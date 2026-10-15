import { STORE_NAMES } from './db'
import type { Store, StoreValue, StagedTrade } from './types'

export const BACKUP_FORMAT='orderlead-full-backup'
export const BACKUP_SCHEMA=1
export const MAX_BACKUP_BYTES=25*1024*1024
export type BackupStores=Record<Store,StoreValue[]>
export type OrderLeadBackup={
  format:typeof BACKUP_FORMAT
  schema:typeof BACKUP_SCHEMA
  exportedAt:string
  appVersion:string
  stores:BackupStores
}
export type RestoreMode='merge'|'replace'
export type BackupCounts={total:number,transactions:number,stores:Record<Store,number>}
const record=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)
const required=(v:unknown,max=180)=>typeof v==='string'&&v.length>0&&v.length<=max
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)
const ymd=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v

function validateRow(store:Store,raw:unknown,index:number):asserts raw is StoreValue{
  if(!record(raw))throw Error(store+' 第 '+(index+1)+' 筆不是交易物件')
  const key=(store==='stocks'||store==='quotes')?'symbol':'id'
  if(!required(raw[key],260))throw Error(store+' 第 '+(index+1)+' 筆缺少 '+key)
  if(store==='reviewTrades'||store==='imports'){
    if(!ymd(raw.date)||!required(raw.symbol,16)||!required(raw.name,100)||
       !['buy','sell'].includes(String(raw.side))||
       !Number.isSafeInteger(raw.quantity)||Number(raw.quantity)<=0||
       !finite(raw.price)||Number(raw.price)<=0||
       !finite(raw.gross)||Number(raw.gross)<=0||
       !required(raw.time,16)||!required(raw.orderId,100)||
       !required(raw.createdAt,120)||!required(raw.importedAt,120))
      throw Error(store+' 第 '+(index+1)+' 筆成交紀錄不完整')
    if((raw.fee!==null&&raw.fee!==undefined&&(!finite(raw.fee)||Number(raw.fee)<0))||
       (raw.tax!==null&&raw.tax!==undefined&&(!finite(raw.tax)||Number(raw.tax)<0)))
      throw Error(store+' 第 '+(index+1)+' 筆費用格式不正確')
  }
  if(store==='trades'){
    if(!ymd(raw.date)||!required(raw.symbol,16)||!['buy','sell'].includes(String(raw.side))||
       !Number.isSafeInteger(raw.quantity)||Number(raw.quantity)<=0||
       !finite(raw.price)||Number(raw.price)<=0||
       !finite(raw.fee)||Number(raw.fee)<0||
       !finite(raw.tax)||Number(raw.tax)<0)
      throw Error('正式交易第 '+(index+1)+' 筆資料無效')
  }
}
/** Strict envelope and key validation: reject truncated or foreign JSON before any writes. */
export function validateFullBackup(value:unknown):OrderLeadBackup{
  if(!record(value)||value.format!==BACKUP_FORMAT||value.schema!==BACKUP_SCHEMA||
    !required(value.exportedAt,80)||!required(value.appVersion,40)||!record(value.stores))
    throw Error('這不是可還原的 OrderLead 完整備份檔')
  const obj=value.stores
  if(Object.keys(obj).length!==STORE_NAMES.length)
    throw Error('備份資料表數量不正確，可能不是完整備份')
  let count=0
  for(const store of STORE_NAMES){
    const rows=obj[store]
    if(!Array.isArray(rows)||rows.length>50000)throw Error(store+' 備份表不完整或筆數過多')
    const ids=new Set<string>()
    for(let i=0;i<rows.length;i++){
      const row=rows[i]
      validateRow(store,row,i)
      const key=(store==='stocks'||store==='quotes')?
        (row as unknown as Record<string,unknown>).symbol:(row as unknown as Record<string,unknown>).id
      const id=String(key)
      if(ids.has(id))throw Error(store+' 存在重複識別碼：'+id)
      ids.add(id)
    }
    count+=rows.length
    if(count>100000)throw Error('備份筆數超過可接受上限')
  }
  return value as unknown as OrderLeadBackup
}
export function summarizeBackup(data:OrderLeadBackup):BackupCounts{
  const stores={} as Record<Store,number>
  for(const name of STORE_NAMES)stores[name]=data.stores[name].length
  return {stores,total:STORE_NAMES.reduce((sum,name)=>sum+stores[name],0),
    transactions:stores.reviewTrades}
}
/** Unit-testable merge plan. Does not overwrite existing same-ID records. */
export function planRestore(current:BackupStores,incoming:BackupStores,mode:RestoreMode):BackupStores{
  const result={} as BackupStores
  for(const name of STORE_NAMES){
    if(mode==='replace'){
      result[name]=incoming[name].map(x=>({...x})) as StoreValue[]
      continue
    }
    const key=(name==='stocks'||name==='quotes')?'symbol':'id'
    const ids=new Set(current[name].map(x=>String((x as unknown as Record<string,unknown>)[key])))
    const out:StoreValue[]=[...current[name]]
    for(const row of incoming[name]){
      const id=String((row as unknown as Record<string,unknown>)[key])
      if(!ids.has(id)){out.push(row);ids.add(id)}
    }
    result[name]=out
  }
  return result
}
export function buildBackup(stores:BackupStores,appVersion:string):OrderLeadBackup{
  return validateFullBackup({
    format:BACKUP_FORMAT,schema:BACKUP_SCHEMA,
    exportedAt:new Date().toISOString(),appVersion,stores
  })
}
export function parseBackupBytes(bytes:Uint8Array):OrderLeadBackup{
  if(!bytes.length||bytes.byteLength>MAX_BACKUP_BYTES)throw Error('備份檔為空或超過 25 MB')
  let parsed:unknown
  try {parsed=JSON.parse(new TextDecoder().decode(bytes))}
  catch {throw Error('備份檔不是有效 JSON')}
  return validateFullBackup(parsed)
}
