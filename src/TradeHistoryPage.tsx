import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownUp, ChevronDown, ChevronUp, FileUp, Inbox, Search, ShieldCheck } from 'lucide-react'
import { list, replaceReviewTrades, readOrRecoverReviewTrades } from './db'
import { parseTradeImportBytes, MAX_IMPORT_BYTES } from './import-file'
import { organizeGmailHistory } from './gmail-history'
import { toStaged } from './import-trades'
import type { StagedTrade } from './types'
import './TradeHistoryPage.css'

const number=(n:number)=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:4}).format(n)
type Filter = 'all'|'buy'|'sell'
export default function TradeHistoryPage(){
  const picker=useRef<HTMLInputElement>(null)
  const [rows,setRows]=useState<StagedTrade[]>([])
  const [loading,setLoading]=useState(true)
  const [working,setWorking]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [origin,setOrigin]=useState('')
  const [search,setSearch]=useState('')
  const [filter,setFilter]=useState<Filter>('all')
  const [ascending,setAscending]=useState(false)
  const [showUnmatched,setShowUnmatched]=useState(false)
  const [showMatches,setShowMatches]=useState<string|null>(null)

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
  const matches=useMemo(()=>new Map(history.matchedSales.map(x=>[x.id,x])),[history])
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase()
    return history.included.filter(row=>(filter==='all'||row.side===filter)&&
      (!q||(row.symbol+' '+row.name+' '+row.date).toLowerCase().includes(q)))
      .sort((a,b)=>{
        const order=a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id)
        return ascending?order:-order
      })
  },[history,filter,search,ascending])

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
      setShowUnmatched(false);setShowMatches(null)
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
      setShowUnmatched(false);setShowMatches(null)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setWorking(false)}
  }
  return <section className="history-page">
    <div className="history-heading">
      <div>
        <span className="eyebrow">STEP 01 · 交易配對與毛損益</span>
        <h1>歷史交易紀錄</h1>
        <p>2024 年起的富邦 Gmail「現買／現賣」，以先進先出（FIFO）配對買進來源，計算可確認的每筆賣出毛損益。其他功能仍不開放。</p>
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
      <div className="history-counters">
        <div className="card"><small>現買（全部列入）</small><strong>{history.buyCount}</strong><span>包含定期定額與尚未賣出的買進</span></div>
        <div className="card"><small>現賣（買進股數足夠）</small><strong>{history.matchedSales.length}</strong><span>依成交時間向前配對</span></div>
        <div className="card"><small>現賣（無法配對）</small><strong>{history.unmatched.length}</strong><span>不列入主表；不計算毛損益</span></div>
        <div className="card history-pnl-summary"><small>可計算已實現毛損益</small>
          <strong className={history.reliableGrossPnl>0?'history-gain':history.reliableGrossPnl<0?'history-loss':''}>
            {history.reliableGrossPnl>0?'+':''}NT$ {number(history.reliableGrossPnl)}
          </strong>
          <span>{history.reliableSaleCount} 筆可計算；{history.uncertainSaleCount} 筆成本待確認，未計入</span>
        </div>
      </div>
      <div className="history-toolbar">
        <label className="history-search"><Search size={17}/><input aria-label="搜尋股票" placeholder="搜尋股票代號、名稱或日期" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <div className="history-switch" aria-label="買賣篩選">
          {(['all','buy','sell'] as const).map(x=><button type="button" key={x} className={filter===x?'selected':''} onClick={()=>setFilter(x)}>{x==='all'?'全部':x==='buy'?'現買':'現賣'}</button>)}
        </div>
        <button className="mini-button history-sort" onClick={()=>setAscending(x=>!x)}><ArrowDownUp size={15}/>{ascending?'舊到新':'新到舊'}</button>
      </div>
      <div className="history-table-heading"><h2>買賣交易表</h2><small>符合篩選的 {filtered.length} 筆／共 {history.included.length} 筆</small></div>
      <div className="history-table-scroll card">
        <table className="history-table">
          <thead><tr><th>日期／時間</th><th>股票</th><th>類型</th><th>成交股數</th><th>每股成交價</th><th>成交價金</th><th>已實現毛損益</th><th>買進配對</th></tr></thead>
          <tbody>{filtered.map(row=><tr key={row.id}>
            <td><b>{row.date}</b><small>{row.time}</small></td>
            <td><b>{row.name}</b><small>{row.symbol}</small></td>
            <td><span className={'history-side '+row.side}>{row.side==='buy'?'現買':'現賣'}</span></td>
            <td className="num">{number(row.quantity)} 股</td>
            <td className="num">{number(row.price)}</td>
            <td className="num">{number(row.gross)}</td>
            <td className="num">
              {row.side==='buy'?<span className="history-mut">尚未實現</span>:
               matches.get(row.id)?.reliable?
               <div className="history-pnl">
                 <b className={(matches.get(row.id)?.grossPnl||0)>0?'history-gain':(matches.get(row.id)?.grossPnl||0)<0?'history-loss':''}>
                   {(matches.get(row.id)?.grossPnl||0)>0?'+':''}{number(matches.get(row.id)?.grossPnl||0)}
                 </b>
                 <small>毛報酬 {number((matches.get(row.id)?.grossRoi||0)*100)}%</small>
               </div>:
               <span className="history-uncertain">成本待確認</span>}
            </td>
            <td>{row.side==='buy'?<span className="history-mut">保留</span>:<button className="history-match" onClick={()=>setShowMatches(showMatches===row.id?null:row.id)}>
              {showMatches===row.id?'收起明細':'配對與成本'} {showMatches===row.id?<ChevronUp size={13}/>:<ChevronDown size={13}/>}
              </button>}
              {showMatches===row.id&&matches.has(row.id)&&<div className="history-match-detail">
                {matches.get(row.id)?.reliable?
                  <div className="history-match-totals">賣出價金 {number(matches.get(row.id)?.proceeds||0)}－買入成本 {number(matches.get(row.id)?.cost||0)}＝毛損益 <b>{number(matches.get(row.id)?.grossPnl||0)}</b></div>:
                  <div className="history-match-warning">{matches.get(row.id)?.reason} 下面僅供查看形式上的配對股數，不認列損益。</div>}
                {matches.get(row.id)?.buys.map((x,i)=><div className="history-lot" key={x.id+'-'+i}>
                  <b>{x.date}　買進 {number(x.quantity)} 股 @ {number(x.unitPrice)}</b>
                  {matches.get(row.id)?.reliable&&<span>配對成本 {number(x.cost)} · 配對賣出 {number(x.proceeds)} · 毛損益 {x.grossPnl>0?'+':''}{number(x.grossPnl)}</span>}
                </div>)}
              </div>}
            </td>
          </tr>)}
          {!filtered.length&&<tr><td colSpan={8} className="history-empty-cell">沒有符合條件的交易</td></tr>}</tbody>
        </table>
      </div>
      <div className="history-disclaimer">本頁「毛損益」＝可配對現賣成交價金－對應 FIFO 買進成交成本，未扣實際手續費及交易稅；不是淨損益。計算起點是 2024 年，若先前有未知買進、定期定額缺漏或公司行動，真實成本可能不同。遇到同股票有無法配對的賣出，該事件之後的配對毛損益標示為「成本待確認」，不納入總計。本頁不計算資金餘額或實際庫存。</div>
      <section className="history-excluded card">
        <button className="history-expander" onClick={()=>setShowUnmatched(x=>!x)}>
          <span><b>無法配對的現賣</b><small>{history.unmatched.length} 筆 · 不納入交易主表，保留查核</small></span>
          {showUnmatched?<ChevronUp size={20}/>:<ChevronDown size={20}/>}
        </button>
        {showUnmatched&&<div className="history-excluded-list">{history.unmatched.map(x=><div key={x.row.id} className="history-excluded-row">
          <div><b>{x.row.date} · {x.row.name}（{x.row.symbol}）</b><small>現賣 {number(x.row.quantity)} 股，2024 起先前可配對買進只有 {number(x.available)} 股</small></div>
          <span>已排除</span>
        </div>)}{!history.unmatched.length&&<p>目前沒有無法配對的賣出。</p>}</div>}
      </section>
    </>}
  </section>
}
