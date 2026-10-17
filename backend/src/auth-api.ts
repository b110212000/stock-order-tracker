/**
 * Issue #53 part 5: guarded browser-facing auth handler.
 *
 * NOT LIVE BY DEFAULT. index.ts must require AUTH_ROUTES_ENABLED === 'true'.
 * DO NOT set it in Cloudflare before migration 0004, edge rate limiting,
 * recovery-key UI and actual D1 + iPhone integration testing succeed.
 *
 * This handler never exposes trade/backup routes and never authorizes using
 * a UUID alone. Never log request bodies, private keys or bearer tokens.
 */
import {allowedAuthOrigin,authCorsHeaders} from './auth-origin'
import type {AuthRuntimeMode} from './auth-origin'
import {issueRegistrationChallenge,enrollFirstDevice} from './auth-registration'
import type {EnrollmentD1} from './auth-registration'
import {issueDeviceLoginChallenge,verifyDeviceLogin} from './auth-device-login'
import {createDeviceSession,authenticateDeviceSession,listMyAuthorizedDevices,revokeDeviceSession} from './auth-sessions'
import {reserveAuthAttempt,trustedConnectingIp} from './auth-rate-limits'
import {isV4Uuid} from './auth-primitives'

const responseBase={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
}
const allowedRoutes=new Set([
  '/v1/auth/registration-challenge',
  '/v1/auth/register',
  '/v1/auth/login-challenge',
  '/v1/auth/login',
  '/v1/auth/devices',
  '/v1/auth/logout'
])

function json(status:number,data:Record<string,unknown>,origin:string,mode:AuthRuntimeMode):Response{
  const headers=new Headers(responseBase)
  authCorsHeaders(origin,mode).forEach((value,key)=>headers.set(key,value))
  // Never allow shared cache to store credentials or authentication outcomes.
  return new Response(JSON.stringify(data),{status,headers})
}
async function limitedText(req:Request,max:number):Promise<string>{
  const declared=req.headers.get('Content-Length')
  if(declared!==null&&(!/^\d{1,9}$/.test(declared)||Number(declared)>max)){
    throw Error('REQUEST_TOO_LARGE')
  }
  if(!req.body)return ''
  const reader=req.body.getReader()
  const buffers:Uint8Array[]=[]
  let total=0
  try{
    while(true){
      const chunk=await reader.read()
      if(chunk.done)break
      total+=chunk.value.byteLength
      if(total>max){
        await reader.cancel()
        throw Error('REQUEST_TOO_LARGE')
      }
      buffers.push(chunk.value)
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(total)
  let offset=0
  for(const part of buffers){bytes.set(part,offset);offset+=part.length}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes)
}
function readIdPair(raw:string):{userId:string,deviceId:string}{
  let value:unknown
  try{value=JSON.parse(raw)}catch{throw Error('AUTH_FAILED')}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AUTH_FAILED')
  const v=value as Record<string,unknown>
  if(Object.keys(v).sort().join(',')!=='deviceId,userId'||
    !isV4Uuid(v.userId)||!isV4Uuid(v.deviceId))throw Error('AUTH_FAILED')
  return {userId:v.userId,deviceId:v.deviceId}
}
function extractUserForThrottle(raw:string):string|undefined{
  try{
    const body:unknown=JSON.parse(raw)
    if(body&&typeof body==='object'&&!Array.isArray(body)&&
      isV4Uuid((body as Record<string,unknown>).userId)){
      return (body as {userId:string}).userId
    }
  }catch{/* malformed attempts still get IP-throttled */}
  return undefined
}
function bearer(req:Request):string{
  const header=req.headers.get('Authorization')
  const match=/^Bearer ([-_A-Za-z0-9]{43})$/.exec(header??'')
  if(!match)throw Error('AUTHENTICATION_REQUIRED')
  return match[1]
}

export async function handleGatedAuthRequest(
  req:Request,db:EnrollmentD1,mode:AuthRuntimeMode='production',now=Date.now()
):Promise<Response>{
  const url=new URL(req.url)
  // Fail closed if an unexpected query could carry credentials or identifiers.
  if(!allowedRoutes.has(url.pathname)||url.search)return new Response(null,{status:404})
  const origin=allowedAuthOrigin(req,mode)
  if(!origin)return new Response(JSON.stringify({error:'ORIGIN_DENIED'}),{
    status:403,headers:responseBase
  })
  // Production credentials must never be transmitted via cleartext transport.
  if(url.protocol!=='https:'&&!(mode==='development'&&url.hostname==='localhost'||
     mode==='development'&&url.hostname==='127.0.0.1')){
    return json(403,{error:'SECURE_ORIGIN_REQUIRED'},origin,mode)
  }
  if(req.method==='OPTIONS'){
    const wanted=req.headers.get('Access-Control-Request-Method')
    if(wanted!=='POST'&&wanted!=='GET'){
      return json(405,{error:'METHOD_NOT_ALLOWED'},origin,mode)
    }
    const headers=authCorsHeaders(origin,mode)
    headers.set('Cache-Control','no-store')
    return new Response(null,{status:204,headers})
  }
  const isDevices=url.pathname==='/v1/auth/devices'
  if(req.method!==(isDevices?'GET':'POST')){
    return json(405,{error:'METHOD_NOT_ALLOWED'},origin,mode)
  }
  // Enforce exact method + Content-Type on any JSON body. GET never gets one.
  const route=url.pathname
  try{
    const ip=trustedConnectingIp(req)
    if(isDevices){
      const token=bearer(req)
      const account=await authenticateDeviceSession(db,token,now)
      await reserveAuthAttempt(db,'account-devices',ip,now,account.userId)
      const devices=await listMyAuthorizedDevices(db,token,now)
      return json(200,{devices},origin,mode)
    }
    if(route==='/v1/auth/registration-challenge'){
      await reserveAuthAttempt(db,'registration-challenge',ip,now)
      if(req.body){
        const raw=await limitedText(req,32)
        if(raw!=='')throw Error('AUTH_FAILED')
      }
      const challenge=await issueRegistrationChallenge(db,now)
      return json(200,challenge,origin,mode)
    }
    if(route==='/v1/auth/login-challenge'){
      // Reserve an IP attempt BEFORE UUID parsing/lookup, preventing
      // probing the existence of user/device identifiers without a budget.
      const raw=await limitedText(req,512)
      const pair=readIdPair(raw)
      await reserveAuthAttempt(db,'device-challenge',ip,now,pair.userId)
      const challenge=await issueDeviceLoginChallenge(db,pair.userId,pair.deviceId,now)
      return json(200,challenge,origin,mode)
    }
    if(route==='/v1/auth/register'){
      await reserveAuthAttempt(db,'registration-complete',ip,now)
      if(req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
        throw Error('AUTH_FAILED')
      const raw=await limitedText(req,4096)
      const result=await enrollFirstDevice(db,raw,{
        nonce:req.headers.get('X-OrderLead-Nonce')??'',
        signature:req.headers.get('X-OrderLead-Signature')??''
      },now)
      return json(201,result,origin,mode)
    }
    if(route==='/v1/auth/login'){
      if(req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
        throw Error('AUTH_FAILED')
      const raw=await limitedText(req,1024)
      const userId=extractUserForThrottle(raw)
      await reserveAuthAttempt(db,'device-login',ip,now,userId)
      const proof=await verifyDeviceLogin(db,raw,{
        nonce:req.headers.get('X-OrderLead-Nonce')??'',
        signature:req.headers.get('X-OrderLead-Signature')??''
      },now)
      const session=await createDeviceSession(db,proof,now)
      return json(200,{token:session.token,expiresAt:session.expiresAt},origin,mode)
    }
    if(route==='/v1/auth/logout'){
      const token=bearer(req)
      const account=await authenticateDeviceSession(db,token,now)
      await reserveAuthAttempt(db,'account-devices',ip,now,account.userId)
      if(req.body&&(await limitedText(req,32))!=='')throw Error('AUTH_FAILED')
      await revokeDeviceSession(db,token,now)
      return json(200,{status:'signed_out'},origin,mode)
    }
    return json(404,{error:'NOT_FOUND'},origin,mode)
  }catch(error){
    const code=error instanceof Error?error.message:''
    if(code==='AUTH_RATE_LIMITED')return json(429,{error:'TRY_LATER'},origin,mode)
    if(code==='AUTH_RATE_UNAVAILABLE')return json(503,{error:'AUTH_UNAVAILABLE'},origin,mode)
    if(code==='REQUEST_TOO_LARGE')return json(413,{error:'INVALID_REQUEST'},origin,mode)
    if(code==='AUTHENTICATION_REQUIRED')return json(401,{error:'AUTH_FAILED'},origin,mode)
    // Do not distinguish nonexistent UUID, invalid signatures, wrong nonce,
    // revoked devices, unsupported schema, or SQL failures in public replies.
    return json(401,{error:'AUTH_FAILED'},origin,mode)
  }
}
