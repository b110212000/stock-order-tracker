import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, FileUp, Inbox, ShieldCheck } from 'lucide-react'
import { list, replaceReviewTrades, readOrRecoverReviewTrades } from './db'
import { parseTradeImportBytes, MAX_IMPORT_BYTES } from './import-file'
import { organizeGmailHistory } from './gmail-history'
import { groupTradesByStock } from './stock-groups'
import StockGroupedView from './StockGroupedView'
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
          setOrigin('已從舊版 Gmail 暫存自動恢復 '+recovered+' 筆')
          setMessage('已自動接續你先前匯入的交易紀錄（'+recovered+' 筆）；舊資料完整保留。'+
            (ignored>0?'其中 '+ignored+' 筆不符合 2024 年起的範圍或格式，未複製。':''))
        }
      })
      .catch(e=>{if(active)setError('讀取歷史交易失敗：'+(e instanceof Error?e.message:String(e))+'。原有資料仍保留，請先重新載入頁面。')})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[])
  const history=useMemo(()=>organizeGmailHistory(rows,'2024-01-01'),[rows])
  const groups=useMemo(()=>groupTradesByStock(history),[history])
  async function importFile(file:File){
    setWorking(true);setError('');setMessage('')
    try{
      if(file.size>MAX_IMPORT_BYTES)throw Error('檔案過大（上限 10 MB）')
      const parsed=parseTradeImportBytes(new Uint8Array(await file.arrayBuffer()),file.name)
      const after2024=parsed.filter(row=>row.date>='2024-01-01')
      if(after2024.length===0)throw Error('找不到 2024 年起的富邦成交紀錄')
      await replaceReviewTrades(toStaged(after2024))
      await refresh()
      setOrigin('已載入 '+after2024.length+' 筆 Gmail 原始成交紀錄')
      setMessage('整理完成：已替換「交易紀錄驗收區」的來源資料。以前的正式交易、資金、提醒與舊匯入暫存均未修改。')
    }catch(e){setError('讀取失敗：'+(e instanceof Error?e.message:String(e)))}
    finally{setWorking(false);if(picker.current)picker.current.value=''}
  }
  async function usePreviousInbox(){
    setWorking(true);setError('');setMessage('')
    try{
      const existing=await list<StagedTrade>('imports')
      const relevant=existing.filter(x=>x.date>='2024-01-01')
      if(!relevant.length)throw Error('找不到先前暫存的 2024 年起 Gmail 紀錄，請選擇最新整理檔案')
      await replaceReviewTrades(relevant)
      await refresh()
      setOrigin('來自先前暫存 '+relevant.length+' 筆（可能不是完整 Gmail 成交清單）')
      setMessage('已整理舊版暫存；建議使用最新 2024 起的完整匯入檔再次替換，以免漏掉舊版先前略過的交易。')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setWorking(false)}
  }
  return <section className="history-page">
    <div className="history-heading">
      <div>
        <span className="eyebrow">STEP 01 · 個股買賣對照</span>
        <h1>歷史交易紀錄</h1>
        <p>按個股整理 2024 年起的富邦 Gmail 買賣；左買右賣，每檔底部顯示未賣股數及成本。用 FIFO 計算可配對賣出的毛損益；其他功能仍不開放。</p>
      </div>
      <button className="primary" disabled={working} onClick={()=>picker.current?.click()}><FileUp size={17}/>{working?'讀取中…':'匯入 Gmail 紀錄'}</button>
    </div>
    <input hidden type="file" ref={picker} accept=".json,.zip,application/json,application/zip" onChange={e=>{const file=e.target.files?.[0];if(file)void importFile(file)}}/>
    {error&&<div className="error-msg" role="alert">{error}</div>}
    {message&&<div className="notice history-message" role="status"><ShieldCheck size={18}/>{message}</div>}
    {loading?<div className="card history-empty">正在讀取本機交易資料…</div>:rows.length===0?<div className="card history-empty">
      <Inbox size={34}/>
      <h2>這裡尚未有交易表資料</h2>
      <p>已嘗試從本機舊版 Gmail 暫存接續歷史交易；如果還是空白，可能當初是在另一個 Safari／主畫面 PWA 儲存環境匯入。你可以直接選 2024 年起的 JSON / ZIP，原本的正式交易與資金資料不會被更動。</p>
      <div className="history-actions"><button className="primary" onClick={()=>picker.current?.click()} disabled={working}>選擇 2024 年交易檔</button><button className="mini-button" onClick={()=>void usePreviousInbox()} disabled={working}>使用舊版已暫存紀錄</button></div>
    </div>:<>
      <div className="history-source">
        <Activity size={16}/>
        <span>{origin||'已儲存的本機 Gmail 歷史交易'} · 2024/01/01 起</span>
        <button type="button" onClick={()=>void usePreviousInbox()} disabled={working} title="如果無法下載私人新檔，可改用先前暫存資料">讀取舊暫存</button>
      </div>
      <div className="grouped-overview" role="status">
        <span>2024 年起 · <b>{groups.length}</b> 檔股票</span>
        <span>買進 <b>{history.buyCount}</b> 筆</span>
        <span>可配對賣出 <b>{history.matchedSales.length}</b> 筆</span>
        {history.unmatched.length>0&&<span>無法配對 <b>{history.unmatched.length}</b> 筆</span>}
      </div>
      <StockGroupedView groups={groups}/>
    </>}
  </section>
}
