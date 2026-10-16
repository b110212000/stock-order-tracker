import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, Inbox, Plus, X } from 'lucide-react'
import { addManualReviewTrade, list, mergeReviewTrades, mutateReviewTrade, uid, now } from './db'
import { parseTradeImportBytes, MAX_IMPORT_BYTES } from './import-file'
import { organizeGmailHistory } from './gmail-history'
import { groupTradesByStock } from './stock-groups'
import StockGroupedView from './StockGroupedView'
import ManualTradeDialog from './ManualTradeDialog'
import { buildManualTrade } from './manual-review-trades'
import type { ManualTradeInput } from './manual-review-trades'
import { toStaged } from './import-trades'
import type { StagedTrade } from './types'
import { editedReviewTrade, assessReviewMutation, mutationPrompt } from './review-ledger-ops'
import './TradeHistoryPage.css'

export default function TradeHistoryPage(){
  const picker=useRef<HTMLInputElement>(null)
  const [rows,setRows]=useState<StagedTrade[]>([])
  const [loading,setLoading]=useState(true)
  const [working,setWorking]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [manualOpen,setManualOpen]=useState(false)
  const [editingRow,setEditingRow]=useState<StagedTrade|null>(null)

  const refresh=useCallback(async()=>{
    const existing=await list<StagedTrade>('reviewTrades')
    setRows(existing)
    return existing
  },[])
  useEffect(()=>{
    let active=true
    list<StagedTrade>('reviewTrades')
      .then(saved=>{if(active)setRows(saved)})
      .catch(e=>{if(active)setError('讀取交易紀錄失敗：'+(e instanceof Error?e.message:String(e)))})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[])
  useEffect(()=>{
    if(!message)return
    const id=window.setTimeout(()=>setMessage(''),3000)
    return ()=>window.clearTimeout(id)
  },[message])
  const history=useMemo(()=>organizeGmailHistory(rows),[rows])
  const groups=useMemo(()=>groupTradesByStock(history),[history])
  async function importFile(file:File){
    setWorking(true);setError('');setMessage('')
    try{
      if(file.size>MAX_IMPORT_BYTES)throw Error('檔案過大（上限 10 MB）')
      const parsed=parseTradeImportBytes(new Uint8Array(await file.arrayBuffer()),file.name)
      const result=await mergeReviewTrades(toStaged(parsed))
      await refresh()
      setMessage('成功匯入 '+result.added+' 筆；'+result.duplicates+' 筆來源已存在，沒有重複加入。原有交易及其他資料均保留。')
    }catch(e){setError('讀取失敗：'+(e instanceof Error?e.message:String(e)))}
    finally{setWorking(false);if(picker.current)picker.current.value=''}
  }
  function editRow(row:StagedTrade){
    setEditingRow(row)
    setManualOpen(true)
    setError('');setMessage('')
  }
  async function deleteRow(row:StagedTrade){
    setError('');setMessage('')
    try{
      const current=await list<StagedTrade>('reviewTrades')
      const original=current.find(x=>x.id===row.id)
      if(!original||JSON.stringify(original)!==JSON.stringify(row))
        throw Error('這筆交易已變更，請重新整理後再試')
      const impact=assessReviewMutation(current,row.id,null)
      if(!window.confirm(mutationPrompt(row,'delete',impact)))return
      await mutateReviewTrade(current,row.id,null)
      await refresh()
      setMessage('已刪除交易，FIFO 損益與剩餘股數已重新計算')
    }catch(e){
      setError(e instanceof Error?e.message:String(e))
      await refresh().catch(()=>{})
    }
  }
  async function saveManual(input:ManualTradeInput){
    if(editingRow){
      const current=await list<StagedTrade>('reviewTrades')
      const original=current.find(x=>x.id===editingRow.id)
      if(!original||JSON.stringify(original)!==JSON.stringify(editingRow))
        throw Error('這筆交易已被其他畫面修改，請關閉後重試')
      const next=editedReviewTrade(original,input)
      const impact=assessReviewMutation(current,original.id,next)
      if((impact.newlyUnmatched>0||impact.recalculatedSales>0)&&
         !window.confirm(mutationPrompt(original,'edit',impact)))return
      await mutateReviewTrade(current,original.id,next)
      await refresh()
      setMessage('交易已更新，相關毛損益與股數已重新計算')
    }else{
      const draft=buildManualTrade(input,uid(),now())
      // A transaction is a historical fact: do not reject sales simply
      // because their earlier buys have not yet been entered.
      await addManualReviewTrade(draft)
      const updated=await refresh()
      const shortage=draft.side==='sell'?
        organizeGmailHistory(updated).unmatched.find(x=>x.row.id===draft.id):undefined
      setMessage('已新增 '+(draft.side==='buy'?'買進':'賣出')+'：'+draft.name+' '+draft.quantity+' 股'+
        (shortage?' · 待配對，尚缺 '+shortage.missing+' 股買進紀錄':''))
    }
    setManualOpen(false);setEditingRow(null)
  }
  function openAdd(){
    setEditingRow(null)
    setManualOpen(true)
  }
  return <section className="history-page">
    <div className="history-heading">
      <h1>交易紀錄</h1>
      <div className="history-heading-actions">
        <button type="button" className="mini-button history-file-button" disabled={working} onClick={()=>picker.current?.click()}><FileUp size={17}/>匯入</button>
        <button type="button" className="primary" disabled={working} onClick={openAdd}><Plus size={17}/>新增</button>
      </div>
    </div>
    <input hidden type="file" ref={picker} accept=".json,.zip,application/json,application/zip"
      onChange={e=>{const file=e.target.files?.[0];if(file)void importFile(file)}}/>
    {!loading&&rows.length>0&&<>
      <div className="grouped-overview" role="status">
        <span><b>{groups.length}</b> 檔股票</span>
        <span>買進 <b>{history.buyCount}</b></span>
        <span>賣出 <b>{history.sellCount}</b></span>
        {history.unmatched.length>0&&<span className="history-unmatched">待核對 <b>{history.unmatched.length}</b></span>}
      </div>
      <StockGroupedView groups={groups} onEdit={editRow} onDelete={row=>void deleteRow(row)}/>
    </>}
    {loading&&<div className="history-loading" role="status">載入中…</div>}
    {!loading&&rows.length===0&&<div className="history-empty-state">
      <div className="history-empty-icon"><Inbox size={27}/></div>
      <h2>還沒有交易紀錄</h2>
      <p>從「新增」開始，或匯入交易檔。</p>
    </div>}
    {(message||error)&&<div className={'history-toast '+(error?'history-toast-error':'')} role={error?'alert':'status'}>
      <span>{error||message}</span>
      <button type="button" onClick={()=>{setError('');setMessage('')}} aria-label="關閉提示"><X size={16}/></button>
    </div>}
    {manualOpen&&<ManualTradeDialog key={editingRow?.id||'new'} editing={editingRow||undefined} onSave={saveManual} onClose={()=>{setManualOpen(false);setEditingRow(null)}} firstTrade={rows.length===0}/>}
  </section>
}
