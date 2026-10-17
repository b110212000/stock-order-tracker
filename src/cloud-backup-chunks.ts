/**
 * A-3.2: prepare upload chunks ONLY; this file deliberately makes no network
 * request and never changes the existing local IndexedDB.
 *
 * Real upload later requires a valid server session, explicit user consent,
 * off-device local backup confirmation, and a verified D1 transaction.
 */
import {STORE_NAMES} from './db'
import {verifyCloudBackupSnapshot} from './cloud-backup-snapshot'
import type {PreparedCloudBackup} from './cloud-backup-snapshot'
import type {Store} from './types'

export type PendingCloudRow=Readonly<{
  storeName:Store
  recordKey:string
  payloadJson:string
}>
export type CloudBackupUploadPlan=Readonly<{
  backupId:string
  chunks:ReadonlyArray<ReadonlyArray<PendingCloudRow>>
  totalRows:number
}>
const encoder=new TextEncoder()
const MAX_ROWS_PER_CHUNK=32
const MAX_CHUNK_BYTES=256*1024
const MAX_ROW_BYTES=64*1024

/**
 * Call this ONLY after prepareLocalCloudBackup() and before any remote IO.
 * Accepts caller-supplied backupId to support retrying an interrupted upload
 * with EXACTLY the same snapshot, rather than silently creating a new backup.
 */
export async function planFirstCloudUpload(
  prepared:PreparedCloudBackup,
  backupId=crypto.randomUUID()
):Promise<CloudBackupUploadPlan>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(backupId)||
    !await verifyCloudBackupSnapshot(prepared.canonicalPayload,prepared.manifest)){
    throw Error('備份快照未通過完整性驗證')
  }
  const backup=JSON.parse(prepared.canonicalPayload) as {stores:Record<Store,Record<string,unknown>[]>}
  const chunks:PendingCloudRow[][]=[]
  let active:PendingCloudRow[]=[]
  let activeBytes=0
  let count=0
  for(const storeName of STORE_NAMES){
    const key=storeName==='stocks'||storeName==='quotes'?'symbol':'id'
    for(const row of backup.stores[storeName]){
      const recordKey=row[key]
      if(typeof recordKey!=='string'||!recordKey||recordKey.length>260)
        throw Error('雲端備份項目識別碼不正確')
      // All values were parsed from canonical JSON: object key order and
      // number formatting remain deterministic.
      const payloadJson=JSON.stringify(row)
      const size=encoder.encode(payloadJson).byteLength
      if(size>MAX_ROW_BYTES)
        throw Error('單筆雲端備份超過 64 KB，請先使用本機備份')
      if(active.length>=MAX_ROWS_PER_CHUNK||activeBytes+size>MAX_CHUNK_BYTES){
        if(active.length)chunks.push(active)
        active=[]
        activeBytes=0
      }
      active.push({storeName,recordKey,payloadJson})
      activeBytes+=size
      count++
    }
  }
  if(active.length)chunks.push(active)
  if(count!==prepared.manifest.total||!chunks.length)
    throw Error('雲端備份筆數不一致')
  return {backupId,chunks,totalRows:count}
}
