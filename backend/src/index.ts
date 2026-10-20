import {handleGatedAuthRequest} from './auth-api'
import {handleEmailAuthRequest} from './email-auth-api'
import type {EmailAuthEnvironment,AuthBackgroundContext} from './email-auth-api'

/**
 * OrderLead backend foundation only.
 *
 * IMPORTANT: No user authentication or data sync is enabled in this Issue.
 * The health route is the only public API. All /v1 routes fail closed.
 */
export interface D1HealthBinding {
  prepare(query: string): {
    first<T>(): Promise<T | null>
  }
}
export interface Env {
  DB: D1HealthBinding
  /** Both explicit flags must be set AFTER security review/real D1 tests. */
  AUTH_ROUTES_ENABLED?:string
  AUTH_EDGE_PROTECTED?:string
  /** Email path requires all three gates; legacy device path needs a fourth. */
  EMAIL_AUTH_ENABLED?:string
  LEGACY_DEVICE_AUTH_ENABLED?:string
  /** Mandatory Cloudflare Secret. Never place its value in source code. */
  PASSWORD_PEPPER?:string
}

const responseHeaders={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
}

function json(status:number,body:Record<string,string>):Response{
  return new Response(JSON.stringify(body),{status,headers:responseHeaders})
}

export async function handleRequest(
  request:Request,env:Env,tasks?:AuthBackgroundContext
):Promise<Response>{
  const path=new URL(request.url).pathname

  // All synchronization paths are locked before verified account-based
  // authorization and conflict handling ship. Never accept anonymous writes.
  if(path==='/v1'||path.startsWith('/v1/')){
    // Two independent opt-in gates. Both are unset by default.
    // Every other /v1 route (especially backups) still returns 503.
    if(path.startsWith('/v1/auth/email/')){
      if(env.AUTH_ROUTES_ENABLED==='true'&&
        env.AUTH_EDGE_PROTECTED==='true'&&
        env.EMAIL_AUTH_ENABLED==='true'){
        return handleEmailAuthRequest(request,env as unknown as EmailAuthEnvironment,tasks)
      }
      return json(503,{error:'SYNC_NOT_ENABLED'})
    }
    // Retired UUID+device registration MUST NOT activate accidentally when
    // the new Email login security gates are eventually configured.
    if(path.startsWith('/v1/auth/')&&
      env.AUTH_ROUTES_ENABLED==='true'&&env.AUTH_EDGE_PROTECTED==='true'&&
      env.LEGACY_DEVICE_AUTH_ENABLED==='true'){
      return handleGatedAuthRequest(request,env.DB as unknown as Parameters<typeof handleGatedAuthRequest>[1])
    }
    return json(503,{error:'SYNC_NOT_ENABLED'})
  }

  if(path!=='/health')return json(404,{error:'NOT_FOUND'})
  if(request.method!=='GET')return json(405,{error:'METHOD_NOT_ALLOWED'})

  try {
    const row=await env.DB.prepare('SELECT 1 AS healthy').first<{healthy:number}>()
    if(row?.healthy!==1)throw new Error('D1 unavailable')
    return json(200,{service:'orderlead-api',status:'ok'})
  } catch {
    // No stack traces, SQL errors or credentials in public responses.
    return json(503,{service:'orderlead-api',status:'unavailable'})
  }
}

export default {
  fetch(request:Request,env:Env,ctx?:AuthBackgroundContext):Promise<Response>{
    return handleRequest(request,env,ctx)
  }
}
