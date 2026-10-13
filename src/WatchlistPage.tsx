import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, CircleHelp, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { drop, initialize, list, now, save } from './db'
import AnalysisPage from './AnalysisPage'
import type { Stock } from './types'

const validateSymbol = (symbol: string) => /^[0-9A-Za-z]{2,8}$/.test(symbol)
const blank: Stock = { symbol: '', name: '', group: '', note: '', createdAt: '', updatedAt: '' }
export default function WatchlistPage() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [search, setSearch] = useState('')
  const [mode,setMode] = useState<'stocks'|'analysis'>('stocks')
  const [selected, setSelected] = useState<Stock | null>(null)
  const [draft, setDraft] = useState<Stock | null>(null)
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = useCallback(async () => { setStocks((await list<Stock>('stocks')).sort((a,b) => a.symbol.localeCompare(b.symbol))) }, [])
  useEffect(() => { initialize().then(reload).catch(e => setError(String(e))) }, [reload])
  const filtered = stocks.filter(s => (s.symbol + s.name + s.group + s.note).toLowerCase().includes(search.toLowerCase()))
  function edit(stock?: Stock) {
    setDraft(stock ? { ...stock } : { ...blank })
    setEditingSymbol(stock?.symbol || null)
    setError('')
  }
  async function persist() {
    if (!draft) return
    const symbol = draft.symbol.trim().toUpperCase()
    const name = draft.name.trim()
    if (!validateSymbol(symbol) || !name) { setError('請輸入 2～8 碼股票代號及名稱'); return }
    if (stocks.some(s => s.symbol === symbol && s.symbol !== editingSymbol)) { setError('這個代號已存在'); return }
    setBusy(true)
    try {
      const when = now()
      const value = { ...draft, symbol, name, group: draft.group.trim(), note: draft.note.trim(), createdAt: draft.createdAt || when, updatedAt: when }
      if (editingSymbol && editingSymbol !== symbol) { setError('已建立的股票代號不可修改，請刪除後重新建立'); return }
      await save('stocks', value)
      setSelected(value)
      setDraft(null)
      await reload()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  async function remove(stock: Stock) {
    if (!window.confirm('確定移除 ' + stock.symbol + ' ' + stock.name + ' 的觀察清單項目？交易資料不會刪除。')) return
    try { await drop('stocks', stock.symbol); setSelected(null); await reload() } catch (e) { setError(String(e)) }
  }
  if(mode==='analysis')return <AnalysisPage onBack={()=>setMode('stocks')}/>
  return <>
    <div className="notice"><CircleHelp size={18}/> 目前不連接股價 API；這是你自行管理的觀察清單，沒有即時買賣建議。</div>
    {error && <div className="error-msg" role="alert">{error}</div>}
    <div className="action-bar" style={{marginBottom:12}}><button className="mini-button" onClick={()=>setMode('analysis')}><BookOpen size={16}/> 訂單領先分析</button></div>
    <div className="tools-row"><label className="search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋代號、名稱、產業或備註" aria-label="搜尋股票"/></label><button className="primary" onClick={() => edit()}><Plus size={17}/> 新增</button></div>
    <div className="section"><h2>股票觀察清單</h2><small>{filtered.length} 檔</small></div>
    <div className="list">
      {filtered.map(stock => <button className="card stock" key={stock.symbol} onClick={() => setSelected(stock)}>
        <span className="stock-avatar">{stock.symbol.slice(0,2)}</span><span className="stock-name"><b>{stock.name}<small>{stock.symbol}</small></b><small>{stock.group || '未分類'}</small></span>
        <span className="status">待重新分析</span>
      </button>)}
      {filtered.length===0 && <div className="card no-result">目前沒有符合條件的股票</div>}
    </div>
    {selected && !draft && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null) }}><section className="dialog detail-dialog" role="dialog" aria-modal="true" aria-label="股票詳細資料"><button className="close" onClick={() => setSelected(null)} aria-label="關閉"><X/></button><span className="eyebrow">{selected.symbol}</span><h2>{selected.name}</h2><p>{selected.group || '未分類'}</p><div className="detail-note">{selected.note || '尚未新增觀察筆記'}</div><div className="form-actions"><button className="outline" onClick={() => remove(selected)}><Trash2 size={16}/> 刪除</button><button className="primary" onClick={() => edit(selected)}><Pencil size={16}/> 編輯</button></div></section></div>}
    {draft && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) { setDraft(null); setError('') } }}><section className="dialog form-dialog" role="dialog" aria-modal="true" aria-label="股票編輯表單">
      <div className="form-heading"><button className="icon-button" onClick={() => { setDraft(null); setError('') }} aria-label="返回"><ArrowLeft/></button><h2>{editingSymbol ? '編輯觀察股票' : '新增觀察股票'}</h2></div>
      <form onSubmit={e => { e.preventDefault(); void persist() }}>
        <label>股票代號<input maxLength={8} required value={draft.symbol} disabled={Boolean(editingSymbol)} onChange={e => setDraft({ ...draft, symbol: e.target.value })} placeholder="例如 3032"/></label>
        <label>公司名稱<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="例如 偉訓"/></label>
        <label>產業分類<input value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })} placeholder="例如 AI 伺服器"/></label>
        <label>觀察筆記<textarea rows={4} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="客戶需求、追蹤原因與風險..."/></label>
        {error && <p className="error-msg" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? '儲存中…' : '儲存股票'}</button>
      </form>
    </section></div>}
  </>
}
