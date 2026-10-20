/** Short-lived OrderLead Email session, scoped to one PWA tab.
 * No password, verified email or trade records are persisted here.
 * The server remains authoritative: UI must call /v1/auth/email/me on restore.
 */
export type CloudEmailSession=Readonly<{token:string,expiresAt:number}>
export const CLOUD_SESSION_KEY='orderlead.email-session.v1'
const tokenOk=/^[-_A-Za-z0-9]{43}$/
let inMemory:CloudEmailSession|null=null

export function validCloudSession(input:unknown,now=Date.now()):input is CloudEmailSession{
  if(!input||typeof input!=='object'||Array.isArray(input))return false
  const value=input as Record<string,unknown>
  return Object.keys(value).sort().join(',')==='expiresAt,token'&&
    typeof value.token==='string'&&tokenOk.test(value.token)&&
    typeof value.expiresAt==='number'&&Number.isSafeInteger(value.expiresAt)&&
    value.expiresAt>now+5000&&value.expiresAt<=now+15*60*1000+5000
}

export function forgetCloudSession():void{
  inMemory=null
  try{sessionStorage.removeItem(CLOUD_SESSION_KEY)}catch{/* private mode */}
}

export function rememberCloudSession(value:CloudEmailSession):void{
  if(!validCloudSession(value))throw Error('INVALID_SESSION')
  inMemory={token:value.token,expiresAt:value.expiresAt}
  try{sessionStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(inMemory))}
  catch{/* memory fallback keeps internal navigation logged in */}
}

export function readCloudSession():CloudEmailSession|null{
  if(validCloudSession(inMemory))return inMemory
  if(inMemory)forgetCloudSession()
  try{
    const stored=sessionStorage.getItem(CLOUD_SESSION_KEY)
    if(!stored)return null
    const parsed:unknown=JSON.parse(stored)
    if(validCloudSession(parsed)){
      inMemory={token:parsed.token,expiresAt:parsed.expiresAt}
      return inMemory
    }
    forgetCloudSession()
  }catch{/* unavailable, corrupt or blocked storage: leave safe memory only */}
  return null
}
