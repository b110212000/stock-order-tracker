import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, ArrowLeftRight, ArrowRight, Bell, ChartColumn, ChevronRight, CircleHelp, ClipboardList, CloudOff, House, Layers, Moon, Plus, Search, Settings, ShieldCheck, Sun, Wallet, X } from 'lucide-react'
import { RELEASES } from './data'
import WatchlistPage from './WatchlistPage'
import type { Page, Theme } from './data'
import { updateSW } from './pwa'

const NAV = [
  { key: 'dashboard' as Page, name: '總覽', Icon: House },
  { key: 'watchlist' as Page, name: '追蹤', Icon: Search },
  { key: 'trades' as Page, name: '交易', Icon: ArrowLeftRight },
  { key: 'performance' as Page, name: '績效', Icon: ChartColumn }
]
function Stat({title,value,detail,icon}: {title:string,value:string,detail:string,icon:ReactNode}) {
  return <div className="card stat"><div className="stat-caption"><span>{title}</span>{icon}</div><strong>{value}</strong><small>{detail}</small></div>
}
function Empty({icon,title,text,action}: {icon:ReactNode,title:string,text:string,action:()=>void}) {
  return <div className="card empty"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p><button className="primary" onClick={action}>查看開發規劃 <ArrowRight size={17}/></button></div>
}
export default function App() {
  const [page,setPage] = useState<Page>('dashboard')
  const [settings,setSettings] = useState(false)
  const [dialog,setDialog] = useState<string | null>(null)
  const [refresh,setRefresh] = useState(false)
  const [theme,setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('orderlead-theme')
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  })
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const change = () => document.documentElement.dataset.theme = theme === 'system' ? (media.matches?'dark':'light') : theme
    change()
    media.addEventListener('change',change)
    localStorage.setItem('orderlead-theme',theme)
    return () => media.removeEventListener('change',change)
  },[theme])
  useEffect(() => {
    const ready = () => setRefresh(true)
    window.addEventListener('orderlead-update-ready',ready)
    return () => window.removeEventListener('orderlead-update-ready',ready)
  },[])
  const pageTitle = {dashboard:'投資總覽',watchlist:'股票追蹤',trades:'交易紀錄',performance:'績效分析'}[page]
  return <div className="app">
    <header className="header">
      <div className="brand"><span className="brand-symbol"><Activity size={21}/></span><span><b>OrderLead</b><small>台股訂單領先追蹤</small></span></div>
      <button className="icon-button" title="設定" aria-label="開啟設定" onClick={()=>setSettings(true)}><Settings size={21}/></button>
    </header>
    <nav className="side-nav" aria-label="主要導覽">{NAV.map(x=><button key={x.key} className={page===x.key?'nav active':'nav'} onClick={()=>setPage(x.key)} aria-current={page===x.key?'page':undefined}><x.Icon size={20}/>{x.name}</button>)}<div className="side-note"><CloudOff size={15}/> 前端試用版</div></nav>
    <main key={page} className="main"><div className="content">
      <div className="intro"><span className="eyebrow">PERSONAL INVESTMENT · v1.1.0</span><h1>{pageTitle}</h1><p>{page==='dashboard'?'從訂單領先開始，建立有紀律的投資管理流程。':page==='watchlist'?'觀察清單已載入，價格及評級尚未串接即時資料。':page==='trades'?'把每一筆買入、賣出與資金成本完整記錄。':'不只看賺多少，也要知道資金使用效率。'}</p></div>
      {page==='dashboard' && <>
        <div className="notice"><CloudOff size={18}/> 本版不提供即時行情；資產數值先顯示空白，不使用模擬收益冒充真實績效。</div>
        <div className="stat-grid"><Stat title="總資產" value="NT$ —" detail="v1.4.0 啟用" icon={<Wallet size={19}/>} /><Stat title="已實現損益" value="NT$ —" detail="尚無交易" icon={<ChartColumn size={19}/>} /><Stat title="持有股票" value="— 檔" detail="v1.3.0 啟用" icon={<Layers size={19}/>} /><Stat title="當月報酬" value="— %" detail="扣除交易費用後計算" icon={<Activity size={19}/>} /></div>
        <div className="section"><h2>快速開始</h2><small>開發中功能已標示版本</small></div>
        <div className="quick-grid"><button className="card quick" onClick={()=>setPage('watchlist')}><span className="quick-icon"><Search size={21}/></span><span><b>查看股票清單</b><small>預載 8 檔關注股票</small></span><ChevronRight size={18}/></button><button className="card quick" onClick={()=>setPage('trades')}><span className="quick-icon purple"><ArrowLeftRight size={21}/></span><span><b>我的交易</b><small>v1.3.0 開放紀錄</small></span><ChevronRight size={18}/></button></div>
        <div className="section"><h2>訂單領先策略</h2></div>
        <div className="card feature"><ShieldCheck size={27}/><div><b>先確認訂單，再判斷買點</b><p>未來將依需求、拉貨、Design-in、量產、產能，再用法人和量價確認。歷史評級不會冒充今天的分析結果。</p></div><span>v1.2.0</span></div>
      </>}
      {page==='watchlist' && <WatchlistPage/>}
      {page==='trades' && <>
        <div className="summary"><div className="card"><small>持有股票</small><strong>—</strong></div><div className="card"><small>已完成交易</small><strong>—</strong></div></div>
        <Empty icon={<ClipboardList size={29}/>} title="交易功能尚未啟用" text="v1.3.0 將支援零股、分批交易、持股成本、手續費及本機儲存；目前不會保存任何交易資料。" action={()=>setDialog('交易紀錄 · v1.3.0')}/>
      </>}
      {page==='performance' && <>
        <div className="stat-grid"><Stat title="累積報酬" value="— %" detail="扣除交易成本" icon={<ChartColumn size={19}/>} /><Stat title="30天等效報酬" value="— %" detail="非未來獲利預測" icon={<Activity size={19}/>} /><Stat title="交易勝率" value="— %" detail="已平倉交易" icon={<Layers size={19}/>} /><Stat title="平均持有天數" value="— 天" detail="以實際成交日計算" icon={<Wallet size={19}/>} /></div>
        <Empty icon={<ChartColumn size={29}/>} title="尚無績效資料" text="v1.4.0 將提供損益、持有時間、月化報酬、資產走勢與資金流向統計。" action={()=>setDialog('績效分析 · v1.4.0')}/>
      </>}
      <footer className="footer">OrderLead · v1.1.0 · 非投資建議 · 尚無即時行情</footer>
    </div></main>
    <nav className="bottom-nav" aria-label="底部分頁">{NAV.map(x=><button key={x.key} className={page===x.key?'nav active':'nav'} onClick={()=>setPage(x.key)} aria-current={page===x.key?'page':undefined}><x.Icon size={21}/><span>{x.name}</span></button>)}</nav>
    {refresh && <div className="update" role="status">有新版本可更新 <button onClick={()=>updateSW(true)}>立即更新</button><button aria-label="關閉" onClick={()=>setRefresh(false)}><X size={17}/></button></div>}
    {settings && <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false)}}><aside className="panel" role="dialog" aria-modal="true" aria-label="設定"><div className="panel-head"><div><span className="eyebrow">PREFERENCES</span><h2>設定</h2></div><button className="icon-button" aria-label="關閉設定" onClick={()=>setSettings(false)}><X/></button></div><div className="panel-body"><h3>外觀</h3><p>可跟隨裝置，也可以手動指定。</p><div className="themes">{([['system','跟隨裝置'],['light','淺色'],['dark','深色']] as const).map(([v,label])=><button key={v} onClick={()=>setTheme(v)} className={theme===v?'selected':''}>{v==='light'?<Sun size={17}/>:v==='dark'?<Moon size={17}/>:<Settings size={17}/>}<span>{label}</span></button>)}</div><div className="setting-line"><span>目前版本</span><b>v1.1.0</b></div><div className="setting-line"><span>資料來源</span><b>前端示範</b></div><h3>版本路線圖</h3>{RELEASES.map(([v,name])=><div className="release" key={v}><b>{v}</b><span>{name}</span></div>)}<p className="fineprint">GitHub Pages 是公開網頁。請勿將交易私密資料或 API 金鑰提交到 Repository。</p></div></aside></div>}
    {dialog && <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}><section className="dialog" role="dialog" aria-modal="true" aria-label="功能資訊"><button className="close" aria-label="關閉" onClick={()=>setDialog(null)}><X size={20}/></button><div className="empty-icon"><ShieldCheck size={27}/></div><h2>{dialog}</h2><p>目前是 v1.1.0 前端基礎版本。為避免不準確資料，本功能將依版本 Issue 逐步開放。</p><button className="primary" onClick={()=>{setDialog(null);setSettings(true)}}>查看版本規劃 <ArrowRight size={16}/></button></section></div>}
  </div>
}
