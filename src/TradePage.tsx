import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, FileUp, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react'
import { drop, list, now, save, today, uid } from './db'
import { calculateTrades, dollars } from './trade-calc'
import type { Stock, Trade } from './types'
import TradeImportPage from './TradeImportPage'

const draftTrade=():Trade=>({id:uid(),symbol:'',side:'buy',date:today(),quantity:100,price:0,fee:0,tax:0,note:'',createdAt:now()})
const orderTotal=(t:Trade)=>t.quantity*t.price+(t.side==='buy'?t.fee+t.tax:-t.fee-t.tax)
export default function TradePage(){
  const [trades,setTrades]=useState<Trade[]>([])
  const [stocks,setStocks]=useState<Stock[]>([])
  const [draft,setDraft]=useState<Trade|null>(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [showImport,setShowImport]=useState(false)
  const reload=useCallback(async()=>{const [t,s]=await Promise.all([list<Trade>('trades'),list<Stock>('stocks')]);setTrades(t.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)));setStocks(s)},[])
  useEffect(()=>{reload().catch(e=>setError(String(e)))},[reload])
  const portfolio=useMemo(()=>{try{return {value:calculateTrades(trades),error:''}}catch(e){return {value:null,error:String(e instanceof Error?e.message:e)}}},[trades])
  const name=(symbol:string)=>stocks.find(s=>s.symbol===symbol)?.name||symbol
  async function persist(){
    if(!draft)return
    setBusy(true);setError('')
    try{
      const t={...draft,symbol:draft.symbol.trim().toUpperCase(),quantity:Number(draft.quantity),price:Number(draft.price),fee:Number(draft.fee),tax:Number(draft.tax)}
      const prospective=[...trades.filter(x=>x.id!==t.id),t]
      calculateTrades(prospective) // Reject overselling and invalid chronological edits.
      await save('trades',t);await reload();setDraft(null)
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  async function remove(t:Trade){
    if(!confirm('確定刪除這筆 '+t.symbol+' 交易？'))return
    try{calculateTrades(trades.filter(x=>x.id!==t.id));await drop('trades',t.id);await reload()}catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  function updateSide(side:'buy'|'sell'){
    if(!draft)return
    const gross=draft.quantity*draft.price
    setDraft({...draft,side,fee:Math.round(gross*0.001425),tax:side==='sell'?Math.round(gross*0.003):0})
  }
  function updateAmount(key:'quantity'|'price',value:number) {
    if(!draft)return
    const t={...draft,[key]:value},gross=t.quantity*t.price
    setDraft({...t,fee:Math.round(gross*0.001425),tax:t.side==='sell'?Math.round(gross*0.003):0})
  }
  if(showImport)return <TradeImportPage onBack={()=>{setShowImport(false);void reload()}} onRefresh={()=>{void reload()}}/>
  return <div>
    <div className="notice"><Wallet size={18}/> 交易以實際成交日期排序，採先進先出（FIFO）成本配對。系統提供費用預估，請以券商交割明細為準。</div>
    {error&& !draft&&<div className="error-msg" role="alert">{error}</div>}
    {portfolio.error&&<div className="error-msg" role="alert">{portfolio.error}</div>}
    <div className="section"><h2>我的持股</h2><div className="action-bar"><button className="mini-button" onClick={()=>setShowImport(true)}><FileUp size={16}/> 郵件匯入</button><button className="primary" onClick={()=>{setDraft({...draftTrade(),symbol:stocks[0]?.symbol||''});setError('')}}><Plus size={16}/> 新增交易</button></div></div>
    <div className="summary"><div className="card"><small>持有股票</small><strong>{portfolio.value?.holdings.length??'—'} 檔</strong></div><div className="card"><small>已實現淨損益</small><strong className={(portfolio.value?.realized||0)>=0?'text-good':'text-bad'}>NT$ {portfolio.value?dollars(portfolio.value.realized):'—'}</strong></div></div>
    {portfolio.value?.holdings.length?<div className="stack">{portfolio.value.holdings.map(h=><div className="item-row" key={h.symbol}><div><b>{name(h.symbol)} · {h.symbol}</b><small>{h.quantity} 股 · 平均成本 NT$ {dollars(h.averageCost)}</small></div><b>NT$ {dollars(h.cost)}</b></div>)}</div>:<div className="card no-result">尚無持股。可以先輸入第一筆買進交易。</div>}
    <div className="section"><h2>全部交易紀錄</h2><small>{trades.length} 筆</small></div>
    <div className="stack">{trades.map(t=><div className="item-row" key={t.id}><div><b><span className={t.side==='buy'?'text-good':'text-bad'}>{t.side==='buy'?'買入':'賣出'}</span> {name(t.symbol)} · {t.symbol}</b><small>{t.date} · {t.quantity} 股 × {dollars(t.price)} 元</small><small>費用 NT$ {dollars(t.fee+t.tax)} · {t.side==='buy'?'支付':'入帳'} NT$ {dollars(orderTotal(t))}</small></div><div className="row-actions"><button aria-label="修改交易" onClick={()=>{setDraft({...t});setError('')}}><Pencil size={15}/></button><button aria-label="刪除交易" onClick={()=>remove(t)}><Trash2 size={15}/></button></div></div>)}{!trades.length&&<div className="card no-result">尚無交易紀錄</div>}</div>
    {draft&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDraft(null)}}><section className="dialog form-dialog trade-dialog" role="dialog" aria-modal="true" aria-label="買賣紀錄編輯"><button className="close" onClick={()=>setDraft(null)} aria-label="關閉"><X/></button><div className="form-heading"><ArrowLeftRight size={22}/><h2>{trades.some(x=>x.id===draft.id)?'修改交易':'新增買賣紀錄'}</h2></div><form onSubmit={e=>{e.preventDefault();void persist()}}>
      <div className="toggle-options"><button type="button" className={draft.side==='buy'?'active':''} onClick={()=>updateSide('buy')}>買進</button><button type="button" className={draft.side==='sell'?'active':''} onClick={()=>updateSide('sell')}>賣出</button></div>
      <label className="form-label">股票代號<input className="form-input" list="trading-stocks" value={draft.symbol} onChange={e=>setDraft({...draft,symbol:e.target.value})} required/><datalist id="trading-stocks">{stocks.map(s=><option value={s.symbol} key={s.symbol}>{s.name}</option>)}</datalist></label>
      <label className="form-label">成交日期<input className="form-input" type="date" max={today()} value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})} required/></label>
      <div className="two-fields"><label className="form-label">成交股數（含零股）<input className="form-input" type="number" step="1" min="1" value={draft.quantity} onChange={e=>updateAmount('quantity',Number(e.target.value))} required/></label><label className="form-label">每股成交價（元）<input className="form-input" type="number" min=".0001" step="any" value={draft.price||''} onChange={e=>updateAmount('price',Number(e.target.value))} required/></label></div>
      <div className="two-fields"><label className="form-label">手續費（元）<input className="form-input" type="number" min="0" step="any" value={draft.fee} onChange={e=>setDraft({...draft,fee:Number(e.target.value)})}/></label><label className="form-label">交易稅（元）<input className="form-input" type="number" min="0" step="any" value={draft.tax} onChange={e=>setDraft({...draft,tax:Number(e.target.value)})}/></label></div>
      <p className="field-help">費用預設依 0.1425% 手續費、一般股票賣出 0.3% 證交稅粗估，沒有計入券商最低費用或折扣，請自行確認並修改。</p>
      <label className="form-label">備註<textarea className="form-input" rows={2} value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label>
      <div className="sum-preview"><span>{draft.side==='buy'?'預估支付':'預估入帳'}</span><strong>NT$ {dollars(orderTotal(draft))}</strong></div>
      {error&&<p className="error-msg" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy?'檢查中…':'儲存交易紀錄'}</button>
    </form></section></div>}
  </div>
}
