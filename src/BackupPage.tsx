import { useRef, useState } from 'react'
import { Download, FileUp, ShieldAlert } from 'lucide-react'
import { list, replaceAll, STORE_NAMES } from './db'
import { calculateTrades } from './trade-calc'
import type { Analysis, AlertRule, AssetSnapshot, CashFlow, Quote, Stock, Store, StoreValue, Trade } from './types'

const arr=(v:unknown):v is unknown[]=>Array.isArray(v)&&v.length<=100000
const obj=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x)
const txt=(x:unknown):x is string=>typeof x==='string'&&x.length<=15000
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)
const dated=(x:unknown)=>txt(x)&&/^\d{4}-\d{2}-\d{2}$/.test(x)
const nonNeg=(x:unknown)=>finite(x)&&x>=0
function validate(store:Store, entries:unknown[]): StoreValue[] {
 const result:StoreValue[]=[]
 const keys=new Set<string>()
 for(const raw of entries){
  if(!obj(raw))throw Error(store+' 存在格式錯誤的資料')
  const key=store==='stocks'||store==='quotes'?raw.symbol:raw.id
  if(!txt(key)||!key||keys.has(key))throw Error(store+' 存在重複或無效的識別碼')
  keys.add(key)
  switch(store){
   case 'stocks':
    if(!txt(raw.symbol)||!txt(raw.name)||!txt(raw.group)||!txt(raw.note)||!txt(raw.createdAt)||!txt(raw.updatedAt))throw Error('stocks 欄位不完整')
    result.push(raw as Stock);break
   case 'analyses':
    if(!txt(raw.symbol)||!dated(raw.asOf)||!['新進場候選','續抱','等待','降低持有'].includes(String(raw.rating))||!['demand','orders','ramp','capacity','peers','institutions','invalidation','sources','updatedAt'].every(k=>txt(raw[k])))throw Error('analyses 欄位錯誤')
    result.push(raw as Analysis);break
   case 'trades':
    if(!txt(raw.symbol)||!dated(raw.date)||!['buy','sell'].includes(String(raw.side))||!finite(raw.quantity)||!finite(raw.price)||!nonNeg(raw.fee)||!nonNeg(raw.tax)||!txt(raw.note)||!txt(raw.createdAt))throw Error('trades 欄位錯誤')
    result.push(raw as Trade);break
   case 'quotes':
    if(!txt(raw.symbol)||!finite(raw.price)||!dated(raw.asOf)||raw.price<=0)throw Error('quotes 欄位錯誤')
    result.push(raw as Quote);break
   case 'cashflows':
    if(!dated(raw.date)||!['deposit','withdraw','dividend'].includes(String(raw.type))||!finite(raw.amount)||raw.amount<=0||!txt(raw.note))throw Error('cashflows 欄位錯誤')
    result.push(raw as CashFlow);break
   case 'alerts':
    if(!txt(raw.symbol)||!['above','below'].includes(String(raw.direction))||!finite(raw.target)||raw.target<=0||typeof raw.enabled!=='boolean'||typeof raw.lastMet!=='boolean')throw Error('alerts 欄位錯誤')
    result.push(raw as AlertRule);break
   case 'snapshots':
    if(!dated(raw.date)||!finite(raw.equity)||!finite(raw.cumulativeNetDeposits)||!txt(raw.capturedAt))throw Error('snapshots 欄位錯誤')
    result.push(raw as AssetSnapshot);break
  }
 }
 return result
}
export default function BackupPage(){
 const input=useRef<HTMLInputElement>(null)
 const [info,setInfo]=useState('')
 const [busy,setBusy]=useState(false)
 async function exportData(){
  setBusy(true);setInfo('')
  try{
   const data:Record<string,StoreValue[]>={}
   for(const store of STORE_NAMES)data[store]=await list<StoreValue>(store)
   const content=JSON.stringify({format:'orderlead-backup',schema:1,exportedAt:new Date().toISOString(),data},null,2)
   const url=URL.createObjectURL(new Blob([content],{type:'application/json'}))
   const link=document.createElement('a');link.href=url;link.download='orderlead-backup-'+new Date().toLocaleDateString('sv-SE')+'.json';document.body.appendChild(link);link.click();link.remove()
   window.setTimeout(()=>URL.revokeObjectURL(url),1500)
   setInfo('已產生本機備份檔，請將它保存在安全的位置。')
  }catch(e){setInfo('備份失敗：'+String(e))}finally{setBusy(false)}
 }
 async function importData(file:File){
  setBusy(true);setInfo('')
  try{
   if(file.size>5*1024*1024)throw Error('備份檔超過 5 MB')
   const parsed:unknown=JSON.parse(await file.text())
   if(!obj(parsed)||parsed.format!=='orderlead-backup'||parsed.schema!==1||!obj(parsed.data))throw Error('不是支援的 OrderLead 備份檔')
   const data={} as Record<Store,StoreValue[]>
   for(const store of STORE_NAMES){
    const items=store==='imports'&&parsed.data[store]===undefined?[]:parsed.data[store]
    if(!arr(items))throw Error(store+' 資料格式不正確')
    data[store]=validate(store,items)
   }
   calculateTrades(data.trades as Trade[])
   if(!confirm('還原將覆蓋此裝置上所有股票、交易、資金、分析及提醒紀錄。請確認已另存當前備份。確定要繼續？'))return
   await replaceAll(data)
   setInfo('還原成功，正在重新載入資料。')
   location.reload()
  }catch(e){setInfo('還原失敗，原資料未變更：'+(e instanceof Error?e.message:String(e)))}finally{setBusy(false);if(input.current)input.current.value=''}
 }
 return <section className="backup-section">
  <h3>資料備份與還原</h3><p className="field-help">這是純前端 App。交易與自訂資料只存在目前這個瀏覽器；請定期備份，重新安裝 PWA 或清除網站資料前務必匯出。</p>
  <div className="action-bar"><button className="mini-button" disabled={busy} onClick={()=>void exportData()}><Download size={17}/> 匯出 JSON</button><button className="mini-button" disabled={busy} onClick={()=>input.current?.click()}><FileUp size={17}/> 還原 JSON</button></div>
  <input type="file" ref={input} style={{display:'none'}} accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void importData(f)}}/>
  {info&&<p role="status" className="field-help">{info}</p>}
  <p className="privacy-warning"><ShieldAlert size={16}/> 備份含私人投資紀錄、待核對匯入資料，請勿上傳到公開 GitHub Repository。</p>
 </section>
}
