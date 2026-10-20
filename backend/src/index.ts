import {handleGatedAuthRequest} from './auth-api'
import {handleEmailAuthRequest} from './email-auth-api'
import {handleBackupRequest} from './cloud-backup-api'
import type {BackupEnvironment} from './cloud-backup-api'
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
  /** Explicit opt-in. Both login and cloud backup stay locked by default. */
  AUTH_ROUTES_ENABLED?:string
  /** Email requires verified Worker+D1 rate controls, not a paid Zone WAF. */
  AUTH_BASIC_LIMITS_READY?:string
  /** Legacy device-only gate is retained but does not open Email routes. */
  AUTH_EDGE_PROTECTED?:string
  /** Email path requires three flags; legacy device path remains separate. */
  EMAIL_AUTH_ENABLED?:string
  /** Separate opt-in: cloud snapshots are never opened by email login alone. */
  BACKUP_RECOVERY_ENABLED?:string
  LEGACY_DEVICE_AUTH_ENABLED?:string
  /** Mandatory Cloudflare Secret. Never place its value in source code. */
  PASSWORD_PEPPER?:string
  /** Per-colo coarse limiter. Mandatory if Email routes are ever enabled. */
  AUTH_REQUEST_LIMITER?:{limit(input:{key:string}):Promise<{success:boolean}>}
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
    // All flags are unset by default. Personal Email auth may use existing
    // Worker+D1 limits without a custom Zone WAF; never open backups here.
    if(path.startsWith('/v1/auth/email/')){
      if(env.AUTH_ROUTES_ENABLED==='true'&&
        env.AUTH_BASIC_LIMITS_READY==='true'&&
        env.EMAIL_AUTH_ENABLED==='true'){
        return handleEmailAuthRequest(request,env as unknown as EmailAuthEnvironment,tasks)
      }
      return json(503,{error:'SYNC_NOT_ENABLED'})
    }
    if(path==='/v1/backups'||path.startsWith('/v1/backups/')){
      if(env.AUTH_ROUTES_ENABLED==='true'&&env.AUTH_BASIC_LIMITS_READY==='true'&&
        env.EMAIL_AUTH_ENABLED==='true'&&env.BACKUP_RECOVERY_ENABLED==='true'){
        return handleBackupRequest(request,env as unknown as BackupEnvironment)
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
