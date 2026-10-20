/**
 * Issue #79 / parent #75: Email auth HTTP adapter.
 *
 * The Worker entrypoint must check three EXPLICIT flags before calling it:
 * AUTH_ROUTES_ENABLED, AUTH_EDGE_PROTECTED, EMAIL_AUTH_ENABLED.
 * Do NOT enable them before Cloudflare edge WAF, migration 0005 and real D1
 * + SMTP + iPhone acceptance. This never exposes financial data.
 */
import {allowedAuthOrigin,authCorsHeaders} from './auth-origin'
import type {EnrollmentD1} from './auth-registration'
import {reserveEmailIpAttempt,reserveEmailAddressAttempt} from './email-auth-rate'
import type {EmailRatePurpose} from './email-auth-rate'
import {
  prepareEmailSignup,confirmEmailSignup,loginEmailPassword,
  authenticateEmailSession,logoutEmailSession,
  preparePasswordReset,confirmPasswordReset
} from './email-auth-core'
import {requestAuthEmail} from './mlb-mail'
import type {OrderLeadMailEnv} from './mlb-mail'
import {decode32ByteToken} from './auth-primitives'
import {normalizePassword} from './email-password-primitives'

export type EmailAuthEnvironment=OrderLeadMailEnv&{
  DB:EnrollmentD1
  PASSWORD_PEPPER?:string
}
const routes=new Map<string,{method:'GET'|'POST',purpose:EmailRatePurpose}>([
  ['/v1/auth/email/register',{method:'POST',purpose:'register'}],
  ['/v1/auth/email/verify',{method:'POST',purpose:'verify'}],
  ['/v1/auth/email/login',{method:'POST',purpose:'login'}],
  ['/v1/auth/email/logout',{method:'POST',purpose:'session'}],
  ['/v1/auth/email/me',{method:'GET',purpose:'session'}],
  ['/v1/auth/email/forgot-password',{method:'POST',purpose:'forgot'}],
  ['/v1/auth/email/reset-password',{method:'POST',purpose:'reset'}]
])
const headers:Record<string,string>={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff'
}
function response(status:number,body:Record<string,unknown>,origin:string):Response{
  const h=new Headers(headers)
  authCorsHeaders(origin).forEach((v,k)=>h.set(k,v))
  return new Response(JSON.stringify(body),{status,headers:h})
}
async function readJson(request:Request,cap=2048):Promise<unknown>{
  if(request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
    throw Error('INVALID_INPUT')
  if(request.headers.get('Content-Length')&&
    Number(request.headers.get('Content-Length'))>cap)throw Error('INPUT_TOO_LARGE')
  if(!request.body)throw Error('INVALID_INPUT')
  const reader=request.body.getReader()
  let size=0
  const chunks:Uint8Array[]=[]
  try{
    while(true){
      const result=await reader.read()
      if(result.done)break
      size+=result.value.byteLength
      if(size>cap)throw Error('INPUT_TOO_LARGE')
      chunks.push(result.value)
    }
  }finally{reader.releaseLock()}
  const total=new Uint8Array(size)
  let off=0
  for(const chunk of chunks){total.set(chunk,off);off+=chunk.byteLength}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(total))}
  catch{throw Error('INVALID_INPUT')}
}
function fields(value:unknown,names:string[]):Record<string,string>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_INPUT')
  const obj=value as Record<string,unknown>
  if(Object.keys(obj).sort().join(',')!==[...names].sort().join(',')||
    names.some(k=>typeof obj[k]!=='string'))throw Error('INVALID_INPUT')
  return obj as Record<string,string>
}
function token(body:Record<string,string>):string{
  if(!decode32ByteToken(body.token))throw Error('INVALID_INPUT')
  return body.token
}
function equalPasswords(body:Record<string,string>):void{
  if(normalizePassword(body.password)!==normalizePassword(body.confirmPassword))
    throw Error('INVALID_INPUT')
}
function bearer(request:Request):string{
  const value=request.headers.get('Authorization')
  const match=/^Bearer ([-_A-Za-z0-9]{43})$/.exec(value||'')
  if(!match||!decode32ByteToken(match[1]))throw Error('AUTHENTICATION_REQUIRED')
  return match[1]
}
function validPepper(env:EmailAuthEnvironment):string{
  if(typeof env.PASSWORD_PEPPER!=='string'||
    !decode32ByteToken(env.PASSWORD_PEPPER))throw Error('EMAIL_AUTH_UNAVAILABLE')
  return env.PASSWORD_PEPPER
}

/** Frontend-visible API only when ALL gates on index.ts explicitly pass. */
export async function handleEmailAuthRequest(
  request:Request,env:EmailAuthEnvironment,now=Date.now()
):Promise<Response>{
  const url=new URL(request.url)
  const route=routes.get(url.pathname)
  // Do not accept credentials/tokens through query strings or arbitrary paths.
  if(!route||url.search)return new Response(null,{status:404})
  const origin=allowedAuthOrigin(request,'production')
  if(!origin)return new Response(JSON.stringify({error:'ORIGIN_DENIED'}),{
    status:403,headers
  })
  if(url.protocol!=='https:')return response(403,{error:'HTTPS_REQUIRED'},origin)
  if(request.method==='OPTIONS'){
    const preflight=request.headers.get('Access-Control-Request-Method')
    if(preflight!==route.method)return response(405,{error:'METHOD_NOT_ALLOWED'},origin)
    const h=authCorsHeaders(origin)
    h.set('Cache-Control','no-store')
    return new Response(null,{status:204,headers:h})
  }
  if(request.method!==route.method)return response(405,{error:'METHOD_NOT_ALLOWED'},origin)

  try{
    // Fail closed if the DB, mail transport or server secret isn't ready.
    // WAF/edge gate is separately enforced by handleRequest().
    if(!env?.DB)throw Error('EMAIL_AUTH_UNAVAILABLE')
    const pepper=validPepper(env)
    await reserveEmailIpAttempt(env.DB,request,route.purpose,now)

    switch(url.pathname){
      case '/v1/auth/email/register':{
        const body=fields(await readJson(request),['email','password','confirmPassword'])
        equalPasswords(body)
        await reserveEmailAddressAttempt(env.DB,body.email,'register',pepper,now)
        const intent=await prepareEmailSignup(env.DB,body.email,body.password,pepper,now)
        if(intent){
          try{await requestAuthEmail(env,intent.kind,intent.email,intent.token,intent.messageId)}
          catch{/* Generic response: never disclose registration status by SMTP success */ }
        }
        return response(202,{status:'check_email_if_eligible'},origin)
      }
      case '/v1/auth/email/verify':{
        const body=fields(await readJson(request),['token'])
        const result=await confirmEmailSignup(env.DB,token(body),now)
        if(!result)return response(400,{error:'INVALID_OR_EXPIRED_LINK'},origin)
        return response(200,{status:'email_verified_sign_in'},origin)
      }
      case '/v1/auth/email/login':{
        const body=fields(await readJson(request),['email','password'])
        await reserveEmailAddressAttempt(env.DB,body.email,'login',pepper,now)
        const session=await loginEmailPassword(env.DB,body.email,body.password,pepper,now)
        return response(200,{token:session.token,expiresAt:session.expiresAt},origin)
      }
      case '/v1/auth/email/forgot-password':{
        const body=fields(await readJson(request),['email'])
        await reserveEmailAddressAttempt(env.DB,body.email,'forgot',pepper,now)
        const intent=await preparePasswordReset(env.DB,body.email,now)
        if(intent){
          try{await requestAuthEmail(env,intent.kind,intent.email,intent.token,intent.messageId)}
          catch{/* Even a mail outage must not enumerate registered addresses. */}
        }
        return response(202,{status:'check_email_if_eligible'},origin)
      }
      case '/v1/auth/email/reset-password':{
        const body=fields(await readJson(request),['token','password','confirmPassword'])
        equalPasswords(body)
        const success=await confirmPasswordReset(env.DB,token(body),body.password,pepper,now)
        if(!success)return response(400,{error:'INVALID_OR_EXPIRED_LINK'},origin)
        return response(200,{status:'password_reset_sign_in_again'},origin)
      }
      case '/v1/auth/email/logout':{
        if(request.body){
          const bytes=Number(request.headers.get('Content-Length'))
          if(bytes>0)throw Error('INVALID_INPUT')
          // Reject streamed or unknown-length request bodies as well.
          const data=await request.text()
          if(data!=='')throw Error('INVALID_INPUT')
        }
        await logoutEmailSession(env.DB,bearer(request),now)
        return response(200,{status:'signed_out'},origin)
      }
      case '/v1/auth/email/me':{
        const owner=await authenticateEmailSession(env.DB,bearer(request),now)
        // Only authenticated Session supplies owner, never a user-submitted UUID.
        return response(200,{userId:owner.userId,expiresAt:owner.expiresAt},origin)
      }
      default:return response(404,{error:'NOT_FOUND'},origin)
    }
  }catch(error){
    const reason=error instanceof Error?error.message:''
    if(reason==='AUTH_RATE_LIMITED')return response(429,{error:'TRY_LATER'},origin)
    if(reason==='AUTH_RATE_UNAVAILABLE'||reason==='EMAIL_AUTH_UNAVAILABLE'||
      reason==='PASSWORD_PEPPER_UNAVAILABLE')return response(503,{error:'AUTH_UNAVAILABLE'},origin)
    if(reason==='INPUT_TOO_LARGE')return response(413,{error:'INVALID_INPUT'},origin)
    if(reason==='AUTHENTICATION_REQUIRED'||reason==='EMAIL_AUTH_FAILED')
      return response(401,{error:'AUTH_FAILED'},origin)
    if(reason==='INVALID_INPUT'||reason==='INVALID_PASSWORD'||reason==='INVALID_EMAIL')
      return response(400,{error:'INVALID_INPUT'},origin)
    // SQL, Worker binding, timeout and other unexpected failures never
    // disclose D1 schema, existing Email, tokens, passwords or stack traces.
    return response(503,{error:'AUTH_UNAVAILABLE'},origin)
  }
}
