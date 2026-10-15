import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, FileUp, Inbox, Plus, ShieldCheck } from 'lucide-react'
import { addManualReviewTrade, list, mergeReviewTrades, readOrRecoverReviewTrades, uid, now } from './db'
import { parseTradeImportBytes, MAX_IMPORT_BYTES } from './import-file'
import { organizeGmailHistory } from './gmail-history'
import { groupTradesByStock } from './stock-groups'
import StockGroupedView from './StockGroupedView'
import ManualTradeDialog from './ManualTradeDialog'
import { buildManualTrade, assertManualSaleCovered } from './manual-review-trades'
import type { ManualTradeInput } from './manual-review-trades'
import { toStaged } from './import-trades'
import type { StagedTrade } from './types'
import './TradeHistoryPage.css'

export default function TradeHistoryPage(){
  const picker=useRef<HTMLInputElement>(null)
  const [rows,setRows]=useState<StagedTrade[]>([])
  const [loading,setLoading]=useState(true)
  const [working,setWorking]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [origin,setOrigin]=useState('')
  const [manualOpen,setManualOpen]=useState(false)

  const refresh=useCallback(async()=>{
    const existing=await list<StagedTrade>('reviewTrades')
    setRows(existing)
  },[])
  useEffect(()=>{
    let active=true
    readOrRecoverReviewTrades()
      .then(({rows,recovered,ignored})=>{
        if(!active)return
        setRows(rows)
        if(recovered>0){
          setOrigin('已從舊版匯入暫存自動接續 '+recovered+' 筆')
          setMessage('已接續原有的交易紀錄（'+recovered+' 筆）；舊資料完整保留。'+
            (ignored>0?'其中 '+ignored+' 筆格式不符，未複製。':''))
        }
      })
      .catch(e=>{if(active)setError('讀取歷史交易失敗：'+(e instanceof Error?e.message:String(e))+'。原有資料仍保留，請先重新載入頁面。')})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[])
  const history=useMemo(()=>organizeGmailHistory(rows),[rows])
  const groups=useMemo(()=>groupTradesByStock(history),[history])
  async function importFile(file:File){
    setWorking(true);setError('');setMessage('')
    try{
      if(file.size>MAX_IMPORT_BYTES)throw Error('檔案過大（上限 10 MB）')
      const parsed=parseTradeImportBytes(new Uint8Array(await file.arrayBuffer()),file.name)
      const result=await mergeReviewTrades(toStaged(parsed))
      await refresh()
      setOrigin('手動交易＋檔案匯入')
      setMessage('成功匯入 '+result.added+' 筆；'+result.duplicates+' 筆來源已存在，沒有重複加入。原有交易及其他資料均保留。')
    }catch(e){setError('讀取失敗：'+(e instanceof Error?e.message:String(e)))}
    finally{setWorking(false);if(picker.current)picker.current.value=''}
  }
  async function usePreviousInbox(){
    setWorking(true);setError('');setMessage('')
    try{
      const existing=await list<StagedTrade>('imports')
      if(!existing.length)throw Error('找不到先前暫存的匯入紀錄')
      const result=await mergeReviewTrades(existing)
      await refresh()
      setOrigin('手動交易＋舊版匯入暫存')
      setMessage('已合併舊暫存 '+result.added+' 筆；'+result.duplicates+' 筆重複跳過。既有手動交易保留。')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setWorking(false)}
  }
  async function saveManual(input:ManualTradeInput){
    const draft=buildManualTrade(input,uid(),now())
    const current=await list<StagedTrade>('reviewTrades')
    assertManualSaleCovered(current,draft)
    await addManualReviewTrade(draft)
    await refresh()
    setOrigin('手動新增＋檔案匯入')
    setMessage('已新增 '+(draft.side==='buy'?'買進':'賣出')+'：'+draft.name+' '+draft.quantity+' 股')
    setManualOpen(false)
  }
  return <section className="history-page">
    <div className="history-heading">
      <div>
        <span className="eyebrow">STEP 01 · 個股買賣對照</span>
        <h1>歷史交易紀錄</h1>
        <p>按個股整理交易：左買右賣，顯示 FIFO 配對、毛損益和未賣股數。可以手動新增第一筆，也能匯入既有的交易檔。</p>
      </div>
      <div className="history-heading-actions">
        <button className="primary" disabled={working} onClick={()=>setManualOpen(true)}><Plus size={17}/>手動新增交易</button>
        <button className="mini-button history-file-button" disabled={working} onClick={()=>picker.current?.click()}><FileUp size={17}/>{working?'讀取中…':'匯入交易檔'}</button>
      </div>
    </div>
    <input hidden type="file" ref={picker} accept=".json,.zip,application/json,application/zip" onChange={e=>{const file=e.target.files?.[0];if(file)void importFile(file)}}/>
    {error&&<div className="error-msg" role="alert">{error}</div>}
    {message&&<div className="notice history-message" role="status"><ShieldCheck size={18}/>{message}</div>}
    {loading?<div className="card history-empty">正在讀取本機交易資料…</div>:rows.length===0?<div className="card history-empty">
      <Inbox size={34}/>
      <h2>從第一筆交易開始</h2>
      <p>還沒有交易紀錄也沒關係。你可以直接新增第一筆買進，填入股票、股數與成交價；已有交易檔的人也能直接匯入。</p>
      <div className="history-actions">
        <button className="primary" onClick={()=>setManualOpen(true)} disabled={working}><Plus size={16}/>新增第一筆買進</button>
        <button className="mini-button history-file-button" onClick={()=>picker.current?.click()} disabled={working}><FileUp size={16}/>匯入交易檔</button>
        <button className="mini-button" onClick={()=>void usePreviousInbox()} disabled={working}>接續舊版暫存</button>
      </div>
    </div>:<>
      <div className="history-source">
        <Activity size={16}/>
        <span>{origin||'儲存在本機的交易紀錄'} · {rows.length} 筆來源紀錄</span>
        <button type="button" onClick={()=>void usePreviousInbox()} disabled={working} title="如果無法下載私人新檔，可改用先前暫存資料">讀取舊暫存</button>
      </div>
      <div className="grouped-overview" role="status">
        <span><b>{groups.length}</b> 檔股票</span>
        <span>買進 <b>{history.buyCount}</b> 筆</span>
        <span>可配對賣出 <b>{history.matchedSales.length}</b> 筆</span>
        {history.unmatched.length>0&&<span>無法配對 <b>{history.unmatched.length}</b> 筆</span>}
      </div>
      <StockGroupedView groups={groups}/>
    </>}
    {manualOpen&&<ManualTradeDialog onSave={saveManual} onClose={()=>setManualOpen(false)} firstTrade={rows.length===0}/>}
  </section>
}
