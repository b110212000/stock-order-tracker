/**
 * Issue #53 step 4 — short-lived, revocable, device-bound bearer sessions.
 *
 * PRIVATE CORE ONLY. This file does not make /v1 routes publicly reachable.
 * Invoke createDeviceSession ONLY after verifyDeviceLogin has atomically
 * consumed a signed, non-replayable device challenge. UUIDs grant NOTHING.
 *
 * The bearer token is visible once to the client, must be kept in memory,
 * never in URLs, cookies, localStorage, analytics or logs. D1 stores only
 * a domain-separated digest. Security requires HTTPS, strict Origin checks,
 * rate limits and server-side revocation checks on every protected request.
 */
import {
  base64UrlEncode,bodyDigest,decode32ByteToken,isV4Uuid
} from './auth-primitives'
import type {EnrollmentD1} from './auth-registration'
import type {VerifiedDevice} from './auth-device-login'

const SESSION_TTL_MS=15*60*1000
const SESSION_SKEW_MS=30*1000

type SessionRow={
  user_id:string
  device_id:string
  issued_at:string
  expires_at:string
  revoked_at:string|null
  device_revoked_at:string|null
}
type DeviceRow={
  device_id:string
  label:string|null
  last_seen_at:string
  created_at:string
}

export type AuthenticatedDevice=Readonly<{
  userId:string
  deviceId:string
  expiresAt:number
}>
export type IssuedDeviceSession=Readonly<{
  /** Credential only for the current memory-resident browser session. */
  token:string
  expiresAt:number
}>
export type AuthorizedDeviceSummary=Readonly<{
  deviceId:string
  label:string|null
  lastSeenAt:string
  createdAt:string
}>
const isTime=(v:number)=>Number.isSafeInteger(v)&&v>=0
const iso=(v:number)=>new Date(v).toISOString()
const authFailure=():never=>{throw Error('AUTHENTICATION_REQUIRED')}

async function digestToken(token:string):Promise<string>{
  return bodyDigest('orderlead-device-session-v1\n'+token)
}

/**
 * Rechecks revocation in the INSERT itself. A retired device cannot mint
 * a session even if its login proof was verified a moment before revocation.
 */
export async function createDeviceSession(
  db:EnrollmentD1,proof:VerifiedDevice,now=Date.now()
):Promise<IssuedDeviceSession>{
  if(!proof||!isV4Uuid(proof.userId)||!isV4Uuid(proof.deviceId)||!isTime(now)||
    typeof proof.verifiedAt!=='string')return authFailure()
  const verifiedAt=Date.parse(proof.verifiedAt)
  if(!isTime(verifiedAt)||Math.abs(now-verifiedAt)>SESSION_SKEW_MS)return authFailure()
  const token=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenSha256=await digestToken(token)
  const expiry=now+SESSION_TTL_MS
  const issued=await db.prepare(
    "INSERT INTO auth_device_sessions (token_sha256,user_id,device_id,issued_at,expires_at,revoked_at) SELECT ?,?,?,?, ?,NULL WHERE EXISTS (SELECT 1 FROM authorized_device_keys WHERE user_id=? AND device_id=? AND revoked_at IS NULL)"
  ).bind(tokenSha256,proof.userId,proof.deviceId,iso(now),iso(expiry),proof.userId,proof.deviceId).run()
  if(issued.meta.changes!==1)return authFailure()
  return {token,expiresAt:expiry}
}

/**
 * Protected data must ALWAYS derive its owner from this verified lookup.
 * Never accept a userId from a request body/query when scoping D1 records.
 */
export async function authenticateDeviceSession(
  db:EnrollmentD1,token:unknown,now=Date.now()
):Promise<AuthenticatedDevice>{
  if(typeof token!=='string'||!decode32ByteToken(token)||!isTime(now))return authFailure()
  const digest=await digestToken(token)
  const row=await db.prepare(
    'SELECT s.user_id,s.device_id,s.issued_at,s.expires_at,s.revoked_at,k.revoked_at AS device_revoked_at FROM auth_device_sessions s INNER JOIN authorized_device_keys k ON s.user_id=k.user_id AND s.device_id=k.device_id WHERE s.token_sha256=? AND s.revoked_at IS NULL AND k.revoked_at IS NULL AND s.expires_at>?'
  ).bind(digest,iso(now)).first<SessionRow>()
  if(!row||row.revoked_at!==null||row.device_revoked_at!==null||
    !isV4Uuid(row.user_id)||!isV4Uuid(row.device_id))return authFailure()
  const issuedAt=Date.parse(row.issued_at)
  const expiresAt=Date.parse(row.expires_at)
  if(!isTime(issuedAt)||!isTime(expiresAt)||issuedAt>now||
    expiresAt<=now||expiresAt-issuedAt!==SESSION_TTL_MS)return authFailure()
  return Object.freeze({userId:row.user_id,deviceId:row.device_id,expiresAt})
}

/** Logout/revoke the current session. A second logout does not reactivate it. */
export async function revokeDeviceSession(
  db:EnrollmentD1,token:unknown,now=Date.now()
):Promise<void>{
  if(typeof token!=='string'||!decode32ByteToken(token)||!isTime(now))return authFailure()
  // Do not allow unknown/revoked session to enumerate session existence.
  await authenticateDeviceSession(db,token,now)
  const changed=await db.prepare(
    'UPDATE auth_device_sessions SET revoked_at=? WHERE token_sha256=? AND revoked_at IS NULL'
  ).bind(iso(now),await digestToken(token)).run()
  if(changed.meta.changes!==1)return authFailure()
}

/** A client-provided UUID is NEVER used to select devices. */
export async function listMyAuthorizedDevices(
  db:EnrollmentD1,token:unknown,now=Date.now()
):Promise<ReadonlyArray<AuthorizedDeviceSummary>>{
  const owner=await authenticateDeviceSession(db,token,now)
  // D1 min required interface only declares first/run: expand locally.
  const readDb=db as EnrollmentD1&{
    prepare(sql:string):ReturnType<EnrollmentD1['prepare']>&{
      all<T>():Promise<{results:T[]}>
    }
  }
  const query=readDb.prepare(
    'SELECT d.device_id,d.label,d.last_seen_at,k.created_at FROM registered_devices d INNER JOIN authorized_device_keys k ON d.user_id=k.user_id AND d.device_id=k.device_id WHERE d.user_id=? AND k.revoked_at IS NULL ORDER BY k.created_at, d.device_id LIMIT 100'
  )
  query.bind(owner.userId)
  const {results}=await query.all<DeviceRow>()
  return Object.freeze(results.map(row=>Object.freeze({
    deviceId:row.device_id,label:row.label,
    lastSeenAt:row.last_seen_at,createdAt:row.created_at
  })))
}
