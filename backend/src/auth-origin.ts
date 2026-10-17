/**
 * Issue #53: strict Origin policy for future device authentication endpoints.
 *
 * IMPORTANT: CORS is a browser data-exposure control, NOT authentication or
 * CSRF protection. Only enable routes after signing proof, rate limiting,
 * origin enforcement and a short-lived session policy are complete.
 *
 * Not imported into the live Worker yet; /v1/* continues returning 503.
 */
const productionOrigin='https://b110212000.github.io'
const localOrigins=new Set(['http://localhost:5173','http://127.0.0.1:5173'])

export type AuthRuntimeMode='production'|'development'

/** Require exact Origin match. Do not do prefix or substring matching. */
export function allowedAuthOrigin(
  request:Request,mode:AuthRuntimeMode='production'
):string|null{
  const origin=request.headers.get('Origin')
  if(!origin||origin==='null')return null
  try{
    const url=new URL(origin)
    if(url.origin!==origin||url.username||url.password)return null
    if(origin===productionOrigin)return origin
    if(mode==='development'&&localOrigins.has(origin))return origin
    return null
  }catch{return null}
}

/** Invoke only AFTER allowedAuthOrigin and backend authentication gates. */
export function authCorsHeaders(origin:string,mode:AuthRuntimeMode='production'):Headers{
  if(origin!==productionOrigin&&!(mode==='development'&&localOrigins.has(origin))){
    throw Error('INVALID_CORS_ORIGIN')
  }
  const headers=new Headers()
  headers.set('Access-Control-Allow-Origin',origin)
  headers.set('Vary','Origin')
  headers.set('Access-Control-Allow-Methods','POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers','Content-Type,X-OrderLead-Nonce,X-OrderLead-Signature')
  headers.set('Access-Control-Max-Age','300')
  return headers
}
