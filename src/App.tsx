import { useEffect, useState } from 'react'
import { ClipboardList, Settings2 } from 'lucide-react'
import TradeHistoryPage from './TradeHistoryPage'
import SettingsPage from './SettingsPage'
import ErrorBoundary from './ErrorBoundary'
import './ErrorBoundary.css'
import { updateSW } from './pwa'
import { clearOrderLeadPwaCache, freshAppUrl } from './cache-repair'

const VERSION='1.22.0'
type Tab='trades'|'settings'

/** Stage one: only trade ledger and minimal App settings are exposed. */
export default function App(){
  const [tab,setTab]=useState<Tab>(()=>/^#\/auth\/(email-verify|reset-password)\//.test(window.location.hash)?'settings':'trades')
  const [refresh,setRefresh]=useState(false)
  const [repairBusy,setRepairBusy]=useState(false)
  const [checkBusy,setCheckBusy]=useState(false)
  const [settingsError,setSettingsError]=useState('')
  const [settingsStatus,setSettingsStatus]=useState('')

  useEffect(()=>{
    const listener=()=>setRefresh(true)
    window.addEventListener('orderlead-update-ready',listener)
    return ()=>window.removeEventListener('orderlead-update-ready',listener)
  },[])
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)')
    const apply=()=>{
      let stored:string|null=null
      try{stored=localStorage.getItem('orderlead-theme')}catch{ /* restricted mode */ }
      document.documentElement.dataset.theme=stored==='light'||stored==='dark'
        ?stored:(media.matches?'dark':'light')
    }
    apply()
    media.addEventListener('change',apply)
    return ()=>media.removeEventListener('change',apply)
  },[])
  async function checkUpdate(){
    if(checkBusy)return
    setCheckBusy(true);setSettingsStatus('');setSettingsError('')
    try{
      if(!navigator.onLine)throw Error('目前沒有網路連線')
      if(!('serviceWorker' in navigator))throw Error('瀏覽器不支援背景更新，請重新整理網站')
      const scope=new URL(import.meta.env.BASE_URL,window.location.origin).href
      const all=await navigator.serviceWorker.getRegistrations()
      const reg=all.find(x=>x.scope===scope)
      if(!reg) {
        setSettingsStatus('目前沒有離線更新服務，請重新整理網站。')
        return
      }
      await reg.update()
      if(reg.waiting) {
        setRefresh(true)
        setSettingsStatus('發現新版，請按「立即更新」。')
      } else {
        setSettingsStatus('已檢查更新；如有新版，這裡會顯示更新提示。')
      }
    }catch(e){setSettingsError(e instanceof Error?e.message:String(e))}
    finally{setCheckBusy(false)}
  }
  async function repairPwa(){
    if(repairBusy)return
    if(!window.confirm('清除 OrderLead 的離線快取並重新載入？交易紀錄與本機資料不會刪除。'))return
    setRepairBusy(true);setSettingsError('');setSettingsStatus('')
    try{
      const result=await clearOrderLeadPwaCache()
      if(result.failures.length){
        setSettingsError(result.failures.join('；'))
        return
      }
      window.location.replace(freshAppUrl())
    }catch(e){setSettingsError(e instanceof Error?e.message:String(e))}
    finally{setRepairBusy(false)}
  }
  function changeTab(next:Tab){
    setTab(next)
    setSettingsError('');setSettingsStatus('')
    // Each screen owns a separate scroll container; return to its top on tab change.
    document.querySelector('.review-shell .main')?.scrollTo({top:0})
  }
  return <div className="app review-shell">
    <header className="header review-app-header">
      <div className="brand"><img className="brand-logo" src={import.meta.env.BASE_URL+'icon-192.png'} alt="OrderLead" width={36} height={36}/><b>OrderLead</b></div>
    </header>
    <main className="main" id="app-main">
      <div className="content">
        <ErrorBoundary>
          {tab==='trades'?
            <TradeHistoryPage/>:
            <SettingsPage
              version={VERSION}
              hasUpdate={refresh}
              checking={checkBusy}
              repairing={repairBusy}
              status={settingsStatus}
              error={settingsError}
              onCheck={()=>void checkUpdate()}
              onUpdate={()=>void updateSW(true)}
              onRepair={()=>void repairPwa()}
            />}
        </ErrorBoundary>
      </div>
    </main>
    <nav className="bottom-nav review-app-nav" aria-label="主要功能">
      <button type="button" className={'nav '+(tab==='trades'?'active':'')} onClick={()=>changeTab('trades')} aria-current={tab==='trades'?'page':undefined}>
        <ClipboardList size={21}/><span>交易</span>
      </button>
      <button type="button" className={'nav '+(tab==='settings'?'active':'')} onClick={()=>changeTab('settings')} aria-current={tab==='settings'?'page':undefined}>
        <span className="review-settings-icon"><Settings2 size={21}/>{refresh&&<i className="review-update-dot" aria-label="有新版本"/>}</span><span>設定</span>
      </button>
    </nav>
  </div>
}
