import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, Plus, X } from 'lucide-react'
import { addManualReviewTrade, list, mergeReviewTrades, mutateReviewTrade, uid, now } from './db'
import { parseTradeImportBytes, MAX_IMPORT_BYTES } from './import-file'
import {parseTabularTrades,resolveTabularNames} from './tabular-trades'
import ImportFormatMenu from './ImportFormatMenu'
import { organizeGmailHistory } from './gmail-history'
import { groupTradesByStock } from './stock-groups'
import StockGroupedView from './StockGroupedView'
import ManualTradeDialog from './ManualTradeDialog'
import { buildManualTrade } from './manual-review-trades'
import { namesFromTrades,lookupStockName } from './stock-name-directory'
import type { ManualTradeInput } from './manual-review-trades'
import { toStaged } from './import-trades'
import type { SourceTrade } from './import-trades'
import type { StagedTrade } from './types'
import { editedReviewTrade, assessReviewMutation, mutationPrompt } from './review-ledger-ops'
import './TradeHistoryPage.css'

export default function TradeHistoryPage(){
  const [rows,setRows]=useState<StagedTrade[]>([])
  const [loading,setLoading]=useState(true)
  const [working,setWorking]=useState(false)
  const [reading,setReading]=useState(false)
  const [preview,setPreview]=useState<null|{file:string,records:SourceTrade[],errors:string[],duplicates:number,newCount:number}>(null)
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
  const knownStockNames=useMemo(()=>namesFromTrades(rows),[rows])
  async function importFile(file:File){
    setReading(true);setError('');setMessage('');setPreview(null)
    try{
      if(file.size>MAX_IMPORT_BYTES)throw Error('檔案過大（上限 10 MB）')
      const bytes=new Uint8Array(await file.arrayBuffer())
      let parsed:SourceTrade[],errors:string[]=[]
      if(/\.(?:csv|xlsx)$/i.test(file.name)){
        const result=parseTabularTrades(bytes,file.name)
        const named=await resolveTabularNames(result.drafts,symbol=>
          lookupStockName(symbol,knownStockNames,import.meta.env.BASE_URL))
        parsed=named.records
        errors=[...result.errors,...named.errors]
      }else parsed=parseTradeImportBytes(bytes,file.name)
      const existing=await list<StagedTrade>('reviewTrades')
      const known=new Set(existing.map(row=>row.id))
      const duplicates=parsed.filter(row=>known.has(row.id)).length
      setPreview({file:file.name,records:parsed,errors,duplicates,newCount:parsed.length-duplicates})
    }catch(e){setError('讀取失敗：'+(e instanceof Error?e.message:String(e)))}
    finally{setReading(false)}
  }
  async function confirmImport(){
    if(!preview||preview.errors.length||preview.newCount===0||working)return
    setWorking(true);setError('')
    try{
      const result=await mergeReviewTrades(toStaged(preview.records))
      setPreview(null)
      await refresh()
      setMessage('成功匯入 '+result.added+' 筆；'+result.duplicates+' 筆來源已存在，沒有重複加入。原有交易及其他資料均保留。')
    }catch(e){setError('匯入失敗：'+(e instanceof Error?e.message:String(e)))}
    finally{setWorking(false)}
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
        <ImportFormatMenu mode="template" className="mini-button history-file-button" disabled={working||reading}/>
        <ImportFormatMenu mode="import" className="mini-button history-file-button" disabled={working||reading}
          onFile={file=>void importFile(file)}/>
        <button type="button" className="primary" disabled={working||reading} onClick={openAdd}><Plus size={17}/>新增</button>
      </div>
    </div>
    {reading&&<div className="history-loading" role="status">正在檢查匯入檔案…</div>}
    {preview&&<section className="history-import-preview card" aria-label="匯入預覽">
      <div className="history-preview-heading">
        <strong>匯入預覽</strong>
        <button type="button" onClick={()=>setPreview(null)} disabled={working} aria-label="取消匯入"><X size={18}/></button>
      </div>
      <small className="history-preview-filename">{preview.file}</small>
      <div className="history-preview-counts">
        <span>可新增 <b>{preview.newCount}</b> 筆</span>
        <span>已存在 <b>{preview.duplicates}</b> 筆</span>
        <span>需修正 <b>{preview.errors.length}</b> 筆</span>
      </div>
      {preview.records.length>0&&<div className="history-preview-examples">
        {preview.records.slice(0,4).map(record=><div key={record.id}>
          <span>{record.date}</span>
          <b>{record.symbol} {record.name}</b>
          <span>{record.side==='sell'?'賣出':'買進'} {record.quantity} 股</span>
        </div>)}
      </div>}
      {preview.errors.length>0&&<div className="history-preview-errors" role="alert">
        {preview.errors.slice(0,8).map((reason,i)=><p key={i}>{reason}</p>)}
        {preview.errors.length>8&&<p>另有 {preview.errors.length-8} 筆錯誤，請先修正檔案。</p>}
      </div>}
      <div className="history-preview-actions">
        <button type="button" className="mini-button" disabled={working} onClick={()=>setPreview(null)}>取消</button>
        <button type="button" className="primary"
          disabled={working||preview.errors.length>0||preview.newCount===0}
          onClick={()=>void confirmImport()}>
          {working?'匯入中…':preview.errors.length>0?'請先修正檔案':preview.newCount===0?'沒有新交易':'確認匯入'}
        </button>
      </div>
    </section>}
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
    {manualOpen&&<ManualTradeDialog key={editingRow?.id||'new'} editing={editingRow||undefined}
      knownStockNames={knownStockNames} onSave={saveManual}
      onClose={()=>{setManualOpen(false);setEditingRow(null)}} firstTrade={rows.length===0}/>}
  </section>
}
