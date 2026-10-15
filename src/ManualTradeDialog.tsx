import { useState } from 'react'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import type { ManualTradeInput } from './manual-review-trades'
import './ManualTradeDialog.css'

type Props={
  onSave:(draft:ManualTradeInput)=>Promise<void>
  onClose:()=>void
  firstTrade?:boolean
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
export default function ManualTradeDialog({onSave,onClose,firstTrade=false}:Props){
  const [draft,setDraft]=useState<ManualTradeInput>({
    date:localDate(),time:localTime(),symbol:'',name:'',side:'buy',quantity:'',price:''
  })
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
  return <div className="overlay manual-overlay" role="presentation">
    <section className="dialog form-dialog manual-trade-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-trade-title">
      <button className="close" type="button" onClick={onClose} disabled={busy} aria-label="關閉"><X size={20}/></button>
      <h2 id="manual-trade-title">{firstTrade?'新增第一筆交易':'手動新增交易'}</h2>
      <p>沒有匯入檔也可以自己記錄。買進不需要先有持股；賣出則必須能配對已記錄的買進。</p>
      <form onSubmit={e=>void submit(e)}>
        <label>交易方向
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
            <input type="number" value={draft.quantity} onChange={e=>set('quantity',e.target.value)} min={1} step={1} placeholder="例如 10" required/>
          </label>
          <label className="form-label">每股成交價格
            <input type="number" value={draft.price} onChange={e=>set('price',e.target.value)} min="0.0001" step="any" placeholder="例如 950" required/>
          </label>
        </div>
        {Number.isFinite(total)&&total>0&&<p className="manual-gross">成交價金（未計費用）：NT$ {new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(total)}</p>}
        <small className="manual-help">此階段僅紀錄成交價金，不估算手續費或交易稅；不會更新其他隱藏的資金資料。</small>
        {error&&<div className="error-msg" role="alert">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy?'正在儲存…':'確認新增交易'}</button>
      </form>
    </section>
  </div>
}
