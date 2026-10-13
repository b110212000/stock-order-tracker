import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, CalendarClock, Plus, Trash2, X } from 'lucide-react'
import { drop, list, now, save, today, uid } from './db'
import type { Analysis, Rating, Stock } from './types'

const RATINGS: Rating[] = ['新進場候選','續抱','等待','降低持有']
const items: { key: keyof Analysis, title: string, subtitle: string }[] = [
  { key:'demand', title:'終端需求', subtitle:'下一～兩季的需求與下游客戶'},
  { key:'orders', title:'訂單與客戶拉貨', subtitle:'PO、Design-in、驗證、出貨與是否失單'},
  { key:'ramp', title:'量產進度', subtitle:'原定時程、實際進展、是否延後'},
  { key:'capacity', title:'擴產與稼動率', subtitle:'擴廠時間、產能利用率、供應鏈地位'},
  { key:'peers', title:'主要同業比較', subtitle:'同產業前幾名競爭者及理由'},
  { key:'institutions', title:'法人與量價確認', subtitle:'外資／投信／自營商、量能及 K 線'},
  { key:'invalidation', title:'失效條件與風險', subtitle:'降評標準、需持續追蹤的數據'},
  { key:'sources', title:'資料來源', subtitle:'每行一個網址或公告名稱，務必標註日期'}
]
function fresh(symbol: string): Analysis { return {id:uid(),symbol,asOf:today(),rating:'等待',demand:'',orders:'',ramp:'',capacity:'',peers:'',institutions:'',invalidation:'',sources:'',updatedAt:now()} }
function tag(rating: Rating) { return rating==='新進場候選'?'tag-good':rating==='降低持有'?'tag-bad':rating==='續抱'?'tag-hold':'tag-wait' }
export default function AnalysisPage({onBack}: {onBack:()=>void}) {
  const [stocks,setStocks]=useState<Stock[]>([])
  const [reports,setReports]=useState<Analysis[]>([])
  const [symbol,setSymbol]=useState('')
  const [draft,setDraft]=useState<Analysis|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const reload=useCallback(async()=>{const [s,r]=await Promise.all([list<Stock>('stocks'),list<Analysis>('analyses')]);setStocks(s);setReports(r.sort((a,b)=>b.asOf.localeCompare(a.asOf)||b.updatedAt.localeCompare(a.updatedAt)));setSymbol(prev=>prev||s[0]?.symbol||'')},[])
  useEffect(()=>{reload().catch(e=>setError(String(e)))},[reload])
  const visible=useMemo(()=>reports.filter(x=>x.symbol===symbol),[reports,symbol])
  async function persist() {
    if(!draft)return
    if(!draft.asOf||!draft.rating||!draft.orders.trim()||!draft.invalidation.trim()){setError('請填寫分析日期、訂單證據及評級失效條件');return}
    setBusy(true)
    try { await save('analyses',{...draft,updatedAt:now()});setDraft(null);setError('');await reload() }
    catch(e){setError(String(e))}finally{setBusy(false)}
  }
  async function remove(a:Analysis){
    if(!confirm('確定刪除這份分析紀錄？'))return
    try { await drop('analyses',a.id);await reload() }catch(e){setError(String(e))}
  }
  return <div className="analysis-page">
    <button className="linkish back-link" onClick={onBack}><ArrowLeft size={17}/> 返回股票清單</button>
    <div className="section"><div><h2>訂單領先研究紀錄</h2><small>手動整理，並非 GPT 自動產生</small></div><button className="primary" onClick={()=>setDraft(fresh(symbol))} disabled={!symbol}><Plus size={16}/> 新增分析</button></div>
    <div className="notice"><BookOpen size={19}/> 記錄客戶訂單、量產和擴產的原始證據，再看法人量價。沒有來源的推測不能當作已驗證事實。</div>
    {error&&!draft&&<p className="error-msg" role="alert">{error}</p>}
    <label className="form-label">選擇股票<select className="form-input" value={symbol} onChange={e=>setSymbol(e.target.value)}>{stocks.map(s=><option key={s.symbol} value={s.symbol}>{s.symbol} {s.name}</option>)}</select></label>
    {!visible.length?<div className="card no-result analysis-empty"><CalendarClock size={28}/><h3>尚無分析紀錄</h3><p>新增第一份紀錄後，就能比較評級、訂單進度與風險的歷史變化。</p></div>:<div className="stack reports">
      {visible.map(a=><article key={a.id} className="card analysis-report">
        <div className="report-head"><div><small>{a.asOf} · {a.symbol}</small><h2><span className={'rating '+tag(a.rating)}>{a.rating}</span></h2></div><div className="row-actions"><button onClick={()=>setDraft({...a})} title="編輯" aria-label="編輯分析">編輯</button><button onClick={()=>remove(a)} title="刪除" aria-label="刪除分析"><Trash2 size={15}/></button></div></div>
        <div className="report-grid">{items.filter(x=>x.key!=='sources').map(x=><div key={x.key}><strong>{x.title}</strong><p>{String(a[x.key])||'未填寫'}</p></div>)}</div>
        <div className="sources"><strong>資料來源</strong><p>{a.sources || '未提供（未驗證）'}</p></div>
      </article>)}
    </div>}
    {draft&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setDraft(null);setError('')}}}><section className="dialog form-dialog analysis-form" role="dialog" aria-modal="true" aria-label="新增或編輯訂單分析">
      <button className="close" onClick={()=>{setDraft(null);setError('')}} aria-label="關閉"><X/></button>
      <h2>{visible.some(x=>x.id===draft.id)?'編輯分析':'新增分析'} · {draft.symbol}</h2><p className="subtle">請區分已簽約訂單、客戶驗證、管理層預估及個人推測。</p>
      <form onSubmit={e=>{e.preventDefault();void persist()}}>
        <div className="two-fields"><label className="form-label">資料日期<input className="form-input" type="date" max={today()} value={draft.asOf} onChange={e=>setDraft({...draft,asOf:e.target.value})}/></label><label className="form-label">評級<select className="form-input" value={draft.rating} onChange={e=>setDraft({...draft,rating:e.target.value as Rating})}>{RATINGS.map(x=><option key={x}>{x}</option>)}</select></label></div>
        {items.map(x=><label key={x.key} className="form-label">{x.title}<small>{x.subtitle}</small><textarea className="form-input" rows={x.key==='sources'?3:2} value={String(draft[x.key])} onChange={e=>setDraft({...draft,[x.key]:e.target.value})}/></label>)}
        {error&&<p className="error-msg" role="alert">{error}</p>}
        <button className="primary" disabled={busy} type="submit">{busy?'儲存中…':'儲存分析紀錄'}</button>
      </form>
    </section></div>}
  </div>
}
