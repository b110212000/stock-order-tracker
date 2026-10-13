import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, BellOff, CircleHelp, Pencil, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import { drop, list, now, save, today, uid } from './db'
import type { AlertRule, Quote, Stock } from './types'
import { dollars } from './trade-calc'

const newRule=():AlertRule=>({id:uid(),symbol:'',direction:'below',target:0,enabled:true,lastMet:false})
export default function AlertsPage(){
 const [rules,setRules]=useState<AlertRule[]>([])
 const [quotes,setQuotes]=useState<Quote[]>([])
 const [stocks,setStocks]=useState<Stock[]>([])
 const [draft,setDraft]=useState<AlertRule|null>(null)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const reload=useCallback(async()=>{
  const [a,q,s]=await Promise.all([list<AlertRule>('alerts'),list<Quote>('quotes'),list<Stock>('stocks')]);setRules(a);setQuotes(q);setStocks(s)
 },[])
 useEffect(()=>{reload().catch(e=>setError(String(e)))},[reload])
 const label=useCallback((code:string)=>stocks.find(x=>x.symbol===code)?.name||code,[stocks])
 const available=useMemo(()=>quotes.filter(q=>q.price>0),[quotes])
 async function persist(){
  if(!draft)return
  const symbol=draft.symbol.trim().toUpperCase()
  if(!symbol||!(draft.target>0)||!Number.isFinite(draft.target)){setError('請輸入股票代號和大於零的提醒價');return}
  try{await save('alerts',{...draft,symbol,lastMet:false,lastTriggered:undefined});await reload();setDraft(null);setError('')}catch(e){setError(String(e))}
 }
 async function remove(a:AlertRule){if(!confirm('確定刪除此價格提醒？'))return;try{await drop('alerts',a.id);await reload()}catch(e){setError(String(e))}}
 async function toggle(a:AlertRule){try{await save('alerts',{...a,enabled:!a.enabled});await reload()}catch(e){setError(String(e))}}
 async function checkAll(){
  setError('');setNotice('')
  let triggered=0,skipped=0
  try{
   for(const r of rules){
    if(!r.enabled)continue
    const q=quotes.find(q=>q.symbol===r.symbol)
    if(!q||q.asOf!==today()){skipped++;continue}
    const met=r.direction==='below'?q.price<=r.target:q.price>=r.target
    if(met&&!r.lastMet)triggered++
    if(met!==r.lastMet)await save('alerts',{...r,lastMet:met,lastTriggered:met&&!r.lastMet?now():r.lastTriggered})
   }
   await reload()
   setNotice(triggered>0?'這次檢查有 '+triggered+' 項價格條件首次符合。請查看提醒列表。':'檢查完成：沒有新的條件跨越。'+(skipped?'有 '+skipped+' 項缺少今日手動報價，已跳過。':''))
  }catch(e){setError(String(e))}
 }
 return <div>
   <div className="notice"><CircleHelp size={18}/> 純前端版本無盤中自動查價，也不會在背景推播。需要先到「績效」輸入手動報價，再按「檢查目前價格」。</div>
   <div className="section"><h2>價格提醒條件</h2><div className="action-bar"><button className="mini-button" onClick={()=>void checkAll()}><RefreshCcw size={16}/> 檢查目前價格</button><button className="primary" onClick={()=>{setDraft({...newRule(),symbol:stocks[0]?.symbol||''});setError('')}}><Plus size={16}/> 新增</button></div></div>
   {notice&&<div className="notice" role="status">{notice}</div>}
   {error&&!draft&&<div className="error-msg" role="alert">{error}</div>}
   <div className="stack">{rules.map(r=>{
     const quote=available.find(x=>x.symbol===r.symbol)
     const met=quote&&(r.direction==='below'?quote.price<=r.target:quote.price>=r.target)
     return <div className="item-row" key={r.id}><div className="alert-item">
       <b>{r.symbol} {label(r.symbol)} <span className="pill">{r.enabled?'啟用':'已停用'}</span></b>
       <small>{r.direction==='below'?'價格低於或等於':'價格高於或等於'} NT$ {dollars(r.target)}</small>
       <small>手動報價：{quote?'NT$ '+dollars(quote.price)+'（'+quote.asOf+'）':'尚未設定'}</small>
       {r.lastTriggered&&<small className="text-good">上次觸發：{new Date(r.lastTriggered).toLocaleString('zh-TW')}</small>}
       {met&&r.enabled&&<small className="text-good">目前手動報價符合條件（不代表即時價）</small>}
      </div><div className="row-actions"><button onClick={()=>toggle(r)} title={r.enabled?'停用':'啟用'} aria-label={r.enabled?'停用':'啟用'}>{r.enabled?<Bell size={16}/>:<BellOff size={16}/>}</button><button onClick={()=>{setDraft({...r});setError('')}} title="編輯"><Pencil size={16}/></button><button onClick={()=>remove(r)} title="刪除"><Trash2 size={16}/></button></div>
     </div>
   })}{!rules.length&&<div className="card no-result">尚未設定任何價格提醒</div>}</div>
   {draft&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDraft(null)}}><section className="dialog form-dialog" role="dialog" aria-modal="true" aria-label="價格提醒設定"><button className="close" onClick={()=>setDraft(null)} aria-label="關閉"><X/></button><h2>設定股價提醒</h2><form onSubmit={e=>{e.preventDefault();void persist()}}>
    <label className="form-label">股票代號<input className="form-input" list="alert-stocks" value={draft.symbol} onChange={e=>setDraft({...draft,symbol:e.target.value})} required/><datalist id="alert-stocks">{stocks.map(s=><option key={s.symbol} value={s.symbol}>{s.name}</option>)}</datalist></label>
    <label className="form-label">提醒方向<select className="form-input" value={draft.direction} onChange={e=>setDraft({...draft,direction:e.target.value as AlertRule['direction']})}><option value="below">價格低於或等於</option><option value="above">價格高於或等於</option></select></label>
    <label className="form-label">觸發價格（元）<input type="number" min=".0001" step="any" className="form-input" value={draft.target||''} onChange={e=>setDraft({...draft,target:Number(e.target.value)})} required/></label>
    {error&&<div className="error-msg" role="alert">{error}</div>}
    <p className="field-help">只有在 App 前景手動檢查價格時才會觸發。舊日期報價不會觸發，請先手動更新為今日價格。</p>
    <button className="primary" type="submit">儲存提醒</button>
   </form></section></div>}
  </div>
}
