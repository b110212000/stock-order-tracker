import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import type { ManualTradeInput } from './manual-review-trades'
import type { StagedTrade } from './types'
import './ManualTradeDialog.css'

type Props={
  onSave:(draft:ManualTradeInput)=>Promise<void>
  onClose:()=>void
  firstTrade?:boolean
  editing?:StagedTrade
}
function localDate(){
  const now=new Date()
  const shifted=new Date(now.getTime()-now.getTimezoneOffset()*60000)
  return shifted.toISOString().slice(0,10)
}
function localTime(){
  const d=new Date()
  return [d.getHours(),d.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':')
}
export default function ManualTradeDialog({onSave,onClose,firstTrade=false,editing}:Props){
  const [draft,setDraft]=useState<ManualTradeInput>(editing?{
    date:editing.date,time:editing.time.slice(0,5),symbol:editing.symbol,
    name:editing.name,side:editing.side,
    quantity:String(editing.quantity),price:String(editing.price)
  }:{
    date:localDate(),time:localTime(),symbol:'',name:'',side:'buy',quantity:'',price:''
  })
  const overlayRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    // iOS Safari may keep 100dvh at the layout-viewport height while the
    // keyboard occupies part of the visual viewport. Anchor the dialog to
    // the actually visible area so the save button is never trapped below it.
    const viewport=window.visualViewport
    const adjust=()=>{
      const layer=overlayRef.current
      if(!layer)return
      layer.style.top=viewport?`${viewport.offsetTop}px`:'0px'
      layer.style.height=viewport?`${viewport.height}px`:'100dvh'
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
  const set=(key:keyof ManualTradeInput,value:string)=>setDraft(old=>({...old,[key]:value}))
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
            <option value="buy">買進</option><option value="sell">賣出</option>
          </select>
        </label>
        <div className="two-fields">
          <label className="form-label">成交日期
            <input type="date" value={draft.date} onChange={e=>set('date',e.target.value)} required/>
          </label>
          <label className="form-label">成交時間
            <input type="time" value={draft.time} onChange={e=>set('time',e.target.value)} required/>
          </label>
        </div>
        <div className="two-fields">
          <label className="form-label">股票代號
            <input value={draft.symbol} onChange={e=>set('symbol',e.target.value)} placeholder="例如 2330" maxLength={8} autoCapitalize="characters" required/>
          </label>
          <label className="form-label">股票名稱
            <input value={draft.name} onChange={e=>set('name',e.target.value)} placeholder="例如 台積電" maxLength={100} required/>
          </label>
        </div>
        <div className="two-fields">
          <label className="form-label">成交股數
            <input inputMode="numeric" type="number" value={draft.quantity} onChange={e=>set('quantity',e.target.value)} min={1} step={1} placeholder="例如 10" required/>
          </label>
          <label className="form-label">每股成交價格
            <input inputMode="decimal" type="number" value={draft.price} onChange={e=>set('price',e.target.value)} min="0.0001" step="any" placeholder="例如 950" required/>
          </label>
        </div>
        {Number.isFinite(total)&&total>0&&<p className="manual-gross">成交價金（未計費用）：NT$ {new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(total)}</p>}
        <small className="manual-help">費用與交易稅未納入計算。</small>
        </div>
        <footer className="manual-dialog-footer">
          {error&&<div className="error-msg" role="alert">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>{busy?'儲存中…':editing?'儲存修改':'新增交易'}</button>
        </footer>
      </form>
    </section>
  </div>,document.body)
}
