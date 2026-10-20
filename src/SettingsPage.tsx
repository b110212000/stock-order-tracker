import { useRef, useState } from 'react'
import { ChevronRight, Cloud, CloudDownload, Copy, DatabaseBackup, FileDown, RefreshCcw, Share2, ShieldCheck } from 'lucide-react'
import './SettingsPage.css'
import BackupPanel from './BackupPanel'
import CloudAccountPanel from './CloudAccountPanel'

type Props={
  version:string
  hasUpdate:boolean
  checking:boolean
  repairing:boolean
  status:string
  error:string
  onCheck:()=>void
  onUpdate:()=>void
  onRepair:()=>void
}
export default function SettingsPage({version,hasUpdate,checking,repairing,status,error,onCheck,onUpdate,onRepair}:Props){
  const [shareOpen,setShareOpen]=useState(false)
  const [backupOpen,setBackupOpen]=useState(false)
  const [cloudOpen,setCloudOpen]=useState(()=>/^#\/auth\/(email-verify|reset-password)\//.test(window.location.hash))
  const [shareStatus,setShareStatus]=useState('')
  const linkRef=useRef<HTMLInputElement>(null)
  const url=new URL(import.meta.env.BASE_URL,window.location.origin).href
  async function shareApp(){
    setShareStatus('')
    if(typeof navigator.share==='function'){
      try{
        await navigator.share({title:'OrderLead',text:'OrderLead 股票交易紀錄 App',url})
        return
      }catch(e){
        if(e instanceof Error&&e.name==='AbortError')return
      }
    }
    setShareOpen(true)
  }
  async function copyLink(){
    try{
      if(!navigator.clipboard?.writeText)throw Error('unsupported')
      await navigator.clipboard.writeText(url)
      setShareStatus('已複製連結')
    }catch{
      linkRef.current?.select()
      setShareStatus('請長按網址複製')
    }
  }
  return <section className="settings-screen" aria-labelledby="settings-title">
    <h1 id="settings-title">設定</h1>
    <div className="settings-list card">
      <div className="settings-item">
        <div className="settings-item-icon"><Share2 size={20}/></div>
        <div className="settings-item-label"><strong>分享 App</strong><small>分享給朋友</small></div>
        <button type="button" className="settings-action" onClick={()=>void shareApp()}>
          分享 <ChevronRight size={16}/>
        </button>
      </div>
      {shareOpen&&<div className="settings-share-content">
        <label className="settings-share-link"><input ref={linkRef} value={url} onFocus={e=>e.currentTarget.select()} readOnly aria-label="App 分享網址"/>
          <button type="button" onClick={()=>void copyLink()} aria-label="複製 App 連結"><Copy size={16}/>複製</button>
        </label>
        {shareStatus&&<span className="settings-share-result" role="status">{shareStatus}</span>}
        <details className="settings-install-tip"><summary>安裝到 iPhone 主畫面</summary><p>用 Safari 開啟網址，點分享 <Share2 size={13}/>，再選「加入主畫面」。</p></details>
      </div>}
      <div className="settings-item">
        <div className="settings-item-icon"><FileDown size={20}/></div>
        <div className="settings-item-label"><strong>匯入範例</strong><small>交易 JSON 格式</small></div>
        <a className="settings-action" href={import.meta.env.BASE_URL+'trade-import-example.json'} download="OrderLead_交易匯入範例.json">
          下載 <ChevronRight size={16}/>
        </a>
      </div>
      <div className="settings-item">
        <div className="settings-item-icon"><DatabaseBackup size={20}/></div>
        <div className="settings-item-label"><strong>資料備份與轉移</strong><small>換機、還原交易與設定</small></div>
        <button type="button" className="settings-action" aria-expanded={backupOpen} onClick={()=>setBackupOpen(v=>!v)}>
          {backupOpen?'收合':'管理'} <ChevronRight size={16}/>
        </button>
      </div>
      {backupOpen&&<BackupPanel version={version}/>}
      <div className="settings-item">
        <div className="settings-item-icon"><Cloud size={20}/></div>
        <div className="settings-item-label"><strong>雲端帳號</strong><small>Email 登入 · 備份／還原</small></div>
        <button type="button" className="settings-action" aria-expanded={cloudOpen}
          aria-controls="orderlead-cloud-account"
          onClick={()=>setCloudOpen(value=>!value)}>
          {cloudOpen?'收合':'管理'} <ChevronRight size={16}/>
        </button>
      </div>
      {cloudOpen&&<div id="orderlead-cloud-account"><CloudAccountPanel version={version}/></div>}
      <div className="settings-item settings-version">
        <div className="settings-item-icon"><CloudDownload size={20}/></div>
        <div className="settings-item-label"><strong>版本更新</strong><small>目前 v{version}</small></div>
        {hasUpdate&&<span className="settings-new">有更新</span>}
        <button type="button" className="settings-action" disabled={checking||repairing} onClick={hasUpdate?onUpdate:onCheck}>
          {checking?'檢查中':hasUpdate?'立即更新':'檢查更新'} <ChevronRight size={16}/>
        </button>
      </div>
      <div className="settings-item">
        <div className="settings-item-icon"><RefreshCcw size={20}/></div>
        <div className="settings-item-label"><strong>修復更新</strong><small>清除 App 離線快取</small></div>
        <button type="button" className="settings-action" disabled={checking||repairing} onClick={onRepair}>
          {repairing?'處理中':'修復'} <ChevronRight size={16}/>
        </button>
      </div>
    </div>
    {error&&<div className="settings-alert" role="alert">{error} <a href={import.meta.env.BASE_URL+'repair.html'}>獨立修復頁</a></div>}
    {status&&<div className="settings-status" role="status">{status}</div>}
    <div className="settings-privacy"><ShieldCheck size={16}/><span>交易資料儲存在這台裝置</span></div>
  </section>
}
