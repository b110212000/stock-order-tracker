import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChartNoAxesCombined, Coins, Landmark, Pencil, Plus, RefreshCcw, Save, Trash2, X } from 'lucide-react'
import { drop, list, now, save, today } from './db'
import { dollars } from './trade-calc'
import { monthlyRealized, overview, snapshotChange } from './analytics'
import type { AssetSnapshot, CashFlow, Quote, Stock, Trade } from './types'

type FlowDraft = CashFlow
function startFlow():FlowDraft {return {id:crypto.randomUUID(),date:today(),type:'deposit',amount:0,note:''}}
const pct=(v:number|null)=>v===null?'—':(v>=0?'+':'')+(v*100).toFixed(2)+'%'
function Sparkline({points}:{points:AssetSnapshot[]}) {
  if(points.length<2)return <div className="empty-inline">需要至少兩次資產快照，才能畫出資產走勢。</div>
  const sorted=[...points].sort((a,b)=>a.date.localeCompare(b.date))
  const vals=sorted.map(p=>p.equity)
  const min=Math.min(...vals),max=Math.max(...vals),spread=Math.max(1,max-min)
  const positions=sorted.map((p,i)=>(30+400*i/(sorted.length-1))+','+(145-110*(p.equity-min)/spread)).join(' ')
  return <svg className="asset-chart" viewBox="0 0 460 175" role="img" aria-label="手動紀錄的資產總值走勢"><line x1="30" x2="430" y1="145" y2="145" stroke="currentColor" opacity=".15"/><line x1="30" x2="430" y1="35" y2="35" stroke="currentColor" opacity=".15"/><polyline points={positions} fill="none" stroke="#4b9cec" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{sorted.map((p,i)=><circle key={p.id} cx={30+400*i/(sorted.length-1)} cy={145-110*(p.equity-min)/spread} r="4" fill="#4b9cec"/>)}<text x="30" y="165" fill="currentColor" fontSize="11">{sorted[0].date}</text><text x="430" y="165" fill="currentColor" fontSize="11" textAnchor="end">{sorted[sorted.length-1].date}</text></svg>
}
export default function PerformancePage({compact=false}:{compact?:boolean}){
 const [trades,setTrades]=useState<Trade[]>([])
 const [stocks,setStocks]=useState<Stock[]>([])
 const [quotes,setQuotes]=useState<Quote[]>([])
 const [flows,setFlows]=useState<CashFlow[]>([])
 const [snapshots,setSnapshots]=useState<AssetSnapshot[]>([])
 const [quoteDraft,setQuoteDraft]=useState<Quote|null>(null)
 const [flowDraft,setFlowDraft]=useState<FlowDraft|null>(null)
 const [error,setError]=useState('')
 const reload=useCallback(async()=>{
  const [t,s,q,f,sh]=await Promise.all([list<Trade>('trades'),list<Stock>('stocks'),list<Quote>('quotes'),list<CashFlow>('cashflows'),list<AssetSnapshot>('snapshots')])
  setTrades(t);setStocks(s);setQuotes(q);setFlows(f.sort((a,b)=>b.date.localeCompare(a.date)));setSnapshots(sh.sort((a,b)=>a.date.localeCompare(b.date)))
 },[])
 useEffect(()=>{reload().catch(e=>setError(String(e)))},[reload])
 const summary=useMemo(()=>{try{return {data:overview(trades,quotes,flows),error:''}}catch(e){return {data:null,error:String(e)}}},[trades,quotes,flows])
 const monthly=useMemo(()=>{try{return monthlyRealized(trades)}catch{return []}},[trades])
 const data=summary.data
 const latestReturn=snapshots.length>1?snapshotChange(snapshots[0],snapshots[snapshots.length-1]):null
 const name=(symbol:string)=>stocks.find(s=>s.symbol===symbol)?.name||symbol
 async function persistQuote(){
  if(!quoteDraft)return
  if(!Number.isFinite(quoteDraft.price)||quoteDraft.price<=0||!quoteDraft.asOf){setError('請輸入有效價格與日期');return}
  try{await save('quotes',quoteDraft);setQuoteDraft(null);setError('');await reload()}catch(e){setError(String(e))}
 }
 async function persistFlow(){
  if(!flowDraft)return
  if(!(flowDraft.amount>0)||!Number.isFinite(flowDraft.amount)||!flowDraft.date){setError('金額必須大於零，且須有日期');return}
  try{await save('cashflows',flowDraft);setFlowDraft(null);setError('');await reload()}catch(e){setError(String(e))}
 }
 async function deleteFlow(f:CashFlow) {if(!confirm('確定刪除這筆資金紀錄？'))return;try{await drop('cashflows',f.id);await reload()}catch(e){setError(String(e))}}
 async function capture() {
   if(!data||data.equity===null||!Number.isFinite(data.equity)){setError('請先為每檔持股輸入估值價格');return}
   if(data.cash<0){setError('現金餘額為負。請確認是否漏登投入資金，再儲存快照。');return}
   if(snapshots.some(s=>s.date===today())&&!confirm('今天已有快照，是否覆蓋？'))return
   const value:AssetSnapshot={id:today(),date:today(),equity:data.equity,cumulativeNetDeposits:data.netInvested,capturedAt:now()}
   try{await save('snapshots',value);await reload();setError('')}catch(e){setError(String(e))}
 }
 if(compact)return <div className="stat-grid"><div className="card stat"><div className="stat-caption">帳戶總值（手動估值）</div><strong>{data?.equity===null||data?.equity===undefined?'NT$ —':'NT$ '+dollars(data.equity)}</strong><small>現金＋持股手動價格</small></div><div className="card stat"><div className="stat-caption">已實現淨損益</div><strong>{data?'NT$ '+dollars(data.p.realized):'—'}</strong><small>FIFO 已完成交易</small></div><div className="card stat"><div className="stat-caption">持有股票</div><strong>{data?.p.holdings.length??'—'} 檔</strong><small>已登記的買賣庫存</small></div><div className="card stat"><div className="stat-caption">整體淨損益</div><strong>{data?.profit===null||data?.profit===undefined?'NT$ —':'NT$ '+dollars(data.profit)}</strong><small>不等於月化報酬</small></div></div>
 return <div className="performance-page">
  <div className="notice"><ChartNoAxesCombined size={19}/> 目前沒有即時行情；持股價格需要手動輸入。每月已實現損益與帳戶資產增減是不同概念。</div>
  {(error||summary.error)&&<p className="error-msg" role="alert">{error||summary.error}</p>}
  <div className="stat-grid">
   <div className="card stat"><div className="stat-caption">帳戶總值</div><strong>{data?.equity===null||data?.equity===undefined?'—':'NT$ '+dollars(data.equity)}</strong><small>現金＋手動估值市值</small></div>
   <div className="card stat"><div className="stat-caption">累計淨損益</div><strong className={data?.profit!==null&&data?.profit!==undefined&&data.profit>=0?'text-good':'text-bad'}>{data?.profit===null||data?.profit===undefined?'—':'NT$ '+dollars(data.profit)}</strong><small>總值－累計淨投入</small></div>
   <div className="card stat"><div className="stat-caption">已實現損益</div><strong>{data?'NT$ '+dollars(data.p.realized):'—'}</strong><small>分批賣出配對</small></div>
   <div className="card stat"><div className="stat-caption">可用現金</div><strong>{data?'NT$ '+dollars(data.cash):'—'}</strong><small>依入出金與買賣推算</small></div>
  </div>
  {data?.cash!==undefined&&data.cash<0&&<div className="error-msg">現金帳面餘額是負數：可能還未登記初始投入資金。此時帳戶總值可能失真。</div>}
  {!!data?.unpriced.length&&<div className="notice">尚未輸入 {data.unpriced.map(x=>x.symbol).join('、')} 的估值價格；總資產及未實現損益暫不顯示。</div>}
  <div className="section"><h2>持股手動估價</h2><small>非即時報價</small></div>
  <div className="stack">{data?.p.holdings.map(h=>{
   const q=quotes.find(q=>q.symbol===h.symbol)
   return <div key={h.symbol} className="item-row"><div><b>{h.symbol} {name(h.symbol)}</b><small>{h.quantity} 股 · FIFO 剩餘成本 {dollars(h.averageCost)} 元／股</small><small>估值 {q?'NT$ '+dollars(q.price)+'（'+q.asOf+'）':'未設定'}</small></div><button className="mini-button" onClick={()=>{setQuoteDraft(q||{symbol:h.symbol,price:h.averageCost,asOf:today()});setError('')}}><Pencil size={15}/> 更新價</button></div>
  })}{!data?.p.holdings.length&&<div className="card no-result">尚無持股；先從交易分頁建立買入紀錄。</div>}</div>
  <div className="section"><h2>資金流向</h2><button className="mini-button" onClick={()=>{setFlowDraft(startFlow());setError('')}}><Plus size={16}/> 新增資金紀錄</button></div>
  <div className="card metric"><div>累計淨入金 <strong>NT$ {data?dollars(data.netInvested):'—'}</strong></div><div>累計股利 <strong>NT$ {data?dollars(data.dividends):'—'}</strong></div></div>
  <div className="stack">{flows.map(f=><div key={f.id} className="item-row"><div><b>{f.type==='deposit'?'入金':f.type==='withdraw'?'出金':'股利'} · NT$ {dollars(f.amount)}</b><small>{f.date} · {f.note||'無備註'}</small></div><div className="row-actions"><button onClick={()=>{setFlowDraft({...f});setError('')}} aria-label="編輯資金紀錄"><Pencil size={16}/></button><button onClick={()=>deleteFlow(f)} aria-label="刪除資金紀錄"><Trash2 size={16}/></button></div></div>)}</div>
  <div className="section"><h2>資產快照</h2><button className="mini-button" onClick={()=>void capture()}><Save size={16}/> 記錄今日資產</button></div>
  <div className="card chart-panel"><Sparkline points={snapshots}/><div className="chart-summary"><span>兩次快照間扣除新增資金後的估計變動率</span><strong>{pct(latestReturn)}</strong></div><p className="field-help">這是按快照計算的簡化資金流調整率，若期間有多次入出金，並非精確時間加權報酬；快照需要手動行情，舊資料不會自動補價。</p></div>
  <div className="section"><h2>已平倉交易績效</h2><small>依賣出月份彙總</small></div>
  <div className="stack">{monthly.map(m=><div key={m.month} className="item-row"><div><b>{m.month}</b><small>{m.count} 次賣出 · 加權持有成本 NT$ {dollars(m.cost)}</small><small>平均持有 {m.avgDays.toFixed(1)} 天 · 平均成本報酬 {pct(m.monthlyEquivalent)}</small></div><strong className={m.pnl>=0?'text-good':'text-bad'}>{m.pnl>=0?'+':''}NT$ {dollars(m.pnl)}</strong></div>)}{!monthly.length&&<div className="card no-result">還沒有賣出交易，無法計算已實現績效。</div>}</div>
  <div className="section"><h2>單次賣出月化比較</h2></div>
  <div className="stack">{[...(data?.p.closed||[])].reverse().map(t=><div className="item-row" key={t.tradeId}><div><b>{t.symbol} · {t.date}</b><small>賣出 {t.quantity} 股 · FIFO 加權持有 {t.holdingDays.toFixed(1)} 天</small><small>實際報酬 {pct(t.roi)} · 30 天等效 {t.holdingDays>0 && t.roi>-1?pct(Math.pow(1+t.roi,30/t.holdingDays)-1):'不適用'}</small></div><strong className={t.pnl>=0?'text-good':'text-bad'}>{t.pnl>=0?'+':''}NT$ {dollars(t.pnl)}</strong></div>)}</div>
  {quoteDraft&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setQuoteDraft(null)}}><section className="dialog form-dialog" role="dialog" aria-modal="true" aria-label="手動估價"><button className="close" aria-label="關閉" onClick={()=>setQuoteDraft(null)}><X/></button><h2>{quoteDraft.symbol} 手動估價</h2><p className="subtle">請輸入實際查到的報價與日期。不是即時行情。</p><form onSubmit={e=>{e.preventDefault();void persistQuote()}}><label className="form-label">每股價格（元）<input className="form-input" type="number" step="any" min=".0001" value={quoteDraft.price} onChange={e=>setQuoteDraft({...quoteDraft,price:Number(e.target.value)})}/></label><label className="form-label">價格日期<input className="form-input" type="date" max={today()} value={quoteDraft.asOf} onChange={e=>setQuoteDraft({...quoteDraft,asOf:e.target.value})}/></label>{error&&<p className="error-msg">{error}</p>}<button className="primary" type="submit"><RefreshCcw size={15}/> 更新手動價格</button></form></section></div>}
  {flowDraft&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setFlowDraft(null)}}><section className="dialog form-dialog" role="dialog" aria-modal="true" aria-label="資金紀錄"><button className="close" aria-label="關閉" onClick={()=>setFlowDraft(null)}><X/></button><h2>資金紀錄</h2><form onSubmit={e=>{e.preventDefault();void persistFlow()}}><label className="form-label">種類<select className="form-input" value={flowDraft.type} onChange={e=>setFlowDraft({...flowDraft,type:e.target.value as CashFlow['type']})}><option value="deposit">入金</option><option value="withdraw">出金</option><option value="dividend">股利</option></select></label><label className="form-label">日期<input className="form-input" type="date" max={today()} value={flowDraft.date} onChange={e=>setFlowDraft({...flowDraft,date:e.target.value})}/></label><label className="form-label">金額<input className="form-input" type="number" min=".01" step="any" value={flowDraft.amount||''} onChange={e=>setFlowDraft({...flowDraft,amount:Number(e.target.value)})}/></label><label className="form-label">備註<textarea className="form-input" rows={2} value={flowDraft.note} onChange={e=>setFlowDraft({...flowDraft,note:e.target.value})}/></label>{error&&<p className="error-msg">{error}</p>}<button className="primary" type="submit"><Coins size={15}/> 儲存</button></form></section></div>}
 </div>
}
