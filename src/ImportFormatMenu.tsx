import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {FileDown,FileJson,FileSpreadsheet,FileUp} from 'lucide-react'
import {createExcelTemplate} from './tabular-trades'
import './ImportFormatMenu.css'

type Mode='template'|'import'
type Props={
 mode:Mode
 className?:string
 disabled?:boolean
 onFile?:(file:File)=>void
}
function downloadTemplate(){
 const object=URL.createObjectURL(new Blob([createExcelTemplate() as BlobPart],{
  type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
 }))
 const anchor=document.createElement('a')
 anchor.href=object;anchor.download='OrderLead_交易匯入範本.xlsx'
 document.body.append(anchor);anchor.click();anchor.remove()
 window.setTimeout(()=>URL.revokeObjectURL(object),2000)
}
export default function ImportFormatMenu({mode,className='',disabled=false,onFile}:Props){
 const [open,setOpen]=useState(false)
 const [position,setPosition]=useState({top:0,left:0})
 const trigger=useRef<HTMLButtonElement>(null)
 const menu=useRef<HTMLDivElement>(null)
 const input=useRef<HTMLInputElement>(null)
 const [format,setFormat]=useState<'excel'|'json'>('excel')
 const label=mode==='template'?'匯入範本':'匯入'
 useEffect(()=>{
  if(!open)return
  function updatePosition(){
   const rect=trigger.current?.getBoundingClientRect()
   if(!rect)return
   const width=168,margin=8
   const left=Math.max(margin,Math.min(window.innerWidth-width-margin,rect.right-width))
   const height=100
   const top=rect.bottom+height+margin<=window.innerHeight?rect.bottom+5:Math.max(margin,rect.top-height-5)
   setPosition({top,left})
  }
  function outside(event:PointerEvent){
   const t=event.target
   if(t instanceof Node&&!trigger.current?.contains(t)&&!menu.current?.contains(t))setOpen(false)
  }
  function keyboard(event:KeyboardEvent){
   if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}
  }
  updatePosition()
  window.addEventListener('resize',updatePosition)
  window.addEventListener('scroll',updatePosition,true)
  document.addEventListener('pointerdown',outside)
  document.addEventListener('keydown',keyboard)
  return ()=>{
   window.removeEventListener('resize',updatePosition)
   window.removeEventListener('scroll',updatePosition,true)
   document.removeEventListener('pointerdown',outside)
   document.removeEventListener('keydown',keyboard)
  }
 },[open])
 function choose(next:'excel'|'json'){
  setOpen(false)
  if(mode==='template'){
   if(next==='excel')downloadTemplate()
   else{
    const anchor=document.createElement('a')
    anchor.href=import.meta.env.BASE_URL+'trade-import-example.json'
    anchor.download='OrderLead_交易匯入範本.json'
    document.body.append(anchor);anchor.click();anchor.remove()
   }
  }else{
   setFormat(next)
   // File selection must be synchronously initiated by the user's tap on iOS.
   if(input.current){
    input.current.accept=next==='excel'?'.xlsx,.csv':'.json,.zip'
    input.current.click()
   }
  }
 }
 return <span className="import-menu-trigger">
  <button ref={trigger} type="button" disabled={disabled} className={className}
   aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
   {mode==='template'?<FileDown size={16}/>:<FileUp size={16}/>}
   {label}
  </button>
  {mode==='import'&&<input ref={input} hidden type="file"
   aria-label="選擇交易匯入檔案"
   accept={format==='excel'?'.xlsx,.csv':'.json,.zip'}
   onChange={event=>{const file=event.currentTarget.files?.[0];if(file)onFile?.(file);event.currentTarget.value=''}}/>}
  {open&&createPortal(<div ref={menu} className="import-choice-menu" role="menu"
   aria-label={label+'格式'} style={{top:position.top,left:position.left}}>
   <button type="button" role="menuitem" onClick={()=>choose('excel')}>
    <FileSpreadsheet size={17}/>Excel
   </button>
   <button type="button" role="menuitem" onClick={()=>choose('json')}>
    <FileJson size={17}/>JSON
   </button>
  </div>,document.body)}
 </span>
}
