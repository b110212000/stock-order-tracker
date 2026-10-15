import { sameScope, isOrderLeadCache } from './repair-scope'

export type CacheRepairResult = {
  removedCaches:number
  removedWorkers:number
  failures:string[]
}

/** Cache-only repair. Never delete IndexedDB, localStorage, cookies, or user files. */
export async function clearOrderLeadPwaCache():Promise<CacheRepairResult> {
  const scope=new URL(import.meta.env.BASE_URL,window.location.origin).href
  const result:CacheRepairResult={removedCaches:0,removedWorkers:0,failures:[]}

  if('caches' in window){
    try{
      const names=await window.caches.keys()
      for(const name of names.filter(x=>isOrderLeadCache(x,scope))){
        try {
          if(await window.caches.delete(name))result.removedCaches++
        }catch{result.failures.push('快取 '+name+' 刪除失敗')}
      }
    }catch{result.failures.push('瀏覽器不允許列出 CacheStorage 快取')}
  }else{
    result.failures.push('此瀏覽器不支援 CacheStorage')
  }

  if('serviceWorker' in navigator){
    try{
      const registrations=await navigator.serviceWorker.getRegistrations()
      for(const registration of registrations.filter(x=>sameScope(x.scope,scope))){
        try{
          if(await registration.unregister())result.removedWorkers++
          else result.failures.push('舊 Service Worker 尚未解除')
        }catch{result.failures.push('解除舊 Service Worker 失敗')}
      }
    }catch{result.failures.push('無法取得 Service Worker 註冊資料')}
  }
  return result
}
export function freshAppUrl():string{
  const url=new URL(import.meta.env.BASE_URL,window.location.origin)
  url.searchParams.set('cache-repair',String(Date.now()))
  return url.href
}
