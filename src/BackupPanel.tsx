import {useEffect,useRef,useState} from 'react'
import {Download,FileUp,Share2} from 'lucide-react'
import {buildBackup,MAX_BACKUP_BYTES,parseBackupBytes,summarizeBackup} from './backup-data'
import type {OrderLeadBackup,RestoreMode} from './backup-data'
import {restoreLocalData,snapshotLocalData} from './backup-storage'
import './BackupPanel.css'

type PreparedFile={href:string,file:File,count:number}
export default function BackupPanel({version}:{version:string}){
  const picker=useRef<HTMLInputElement>(null)
  const [prepared,setPrepared]=useState<PreparedFile|null>(null)
  const [selected,setSelected]=useState<OrderLeadBackup|null>(null)
  const [mode,setMode]=useState<RestoreMode>('merge')
  const [working,setWorking]=useState(false)
  const [status,setStatus]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>()=>{if(prepared)URL.revokeObjectURL(prepared.href)},[prepared])
  async function generate(){
    setWorking(true);setError('');setStatus('')
    try{
      const data=buildBackup(await snapshotLocalData(),version)
      const count=summarizeBackup(data).total
      const encoded=JSON.stringify(data,null,2)
      const blob=new Blob([encoded],{type:'application/json'})
      if(blob.size>MAX_BACKUP_BYTES)throw Error('備份超過 25 MB，請先匯出資料後聯絡開發者')
      const stamp=data.exportedAt.slice(0,10)
      const file=new File([blob],'OrderLead_完整備份_'+stamp+'.json',{type:'application/json'})
      setPrepared({file,href:URL.createObjectURL(blob),count})
      setStatus('備份已產生，請按「儲存檔案」。')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setWorking(false)}
  }
  async function shareFile(){
    if(!prepared)return
    if(typeof navigator.share!=='function'||!(navigator.canShare?.({files:[prepared.file]}))){
      setStatus('此瀏覽器不支援分享備份檔，請按「儲存檔案」。')
      return
    }
    try{await navigator.share({title:'OrderLead 完整備份',files:[prepared.file]})}
    catch(e){if(!(e instanceof Error&&e.name==='AbortError'))
      setError('分享失敗，請改用儲存檔案。')}
  }
  async function load(file:File){
    setError('');setStatus('');setSelected(null)
    try{
      if(file.size>MAX_BACKUP_BYTES)throw Error('檔案超過 25 MB')
      const data=parseBackupBytes(new Uint8Array(await file.arrayBuffer()))
      setSelected(data);setMode('merge')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{if(picker.current)picker.current.value=''}
  }
  async function apply(){
    if(!selected||working)return
    const counts=summarizeBackup(selected)
    if(mode==='replace'){
      if(!window.confirm('「取代」會移除目前所有 OrderLead 本機資料，改成備份檔內容。建議先匯出現在的資料。確定繼續嗎？'))return
      if(window.prompt('請輸入「取代」確認覆蓋現有資料')!=='取代')return
    }else{
      if(!window.confirm('從備份合併 '+counts.total+' 筆資料？現有同 ID 資料會優先保留。'))return
    }
    setWorking(true);setError('');setStatus('')
    try{
      const result=await restoreLocalData(selected,mode)
      setSelected(null)
      setStatus('轉移成功：'+(mode==='merge'?'新增 '+result.added:'已還原 '+result.after)+' 筆。返回「交易」可確認資料。')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setWorking(false)}
  }
  const counts=selected?summarizeBackup(selected):null
  return <section className="backup-panel" aria-label="資料備份與轉移">
    <div className="backup-actions">
      <button type="button" className="backup-main" disabled={working} onClick={()=>void generate()}><Download size={17}/>產生備份</button>
      <button type="button" className="backup-secondary" disabled={working} onClick={()=>picker.current?.click()}><FileUp size={17}/>匯入備份</button>
    </div>
    <input type="file" hidden ref={picker} accept=".json,application/json" onChange={e=>{
      const file=e.currentTarget.files?.[0];if(file)void load(file)
    }}/>
    {prepared&&<div className="backup-prepared">
      <span>備份已準備好 · {prepared.count} 筆</span>
      <div className="backup-inline">
        <a className="backup-link" href={prepared.href} download={prepared.file.name}>儲存檔案</a>
        <button type="button" onClick={()=>void shareFile()}><Share2 size={15}/>分享至檔案</button>
      </div>
    </div>}
    {selected&&counts&&<div className="backup-preview">
      <strong>待還原備份 · {counts.total} 筆</strong>
      <small>{selected.exportedAt.slice(0,10)} · 交易 {counts.transactions} 筆</small>
      <label>還原方式
        <select value={mode} onChange={e=>setMode(e.target.value as RestoreMode)}>
          <option value="merge">合併（保留現有資料）</option>
          <option value="replace">取代（覆蓋全部資料）</option>
        </select>
      </label>
      <div className="backup-inline">
        <button className="backup-confirm" type="button" disabled={working} onClick={()=>void apply()}>
          {working?'處理中…':'確認還原'}
        </button>
        <button type="button" onClick={()=>setSelected(null)} disabled={working}>取消</button>
      </div>
    </div>}
    {status&&<p className="backup-status" role="status">{status}</p>}
    {error&&<p className="backup-error" role="alert">{error}</p>}
    <p className="backup-note">備份含私人財務紀錄，檔案未加密。請妥善保存；換機前先確認檔案已存好。</p>
  </section>
}
