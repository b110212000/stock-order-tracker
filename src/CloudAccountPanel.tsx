import {useEffect,useState} from 'react'
import {Check,Copy,KeyRound,LockKeyhole,ShieldAlert} from 'lucide-react'
import {createPendingCloudIdentity} from './cloud-identity'
import type {PendingCloudIdentity} from './cloud-identity'
import {readCloudDevice,savePendingCloudDevice} from './cloud-device-storage'
import type {StoredCloudDeviceIdentity} from './cloud-device-storage'
import './CloudAccountPanel.css'

type LoadState='loading'|'empty'|'existing'|'error'

/**
 * Local-only onboarding. NEVER report successful cloud registration.
 * The server's dual security gates are still disabled, so no API request,
 * session token, or trade upload is made here.
 *
 * recoveryKey only exists in this component's temporary React state while
 * the user views it. It is discarded after local key storage or unmount.
 * No key or verifier is written to logs, URLs or localStorage.
 */
export default function CloudAccountPanel(){
  const [loadState,setLoadState]=useState<LoadState>('loading')
  const [stored,setStored]=useState<StoredCloudDeviceIdentity|null>(null)
  const [draft,setDraft]=useState<PendingCloudIdentity|null>(null)
  const [acknowledged,setAcknowledged]=useState(false)
  const [working,setWorking]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')

  useEffect(()=>{
    let mounted=true
    readCloudDevice().then(device=>{
      if(!mounted)return
      setStored(device)
      setLoadState(device?'existing':'empty')
    }).catch(()=>{
      if(mounted){
        setLoadState('error')
        setError('無法讀取本機設備金鑰，請勿清除網站資料或重新建立帳號。')
      }
    })
    return ()=>{mounted=false}
  },[])

  async function begin(){
    if(working||loadState!=='empty'||draft)return
    setWorking(true);setError('');setNotice('')
    try{
      // Recheck to avoid replacing an identity created in another PWA tab.
      const existing=await readCloudDevice()
      if(existing){
        setStored(existing)
        setLoadState('existing')
        return
      }
      setDraft(await createPendingCloudIdentity())
      setAcknowledged(false)
    }catch{
      setError('無法產生安全金鑰。請確認瀏覽器支援安全儲存空間。')
    }finally{setWorking(false)}
  }

  async function copyRecoveryInfo(){
    if(!draft||working)return
    setError('');setNotice('')
    try{
      if(!navigator.clipboard?.writeText)throw Error('clipboard-unavailable')
      await navigator.clipboard.writeText(
        'OrderLead 帳號識別碼：'+draft.userId+'\n恢復金鑰：'+draft.recoveryKey
      )
      setNotice('已複製恢復資訊。請存到其他裝置或紙本；剪貼簿內容可能被其他 App 讀取。')
    }catch{
      setError('無法複製，請手動記下帳號識別碼與恢復金鑰。')
    }
  }

  function cancel(){
    if(working)return
    setDraft(null)
    setAcknowledged(false)
    setError('')
    setNotice('已取消，這次產生的恢復金鑰未儲存。')
  }

  async function persist(){
    if(!draft||!acknowledged||working||loadState!=='empty')return
    setWorking(true);setError('');setNotice('')
    try{
      // Persist only an unextractable CryptoKey and public metadata.
      // The plaintext recovery secret is NEVER passed to IndexedDB.
      await savePendingCloudDevice(draft,true)
      setDraft(null)
      setAcknowledged(false)
      setStored(await readCloudDevice())
      setLoadState('existing')
      setNotice('本機設備金鑰已安全保存，但尚未建立雲端帳號，也沒有備份任何交易。')
    }catch{
      setError('無法儲存設備金鑰；可能已有舊裝置資料。請勿清除瀏覽器資料，請重新開啟此區塊確認狀態。')
    }finally{setWorking(false)}
  }

  return <section className="cloud-account-panel" aria-label="雲端帳號本機準備">
    <p className="cloud-account-caution"><ShieldAlert size={17} aria-hidden="true"/>目前僅提供<strong>本機設備金鑰準備</strong>，雲端登入與交易上傳尚未開放。</p>
    {loadState==='loading'&&<p className="cloud-account-muted" role="status">正在檢查這台裝置是否已有設備金鑰…</p>}
    {loadState==='error'&&<p className="cloud-account-muted">為保護既有帳號，檢查失敗時不允許產生新金鑰。</p>}
    {loadState==='existing'&&stored&&<div className="cloud-account-existing">
      <div className="cloud-account-heading"><LockKeyhole size={17} aria-hidden="true"/><strong>已保存本機設備金鑰</strong></div>
      <dl className="cloud-account-meta">
        <dt>帳號識別碼</dt><dd className="cloud-account-id">{stored.userId}</dd>
        <dt>設備狀態</dt><dd>{stored.state==='pending'?'待連線註冊':'本機記錄：已註冊，尚未重新驗證'}</dd>
      </dl>
      <p>設備私鑰已保存在此瀏覽器，但<strong>無法在這裡再次查看恢復金鑰</strong>。請妥善保管之前另存的金鑰，不要清除網站資料。</p>
      <p>待安全登入功能開放，才能將這組身分註冊到 Cloudflare。現在沒有雲端備份。</p>
    </div>}
    {loadState==='empty'&&!draft&&<div className="cloud-account-intro">
      <div className="cloud-account-heading"><KeyRound size={17} aria-hidden="true"/><strong>準備這台裝置的金鑰</strong></div>
      <p>系統會產生一組設備私鑰和一份恢復金鑰。恢復金鑰只在下一個畫面顯示，之後無法重新查看。</p>
      <p>請將恢復金鑰與帳號識別碼存到<strong>這台手機以外</strong>，例如紙本或其他安全的裝置。這不會將帳號送到雲端。</p>
      <button type="button" className="cloud-account-primary" disabled={working} onClick={()=>void begin()}>
        <KeyRound size={17} aria-hidden="true"/>{working?'準備中…':'產生本機設備金鑰'}
      </button>
    </div>}
    {loadState==='empty'&&draft&&<div className="cloud-account-recovery">
      <div className="cloud-account-heading"><KeyRound size={17} aria-hidden="true"/><strong>請先妥善保存恢復資訊</strong></div>
      <p className="cloud-account-warning">只會在本次畫面顯示！儲存金鑰、取消或離開此頁後，將無法再次查看。</p>
      <div className="cloud-account-secret">
        <label>帳號識別碼（User UUID）</label>
        <output className="cloud-account-id">{draft.userId}</output>
        <label>恢復金鑰（請勿公開）</label>
        <output className="cloud-account-key">{draft.recoveryKey}</output>
      </div>
      <button type="button" className="cloud-account-secondary" disabled={working} onClick={()=>void copyRecoveryInfo()}>
        <Copy size={16} aria-hidden="true"/>複製帳號與恢復金鑰
      </button>
      <label className="cloud-account-confirm">
        <input type="checkbox" checked={acknowledged} disabled={working} onChange={e=>setAcknowledged(e.currentTarget.checked)}/>
        <span>我已將<strong>帳號識別碼與恢復金鑰</strong>保存到此裝置以外，也了解現在還沒有建立雲端帳號或備份交易資料。</span>
      </label>
      <div className="cloud-account-actions">
        <button type="button" className="cloud-account-primary" disabled={!acknowledged||working} onClick={()=>void persist()}>
          <Check size={17} aria-hidden="true"/>{working?'儲存中…':'確認並保存本機金鑰'}
        </button>
        <button type="button" className="cloud-account-secondary" disabled={working} onClick={cancel}>取消，不儲存</button>
      </div>
    </div>}
    {notice&&<p role="status" className="cloud-account-notice">{notice}</p>}
    {error&&<p role="alert" className="cloud-account-error">{error}</p>}
    <p className="cloud-account-footer">交易紀錄目前仍在本機，請先用「資料備份與轉移」匯出完整備份並另存其他裝置。</p>
  </section>
}
