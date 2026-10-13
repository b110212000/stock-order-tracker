import { useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronRight, CircleHelp, CloudOff, Download, ExternalLink } from 'lucide-react'
import { GUIDE_STEPS } from './guide-content'
import type { Page } from './data'
import './GuidePage.css'

type Props = { onNavigate:(page:Page)=>void, onOpenSettings:()=>void }
const STORAGE_KEY = 'orderlead-guide-step'

function initialStep() {
  try {
    const previous = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isInteger(previous) && previous>=0 && previous<GUIDE_STEPS.length ? previous : 0
  } catch { return 0 }
}

export default function GuidePage({onNavigate,onOpenSettings}:Props) {
  const [index,setIndex]=useState(initialStep)
  const step=GUIDE_STEPS[index]
  const total=GUIDE_STEPS.length

  function selectStep(next:number) {
    if(next<0||next>=total)return
    setIndex(next)
    try { localStorage.setItem(STORAGE_KEY,String(next)) } catch { /* private mode may block storage */ }
    document.querySelector('.main')?.scrollTo({top:0,behavior:'smooth'})
  }

  function visitFeature() {
    if(step.openSettings)onOpenSettings()
    else if(step.target)onNavigate(step.target)
  }

  return <div className="guide-page">
    <div className="guide-top card">
      <span className="guide-kicker"><BookOpen size={17}/> 新手操作指南</span>
      <h2>一步一步學會 OrderLead</h2>
      <p>依照實際使用流程，從建立資金、記錄股票，到績效分析與備份。每個步驟都能直接跳到對應功能。</p>
      <div className="guide-progress-caption">
        <span>目前第 {index+1} 步，共 {total} 步</span><strong>{Math.round((index+1)/total*100)}%</strong>
      </div>
      <div className="guide-progress" role="progressbar" aria-label="教學進度" aria-valuenow={index+1} aria-valuemin={1} aria-valuemax={total}><span style={{width:`${((index+1)/total)*100}%`}}/></div>
    </div>

    <div className="guide-step-selector" aria-label="選擇教學章節">
      {GUIDE_STEPS.map((s,i)=><button key={s.id} type="button" className={i===index?'guide-pill active':'guide-pill'} onClick={()=>selectStep(i)} aria-current={i===index?'step':undefined}>
        <span>{i+1}</span>{s.category}
      </button>)}
    </div>

    <section className="card guide-lesson" aria-labelledby="guide-step-title" key={step.id}>
      <div className="guide-lesson-meta"><span>STEP {String(index+1).padStart(2,'0')}</span><span>{step.category}</span></div>
      <h2 id="guide-step-title">{step.title}</h2>
      <p className="guide-lesson-subtitle">{step.subtitle}</p>
      <ol className="guide-list">{step.instructions.map((instruction,i)=><li key={i}><span className="guide-number">{i+1}</span><p>{instruction}</p></li>)}</ol>
      <div className="guide-note"><CircleHelp size={18}/><p>{step.tip}</p></div>
      {step.actionLabel&&<button className="guide-go" onClick={visitFeature}>
        {step.openSettings?<Download size={18}/>:<ExternalLink size={18}/>}
        <span>{step.actionLabel}</span><ChevronRight size={18}/>
      </button>}
      <div className="guide-controls">
        <button className="guide-prev" onClick={()=>selectStep(index-1)} disabled={index===0}><ArrowLeft size={16}/> 上一步</button>
        {index===total-1
          ?<button className="primary" onClick={()=>selectStep(0)}><CheckCircle2 size={17}/> 重新閱讀</button>
          :<button className="primary" onClick={()=>selectStep(index+1)}>下一步 <ArrowRight size={17}/></button>}
      </div>
    </section>

    <div className="guide-faq">
      <h2>常見問題</h2>
      <details><summary>股價會自動更新嗎？</summary><p>目前不會。這一版沒有串股票報價 API，請在「績效」自行輸入股票參考價與日期。之後才會規劃後端行情服務。</p></details>
      <details><summary>已設定價格提醒，關閉 App 還會通知嗎？</summary><p>不會。目前提醒只有在 App 內使用「檢查目前價格」時才判斷，必須事先輸入今天的手動報價。背景監控和推播屬於後續後端版本。</p></details>
      <details><summary>為什麼有獲利，帳戶資產卻看起來不對？</summary><p>請先確認是否已登記初始入金、每筆交易費用與所有持股的手動估價。已實現損益、未實現損益和整體帳戶現金並不是同一個數字。</p></details>
      <details><summary>資料會同步到其他 iPhone 或電腦嗎？</summary><p>不會。資料目前保存在當前 App／瀏覽器的 IndexedDB。請使用「設定 → 匯出 JSON」備份；在另一個環境還原時會覆蓋其原有資料。</p></details>
    </div>
    <div className="guide-footer-warning"><CloudOff size={17}/> v1.6.0 仍是純前端：沒有 GPT 自動分析、即時行情、雲端同步或背景推播。</div>
  </div>
}
