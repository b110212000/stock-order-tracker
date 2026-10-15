import { useEffect, useState } from 'react'
import { Activity, X } from 'lucide-react'
import TradeHistoryPage from './TradeHistoryPage'
import { updateSW } from './pwa'

/** Stage 1: Hide all unapproved modules, without deleting their code or IndexedDB data. */
export default function App(){
  const [refresh,setRefresh]=useState(false)
  useEffect(()=>{
    const listener=()=>setRefresh(true)
    window.addEventListener('orderlead-update-ready',listener)
    return ()=>window.removeEventListener('orderlead-update-ready',listener)
  },[])
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)')
    const apply=()=>{
      const stored=localStorage.getItem('orderlead-theme')
      document.documentElement.dataset.theme=stored==='light'||stored==='dark'
        ?stored:(media.matches?'dark':'light')
    }
    apply()
    media.addEventListener('change',apply)
    return ()=>media.removeEventListener('change',apply)
  },[])
  return <div className="app review-shell">
    <header className="header">
      <div className="brand"><span className="brand-symbol"><Activity size={21}/></span><span><b>OrderLead</b><small>富邦 Gmail 歷史交易</small></span></div>
      <span className="review-status">第一關 · 交易紀錄</span>
    </header>
    <main className="main"><div className="content">
      <TradeHistoryPage/>
      <footer className="footer">OrderLead · v1.10.0 · 其他功能暫時隱藏 · 非投資建議</footer>
    </div></main>
    {refresh&&<div className="update" role="status">
      有新版本可更新 <button onClick={()=>updateSW(true)}>立即更新</button>
      <button aria-label="關閉" onClick={()=>setRefresh(false)}><X size={17}/></button>
    </div>}
  </div>
}
