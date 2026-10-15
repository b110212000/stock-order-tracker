import { ChevronRight, CloudDownload, RefreshCcw, ShieldCheck } from 'lucide-react'
import './SettingsPage.css'

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
  return <section className="settings-screen" aria-labelledby="settings-title">
    <h1 id="settings-title">設定</h1>
    <div className="settings-list card">
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
