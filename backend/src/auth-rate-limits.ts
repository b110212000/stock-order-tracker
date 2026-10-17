/**
 * Issue #53 step 4. Atomic D1 fixed-window abuse counters.
 *
 * This is a SECOND line of defence. Enable Cloudflare's edge WAF/rate limit
 * too before public authentication. Never store raw IP or trust user-provided
 * X-Forwarded-For. Cloudflare's CF-Connecting-IP is read only at the Worker
 * ingress; absent or malformed values must fail closed.
 *
 * There is deliberately no public router integration in this phase.
 */
import {bodyDigest,isV4Uuid} from './auth-primitives'
import type {EnrollmentD1} from './auth-registration'

export type AuthRatePurpose=
  'registration-challenge'|'registration-complete'|
  'device-challenge'|'device-login'|'account-devices'

const WINDOW_MS=5*60*1000
const limits:Record<AuthRatePurpose,{ip:number,account:number}>={
  'registration-challenge':{ip:6,account:0},
  'registration-complete':{ip:12,account:0},
  'device-challenge':{ip:15,account:8},
  'device-login':{ip:15,account:8},
  'account-devices':{ip:30,account:20}
}
type Bucket={scope:'ip'|'account',value:string,limit:number}

function validIngressAddress(value:string|null):value is string{
  if(!value||value.length>45||value.includes(',')||/\s/.test(value))return false
  // Reject hostnames and user-controlled forwarded IP lists. Cloudflare sets
  // CF-Connecting-IP. IPv6 zones, brackets and ports are not accepted.
  if(value.includes(':'))return /^[0-9a-fA-F:]+$/.test(value)&&value.includes(':')
  const parts=value.split('.')
  return parts.length===4&&parts.every(x=>/^\d{1,3}$/.test(x)&&+x>=0&&+x<=255)
}

export function trustedConnectingIp(request:Request):string{
  const ip=request.headers.get('CF-Connecting-IP')
  if(!validIngressAddress(ip))throw Error('AUTH_RATE_UNAVAILABLE')
  return ip.toLowerCase()
}

/**
 * Reserve attempts *before* issuing challenges or checking whether a UUID
 * exists. Each UPDATE is atomic and caps at the configured bound. Even bad
 * signatures and unknown accounts must consume the same request budget.
 */
export async function reserveAuthAttempt(
  db:EnrollmentD1,purpose:AuthRatePurpose,
  ingressIp:string,now=Date.now(),accountId?:string
):Promise<void>{
  if(!Object.hasOwn(limits,purpose)||!validIngressAddress(ingressIp)||
    !Number.isSafeInteger(now)||now<0||
    (accountId!==undefined&&!isV4Uuid(accountId))){
    throw Error('AUTH_RATE_UNAVAILABLE')
  }
  const rule=limits[purpose]
  const buckets:Bucket[]=[{scope:'ip',value:ingressIp.toLowerCase(),limit:rule.ip}]
  if(accountId&&rule.account>0){
    buckets.push({scope:'account',value:accountId,limit:rule.account})
  }
  const windowId=Math.floor(now/WINDOW_MS)
  const begins=windowId*WINDOW_MS
  const expiresAt=new Date(begins+WINDOW_MS).toISOString()
  for(const bucket of buckets){
    const hash=await bodyDigest(
      ['orderlead-auth-rate-v1',purpose,bucket.scope,bucket.value,windowId].join('\n')
    )
    const res=await db.prepare(
      'INSERT INTO auth_request_limits (bucket_id,window_started_ms,attempts,expires_at) VALUES (?,?,1,?) ON CONFLICT(bucket_id) DO UPDATE SET attempts=auth_request_limits.attempts+1 WHERE auth_request_limits.attempts < ?'
    ).bind(hash,begins,expiresAt,bucket.limit).run()
    if(res.meta.changes!==1)throw Error('AUTH_RATE_LIMITED')
  }
}

/** Per-user and per-device protections only complement ingress IP throttling. */
export const authRateWindowMs=WINDOW_MS
