import {useEffect,useRef,useState} from 'react'
import {CloudDownload,CloudUpload,LogOut,Mail} from 'lucide-react'
import {prepareLocalCloudBackup,verifyCloudBackupSnapshot} from './cloud-backup-snapshot'
import type {CloudBackupManifest} from './cloud-backup-snapshot'
import {planFirstCloudUpload} from './cloud-backup-chunks'
import {restoreLocalData} from './backup-storage'
import {summarizeBackup,validateFullBackup} from './backup-data'
import type {OrderLeadBackup,RestoreMode} from './backup-data'
import './CloudAccountPanel.css'
import {contentSignature,matchedCloudSync,readSyncMarker,rememberSyncMarker} from './cloud-sync-state'
import {forgetCloudSession,readCloudSession,rememberCloudSession,validCloudSession} from './cloud-email-session'
import type {CloudEmailSession} from './cloud-email-session'

const HOST='https://orderlead-api.b110212000.workers.dev'
const tokenOk=/^[-_A-Za-z0-9]{43}$/
type Session=CloudEmailSession
type Screen='login'|'register'|'forgot'|'reset'|'verify'
type Backup={backupId:string,verifiedAt:string,total:number,transactions:number,sha256:string}
type Entry={backup:OrderLeadBackup,entry:Backup}
const active=(session:Session|null):session is Session=>validCloudSession(session)
async function api(path:string,method:'GET'|'POST'='GET',data?:unknown,token?:string):Promise<Record<string,unknown>>{
  const response=await fetch(HOST+path,{method,cache:'no-store',
    headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),
      ...(token?{'Authorization':'Bearer '+token}:{})},
    ...(data!==undefined?{body:JSON.stringify(data)}:{})})
  const value=await response.json().catch(()=>({})) as Record<string,unknown>
  if(!response.ok){
    if(response.status===503){
      if(value.error==='SYNC_NOT_ENABLED')
        throw Error('雲端功能尚未啟用，請確認 Worker 部署版本')
      if(path==='/v1/auth/email/register'){
        const stages:Record<string,string>={
          MAIL_BINDING:'MLB 郵件連線',
          PASSWORD_HASH:'密碼運算',
          ACCOUNT_LOOKUP:'帳號資料查詢',
          SIGNUP_STORAGE:'待驗證帳號寫入',
          REGISTRATION_INTERNAL:'註冊內部檢查'
        }
        const stage=typeof value.phase==='string'?stages[value.phase]:undefined
        throw Error(stage?'註冊服務失敗：'+stage+'（HTTP 503）':
          '註冊服務暫時異常（HTTP 503），並非功能未開啟')
      }
      throw Error('雲端伺服器暫時無法完成操作（HTTP 503）')
    }
    if(response.status===429)throw Error('請求太頻繁，請稍候再試')
    if(response.status===401)throw Object.assign(Error('密碼錯誤或登入已過期，請重新登入'),{status:401})
    if(response.status===400){
      if(value.error==='INVALID_OR_EXPIRED_LINK')throw Error('驗證或密碼重設連結已失效，請重新申請')
      if(path.includes('forgot-password'))throw Error('Email 格式不正確，請重新輸入')
      if(value.error==='INVALID_INPUT')throw Error('Email 或密碼格式不正確（密碼至少 5 字元）')
      throw Error('輸入資料不正確，請檢查後再試')
    }
    throw Error('連線失敗：HTTP '+response.status)
  }
  return value
}
function extractAction():{screen:Screen,token:string}{
  const match=/^#\/auth\/(email-verify|reset-password)\/([-_A-Za-z0-9]{43})$/.exec(window.location.hash)
  if(!match)return {screen:'login',token:''}
  // Do not keep the secret link in browser history after opening.
  window.history.replaceState(null,'',location.pathname+location.search)
  return {screen:match[1]==='email-verify'?'verify':'reset',token:match[2]}
}
export default function CloudAccountPanel({version}:{version:string}){
  const init=useRef<ReturnType<typeof extractAction>|null>(null)
  if(init.current===null)init.current=extractAction()
  const [screen,setScreen]=useState<Screen>(init.current.screen)
  const [linkToken,setLinkToken]=useState(init.current.token)
  const [email,setEmail]=useState(''),[password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [session,setSession]=useState<Session|null>(null)
  const [verifiedEmail,setVerifiedEmail]=useState('')
  const [checkingSession,setCheckingSession]=useState(()=>init.current?.screen==='login'&&readCloudSession()!==null)
  const [backups,setBackups]=useState<Backup[]>([])
  const [syncState,setSyncState]=useState<'unsynced'|'syncing'|'synced'>('unsynced')
  const [chosen,setChosen]=useState<Entry|null>(null)
  const [mode,setMode]=useState<RestoreMode>('merge')
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('')
  async function act(fn:()=>Promise<void>){
    if(busy)return
    setBusy(true);setStatus('');setError('')
    try{await fn()}catch(e){setError(e instanceof Error?e.message:'操作失敗')}
    finally{setBusy(false)}
  }
  useEffect(()=>{
    if(init.current?.screen!=='verify'||!linkToken)return
    const token=linkToken
    setLinkToken('')
    void act(async()=>{
      await api('/v1/auth/email/verify','POST',{token})
      setScreen('login');setStatus('信箱驗證成功，請登入')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  async function checkCurrentSync(backupsOnServer:Backup[]):Promise<boolean>{
    const marker=readSyncMarker()
    if(!marker||!backupsOnServer.some(item=>item.backupId===marker.backupId))
      return false
    try{
      const current=await prepareLocalCloudBackup(version)
      return matchedCloudSync(marker,await contentSignature(current.manifest),
        backupsOnServer.map(item=>item.backupId))
    }catch{return false}
  }
  async function refresh(token:string){
    const response=await api('/v1/backups','GET',undefined,token)
    if(!Array.isArray(response.backups))throw Error('雲端備份清單無效')
    const serverBackups=response.backups as Backup[]
    setBackups(serverBackups)
    const current=await checkCurrentSync(serverBackups)
    setSyncState(current?'synced':'unsynced')
  }
  // Restore a remembered session after switching pages or reopening PWA.
  // /me checks revocation, expiry and password version asynchronously.
  // Never trust a cached token alone for showing an authenticated account.
  useEffect(()=>{
    if(init.current?.screen!=='login')return
    const saved=readCloudSession()
    if(!saved){setCheckingSession(false);return}
    let cancelled=false
    void (async()=>{
      try{
        const owner=await api('/v1/auth/email/me','GET',undefined,saved.token)
        if(cancelled)return
        if(typeof owner.email!=='string'||!owner.email.includes('@')||
          typeof owner.expiresAt!=='number'||
          !validCloudSession({token:saved.token,expiresAt:owner.expiresAt}))
          throw Error('登入狀態無效，請重新登入')
        const renewed={token:saved.token,expiresAt:owner.expiresAt}
        rememberCloudSession(renewed)
        setVerifiedEmail(owner.email)
        setEmail(owner.email)
        setSession(renewed)
        try{await refresh(saved.token)}
        catch(error){
          if(!cancelled)setError(error instanceof Error?error.message:'無法載入備份清單')
        }
      }catch(error){
        if(cancelled)return
        setSession(null);setVerifiedEmail('')
        if((error as {status?:number})?.status===401){
          forgetCloudSession()
          setStatus('登入已過期，請重新登入')
        }else{
          // Retain the token for retry in a brief network outage, but don't
          // display a logged-in account until the server verifies it.
          setError('無法確認先前的登入，請檢查網路後重新開啟雲端帳號')
        }
      }finally{
        if(!cancelled)setCheckingSession(false)
      }
    })()
    return()=>{cancelled=true}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  useEffect(()=>{
    if(!session)return
    const expire=()=>{
      if(Date.now()+5000<session.expiresAt)return
      forgetCloudSession()
      setSession(null);setVerifiedEmail('');setBackups([]);setChosen(null);setSyncState('unsynced')
      setStatus('長期未使用，請重新登入')
    }
    // Browsers cap a single timeout near 24.8 days. Short interval also
    // handles an iOS PWA waking up after weeks in the background.
    const timer=window.setInterval(expire,60*1000)
    document.addEventListener('visibilitychange',expire)
    return()=>{
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange',expire)
    }
  },[session])

  async function submit(){
    await act(async()=>{
      if(screen!=='forgot'&&screen!=='verify'){
        // Browsers use UTF-16 code units for minLength; backend uses Unicode code points.
        const codePoints=[...password.normalize('NFC')].length
        if(codePoints<5||codePoints>128)throw Error('密碼長度需為 5～128 個字元')
      }
      if(screen==='register'){
        if(password!==confirm)throw Error('兩次密碼不一致')
        await api('/v1/auth/email/register','POST',{email,password,confirmPassword:confirm})
        setPassword('');setConfirm('')
        setStatus('請到信箱點擊驗證連結，再返回登入')
      }else if(screen==='forgot'){
        await api('/v1/auth/email/forgot-password','POST',{email})
        setStatus('若信箱已註冊，將收到密碼重設郵件')
      }else if(screen==='reset'){
        if(password!==confirm)throw Error('兩次密碼不一致')
        await api('/v1/auth/email/reset-password','POST',{
          token:linkToken,password,confirmPassword:confirm
        })
        forgetCloudSession();setSession(null);setVerifiedEmail('')
        setLinkToken('');setPassword('');setConfirm('');setScreen('login')
        setStatus('密碼已變更，請重新登入')
      }else{
        const result=await api('/v1/auth/email/login','POST',{email,password})
        if(typeof result.token!=='string'||!tokenOk.test(result.token)||
          typeof result.expiresAt!=='number'||result.expiresAt<Date.now())
          throw Error('登入回應不正確')
        // The canonical Email comes from the authenticated server, not the
        // user-typed address. Do not cache it in browser storage.
        const owner=await api('/v1/auth/email/me','GET',undefined,result.token)
        if(typeof owner.email!=='string'||!owner.email.includes('@')||
          typeof owner.expiresAt!=='number'||
          !validCloudSession({token:result.token,expiresAt:owner.expiresAt}))
          throw Error('登入帳號資訊不正確')
        const newSession:Session={token:result.token,expiresAt:owner.expiresAt}
        rememberCloudSession(newSession)
        setVerifiedEmail(owner.email)
        setEmail(owner.email)
        setSession(newSession)
        setPassword('')
        await refresh(result.token)
        setStatus('登入成功')
      }
    })
  }
  async function upload(){
    if(!active(session))return setError('請重新登入')
    if(busy)return
    setSyncState('syncing')
    await act(async()=>{
      try{
        const prepared=await prepareLocalCloudBackup(version)
        const signature=await contentSignature(prepared.manifest)
        const plan=await planFirstCloudUpload(prepared)
        await api('/v1/backups/start','POST',{backupId:plan.backupId,manifest:prepared.manifest},session.token)
        for(const rows of plan.chunks){
          if(!active(session))throw Error('SESSION_EXPIRED')
          await api('/v1/backups/'+plan.backupId+'/chunks','POST',{rows},session.token)
        }
        const result=await api('/v1/backups/'+plan.backupId+'/complete','POST',{},session.token)
        if(result.verified!==true)throw Error('BACKUP_UNVERIFIED')
        // A receipt is never written before the server confirms completion.
        rememberSyncMarker({backupId:plan.backupId,contentSignature:signature})
        // Also recheck locally: changes made DURING upload must remain unsynced.
        await refresh(session.token)
      }catch(e){
        setSyncState('unsynced')
        if(e instanceof Error&&e.message==='空白資料不能標記為首次雲端備份')
          throw Error('目前沒有需要同步的紀錄')
        throw Error('同步失敗，請稍後再試')
      }
    })
  }
  async function download(entry:Backup){
    if(!active(session))return setError('請重新登入')
    await act(async()=>{
      const result=await api('/v1/backups/'+entry.backupId,'GET',undefined,session.token)
      if(typeof result.payload!=='string'||!result.manifest||
        !await verifyCloudBackupSnapshot(result.payload,result.manifest as CloudBackupManifest))
        throw Error('雲端備份 SHA-256 驗證失敗，未更動手機資料')
      const backup=validateFullBackup(JSON.parse(result.payload))
      if(summarizeBackup(backup).total!==entry.total)throw Error('雲端備份筆數不一致')
      setChosen({backup,entry});setMode('merge')
    })
  }
  async function restore(){
    if(!chosen||busy)return
    if(mode==='replace'){
      if(!window.confirm('取代會覆蓋手機的全部九張資料表，請先匯出本機資料。確定嗎？'))return
      if(window.prompt('輸入「取代」確認覆蓋')!=='取代')return
    }else if(!window.confirm('合併 '+chosen.entry.total+' 筆資料？現有同 ID 紀錄會優先保留。'))return
    await act(async()=>{
      await restoreLocalData(chosen.backup,mode)
      setChosen(null)
      setStatus('還原完成')
      setSyncState(await checkCurrentSync(backups)?'synced':'unsynced')
    })
  }
  async function logout(){
    const current=session
    forgetCloudSession()
    setSession(null);setVerifiedEmail('');setBackups([]);setChosen(null)
    if(!active(current))return
    await act(async()=>{await api('/v1/auth/email/logout','POST',undefined,current.token);setStatus('已登出')})
  }
  return <section className="cloud-account-panel" aria-label="Email 雲端備份與還原">
    <div className="cloud-account-heading"><Mail size={17}/><strong>雲端備份與換機還原</strong>
      {active(session)&&verifiedEmail&&
        <span className="cloud-sync-status" role="status" aria-live="polite">
          {syncState==='syncing'?'同步中…':syncState==='synced'?'已同步':'未同步'}
        </span>}
    </div>
    {checkingSession?<p role="status">正在確認登入狀態…</p>:
      !active(session)||!verifiedEmail?<div className="cloud-account-intro">
      <p>以 Email 登入後就能備份交易紀錄並在換手機時找回。只有曾經完成雲端備份的資料才能還原。</p>
      {screen!=='verify'&&<form className="cloud-auth-form" onSubmit={e=>{e.preventDefault();void submit()}}>
        <strong>{screen==='register'?'註冊':screen==='forgot'?'忘記密碼':
          screen==='reset'?'重設密碼':'Email 登入'}</strong>
        {screen!=='reset'&&<label>Email
          <input type="email" value={email} required maxLength={254} autoComplete="email"
            onChange={e=>setEmail(e.target.value)}/></label>}
        {screen!=='forgot'&&<label>密碼
          <input type="password" value={password} required minLength={5} maxLength={128}
            autoComplete={screen==='login'?'current-password':'new-password'}
            onChange={e=>setPassword(e.target.value)}/></label>}
        {(screen==='register'||screen==='reset')&&<small className="cloud-password-hint">密碼至少 5 字元，建議使用更長且不重複的密碼。</small>}
        {(screen==='register'||screen==='reset')&&<label>確認密碼
          <input type="password" value={confirm} required minLength={5} maxLength={128}
            autoComplete="new-password" onChange={e=>setConfirm(e.target.value)}/></label>}
        <button type="submit" className="cloud-account-primary" disabled={busy}>
          {busy?'處理中…':screen==='register'?'寄送驗證信':screen==='forgot'?'寄送重設信':
            screen==='reset'?'更新密碼':'登入'}
        </button>
      </form>}
      {screen!=='reset'&&<div className="cloud-auth-switch">
        {(['login','register','forgot'] as const).filter(x=>x!==screen).map(x=>
          <button key={x} type="button" disabled={busy} onClick={()=>{setScreen(x);setStatus('');setError('')}}>
            {x==='login'?'返回登入':x==='register'?'建立帳號':'忘記密碼'}
          </button>)}
      </div>}
    </div>:<div className="cloud-account-intro">
      <p className="cloud-account-signed-email"><strong>已登入：{verifiedEmail}</strong></p>
      <p>已記住登入 · 持續使用會自動續期（30 天未使用才需重新登入）</p>
      <div className="cloud-account-actions">
        <button type="button" className="cloud-account-primary" disabled={busy} onClick={()=>void upload()}>
          <CloudUpload size={16}/>{syncState==='syncing'?'同步中…':'立即同步'}
        </button>
        <button type="button" className="cloud-account-secondary" disabled={busy}
          onClick={()=>void act(()=>refresh(session.token))}>重新整理</button>
      </div>
      <strong>已完成的備份</strong>
      {backups.length===0?<p>尚未有已驗證的雲端備份</p>:backups.map(x=>
        <div className="cloud-snapshot" key={x.backupId}>
          <span>{new Date(x.verifiedAt).toLocaleString('zh-TW')} · {x.total} 筆（交易 {x.transactions} 筆）</span>
          <button type="button" disabled={busy} onClick={()=>void download(x)}>
            <CloudDownload size={15}/>預覽
          </button>
        </div>)}
      {chosen&&<div className="backup-preview">
        <strong>準備還原 · {chosen.entry.total} 筆</strong>
        <label>還原方式
          <select value={mode} onChange={e=>setMode(e.target.value as RestoreMode)}>
            <option value="merge">合併（保留目前資料）</option>
            <option value="replace">取代（刪除目前資料）</option>
          </select>
        </label>
        <div className="cloud-account-actions">
          <button type="button" className="cloud-account-primary" disabled={busy} onClick={()=>void restore()}>確認還原</button>
          <button type="button" className="cloud-account-secondary" disabled={busy} onClick={()=>setChosen(null)}>取消</button>
        </div>
      </div>}
      <button type="button" className="cloud-account-secondary" disabled={busy}
        onClick={()=>void logout()}><LogOut size={15}/>登出</button>
    </div>}
    {status&&<p className="cloud-account-notice" role="status">{status}</p>}
    {error&&<p className="cloud-account-error" role="alert">{error}</p>}
    <p className="cloud-account-footer">雲端備份不會清除手機的原有資料。請另外保留一份本機 JSON 檔案。</p>
  </section>
}
