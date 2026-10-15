import type { Stock, Store, StoreValue, StagedTrade, Trade } from './types'
import { WATCHLIST } from './data'

const DB_NAME = 'orderlead-local'
const DB_VERSION = 4
export const STORE_NAMES: Store[] = ['stocks', 'analyses', 'trades', 'quotes', 'cashflows', 'alerts', 'snapshots', 'imports', 'reviewTrades']
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const today = () => new Date().toLocaleDateString('sv-SE')

export function openOrderLeadDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of STORE_NAMES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: store === 'stocks' || store === 'quotes' ? 'symbol' : 'id' })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('無法開啟本機資料庫'))
    request.onblocked = () => reject(new Error('資料庫正在被另一個分頁使用'))
  })
}
const open=openOrderLeadDB
async function transaction<T>(store: Store, mode: IDBTransactionMode, fn: (object: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    let output: T
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    req.onsuccess = () => { output = req.result }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => { db.close(); resolve(output) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error || new Error('儲存中斷')) }
  })
}
export async function list<T extends StoreValue>(store: Store): Promise<T[]> {
  return transaction<T[]>(store, 'readonly', object => object.getAll())
}
export async function save<T extends StoreValue>(store: Store, value: T): Promise<void> {
  await transaction(store, 'readwrite', object => object.put(value))
}
export async function drop(store: Store, key: string): Promise<void> {
  await transaction(store, 'readwrite', object => object.delete(key))
}
export async function seedStocks(): Promise<void> {
  const existing = await list<Stock>('stocks')
  if (existing.length) return
  // New installs receive default watchlist; an intentionally empty watchlist stays empty.
  const db = await open()
  const tx = db.transaction('stocks', 'readwrite')
  const object = tx.objectStore('stocks')
  const current = now()
  for (const item of WATCHLIST) {
    object.put({ ...item, note: '', createdAt: current, updatedAt: current })
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}
export async function clearAll(): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAMES, 'readwrite')
    STORE_NAMES.forEach(store => tx.objectStore(store).clear())
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}
// Intentionally keep a sentinel so deleting the last stock does not reseed on next load.
export async function initialize(): Promise<void> {
  if (localStorage.getItem('orderlead-seeded') === '1') return
  await seedStocks()
  localStorage.setItem('orderlead-seeded', '1')
}

export async function replaceAll(groups: Record<Store, StoreValue[]>): Promise<void> {
  const db=await open()
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE_NAMES,'readwrite')
    for(const name of STORE_NAMES){
      const object=tx.objectStore(name)
      object.clear()
      for(const item of groups[name])object.put(item)
    }
    tx.oncomplete=()=>resolve()
    tx.onabort=()=>reject(tx.error||new Error('無法還原本機資料'))
    tx.onerror=()=>reject(tx.error||new Error('無法還原本機資料'))
  }).finally(()=>db.close())
  localStorage.setItem('orderlead-seeded','1')
}

export async function saveMany<T extends StoreValue>(store: Store, items: T[]): Promise<void> {
  if (!items.length) return
  const db=await open()
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite')
      const object=tx.objectStore(store)
      for(const item of items)object.put(item)
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error||new Error('批次寫入失敗'))
      tx.onabort=()=>reject(tx.error||new Error('批次寫入中止'))
    })
  } finally { db.close() }
}
export async function approveImportedTrade(staged: StagedTrade, trade: Trade): Promise<void> {
  const db=await open()
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['imports','trades'],'readwrite')
      tx.objectStore('trades').add(trade)
      tx.objectStore('imports').put({...staged,status:'approved'})
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error||new Error('核准匯入失敗'))
      tx.onabort=()=>reject(tx.error||new Error('核准匯入中止'))
    })
  } finally { db.close() }
}

export async function approveImportedTrades(updates: StagedTrade[], trades: Trade[]): Promise<void> {
  if (!trades.length || updates.length !== trades.length) throw Error('批次核准資料筆數異常')
  const ids=new Set<string>()
  for(let i=0;i<trades.length;i++){
    if(trades[i].id!=='gmail:'+updates[i].id || updates[i].status!=='approved' || ids.has(trades[i].id))
      throw Error('批次核准來源識別碼錯誤或重複')
    ids.add(trades[i].id)
  }
  const db=await open()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['imports','trades'],'readwrite')
      const tradesStore=tx.objectStore('trades')
      const importsStore=tx.objectStore('imports')
      for(let i=0;i<trades.length;i++){
        tradesStore.add(trades[i])
        importsStore.put(updates[i])
      }
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error||Error('批次交易寫入失敗'))
      tx.onabort=()=>reject(tx.error||Error('批次交易寫入中止'))
    })
  }finally{db.close()}
}

/** Replace only unapproved Gmail staging rows in one IndexedDB transaction.
 * Approved staging and all formal trades survive, and the formal IDs are never restaged. */
export async function replacePendingImports(rows: StagedTrade[]): Promise<{cleared:number,inserted:number,retainedApproved:number}> {
  const seen=new Set<string>()
  for(const item of rows){
    if(item.status!=='pending'||seen.has(item.id))throw Error('匯入資料重複或狀態異常')
    seen.add(item.id)
  }
  const db=await open()
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(['imports','trades'],'readwrite')
      const imports=tx.objectStore('imports')
      const currentReq=imports.getAll()
      const tradesReq=tx.objectStore('trades').getAll()
      let haveImports=false,haveTrades=false,stats={cleared:0,inserted:0,retainedApproved:0}
      const proceed=()=>{
        if(!haveImports||!haveTrades)return
        const current=currentReq.result as StagedTrade[]
        const formal=tradesReq.result as Trade[]
        const protectedIds=new Set(current.filter(x=>x.status==='approved').map(x=>x.id))
        for(const t of formal)if(t.id.startsWith('gmail:'))protectedIds.add(t.id.slice(6))
        stats.retainedApproved=protectedIds.size
        for(const item of current)if(item.status!=='approved'){imports.delete(item.id);stats.cleared++}
        for(const item of rows){
          if(protectedIds.has(item.id))continue
          imports.put(item);stats.inserted++
        }
      }
      currentReq.onsuccess=()=>{haveImports=true;proceed()}
      tradesReq.onsuccess=()=>{haveTrades=true;proceed()}
      tx.oncomplete=()=>resolve(stats)
      tx.onerror=()=>reject(tx.error||Error('重新匯入失敗'))
      tx.onabort=()=>reject(tx.error||Error('重新匯入失敗，原資料保留'))
    })
  }finally{db.close()}
}

/** Remove the import inbox only. It does NOT remove any approved formal trades. */
export async function clearImportInbox():Promise<void>{
  const db=await open()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('imports','readwrite')
      tx.objectStore('imports').clear()
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error||Error('清理匯入暫存失敗'))
      tx.onabort=()=>reject(tx.error||Error('清理匯入暫存失敗'))
    })
  }finally{db.close()}
}

/** Replace only Step 1's independent review table. No other stores are touched. */
export async function replaceReviewTrades(records: StagedTrade[]): Promise<void>{
  const ids=new Set<string>()
  for(const row of records){
    if(ids.has(row.id)||!row.id||!Number.isSafeInteger(row.quantity)||row.quantity<=0)
      throw Error('歷史交易資料有重複或無效筆數')
    ids.add(row.id)
  }
  const db=await open()
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('reviewTrades','readwrite')
      const store=tx.objectStore('reviewTrades')
      store.clear()
      for(const row of records)store.put(row)
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error||Error('歷史交易更新失敗'))
      tx.onabort=()=>reject(tx.error||Error('歷史交易更新中斷'))
    })
  }finally{db.close()}
}

/** Add only new source IDs to the stage-one ledger, without clearing any manual
 * trades. All reads and writes happen inside one transaction. */
export async function mergeReviewTrades(records:StagedTrade[]):Promise<{added:number,duplicates:number}>{
  const incoming=new Set<string>()
  for(const row of records){
    if(!row.id||incoming.has(row.id)||!Number.isSafeInteger(row.quantity)||row.quantity<=0||
       !Number.isFinite(row.price)||row.price<=0||!Number.isFinite(row.gross)||row.gross<=0)
      throw Error('匯入資料有重複或無效內容')
    incoming.add(row.id)
  }
  const db=await open()
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('reviewTrades','readwrite')
      const store=tx.objectStore('reviewTrades')
      const request=store.getAllKeys()
      let result={added:0,duplicates:0}
      request.onsuccess=()=>{
        const ids=new Set(request.result.map(k=>String(k)))
        for(const row of records){
          if(ids.has(row.id))result.duplicates++
          else{store.add(row);ids.add(row.id);result.added++}
        }
      }
      tx.oncomplete=()=>resolve(result)
      tx.onerror=()=>reject(tx.error||Error('合併交易失敗'))
      tx.onabort=()=>reject(tx.error||Error('合併交易中斷'))
    })
  }finally{db.close()}
}

/** A manual transaction must not silently overwrite a previously imported row. */
export async function addManualReviewTrade(row:StagedTrade):Promise<void>{
  const db=await open()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('reviewTrades','readwrite')
      tx.objectStore('reviewTrades').add(row)
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error||Error('手動交易儲存失敗'))
      tx.onabort=()=>reject(tx.error||Error('手動交易儲存中斷'))
    })
  }finally{db.close()}
}

/** Optimistic, atomic mutation scoped strictly to the first-step review store.
 * This is intentionally separate from actual holdings and cash stores.
 * The expected snapshot is rechecked inside the SAME write transaction to
 * prevent changing a record after another tab modified its FIFO inputs. */
export async function mutateReviewTrade(
  expectedRows:StagedTrade[],targetId:string,updated:StagedTrade|null
):Promise<void>{
  if(updated&&updated.id!==targetId)throw Error('編輯交易的識別碼不符')
  const db=await open()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('reviewTrades','readwrite')
      const store=tx.objectStore('reviewTrades')
      const read=store.getAll()
      let cause=''
      read.onsuccess=()=>{
        const current=read.result as StagedTrade[]
        if(JSON.stringify(current)!==JSON.stringify(expectedRows)){
          cause='交易資料已在其他畫面變更，請重新整理再試'
          tx.abort()
          return
        }
        if(!current.some(row=>row.id===targetId)){
          cause='找不到指定交易，請重新整理'
          tx.abort()
          return
        }
        if(updated)store.put(updated)
        else store.delete(targetId)
      }
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(Error(cause||'交易修改中斷，原始資料未更動'))
      tx.onerror=()=>reject(tx.error||Error('交易修改失敗'))
    })
  }finally{db.close()}
}
