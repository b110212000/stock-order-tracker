import {handleGatedAuthRequest} from './auth-api'
import type {EnrollmentD1} from './auth-registration'

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

export async function handleRequest(request:Request,env:Env):Promise<Response>{
  const path=new URL(request.url).pathname

  // All synchronization paths are locked before verified account-based
  // authorization and conflict handling ship. Never accept anonymous writes.
  if(path==='/v1'||path.startsWith('/v1/')){
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
  fetch(request:Request,env:Env):Promise<Response>{
    return handleRequest(request,env)
  }
}
