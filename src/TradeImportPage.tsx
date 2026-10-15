import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCheck, CheckCircle2, CircleAlert, FileJson, FileUp, Pencil, ShieldAlert, X } from 'lucide-react'
import { list, save, saveMany, approveImportedTrade } from './db'
import { dollars, calculateTrades } from './trade-calc'
import { readTradePreview, roughShortfalls, toStaged } from './import-trades'
import type { SourceTrade, } from './import-trades'
import type { StagedTrade, Trade } from './types'
import './TradeImportPage.css'
import BulkApprovalDialog from './BulkApprovalDialog'
import './BulkApprovalDialog.css'

export default function TradeImportPage({onBack,onRefresh}:{onBack:()=>void,onRefresh:()=>void}){
 const input=useRef<HTMLInputElement>(null)
 const [staged,setStaged]=useState<StagedTrade[]>([])
 const [existing,setExisting]=useState<Trade[]>([])
 const [showBulk,setShowBulk]=useState(false)
 const [incoming,setIncoming]=useState<SourceTrade[]>([])
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [info,setInfo]=useState('')
 const [editing,setEditing]=useState<StagedTrade|null>(null)
 const [showAll,setShowAll]=useState(false)
 const [offset,setOffset]=useState(0)
 const reload=useCallback(async()=>{
  const [rows,trades]=await Promise.all([list<StagedTrade>('imports'),list<Trade>('trades')])
  setStaged(rows.sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time)))
  setExisting(trades)
 },[])
 useEffect(()=>{reload().catch(e=>setError(String(e)))},[reload])
 const ids=new Set(staged.map(s=>s.id))
 const duplicates=incoming.filter(s=>ids.has(s.id)).length
 const pending=staged.filter(s=>s.status==='pending')
 const confirmed=staged.filter(s=>s.status==='approved')
 const pendingShortfalls=useMemo(()=>roughShortfalls(staged),[staged])
 const visible=(showAll?staged:pending).slice(offset,offset+25)
 async function chooseFile(file:File){
  setError('');setInfo('');setIncoming([])
  try{
   if(file.size>10*1024*1024)throw Error('JSON 超過 10 MB')
   const parsed=readTradePreview(JSON.parse(await file.text()))
   setIncoming(parsed)
   setInfo('解析成功：'+parsed.length+' 筆，請確認內容後再按「暫存交易」。不會立即改動庫存。')
  }catch(e){setError(String(e instanceof Error?e.message:e))}
  if(input.current)input.current.value=''
 }
 async function stage(){
  if(!incoming.length)return
  setBusy(true);setError('')
  try{
   const current=await list<StagedTrade>('imports')
   const existing=new Set(current.map(x=>x.id))
   const rows=toStaged(incoming).filter(x=>!existing.has(x.id))
   await saveMany('imports',rows)
   setIncoming([]);setInfo('新增 '+rows.length+' 筆待核對交易，略過 '+(incoming.length-rows.length)+' 筆重複紀錄。不會影響正式持股。')
   await reload()
  }catch(e){setError(String(e))}finally{setBusy(false)}
 }
 async function persistFee(){
  if(!editing)return
  const fees=editing.fee,tax=editing.tax
  if(fees===null||tax===null||!Number.isFinite(fees)||fees<0||!Number.isFinite(tax)||tax<0){setError('請填寫非負的手續費與交易稅，未知費用不能直接視為零。');return}
  if(editing.side==='sell' && fees+tax>=editing.quantity*editing.price){setError('賣出費用不能超過成交金額');return}
  try{await save('imports',{...editing,feeStatus:'verified'});setEditing(null);setError('');await reload();setInfo('費用已標記為手動核對，還需要按「確認寫入」才能加入正式交易。')}catch(e){setError(String(e))}
 }
 async function approve(row:StagedTrade){
  setError('');setInfo('')
  if(row.fee===null||row.tax===null){setError('先編輯這筆交易的實際手續費與證交稅（如確實為 0 請主動填入 0）。');return}
  setBusy(true)
  try{
   const current=await list<Trade>('trades')
   const id='gmail:'+row.id
   if(current.some(t=>t.id===id))throw Error('這筆交易已經存在正式紀錄')
   const asTrade:Trade={id,symbol:row.symbol,side:row.side,date:row.date,
    quantity:row.quantity,price:row.price,fee:row.fee,tax:row.tax,
    note:'富邦成交回報；委託 '+row.orderId+'；'+row.name+'；已手動核對費用',createdAt:row.createdAt}
   calculateTrades([...current,asTrade])
   await approveImportedTrade(row,asTrade)
   setInfo(row.date+' '+row.symbol+' 已核准寫入正式交易；更新持股與績效。')
   await reload();onRefresh()
  }catch(e){setError(String(e instanceof Error?e.message:e))}finally{setBusy(false)}
 }
 async function markSkipped(row:StagedTrade){
  if(!confirm('將此交易標記「暫不匯入」？仍保留原始預覽資料。'))return
  try{await save('imports',{...row,status:'skipped'});await reload()}catch(e){setError(String(e))}
 }
 return <section className="gmail-import">
  <button className="linkish back-link" onClick={onBack}><ArrowLeft size={17}/> 返回交易紀錄</button>
  <div className="section"><h2>首次匯入券商交易</h2><small>v1.8.0 · 本機處理</small></div>
  <div className="notice"><ShieldAlert size={19}/> Gmail 檔案只在你的裝置解析及暫存；本功能不會連接 Gmail API、不會傳到 GitHub，也不會覆蓋其他投資資料。</div>
  <div className="import-overview">
    <div className="card"><strong>{pending.length}</strong><small>待核對</small></div>
    <div className="card"><strong>{confirmed.length}</strong><small>已核准匯入</small></div>
    <div className="card"><strong>{staged.filter(x=>x.fee===null||x.tax===null).length}</strong><small>費用未確認</small></div>
  </div>
  <div className="card import-upload">
   <FileJson size={25}/><div><b>匯入 OrderLead Gmail 交易預覽 JSON</b><p>選取本次 ChatGPT 產出的 <code>orderlead_gmail_trade_preview_2021-2026.json</code>，檢查筆數後存入「待核對」。</p></div>
   <button className="primary" onClick={()=>input.current?.click()} disabled={busy}><FileUp size={16}/> 選擇檔案</button>
   <input ref={input} type="file" accept=".json,application/json" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void chooseFile(file)}}/>
  </div>
  {incoming.length>0&&<div className="card import-preview">
    <h3>匯入前預覽</h3><p>共 {incoming.length} 筆，已有 {duplicates} 筆來源 ID 存在；剩下 {incoming.length-duplicates} 筆可加入待核對清單。</p>
    <p className="field-help">所有尚未取得實際費用的資料，手續費與證交稅保留為「未知」，不會先填成 0。</p>
    <ul>{incoming.slice(0,8).map(r=><li key={r.id}>{r.date}　{r.symbol}　{r.side==='buy'?'買':'賣'} {r.quantity} 股 @ {dollars(r.price)}</li>)}</ul>
    <button className="primary" disabled={busy} onClick={()=>void stage()}>確認暫存 {incoming.length-duplicates} 筆</button>
  </div>}
  {error&&<div className="error-msg" role="alert">{error}</div>}
  {info&&<p className="notice" role="status"><CheckCircle2 size={18}/>{info}</p>}
  {pendingShortfalls.length>0&&<div className="import-warning"><CircleAlert size={18}/><p>這批郵件仍有 {pendingShortfalls.length} 處「歷史買進股數不足」的跡象（可能缺信、其他券商、ETF 分割或公司行動）。請勿在未補齊成本基礎前核准有問題的賣出紀錄。</p></div>}
  <div className="section"><h2>郵件交易核對清單</h2><div className="action-bar"><button className="primary" disabled={busy||pending.length===0} onClick={()=>{setShowBulk(true);setError('')}}><CheckCheck size={16}/> 一鍵批次核對</button><button className="mini-button" onClick={()=>{setShowAll(!showAll);setOffset(0)}}>{showAll?'只看待核對':'查看全部'}</button></div></div>
  <p className="field-help">待核對資料不會影響總覽、持股與績效。可按「一鍵批次核對」先預覽通過數量與例外股票，指定費用處理方式再核准。預估費用不等於交割實際值；異常股票仍待核對。也可逐筆核對實際手續費。</p>
  <div className="stack">{visible.map(row=><div className="item-row staged-row" key={row.id}>
   <div><b>{row.name} · {row.symbol} <span className={row.side==='buy'?'text-good':'text-bad'}>{row.side==='buy'?'買入':'賣出'}</span></b>
    <small>{row.date} {row.time} · {row.quantity} 股 × {dollars(row.price)} 元 · 委託 {row.orderId}</small>
    <small>成交價金 NT$ {dollars(row.gross)} · 手續費 {row.fee===null?'待核對':dollars(row.fee)} · 稅 {row.tax===null?'待核對':dollars(row.tax)}</small>
    <small>狀態：{row.status==='pending'?'待核對':row.status==='approved'?'已寫入正式交易':'暫不匯入'}</small>
   </div>
   {row.status==='pending'&&<div className="row-actions import-row-actions">
     <button title="核對費用" aria-label="核對費用" onClick={()=>{setEditing({...row});setError('')}}><Pencil size={16}/></button>
     <button disabled={busy||row.fee===null||row.tax===null} onClick={()=>void approve(row)}>確認寫入</button>
     <button onClick={()=>void markSkipped(row)}>略過</button>
   </div>}
  </div>)}
   {visible.length===0&&<div className="card no-result">{showAll?'還沒有匯入資料':'目前沒有待核對交易'}</div>}
  </div>
  <div className="import-pagination">
   <button className="mini-button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>上一頁</button>
   <small>{(showAll?staged:pending).length?Math.floor(offset/25)+1:0} / {Math.ceil((showAll?staged:pending).length/25)} 頁</small>
   <button className="mini-button" disabled={offset+25>=(showAll?staged:pending).length} onClick={()=>setOffset(offset+25)}>下一頁</button>
  </div>
  {showBulk&&<BulkApprovalDialog staged={staged} existing={existing} onClose={()=>setShowBulk(false)} onImported={(count,blocked,estimated)=>{
      setShowBulk(false);setOffset(0)
      setInfo('批次核准 '+count+' 筆；'+blocked+' 筆因費用或庫存等問題暫留待核對。'+(estimated?'其中 '+estimated+' 筆費用為預估，請依交割單校正。':''))
      void reload();onRefresh()
    }}/>}
  {editing&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(null)}}><section className="dialog form-dialog" role="dialog" aria-modal="true" aria-label="核對交割費用"><button className="close" onClick={()=>setEditing(null)} aria-label="關閉"><X/></button>
   <h2>核對 {editing.symbol} 交易費用</h2><p className="field-help">{editing.date} · {editing.side==='buy'?'買':'賣'} {editing.quantity} 股 · 成交價金 NT$ {dollars(editing.gross)}。請使用券商交割資料，而非成交回報的未扣費價金。</p>
   <form onSubmit={e=>{e.preventDefault();void persistFee()}}>
    <label className="form-label">實際手續費（元）<input className="form-input" min="0" step="any" type="number" placeholder="請確認；如為 0 請輸入 0" value={editing.fee??''} onChange={e=>setEditing({...editing,fee:e.target.value===''?null:Number(e.target.value)})}/></label>
    <label className="form-label">實際交易稅（元）<input className="form-input" min="0" step="any" type="number" placeholder="請確認；如為 0 請輸入 0" value={editing.tax??''} onChange={e=>setEditing({...editing,tax:e.target.value===''?null:Number(e.target.value)})}/></label>
    {error&&<div className="error-msg">{error}</div>}
    <button className="primary" type="submit">儲存已核對費用</button>
   </form>
  </section></div>}
 </section>
}
