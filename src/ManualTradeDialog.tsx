import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent } from 'react'
import { CalendarDays, Clock3, X } from 'lucide-react'
import type { ManualTradeInput } from './manual-review-trades'
import type { StagedTrade } from './types'
import { lookupStockName, mayAutofillName, normalizeStockSymbol, validStockSymbol } from './stock-name-directory'
import type { NameDirectory } from './stock-name-directory'
import './ManualTradeDialog.css'

type Props={
  onSave:(draft:ManualTradeInput)=>Promise<void>
  onClose:()=>void
  firstTrade?:boolean
  editing?:StagedTrade
  knownStockNames?:NameDirectory
}
const EMPTY_STOCK_NAMES:NameDirectory={}
function localDate(){
  const now=new Date()
  const shifted=new Date(now.getTime()-now.getTimezoneOffset()*60000)
  return shifted.toISOString().slice(0,10)
}
export default function ManualTradeDialog({onSave,onClose,firstTrade=false,editing,knownStockNames=EMPTY_STOCK_NAMES}:Props){
  const [draft,setDraft]=useState<ManualTradeInput>(editing?{
    date:editing.date,time:editing.time.slice(0,5),symbol:editing.symbol,
    name:editing.name,side:editing.recurring?'recurring':editing.side,
    quantity:String(editing.quantity),price:String(editing.price),
    fee:editing.fee==null?'':String(editing.fee),
    tax:editing.tax==null?'':String(editing.tax)
  }:{
    date:localDate(),time:'',symbol:'',name:'',side:'buy',quantity:'',price:'',fee:'',tax:''
  })
  const overlayRef=useRef<HTMLDivElement>(null)
  const autoNameRef=useRef<string|null>(null)
  const [lookupStatus,setLookupStatus]=useState<'loading'|'missing'|''>('')

  useEffect(()=>{
    const symbol=normalizeStockSymbol(draft.symbol)
    // Leave an existing/manual name untouched. A cleared name can be looked up.
    if(!validStockSymbol(symbol)||!mayAutofillName(draft.name,autoNameRef.current)||
       (draft.name!==''&&draft.name===autoNameRef.current)){
      setLookupStatus('')
      return
    }
    let cancelled=false
    const id=window.setTimeout(()=>{
      setLookupStatus('loading')
      void lookupStockName(symbol,knownStockNames,import.meta.env.BASE_URL).then(name=>{
        if(cancelled)return
        if(!name){setLookupStatus('missing');return}
        setDraft(current=>{
          if(normalizeStockSymbol(current.symbol)!==symbol||
             !mayAutofillName(current.name,autoNameRef.current))return current
          if(current.name===name)return current
          autoNameRef.current=name
          return {...current,name}
        })
        setLookupStatus('')
      }).catch(()=>{if(!cancelled)setLookupStatus('missing')})
    },180)
    return ()=>{cancelled=true;window.clearTimeout(id)}
  },[draft.symbol,draft.name,knownStockNames])
  useEffect(()=>{
    // iOS Safari may keep 100dvh at the layout-viewport height while the
    // keyboard occupies part of the visual viewport. Anchor the dialog to
    // the actually visible area so the save button is never trapped below it.
    const viewport=window.visualViewport
    const adjust=()=>{
      const layer=overlayRef.current
      if(!layer)return
      // On iOS, the visible area shrinks when the software keyboard opens.
      // Use that region instead of laying the Save action beneath the keyboard.
      layer.style.top=viewport?`${Math.max(0,viewport.offsetTop)}px`:'0px'
      layer.style.height=viewport?`${viewport.height}px`:'100dvh'
      layer.classList.toggle('manual-keyboard-open',
        !!viewport&&viewport.height<window.innerHeight*0.78)
      layer.classList.toggle('manual-short-view',!!viewport&&viewport.height<430)
    }
    adjust()
    viewport?.addEventListener('resize',adjust)
    viewport?.addEventListener('scroll',adjust)
    window.addEventListener('resize',adjust)
    const previous=document.activeElement
    return ()=>{
      viewport?.removeEventListener('resize',adjust)
      viewport?.removeEventListener('scroll',adjust)
      window.removeEventListener('resize',adjust)
      if(previous instanceof HTMLElement)previous.focus({preventScroll:true})
    }
  },[])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const set=(key:keyof ManualTradeInput,value:string)=>{
    if(key==='symbol'||key==='name')setLookupStatus('')
    setDraft(old=>{
    const next={...old,[key]:value}
    if(key==='symbol'&&value!==old.symbol&&autoNameRef.current===old.name){
      next.name=''
      autoNameRef.current=null
    }
    if(key==='name')autoNameRef.current=null
    // On edits, execution terms changing invalidate previously reported broker
    // costs. The user can explicitly re-enter their verified amounts afterward.
    const sideChanged=key==='side'&&old.side!==value&&
      (old.side==='recurring'||old.side==='buy')&&(value==='recurring'||value==='buy')
    if(editing&&['date','time','symbol','side','quantity','price'].includes(key)&&old[key]!==value&&!sideChanged){
      next.fee=''
      next.tax=''
    }
    return next
  })}
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(busy)return
    setBusy(true);setError('')
    try{await onSave(draft)}catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const total=Number(draft.quantity)*Number(draft.price)
  return createPortal(<div ref={overlayRef} className="overlay manual-overlay" role="presentation">
    <section className="dialog form-dialog manual-trade-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-trade-title">
      <header className="manual-dialog-header">
        <h2 id="manual-trade-title">{editing?'編輯交易':firstTrade?'新增第一筆交易':'新增交易'}</h2>
        <button className="manual-close" type="button" onClick={onClose} disabled={busy} aria-label="關閉"><X size={21}/></button>
      </header>
      <form onSubmit={e=>void submit(e)}>
        <div className="manual-fields-scroll">
        <label className="form-label">交易方向
          <select value={draft.side} onChange={e=>set('side',e.target.value)} required>
            <option value="buy">買進</option><option value="sell">賣出</option><option value="recurring">定期定額</option>
          </select>
        </label>
        <div className="two-fields manual-date-row">
          <label className="form-label">成交日期
            <span className="manual-picker-shell">
              <span className="manual-picker-display" aria-hidden="true">
                <span>{draft.date?draft.date.replaceAll('-','/'):'選擇日期'}</span><CalendarDays size={16}/>
              </span>
              <input type="date" aria-label="成交日期" value={draft.date} onChange={e=>set('date',e.target.value)} required/>
            </span>
          </label>
          <label className="form-label">成交時間（選填）
            <span className="manual-picker-shell">
              <span className={'manual-picker-display'+(!draft.time?' manual-picker-placeholder':'')} aria-hidden="true">
                <span>{draft.time||'選填'}</span><Clock3 size={16}/>
              </span>
              <input type="time" aria-label="成交時間（選填）" value={draft.time} onChange={e=>set('time',e.target.value)}/>
            </span>
          </label>
        </div>
        <div className="two-fields manual-stock-row">
          <label className="form-label">股票代號
            <input value={draft.symbol} onChange={e=>set('symbol',e.target.value)} placeholder="例如 2330" maxLength={8} autoCapitalize="characters" required/>
          </label>
          <label className="form-label">股票名稱
            <input value={draft.name} onChange={e=>set('name',e.target.value)} placeholder="例如 台積電" maxLength={100} required/>
          </label>
        </div>
        {lookupStatus==='loading'&&<small className="manual-name-lookup-note" role="status">查詢名稱中…</small>}
        {lookupStatus==='missing'&&<small className="manual-name-lookup-note" role="status">查無名稱，可自行填寫</small>}
        <div className="two-fields manual-numeric-row">
          <label className="form-label">成交股數
            <input inputMode="numeric" type="number" value={draft.quantity} onChange={e=>set('quantity',e.target.value)} min={1} step={1} placeholder="例如 10" required/>
          </label>
          <label className="form-label">每股成交價格
            <input inputMode="decimal" type="number" value={draft.price} onChange={e=>set('price',e.target.value)} min="0.0001" step="any" placeholder="例如 950" required/>
          </label>
        </div>
        <div className="two-fields manual-fees-row">
          <label className="form-label">手續費（NT$）
            <input inputMode="decimal" type="number" value={draft.fee??''} onChange={e=>set('fee',e.target.value)} min={0} max={100000000} step="0.01" placeholder="選填"/>
          </label>
          <label className="form-label">交易稅（NT$）
            <input inputMode="decimal" type="number" value={draft.tax??''} onChange={e=>set('tax',e.target.value)} min={0} max={100000000} step="0.01" placeholder="選填"/>
          </label>
        </div>
        {Number.isFinite(total)&&total>0&&<p className="manual-gross">成交價金（未計費用）：NT$ {new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(total)}</p>}
        <small className="manual-help">請填實際金額；留白表示未知，填 0 表示已確認為零。變更成交條件後需重新核對費稅。</small>
        </div>
        <footer className="manual-dialog-footer">
          {error&&<div className="error-msg" role="alert">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>{busy?'儲存中…':editing?'儲存修改':'新增交易'}</button>
        </footer>
      </form>
    </section>
  </div>,document.body)
}
