import { STORE_NAMES,openOrderLeadDB } from './db'
import { planRestore, summarizeBackup,validateFullBackup } from './backup-data'
import type { BackupStores,OrderLeadBackup,RestoreMode } from './backup-data'
import type { Store,StoreValue } from './types'

/** Read all nine stores using the same readonly IDB transaction.
 * Never export a mixture of pre- and post-edit snapshots. */
export async function snapshotLocalData():Promise<BackupStores>{
  const db=await openOrderLeadDB()
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAMES,'readonly')
      const result={} as BackupStores
      for(const name of STORE_NAMES){
        const request=tx.objectStore(name).getAll()
        request.onsuccess=()=>{result[name]=request.result as StoreValue[]}
      }
      tx.oncomplete=()=>resolve(result)
      tx.onerror=()=>reject(tx.error||Error('備份讀取失敗'))
      tx.onabort=()=>reject(tx.error||Error('備份讀取中斷'))
    })
  }finally{db.close()}
}
/** An IDB readwrite transaction covers validation, duplicate handling and
 * all changes. If any write fails, the entire restore is rolled back. */
export async function restoreLocalData(backup:OrderLeadBackup,mode:RestoreMode):Promise<{before:number,after:number,added:number}>{
  validateFullBackup(backup)
  if(mode!=='merge'&&mode!=='replace')throw Error('不支援此還原模式')
  const db=await openOrderLeadDB()
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAMES,'readwrite')
      const current={} as BackupStores
      const ready=new Set<Store>()
      let prepared=false
      let stats={before:0,after:0,added:0}
      let failure=''
      function stageWrites(){
        if(prepared||ready.size!==STORE_NAMES.length)return
        prepared=true
        try{
          const previous=STORE_NAMES.reduce((sum,s)=>sum+current[s].length,0)
          const incomingCount=summarizeBackup(backup).total
          if(mode==='replace'&&previous>0&&incomingCount===0)
            throw Error('空白備份不能取代目前已有的資料')
          const planned=planRestore(current,backup.stores,mode)
          const after=STORE_NAMES.reduce((sum,s)=>sum+planned[s].length,0)
          stats={before:previous,after,added:mode==='merge'?after-previous:incomingCount}
          for(const name of STORE_NAMES){
            const store=tx.objectStore(name)
            // Merge adds only new keys and NEVER overwrites a local edit.
            if(mode==='merge'){
              const key=name==='stocks'||name==='quotes'?'symbol':'id'
              const ids=new Set(current[name].map(x=>String((x as unknown as Record<string,unknown>)[key])))
              for(const row of backup.stores[name]){
                const id=String((row as unknown as Record<string,unknown>)[key])
                if(!ids.has(id)){store.add(row);ids.add(id)}
              }
            }else{
              store.clear()
              for(const row of backup.stores[name])store.add(row)
            }
          }
        }catch(e){
          failure=e instanceof Error?e.message:String(e)
          tx.abort()
        }
      }
      for(const name of STORE_NAMES){
        const req=tx.objectStore(name).getAll()
        req.onsuccess=()=>{
          current[name]=req.result as StoreValue[]
          ready.add(name)
          stageWrites()
        }
      }
      tx.oncomplete=()=>resolve(stats)
      tx.onerror=()=>reject(tx.error||Error('備份還原失敗，原本資料已保留'))
      tx.onabort=()=>reject(Error(failure||'備份還原已中斷，原本資料已保留'))
    })
  }finally{db.close()}
}
