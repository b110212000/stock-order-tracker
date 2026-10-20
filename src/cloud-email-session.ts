/** Remembered OrderLead session for a personal device.
 * Only the 256-bit random bearer token and expiry are retained.
 * Server /me must verify ownership on every app restart; cached state is
 * never sufficient to show the logged-in UI or authorize backup access.
 *
 * GitHub Pages projects on the same hostname share an origin. Persistent
 * login is therefore only suitable for a device under the user's control.
 */
export type CloudEmailSession=Readonly<{token:string,expiresAt:number}>
export const CLOUD_SESSION_KEY='orderlead.email-session.v2'
const LEGACY_SESSION_KEY='orderlead.email-session.v1'
const MAX_SESSION_MS=30*24*60*60*1000
const tokenOk=/^[-_A-Za-z0-9]{43}$/
let inMemory:CloudEmailSession|null=null

export function validCloudSession(input:unknown,now=Date.now()):input is CloudEmailSession{
  if(!input||typeof input!=='object'||Array.isArray(input))return false
  const value=input as Record<string,unknown>
  return Object.keys(value).sort().join(',')==='expiresAt,token'&&
    typeof value.token==='string'&&tokenOk.test(value.token)&&
    typeof value.expiresAt==='number'&&Number.isSafeInteger(value.expiresAt)&&
    value.expiresAt>now+5000&&value.expiresAt<=now+MAX_SESSION_MS+5000
}

export function forgetCloudSession():void{
  inMemory=null
  try{localStorage.removeItem(CLOUD_SESSION_KEY)}catch{/* private browsing */}
  try{sessionStorage.removeItem(LEGACY_SESSION_KEY)}catch{/* private browsing */}
  try{sessionStorage.removeItem(CLOUD_SESSION_KEY)}catch{/* private browsing */}
}

export function rememberCloudSession(value:CloudEmailSession):void{
  if(!validCloudSession(value))throw Error('INVALID_SESSION')
  inMemory={token:value.token,expiresAt:value.expiresAt}
  try{localStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(inMemory))}
  catch{
    // On storage-restricted phones keep in-memory navigation working,
    // and prefer tab-scoped storage if localStorage cannot be used.
    try{sessionStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(inMemory))}
    catch{/* memory fallback */}
  }
  try{sessionStorage.removeItem(LEGACY_SESSION_KEY)}catch{/* restricted mode */}
}

export function readCloudSession():CloudEmailSession|null{
  if(validCloudSession(inMemory))return inMemory
  if(inMemory)forgetCloudSession()
  try{
    const stored=localStorage.getItem(CLOUD_SESSION_KEY)
    if(stored){
      const parsed:unknown=JSON.parse(stored)
      if(validCloudSession(parsed)){
        inMemory={token:parsed.token,expiresAt:parsed.expiresAt}
        return inMemory
      }
      localStorage.removeItem(CLOUD_SESSION_KEY)
    }
  }catch{/* unavailable storage/corrupt data */}
  for(const key of [CLOUD_SESSION_KEY,LEGACY_SESSION_KEY]){
    try{
      const stored=sessionStorage.getItem(key)
      if(!stored)continue
      const parsed:unknown=JSON.parse(stored)
      if(validCloudSession(parsed)){
        rememberCloudSession(parsed)
        return inMemory
      }
      sessionStorage.removeItem(key)
    }catch{/* unavailable/corrupt storage */}
  }
  return null
}
