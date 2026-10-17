/**
 * Issue #53 third step: device login verification core.
 *
 * This module is deliberately NOT connected to the live Worker router.
 * Do not expose it before rate limiting, strict Origin/CORS controls,
 * an explicit short-lived session design and real D1 concurrency tests.
 * Verification here is NOT a durable session or trade-sync authorization.
 */
import {
  base64UrlEncode,bodyDigest,compareVerifier,decode32ByteToken,
  isV4Uuid,publicDeviceKeyIsValid,verifyDeviceProof
} from './auth-primitives'
import type {DeviceProof} from './auth-primitives'
import type {EnrollmentD1,RegistrationChallenge} from './auth-registration'

const LOGIN_TTL_MS=120_000
const textEncoder=new TextEncoder()
const route='/v1/auth/login'

type AuthorizedDeviceRow={public_jwk:string}
type LoginChallengeRow={
  challenge_id:string
  purpose:string
  user_id:string|null
  device_id:string|null
  nonce_sha256:string
  issued_at:string
  expires_at:string
  consumed_at:string|null
  public_jwk:string
  revoked_at:string|null
}
type LoginRequest={
  challengeId:string
  userId:string
  deviceId:string
}
export type LoginProofHeaders={
  nonce:string
  signature:string
}
export type VerifiedDevice=Readonly<{
  userId:string
  deviceId:string
  verifiedAt:string
}>

function genericFailure():never{throw Error('DEVICE_AUTH_FAILED')}
function iso(time:number){return new Date(time).toISOString()}
function validTime(time:number){return Number.isSafeInteger(time)&&time>=0}
function validLoginRequest(value:unknown):value is LoginRequest{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const body=value as Partial<LoginRequest>
  return Object.keys(body).sort().join(',')==='challengeId,deviceId,userId'&&
    isV4Uuid(body.challengeId)&&isV4Uuid(body.deviceId)&&isV4Uuid(body.userId)
}

/**
 * Caller must FIRST enforce abuse limits. An unknown/revoked device gets
 * exactly the same external error as a malformed attempt: no account hints.
 *
 * A challenge is scoped to one account, one device and the device-login
 * purpose; its nonce is never persisted in plaintext.
 */
export async function issueDeviceLoginChallenge(
  db:EnrollmentD1,userId:string,deviceId:string,now=Date.now()
):Promise<RegistrationChallenge>{
  if(!isV4Uuid(userId)||!isV4Uuid(deviceId)||!validTime(now))return genericFailure()
  const device=await db.prepare(
    'SELECT public_jwk FROM authorized_device_keys WHERE user_id=? AND device_id=? AND revoked_at IS NULL'
  ).bind(userId,deviceId).first<AuthorizedDeviceRow>()
  if(!device)return genericFailure()
  let jwk:unknown
  try{jwk=JSON.parse(device.public_jwk)}catch{return genericFailure()}
  if(!publicDeviceKeyIsValid(jwk))return genericFailure()

  const challengeId=crypto.randomUUID()
  const nonce=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const issuedAt=now
  const expiresAt=issuedAt+LOGIN_TTL_MS
  const digest=await bodyDigest(nonce)
  const inserted=await db.prepare(
    "INSERT INTO auth_challenges (challenge_id,user_id,device_id,purpose,nonce_sha256,issued_at,expires_at,consumed_at) VALUES (?,?,?,'device-login',?,?,?,NULL)"
  ).bind(challengeId,userId,deviceId,digest,iso(issuedAt),iso(expiresAt)).run()
  if(inserted.meta.changes!==1)throw Error('DEVICE_AUTH_UNAVAILABLE')
  return {challengeId,nonce,issuedAt,expiresAt}
}

/**
 * Verify detached ECDSA P-256 proof of an exact JSON request body. A
 * successful result identifies the device only for this one operation;
 * downstream API access will require a separately reviewed session policy.
 *
 * D1.batch() is atomic. Challenge consumption is guarded by a fresh random
 * marker. The two follow-up UPDATE statements only proceed if the first
 * challenge compare-and-set committed. Revocation is rechecked in SQL.
 */
export async function verifyDeviceLogin(
  db:EnrollmentD1,rawBody:string,headers:LoginProofHeaders,now=Date.now()
):Promise<VerifiedDevice>{
  if(typeof rawBody!=='string'||textEncoder.encode(rawBody).byteLength>1024||
    !validTime(now)||!headers||!decode32ByteToken(headers.nonce)||
    typeof headers.signature!=='string')return genericFailure()

  let decoded:unknown
  try{decoded=JSON.parse(rawBody)}catch{return genericFailure()}
  if(!validLoginRequest(decoded))return genericFailure()

  const row=await db.prepare(
    "SELECT c.challenge_id,c.purpose,c.user_id,c.device_id,c.nonce_sha256,c.issued_at,c.expires_at,c.consumed_at,k.public_jwk,k.revoked_at FROM auth_challenges c INNER JOIN authorized_device_keys k ON k.user_id=c.user_id AND k.device_id=c.device_id WHERE c.challenge_id=? AND c.user_id=? AND c.device_id=? AND c.purpose='device-login' AND k.revoked_at IS NULL"
  ).bind(decoded.challengeId,decoded.userId,decoded.deviceId).first<LoginChallengeRow>()
  if(!row||row.purpose!=='device-login'||row.user_id!==decoded.userId||
    row.device_id!==decoded.deviceId||row.consumed_at!==null||row.revoked_at!==null){
    return genericFailure()
  }
  const issuedAt=Date.parse(row.issued_at)
  const expiresAt=Date.parse(row.expires_at)
  if(!validTime(issuedAt)||!validTime(expiresAt)||
    expiresAt-issuedAt!==LOGIN_TTL_MS||issuedAt>now+10_000||
    expiresAt<=now||now-issuedAt>LOGIN_TTL_MS)return genericFailure()
  let publicJwk:unknown
  try{publicJwk=JSON.parse(row.public_jwk)}catch{return genericFailure()}
  if(!publicDeviceKeyIsValid(publicJwk))return genericFailure()
  const nonceDigest=await bodyDigest(headers.nonce)
  if(!compareVerifier(nonceDigest,row.nonce_sha256))return genericFailure()
  const proof:DeviceProof={
    method:'POST',route,issuedAt,
    challenge:headers.nonce,bodySha256:await bodyDigest(rawBody)
  }
  if(!await verifyDeviceProof(publicJwk,proof,headers.signature))return genericFailure()

  const verifiedAt=iso(now)
  const marker=verifiedAt+'#'+crypto.randomUUID()
  const gate='EXISTS (SELECT 1 FROM auth_challenges WHERE challenge_id=? AND consumed_at=?)'
  const results=await db.batch([
    db.prepare(
      "UPDATE auth_challenges SET consumed_at=? WHERE challenge_id=? AND purpose='device-login' AND user_id=? AND device_id=? AND nonce_sha256=? AND consumed_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM authorized_device_keys WHERE user_id=? AND device_id=? AND revoked_at IS NULL)"
    ).bind(marker,decoded.challengeId,decoded.userId,decoded.deviceId,nonceDigest,verifiedAt,decoded.userId,decoded.deviceId),
    db.prepare(
      'UPDATE authorized_device_keys SET last_verified_at=? WHERE user_id=? AND device_id=? AND revoked_at IS NULL AND '+gate
    ).bind(verifiedAt,decoded.userId,decoded.deviceId,decoded.challengeId,marker),
    db.prepare(
      'UPDATE registered_devices SET last_seen_at=? WHERE user_id=? AND device_id=? AND '+gate
    ).bind(verifiedAt,decoded.userId,decoded.deviceId,decoded.challengeId,marker)
  ])
  if(results.length!==3||results.some(result=>result.meta.changes!==1)){
    return genericFailure()
  }
  return Object.freeze({userId:decoded.userId,deviceId:decoded.deviceId,verifiedAt})
}
