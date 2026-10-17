/**
 * A-3.2 / Issue #66: D1 storage engine for a FIRST FULL cloud backup.
 *
 * UNSHIPPED / NOT ROUTED. There is intentionally NO HTTP entry point.
 * Only an authenticated, non-revoked server-side session may create the
 * branded owner; TypeScript branding alone is NEVER an authorization check.
 * Do not wire this module until Issue #53 (rate limits, sessions, revocation,
 * exact Origin handling) is complete and real D1 tests have passed.
 */
import {bodyDigest,isV4Uuid} from './auth-primitives'
import {
  buildCloudBackupSnapshot,verifyCloudBackupSnapshot
} from '../../src/cloud-backup-snapshot'
import type {CloudBackupManifest,PreparedCloudBackup} from '../../src/cloud-backup-snapshot'
import {BACKUP_FORMAT,MAX_BACKUP_BYTES,validateFullBackup} from '../../src/backup-data'
import type {BackupStores,OrderLeadBackup} from '../../src/backup-data'
import {STORE_NAMES} from '../../src/db'
import type {Store,StoreValue} from '../../src/types'

declare const sessionVerifiedOwner: unique symbol
/** Must be created only after authenticating a real, revocable server session. */
export type AuthenticatedBackupOwner=Readonly<{
  userId:string
  readonly [sessionVerifiedOwner]:true
}>

export interface CloudStatement{
  bind(...args:(string|number|null)[]):CloudStatement
  first<T>():Promise<T|null>
  all<T>():Promise<{results:T[]}>
  run():Promise<{meta:{changes:number}}>
}
export interface CloudBackupD1{
  prepare(sql:string):CloudStatement
  /** A failed batch must roll back its ENTIRE D1 transaction. */
  batch(statements:CloudStatement[]):Promise<Array<{meta:{changes:number}}>>
}
export type CloudBackupRow=Readonly<{
  storeName:Store
  recordKey:string
  payloadJson:string
}>
type SnapshotRow={
  backup_id:string
  schema_version:number
  app_version:string
  exported_at:string
  status:string
  sha256:string
  byte_length:number
  record_count:number
  transaction_count:number
  manifest_json:string
}
type EntryRow={
  store_name:string
  record_key:string
  payload_json:string
  payload_sha256:string
}
const encoder=new TextEncoder()
const MAX_CHUNK_ROWS=32
const MAX_CHUNK_BYTES=256*1024
const MAX_RECORD_BYTES=64*1024
const digestPattern=/^[a-f0-9]{64}$/

function invalid():never{throw Error('CLOUD_BACKUP_INVALID')}
function bytes(s:string){return encoder.encode(s).byteLength}
function ownerId(owner:AuthenticatedBackupOwner):string{
  if(!owner||!isV4Uuid(owner.userId))return invalid()
  return owner.userId
}
function isStore(value:unknown):value is Store{
  return typeof value==='string'&&(STORE_NAMES as string[]).includes(value)
}
function validManifest(value:CloudBackupManifest):boolean{
  if(!value||value.format!=='orderlead-cloud-snapshot-v1'||value.schema!==1||
    typeof value.exportedAt!=='string'||!Number.isFinite(Date.parse(value.exportedAt))||
    typeof value.appVersion!=='string'||value.appVersion.length>40||
    !digestPattern.test(value.sha256)||
    !Number.isSafeInteger(value.byteLength)||value.byteLength<1||
    value.byteLength>MAX_BACKUP_BYTES||
    !Number.isSafeInteger(value.total)||value.total<1||value.total>100000||
    !Number.isSafeInteger(value.transactions)||value.transactions<0||
    value.transactions>value.total||
    !value.storeCounts||!value.storeSha256||
    Object.keys(value.storeCounts).length!==STORE_NAMES.length||
    Object.keys(value.storeSha256).length!==STORE_NAMES.length)return false
  let total=0
  for(const name of STORE_NAMES){
    const count=value.storeCounts[name]
    if(!Number.isSafeInteger(count)||count<0||count>50000||
      !digestPattern.test(value.storeSha256[name]))return false
    total+=count
  }
  return total===value.total&&value.transactions===value.storeCounts.reviewTrades
}
function parseManifest(raw:string):CloudBackupManifest{
  let result:unknown
  try{result=JSON.parse(raw)}catch{return invalid()}
  if(!validManifest(result as CloudBackupManifest))return invalid()
  return result as CloudBackupManifest
}
function assertSameManifest(row:SnapshotRow,manifest:CloudBackupManifest):void{
  const current=parseManifest(row.manifest_json)
  if(row.sha256!==manifest.sha256||row.byte_length!==manifest.byteLength||
    row.record_count!==manifest.total||row.transaction_count!==manifest.transactions||
    row.schema_version!==manifest.schema||row.app_version!==manifest.appVersion||
    row.exported_at!==manifest.exportedAt||
    JSON.stringify(current)!==JSON.stringify(manifest))return invalid()
}
async function fetchSnapshot(db:CloudBackupD1,userId:string,backupId:string):Promise<SnapshotRow|null>{
  return db.prepare(
    'SELECT backup_id,schema_version,app_version,exported_at,status,sha256,byte_length,record_count,transaction_count,manifest_json FROM cloud_backup_snapshots WHERE user_id=? AND backup_id=?'
  ).bind(userId,backupId).first<SnapshotRow>()
}

/** Idempotent start: same user+backup UUID+manifest may resume interrupted upload. */
export async function startCloudBackup(
  db:CloudBackupD1,owner:AuthenticatedBackupOwner,backupId:string,
  manifest:CloudBackupManifest,now=Date.now()
):Promise<'staging'|'verified'>{
  const userId=ownerId(owner)
  if(!isV4Uuid(backupId)||!validManifest(manifest)||!Number.isSafeInteger(now))return invalid()
  await db.prepare(
    "INSERT INTO cloud_backup_snapshots (user_id,backup_id,schema_version,app_version,exported_at,created_at,status,sha256,byte_length,record_count,transaction_count,manifest_json,verified_at) VALUES (?,?,?,?,?,?,'staging',?,?,?,?,?,NULL) ON CONFLICT(user_id,backup_id) DO NOTHING"
  ).bind(
    userId,backupId,manifest.schema,manifest.appVersion,manifest.exportedAt,
    new Date(now).toISOString(),manifest.sha256,manifest.byteLength,manifest.total,
    manifest.transactions,JSON.stringify(manifest)
  ).run()
  const row=await fetchSnapshot(db,userId,backupId)
  if(!row||!['staging','verified'].includes(row.status))return invalid()
  assertSameManifest(row,manifest)
  return row.status as 'staging'|'verified'
}
function validateOneRow(row:CloudBackupRow):void{
  if(!row||!isStore(row.storeName)||typeof row.recordKey!=='string'||
    row.recordKey.length<1||row.recordKey.length>260||
    typeof row.payloadJson!=='string'||bytes(row.payloadJson)>MAX_RECORD_BYTES)return invalid()
  let value:unknown
  try{value=JSON.parse(row.payloadJson)}catch{return invalid()}
  if(!value||typeof value!=='object'||Array.isArray(value)||
    JSON.stringify(value)!==row.payloadJson)return invalid()
  const item=value as Record<string,unknown>
  const key=row.storeName==='stocks'||row.storeName==='quotes'?'symbol':'id'
  if(item[key]!==row.recordKey)return invalid()
  // Reuse the full local backup validator to reject malformed trades,
  // unexpected dates, non-finite values and absent required fields.
  const stores=Object.fromEntries(STORE_NAMES.map(name=>[name,[]])) as BackupStores
  stores[row.storeName]=[value as StoreValue]
  validateFullBackup({
    format:BACKUP_FORMAT,schema:1,
    exportedAt:'2026-01-01T00:00:00.000Z',appVersion:'1',
    stores
  })
}
/**
 * Atomic 1..32-row chunk. Retrying identical rows is safe, but any conflict
 * with a different payload is rejected; previously stored values NEVER get
 * overwritten or silently amended. No anonymous path can call this.
 */
export async function appendCloudBackupChunk(
  db:CloudBackupD1,owner:AuthenticatedBackupOwner,
  backupId:string,rows:readonly CloudBackupRow[]
):Promise<{accepted:number}>{
  const userId=ownerId(owner)
  if(!isV4Uuid(backupId)||!Array.isArray(rows)||rows.length<1||
    rows.length>MAX_CHUNK_ROWS)return invalid()
  const signatureKeys=new Set<string>()
  let totalBytes=0
  for(const row of rows){
    validateOneRow(row)
    totalBytes+=bytes(row.payloadJson)
    const signature=row.storeName+'\u0000'+row.recordKey
    if(signatureKeys.has(signature))return invalid()
    signatureKeys.add(signature)
  }
  if(totalBytes>MAX_CHUNK_BYTES)return invalid()
  const snapshot=await fetchSnapshot(db,userId,backupId)
  if(!snapshot||snapshot.status!=='staging')return invalid()

  const statements:CloudStatement[]=[]
  for(const row of rows){
    const sha=await bodyDigest(row.payloadJson)
    // Restrict writes at execution time too; do not trust an old SELECT.
    statements.push(db.prepare(
      "INSERT INTO cloud_backup_entries (user_id,backup_id,store_name,record_key,payload_json,payload_sha256) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM cloud_backup_snapshots WHERE user_id=? AND backup_id=? AND status='staging') ON CONFLICT(user_id,backup_id,store_name,record_key) DO NOTHING"
    ).bind(userId,backupId,row.storeName,row.recordKey,row.payloadJson,sha,userId,backupId))
  }
  await db.batch(statements)
  // Each row MUST match even on retry. Do not accept conflicting duplicate IDs.
  // IN placeholders are constructed from array length, never user input.
  for(const row of rows){
    const stored=await db.prepare(
      'SELECT payload_json,payload_sha256 FROM cloud_backup_entries WHERE user_id=? AND backup_id=? AND store_name=? AND record_key=?'
    ).bind(userId,backupId,row.storeName,row.recordKey)
      .first<{payload_json:string,payload_sha256:string}>()
    if(!stored||stored.payload_json!==row.payloadJson||
      stored.payload_sha256!==await bodyDigest(row.payloadJson))return invalid()
  }
  const after=await fetchSnapshot(db,userId,backupId)
  if(!after||!['staging','verified'].includes(after.status))return invalid()
  return {accepted:rows.length}
}

/** D1 is the source of truth. Reconstruct all NINE stores from persisted rows. */
async function rebuildStoredBackup(
  db:CloudBackupD1,userId:string,backupId:string,
  snapshot:SnapshotRow
):Promise<PreparedCloudBackup>{
  const stores=Object.fromEntries(STORE_NAMES.map(name=>[name,[]])) as BackupStores
  let offset=0
  // Paginate to avoid requesting all 25MB in one D1 result object.
  while(offset<=snapshot.record_count){
    const page=await db.prepare(
      'SELECT store_name,record_key,payload_json,payload_sha256 FROM cloud_backup_entries WHERE user_id=? AND backup_id=? ORDER BY store_name,record_key LIMIT ? OFFSET ?'
    ).bind(userId,backupId,128,offset).all<EntryRow>()
    if(!page||!Array.isArray(page.results))return invalid()
    for(const entry of page.results){
      if(!isStore(entry.store_name)||typeof entry.payload_json!=='string'||
        bytes(entry.payload_json)>MAX_RECORD_BYTES||
        !digestPattern.test(entry.payload_sha256)||
        await bodyDigest(entry.payload_json)!==entry.payload_sha256)return invalid()
      let value:Record<string,unknown>
      try{value=JSON.parse(entry.payload_json)}catch{return invalid()}
      const key=entry.store_name==='stocks'||entry.store_name==='quotes'?'symbol':'id'
      if(value[key]!==entry.record_key)return invalid()
      stores[entry.store_name].push(value as StoreValue)
    }
    offset+=page.results.length
    if(offset>snapshot.record_count)return invalid()
    if(page.results.length<128)break
  }
  if(offset!==snapshot.record_count)return invalid()
  const base:OrderLeadBackup={
    format:BACKUP_FORMAT,schema:1,
    exportedAt:snapshot.exported_at,appVersion:snapshot.app_version,stores
  }
  return buildCloudBackupSnapshot(base)
}

/**
 * Server RE-READS stored rows, independently recomputes nine store SHA-256
 * values + whole snapshot hash, and performs an atomic compare-and-set.
 * A concurrent extra insert changes the SQL row count, preventing success.
 */
export async function completeCloudBackup(
  db:CloudBackupD1,owner:AuthenticatedBackupOwner,backupId:string,
  now=Date.now()
):Promise<CloudBackupManifest>{
  const userId=ownerId(owner)
  if(!isV4Uuid(backupId)||!Number.isSafeInteger(now))return invalid()
  const snapshot=await fetchSnapshot(db,userId,backupId)
  if(!snapshot||!['staging','verified'].includes(snapshot.status))return invalid()
  const manifest=parseManifest(snapshot.manifest_json)
  assertSameManifest(snapshot,manifest)
  const reconstructed=await rebuildStoredBackup(db,userId,backupId,snapshot)
  if(!await verifyCloudBackupSnapshot(reconstructed.canonicalPayload,manifest))return invalid()
  if(snapshot.status==='verified')return manifest
  const constraints=STORE_NAMES.map(
    ()=>' AND (SELECT COUNT(*) FROM cloud_backup_entries WHERE user_id=? AND backup_id=? AND store_name=?)=?'
  ).join('')
  const params:(string|number|null)[]=[
    new Date(now).toISOString(),userId,backupId,manifest.total
  ]
  for(const store of STORE_NAMES)params.push(userId,backupId,store,manifest.storeCounts[store])
  const updated=await db.prepare(
    "UPDATE cloud_backup_snapshots SET status='verified',verified_at=? WHERE user_id=? AND backup_id=? AND status='staging' AND (SELECT COUNT(*) FROM cloud_backup_entries WHERE user_id=? AND backup_id=?)=?"+constraints
  // account for extra owner+backup args in the TOTAL row count subquery
  ).bind(...[
    params[0],params[1],params[2],userId,backupId,params[3],...params.slice(4)
  ]).run()
  if(updated.meta.changes!==1)return invalid()
  return manifest
}

/** Download only completed, server-verifiable backups; never a staging copy. */
export async function readVerifiedCloudBackup(
  db:CloudBackupD1,owner:AuthenticatedBackupOwner,backupId:string
):Promise<PreparedCloudBackup>{
  const userId=ownerId(owner)
  if(!isV4Uuid(backupId))return invalid()
  const snapshot=await fetchSnapshot(db,userId,backupId)
  if(!snapshot||snapshot.status!=='verified')return invalid()
  const manifest=parseManifest(snapshot.manifest_json)
  assertSameManifest(snapshot,manifest)
  const restored=await rebuildStoredBackup(db,userId,backupId,snapshot)
  if(!await verifyCloudBackupSnapshot(restored.canonicalPayload,manifest))return invalid()
  return restored
}
