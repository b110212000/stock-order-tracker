import {useEffect,useRef,useState} from 'react'
import {CloudDownload,CloudUpload,LogOut,Mail} from 'lucide-react'
import {prepareLocalCloudBackup,verifyCloudBackupSnapshot} from './cloud-backup-snapshot'
import type {CloudBackupManifest} from './cloud-backup-snapshot'
import {planFirstCloudUpload} from './cloud-backup-chunks'
import {restoreLocalData} from './backup-storage'
import {summarizeBackup,validateFullBackup} from './backup-data'
import type {OrderLeadBackup,RestoreMode} from './backup-data'
import './CloudAccountPanel.css'

const HOST='https://orderlead-api.b110212000.workers.dev'
const tokenOk=/^[-_A-Za-z0-9]{43}$/
type Session={token:string,expiresAt:number}
type Screen='login'|'register'|'forgot'|'reset'|'verify'
type Backup={backupId:string,verifiedAt:string,total:number,transactions:number,sha256:string}
type Entry={backup:OrderLeadBackup,entry:Backup}
const active=(session:Session|null):session is Session=>!!session&&
  tokenOk.test(session.token)&&Date.now()+5000<session.expiresAt
async function api(path:string,method:'GET'|'POST'='GET',data?:unknown,token?:string):Promise<Record<string,unknown>>{
  const response=await fetch(HOST+path,{method,cache:'no-store',
    headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),
      ...(token?{'Authorization':'Bearer '+token}:{})},
    ...(data!==undefined?{body:JSON.stringify(data)}:{})})
  const value=await response.json().catch(()=>({})) as Record<string,unknown>
  if(!response.ok){
    if(response.status===503)throw Error('Cloudflare 雲端服務尚未開放')
    if(response.status===429)throw Error('請求太頻繁，請稍候再試')
    if(response.status===401)throw Error('密碼錯誤或登入已過期，請重新登入')
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
  const [backups,setBackups]=useState<Backup[]>([])
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
  async function refresh(token:string){
    const response=await api('/v1/backups','GET',undefined,token)
    if(!Array.isArray(response.backups))throw Error('雲端備份清單無效')
    setBackups(response.backups as Backup[])
  }
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
        setLinkToken('');setPassword('');setConfirm('');setScreen('login')
        setStatus('密碼已變更，請重新登入')
      }else{
        const result=await api('/v1/auth/email/login','POST',{email,password})
        if(typeof result.token!=='string'||!tokenOk.test(result.token)||
          typeof result.expiresAt!=='number'||result.expiresAt<Date.now())
          throw Error('登入回應不正確')
        setSession({token:result.token,expiresAt:result.expiresAt})
        setPassword('');await refresh(result.token)
        setStatus('登入成功')
      }
    })
  }
  async function upload(){
    if(!active(session))return setError('請重新登入')
    await act(async()=>{
      setStatus('正在準備九張資料表…')
      const prepared=await prepareLocalCloudBackup(version)
      const plan=await planFirstCloudUpload(prepared)
      await api('/v1/backups/start','POST',{backupId:plan.backupId,manifest:prepared.manifest},session.token)
      for(let i=0;i<plan.chunks.length;i++){
        if(!active(session))throw Error('登入已過期，請重新登入後再備份')
        setStatus('正在上傳 '+(i+1)+' / '+plan.chunks.length)
        await api('/v1/backups/'+plan.backupId+'/chunks','POST',
          {rows:plan.chunks[i]},session.token)
      }
      const result=await api('/v1/backups/'+plan.backupId+'/complete','POST',{},session.token)
      if(result.verified!==true)throw Error('伺服器尚未驗證備份完整性')
      await refresh(session.token)
      setStatus('雲端備份完成，已驗證 '+plan.totalRows+' 筆資料')
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
      setChosen({backup,entry});setMode('merge');setStatus('資料驗證完成，請確認還原方式')
    })
  }
  async function restore(){
    if(!chosen||busy)return
    if(mode==='replace'){
      if(!window.confirm('取代會覆蓋手機的全部九張資料表，請先匯出本機資料。確定嗎？'))return
      if(window.prompt('輸入「取代」確認覆蓋')!=='取代')return
    }else if(!window.confirm('合併 '+chosen.entry.total+' 筆資料？現有同 ID 紀錄會優先保留。'))return
    await act(async()=>{
      const result=await restoreLocalData(chosen.backup,mode)
      setChosen(null)
      setStatus('還原成功：'+(mode==='merge'?'新增 '+result.added:'目前 '+result.after)+' 筆')
    })
  }
  async function logout(){
    const current=session
    setSession(null);setBackups([]);setChosen(null)
    if(!active(current))return
    await act(async()=>{await api('/v1/auth/email/logout','POST',undefined,current.token);setStatus('已登出')})
  }
  return <section className="cloud-account-panel" aria-label="Email 雲端備份與還原">
    <div className="cloud-account-heading"><Mail size={17}/><strong>雲端備份與換機還原</strong></div>
    {!active(session)?<div className="cloud-account-intro">
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
      <p>已登入 · 有效至 {new Date(session.expiresAt).toLocaleTimeString('zh-TW')}</p>
      <div className="cloud-account-actions">
        <button type="button" className="cloud-account-primary" disabled={busy} onClick={()=>void upload()}>
          <CloudUpload size={16}/>立即備份
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
        <strong>已校驗雲端備份 · {chosen.entry.total} 筆</strong>
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
