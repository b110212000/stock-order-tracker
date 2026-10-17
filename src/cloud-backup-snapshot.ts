/**
 * A-3.1 / Issue #64: prepare the first *complete* cloud backup, without writing
 * to Cloudflare or changing any IndexedDB record.
 *
 * No live PWA or Worker imports this module yet. The output is an integrity
 * contract for a later, authenticated and server-verified upload.
 */
import {STORE_NAMES} from './db'
import {buildBackup,MAX_BACKUP_BYTES,summarizeBackup,validateFullBackup} from './backup-data'
import {snapshotLocalData} from './backup-storage'
import type {OrderLeadBackup} from './backup-data'
import type {Store} from './types'

export const CLOUD_BACKUP_FORMAT='orderlead-cloud-snapshot-v1'
export type CloudBackupManifest=Readonly<{
  format:typeof CLOUD_BACKUP_FORMAT
  schema:1
  exportedAt:string
  appVersion:string
  sha256:string
  byteLength:number
  total:number
  transactions:number
  storeCounts:Record<Store,number>
  storeSha256:Record<Store,string>
}>
export type PreparedCloudBackup=Readonly<{
  manifest:CloudBackupManifest
  /** Deterministic complete JSON; never submit this before authenticated opt-in. */
  canonicalPayload:string
}>

const encoder=new TextEncoder()
const digestPattern=/^[0-9a-f]{64}$/

/** Every JSON object key sorts lexicographically; arrays retain order. */
function stableJson(value:unknown):string{
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw Error('備份包含無效數值')
    return JSON.stringify(value)
  }
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']'
  if(typeof value==='object'){
    const obj=value as Record<string,unknown>
    const fields=Object.keys(obj).sort()
    return '{'+fields.map(key=>{
      if(obj[key]===undefined)throw Error('備份包含未定義欄位')
      return JSON.stringify(key)+':'+stableJson(obj[key])
    }).join(',')+'}'
  }
  throw Error('備份包含不支援的資料格式')
}

function sortByKey(rows:unknown[],store:Store):unknown[]{
  const key=store==='stocks'||store==='quotes'?'symbol':'id'
  const ordered=[...rows]
  ordered.sort((a,b)=>{
    const first=String((a as Record<string,unknown>)[key])
    const second=String((b as Record<string,unknown>)[key])
    return first<second?-1:first>second?1:0
  })
  return ordered
}
async function digestHex(text:string):Promise<string>{
  const bytes=encoder.encode(text)
  const hash=await crypto.subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')
}
function matchingDigest(a:string,b:string):boolean{
  if(!digestPattern.test(a)||!digestPattern.test(b))return false
  let diff=0
  for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i)
  return diff===0
}

/**
 * Re-encode as JSON to ensure cloud snapshot contains only JSON-safe data.
 * Stable key/row ordering makes hashes independent from property insertion
 * order and IDB getAll() scheduling. Original arrays and objects are untouched.
 */
export async function buildCloudBackupSnapshot(source:OrderLeadBackup):Promise<PreparedCloudBackup>{
  // Existing validator already checks all nine tables, key uniqueness, and
  // required trade fields. Do not accept partial "reviewTrades only" exports.
  validateFullBackup(source)
  const serialized=JSON.stringify(source)
  if(!serialized)throw Error('無法序列化完整備份')
  const copied=JSON.parse(serialized) as OrderLeadBackup
  validateFullBackup(copied)

  const stores={} as OrderLeadBackup['stores']
  const counts={} as Record<Store,number>
  const storeSha256={} as Record<Store,string>
  for(const store of STORE_NAMES){
    stores[store]=sortByKey(copied.stores[store],store) as typeof stores[typeof store]
    counts[store]=stores[store].length
    storeSha256[store]=await digestHex(stableJson(stores[store]))
  }
  const canonicalPayload=stableJson({...copied,stores})
  const byteLength=encoder.encode(canonicalPayload).byteLength
  if(byteLength===0||byteLength>MAX_BACKUP_BYTES)
    throw Error('首次雲端備份超過 25 MB 限制')
  const aggregate=summarizeBackup({...copied,stores})
  return {
    canonicalPayload,
    manifest:{
      format:CLOUD_BACKUP_FORMAT,
      schema:copied.schema,
      exportedAt:copied.exportedAt,
      appVersion:copied.appVersion,
      sha256:await digestHex(canonicalPayload),
      byteLength,
      total:aggregate.total,
      transactions:aggregate.transactions,
      storeCounts:counts,
      storeSha256
    }
  }
}

/**
 * Rechecks the complete payload; use again after future server round-trip.
 * Valid JSON and HTTP 200 are NOT sufficient evidence of safe cloud backup.
 */
export async function verifyCloudBackupSnapshot(
  payload:string,manifest:CloudBackupManifest
):Promise<boolean>{
  if(typeof payload!=='string'||encoder.encode(payload).byteLength>MAX_BACKUP_BYTES||
    !manifest||manifest.format!==CLOUD_BACKUP_FORMAT||manifest.schema!==1||
    !digestPattern.test(manifest.sha256))return false
  let value:unknown
  try{value=JSON.parse(payload)}catch{return false}
  try{
    const calculated=await buildCloudBackupSnapshot(value as OrderLeadBackup)
    if(calculated.canonicalPayload!==payload||
      calculated.manifest.byteLength!==manifest.byteLength||
      calculated.manifest.exportedAt!==manifest.exportedAt||
      calculated.manifest.appVersion!==manifest.appVersion||
      calculated.manifest.total!==manifest.total||
      calculated.manifest.transactions!==manifest.transactions||
      !matchingDigest(calculated.manifest.sha256,manifest.sha256))return false
    for(const store of STORE_NAMES){
      if(calculated.manifest.storeCounts[store]!==manifest.storeCounts?.[store]||
        !matchingDigest(calculated.manifest.storeSha256[store],manifest.storeSha256?.[store]))return false
    }
    return true
  }catch{return false}
}

/** Uses the existing single readonly IndexedDB transaction, no mutations. */
export async function prepareLocalCloudBackup(appVersion:string):Promise<PreparedCloudBackup>{
  const stores=await snapshotLocalData()
  return buildCloudBackupSnapshot(buildBackup(stores,appVersion))
}
