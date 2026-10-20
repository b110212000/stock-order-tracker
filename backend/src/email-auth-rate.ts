/**
 * Server-only Email authentication request quotas. No public access and
 * no raw addresses or IPs persisted. The per-Email quota uses an HMAC with
 * PASSWORD_PEPPER (Cloudflare secret), not a reversible/dictionary SHA hash.
 *
 * D1 counters complement -- NEVER replace -- edge WAF and abuse detection.
 */
import {bodyDigest,decode32ByteToken} from './auth-primitives'
import {normalizeEmailAddress} from './email-password-primitives'
import {trustedConnectingIp} from './auth-rate-limits'
import type {EnrollmentD1} from './auth-registration'

export type EmailRatePurpose='register'|'verify'|'login'|'forgot'|'reset'|'session'
const WINDOW=5*60*1000
const limits:Record<EmailRatePurpose,{ip:number,email:number}>={
  register:{ip:6,email:3},
  verify:{ip:12,email:0},
  login:{ip:12,email:5},
  forgot:{ip:6,email:2},
  reset:{ip:12,email:0},
  session:{ip:30,email:0}
}
function asTime(now:number):void{
  if(!Number.isSafeInteger(now)||now<0)throw Error('AUTH_RATE_UNAVAILABLE')
}
async function storeBucket(
  db:EnrollmentD1,id:string,limit:number,now:number
):Promise<void>{
  const start=Math.floor(now/WINDOW)*WINDOW
  const res=await db.prepare(
    'INSERT INTO auth_request_limits (bucket_id,window_started_ms,attempts,expires_at) VALUES (?,?,1,?) ON CONFLICT(bucket_id) DO UPDATE SET attempts=auth_request_limits.attempts+1 WHERE auth_request_limits.attempts < ?'
  ).bind(id,start,new Date(start+WINDOW).toISOString(),limit).run()
  if(res.meta.changes!==1)throw Error('AUTH_RATE_LIMITED')
}
async function hmacAddress(email:string,pepper:string):Promise<string>{
  const secret=decode32ByteToken(pepper)
  if(!secret)throw Error('AUTH_RATE_UNAVAILABLE')
  const key=await crypto.subtle.importKey('raw',new Uint8Array(secret).buffer,{
    name:'HMAC',hash:'SHA-256'
  },false,['sign'])
  const signature=await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode('orderlead-email-rate-v1\n'+email))
  return Array.from(new Uint8Array(signature),v=>v.toString(16).padStart(2,'0')).join('')
}

/** Must run for every incoming auth attempt, even with malformed JSON. */
export async function reserveEmailIpAttempt(
  db:EnrollmentD1,request:Request,purpose:EmailRatePurpose,now=Date.now()
):Promise<void>{
  asTime(now)
  if(!Object.hasOwn(limits,purpose))throw Error('AUTH_RATE_UNAVAILABLE')
  const ip=trustedConnectingIp(request)
  const key=await bodyDigest(['orderlead-email-auth-ip-v1',purpose,ip,
    Math.floor(now/WINDOW)].join('\n'))
  await storeBucket(db,key,limits[purpose].ip,now)
}

/**
 * Call after the IP reservation; exactly one per request with a parseable
 * address. A new IP cannot bypass this shared, secret-keyed Email quota.
 */
export async function reserveEmailAddressAttempt(
  db:EnrollmentD1,rawEmail:unknown,purpose:EmailRatePurpose,
  pepper:string,now=Date.now()
):Promise<void>{
  asTime(now)
  if(!Object.hasOwn(limits,purpose)||limits[purpose].email<=0)
    throw Error('AUTH_RATE_UNAVAILABLE')
  const email=normalizeEmailAddress(rawEmail)
  const keyed=await hmacAddress(email,pepper)
  const id=await bodyDigest(['orderlead-email-auth-identity-v1',purpose,keyed,
    Math.floor(now/WINDOW)].join('\n'))
  await storeBucket(db,id,limits[purpose].email,now)
}
