/**
 * Issue #53, server enrollment core. NOT ROUTED by src/index.ts.
 *
 * This module deliberately is not called by any public /v1/* endpoint yet.
 * Before enabling it: install edge/IP rate limiting, per-account throttles,
 * exact CORS allowlist, CSRF/origin checks, payload size caps, backup-key
 * confirmation UI, and end-to-end D1 tests. All /v1/* remains HTTP 503.
 */
import {
  base64UrlEncode,bodyDigest,compareVerifier,decode32ByteToken,
  isV4Uuid,publicDeviceKeyIsValid,verifyDeviceProof
} from './auth-primitives'
import type {DeviceProof} from './auth-primitives'

export interface EnrollmentStatement{
  bind(...params:(string|number|null)[]):EnrollmentStatement
  first<T>():Promise<T|null>
  run():Promise<{meta:{changes:number}}>
}
export interface EnrollmentD1{
  prepare(sql:string):EnrollmentStatement
  /** Cloudflare D1 batch runs atomically: all statements commit or all roll back. */
  batch(statements:EnrollmentStatement[]):Promise<Array<{meta:{changes:number}}>>
}
export type RegistrationChallenge={
  challengeId:string
  nonce:string
  issuedAt:number
  expiresAt:number
}
type ChallengeRow={
  challenge_id:string
  purpose:string
  user_id:string|null
  device_id:string|null
  nonce_sha256:string
  issued_at:string
  expires_at:string
  consumed_at:string|null
}
export type EnrollmentBody={
  challengeId:string
  userId:string
  deviceId:string
  publicJwk:JsonWebKey
  recoveryVerifierSha256:string
}
export type EnrollmentHeaders={
  /** 32-byte, server-issued nonce. Not an authentication token by itself. */
  nonce:string
  /** Base64url-encoded 64-byte ECDSA P-256/SHA-256 signature. */
  signature:string
}
export type EnrollmentResult={userId:string,deviceId:string}

const TTL_MS=120_000
const HEX_256=/^[0-9a-f]{64}$/
const encoder=new TextEncoder()

function invalid():never{
  throw Error('REGISTRATION_INVALID')
}
function iso(ms:number):string{
  return new Date(ms).toISOString()
}
function validPayload(value:unknown):value is EnrollmentBody{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const x=value as Partial<EnrollmentBody>
  return Object.keys(x).sort().join(',')===
    'challengeId,deviceId,publicJwk,recoveryVerifierSha256,userId'&&
    isV4Uuid(x.challengeId)&&isV4Uuid(x.userId)&&isV4Uuid(x.deviceId)&&
    x.userId!==x.deviceId&&publicDeviceKeyIsValid(x.publicJwk)&&
    typeof x.recoveryVerifierSha256==='string'&&
    HEX_256.test(x.recoveryVerifierSha256)
}

/** Must be invoked only after API gateway origin + abuse protection. */
export async function issueRegistrationChallenge(
  db:EnrollmentD1,
  now=Date.now()
):Promise<RegistrationChallenge>{
  if(!Number.isSafeInteger(now)||now<0)throw Error('INVALID_CLOCK')
  const issuedAt=now,expiresAt=now+TTL_MS
  const challengeId=crypto.randomUUID()
  const nonce=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const nonceSha256=await bodyDigest(nonce)
  const result=await db.prepare(
    'INSERT INTO auth_challenges (challenge_id,user_id,device_id,purpose,nonce_sha256,issued_at,expires_at,consumed_at) VALUES (?,NULL,NULL,\'registration\',?,?,?,NULL)'
  ).bind(challengeId,nonceSha256,iso(issuedAt),iso(expiresAt)).run()
  if(result.meta.changes!==1)throw Error('CHALLENGE_UNAVAILABLE')
  return {challengeId,nonce,issuedAt,expiresAt}
}

/**
 * Detached signature: sign the exact serialized request body text with
 * signCloudDeviceRequest(identity,{nonce,issuedAt},{
 *   method:'POST',route:'/v1/auth/register',body:rawBody
 * }).
 *
 * Caller MUST compare the browser-sent signature with the key included in
 * the body, and require explicit offline recovery-key backup confirmation.
 * This code never accepts/stores the plaintext recovery secret.
 */
export async function enrollFirstDevice(
  db:EnrollmentD1,
  rawBody:string,
  headers:EnrollmentHeaders,
  now=Date.now()
):Promise<EnrollmentResult>{
  if(typeof rawBody!=='string'||encoder.encode(rawBody).byteLength>4096||
     !Number.isSafeInteger(now)||!headers||!decode32ByteToken(headers.nonce)||
     typeof headers.signature!=='string'){
    return invalid()
  }
  let body:unknown
  try{body=JSON.parse(rawBody)}catch{return invalid()}
  if(!validPayload(body))return invalid()
  const challenge=await db.prepare(
    'SELECT challenge_id,purpose,user_id,device_id,nonce_sha256,issued_at,expires_at,consumed_at FROM auth_challenges WHERE challenge_id=?'
  ).bind(body.challengeId).first<ChallengeRow>()
  if(!challenge||challenge.purpose!=='registration'||challenge.user_id!==null||
     challenge.device_id!==null||challenge.consumed_at!==null)return invalid()
  const issuedAt=Date.parse(challenge.issued_at)
  const expiresAt=Date.parse(challenge.expires_at)
  if(!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(expiresAt)||
     issuedAt>now+10_000||expiresAt<=now||expiresAt-issuedAt!==TTL_MS||
     now-issuedAt>TTL_MS)return invalid()

  // Treat hash as non-secret, but compare fixed-length values without early exit.
  const nonceSha256=await bodyDigest(headers.nonce)
  if(!compareVerifier(nonceSha256,challenge.nonce_sha256))return invalid()
  const proof:DeviceProof={
    method:'POST',route:'/v1/auth/register',issuedAt,
    challenge:headers.nonce,bodySha256:await bodyDigest(rawBody)
  }
  if(!await verifyDeviceProof(body.publicJwk,proof,headers.signature))return invalid()

  const stamp=iso(now)
  // Unique marker protects against the second racing submission using the
  // timestamp from the first submit. All INSERTs depend on this marker.
  const marker=stamp+'#'+crypto.randomUUID()
  const scope='EXISTS (SELECT 1 FROM auth_challenges WHERE challenge_id=? AND consumed_at=?)'
  const statements=[
    db.prepare(
      'UPDATE auth_challenges SET consumed_at=? WHERE challenge_id=? AND purpose=\'registration\' AND consumed_at IS NULL AND user_id IS NULL AND device_id IS NULL AND expires_at>? AND nonce_sha256=?'
    ).bind(marker,body.challengeId,stamp,nonceSha256),
    db.prepare(
      'INSERT INTO account_users (id,auth_provider,auth_subject,created_at) SELECT ?,\'orderlead-device-v1\',?,? WHERE '+scope
    ).bind(body.userId,body.userId,stamp,body.challengeId,marker),
    db.prepare(
      'INSERT INTO registered_devices (user_id,device_id,label,last_seen_at) SELECT ?,?,NULL,? WHERE '+scope
    ).bind(body.userId,body.deviceId,stamp,body.challengeId,marker),
    db.prepare(
      'INSERT INTO account_recovery_verifiers (user_id,verifier_sha256,created_at) SELECT ?,?,? WHERE '+scope
    ).bind(body.userId,body.recoveryVerifierSha256,stamp,body.challengeId,marker),
    db.prepare(
      'INSERT INTO authorized_device_keys (user_id,device_id,public_jwk,created_at) SELECT ?,?,?,? WHERE '+scope
    ).bind(body.userId,body.deviceId,JSON.stringify(body.publicJwk),stamp,body.challengeId,marker)
  ]
  // D1 batch is a SQL transaction: if any constraint fails, no account or
  // key is committed. Never split into individually awaited .run() calls.
  const results=await db.batch(statements)
  if(results.length!==5||results.some(item=>item.meta.changes!==1)){
    return invalid()
  }
  return {userId:body.userId,deviceId:body.deviceId}
}
