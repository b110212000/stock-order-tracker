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

/** Refresh quietly while the PWA is in use even if the account panel is closed.
 * A session with more than 29 days remaining is not sent to the network.
 * Offline/429/5xx never log the user out; 401 means a server-revoked token.
 */
let renewalPending=false
export async function renewStoredCloudSession():Promise<void>{
  if(renewalPending)return
  const saved=readCloudSession()
  if(!saved||saved.expiresAt-Date.now()>=29*24*60*60*1000)return
  renewalPending=true
  try{
    const res=await fetch('https://orderlead-api.b110212000.workers.dev/v1/auth/email/me',{
      method:'GET',cache:'no-store',
      headers:{Authorization:'Bearer '+saved.token}
    })
    if(readCloudSession()?.token!==saved.token)return
    if(res.status===401){
      forgetCloudSession()
      return
    }
    if(!res.ok)return
    const owner=await res.json() as {expiresAt?:unknown}
    if(typeof owner.expiresAt!=='number')return
    const updated={token:saved.token,expiresAt:owner.expiresAt}
    if(validCloudSession(updated))rememberCloudSession(updated)
  }catch{/* Offline is not a logout reason. */}
  finally{renewalPending=false}
}
