/** Small client-side sync receipt. Never stores any trade record, Email,
 * password, bearer token or unfinished upload as proof of completion.
 * User data is ONLY synced when a server-verified backup ID is present in
 * the authenticated owner's fresh cloud backup list AND all nine local store
 * hashes are identical to the successful upload.
 */
import {STORE_NAMES} from './db'
import type {CloudBackupManifest} from './cloud-backup-snapshot'

export const SYNC_MARKER_KEY='orderlead.cloud-sync-marker.v1'
export type SyncMarker=Readonly<{backupId:string,contentSignature:string}>
const hex=/^[0-9a-f]{64}$/
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export async function contentSignature(manifest:CloudBackupManifest):Promise<string>{
  const data=STORE_NAMES.map(store=>{
    const hash=manifest.storeSha256?.[store]
    const count=manifest.storeCounts?.[store]
    if(typeof hash!=='string'||!hex.test(hash)||
       !Number.isSafeInteger(count)||count<0)
      throw Error('INVALID_SYNC_CONTENT')
    return [store,count,hash]
  })
  // Intentionally excludes backup timestamp/appVersion, which vary between
  // exports even when the actual local rows are unchanged.
  const bytes=new TextEncoder().encode(JSON.stringify(data))
  const hash=await crypto.subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')
}

function validMarker(value:unknown):value is SyncMarker{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const obj=value as Record<string,unknown>
  return Object.keys(obj).sort().join(',')==='backupId,contentSignature'&&
    typeof obj.backupId==='string'&&uuid.test(obj.backupId)&&
    typeof obj.contentSignature==='string'&&hex.test(obj.contentSignature)
}

export function readSyncMarker():SyncMarker|null{
  try{
    const text=localStorage.getItem(SYNC_MARKER_KEY)
    if(!text)return null
    const parsed:unknown=JSON.parse(text)
    return validMarker(parsed)?parsed:null
  }catch{return null}
}
export function rememberSyncMarker(value:SyncMarker):void{
  if(!validMarker(value))throw Error('INVALID_SYNC_MARKER')
  try{localStorage.setItem(SYNC_MARKER_KEY,JSON.stringify(value))}
  catch{/* storage disabled: remain unsynced on next visit, never false-sync */}
}
export function matchedCloudSync(
  marker:SyncMarker|null,
  currentSignature:string,
  completedBackupIds:ReadonlyArray<string>
):boolean{
  return !!marker&&marker.contentSignature===currentSignature&&
    completedBackupIds.includes(marker.backupId)
}
