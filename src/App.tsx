import { useEffect, useState } from 'react'
import { Activity, RefreshCw, X } from 'lucide-react'
import TradeHistoryPage from './TradeHistoryPage'
import ErrorBoundary from './ErrorBoundary'
import './ErrorBoundary.css'
import { updateSW } from './pwa'
import { clearOrderLeadPwaCache, freshAppUrl } from './cache-repair'

/** Stage 1: Hide all unapproved modules, without deleting their code or IndexedDB data. */
export default function App(){
  const [refresh,setRefresh]=useState(false)
  const [repairBusy,setRepairBusy]=useState(false)
  const [repairError,setRepairError]=useState('')
  useEffect(()=>{
    const listener=()=>setRefresh(true)
    window.addEventListener('orderlead-update-ready',listener)
    return ()=>window.removeEventListener('orderlead-update-ready',listener)
  },[])
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)')
    const apply=()=>{
      let stored:string|null=null
      try{stored=localStorage.getItem('orderlead-theme')}catch{ /* private browsing restrictions */ }
      document.documentElement.dataset.theme=stored==='light'||stored==='dark'
        ?stored:(media.matches?'dark':'light')
    }
    apply()
    media.addEventListener('change',apply)
    return ()=>media.removeEventListener('change',apply)
  },[])
  async function repairPwa(){
    if(repairBusy)return
    if(!window.confirm('確定要修復 App 更新嗎？系統只會清除 OrderLead 的離線快取並解除舊 Service Worker，不會刪除歷史交易、資金及其他本機資料。'))return
    setRepairBusy(true);setRepairError('')
    try{
      const result=await clearOrderLeadPwaCache()
      if(result.failures.length) {
        setRepairError(result.failures.join('；')+'。你仍可使用獨立修復頁重新嘗試。')
        return
      }
      window.location.replace(freshAppUrl())
    }catch(error){
      setRepairError('修復更新失敗：'+(error instanceof Error?error.message:String(error)))
    }finally{setRepairBusy(false)}
  }
  return <div className="app review-shell">
    <header className="header">
      <div className="brand"><span className="brand-symbol"><Activity size={21}/></span><span><b>OrderLead</b><small>股票買賣紀錄</small></span></div>
      <div className="review-header-actions">
        <span className="review-status">第一關 · 交易紀錄</span>
        <button className="review-repair-btn" disabled={repairBusy} onClick={()=>void repairPwa()} title="清除 OrderLead 離線快取，不刪除交易資料"><RefreshCw size={16}/><span>{repairBusy?'修復中…':'修復更新'}</span></button>
      </div>
    </header>
    <main className="main"><div className="content">
      {repairError&&<p className="error-msg" role="alert">{repairError} <a href={import.meta.env.BASE_URL+'repair.html'}>開啟獨立修復頁</a></p>}
      <ErrorBoundary><TradeHistoryPage/></ErrorBoundary>
      <footer className="footer">OrderLead · v1.13.0 · 其他功能暫時隱藏 · 非投資建議</footer>
    </div></main>
    {refresh&&<div className="update" role="status">
      有新版本可更新 <button onClick={()=>updateSW(true)}>立即更新</button>
      <button aria-label="關閉" onClick={()=>setRefresh(false)}><X size={17}/></button>
    </div>}
  </div>
}
