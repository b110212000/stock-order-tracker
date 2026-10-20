/**
 * Issue #87 / #75: Worker-local rate limiting is a fast preliminary brake
 * BEFORE D1 queries and PBKDF2. D1's atomic per-IP + per-Email counters
 * remain mandatory; this approximate/colo-local binding is NOT zone WAF.
 * Do not set AUTH_EDGE_PROTECTED just because this binding exists.
 */
import {trustedConnectingIp} from './auth-rate-limits'
import {decode32ByteToken} from './auth-primitives'
import type {EmailRatePurpose} from './email-auth-rate'

export interface AuthRequestRateLimiter {
  limit(input:{key:string}):Promise<{success:boolean}>
}

export interface AuthWorkerRateEnvironment {
  AUTH_REQUEST_LIMITER?:AuthRequestRateLimiter
}

/** All protected requests must be limited before doing expensive work. */
export async function reserveAuthWorkerAttempt(
  env:AuthWorkerRateEnvironment,request:Request,purpose:EmailRatePurpose,
  pepper:string
):Promise<void>{
  if(!env?.AUTH_REQUEST_LIMITER?.limit)throw Error('AUTH_RATE_UNAVAILABLE')
  const secret=decode32ByteToken(pepper)
  if(!secret)throw Error('AUTH_RATE_UNAVAILABLE')
  const ip=trustedConnectingIp(request)
  // A keyed digest prevents raw IP addresses being stored in rate-limit keys.
  try{
    const key=await crypto.subtle.importKey('raw',new Uint8Array(secret).buffer,
      {name:'HMAC',hash:'SHA-256'},false,['sign'])
    const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,
      new TextEncoder().encode('orderlead-auth-worker-rate-v1\n'+purpose+'\n'+ip)))
    const bucket=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('')
    const result=await env.AUTH_REQUEST_LIMITER.limit({key:bucket})
    if(result?.success===false)throw Error('AUTH_RATE_LIMITED')
    if(result?.success!==true)throw Error('AUTH_RATE_UNAVAILABLE')
  }catch(error){
    if(error instanceof Error&&error.message==='AUTH_RATE_LIMITED')throw error
    throw Error('AUTH_RATE_UNAVAILABLE')
  }
}
