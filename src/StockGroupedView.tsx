import { useMemo, useState } from 'react'
import { ArrowDownUp, ChevronDown, ChevronUp, Search } from 'lucide-react'
import type { StockGroup } from './stock-groups'
import { sortStockGroups, STOCK_SORT_OPTIONS } from './stock-sorting'
import type { StockSortMode } from './stock-sorting'
import './StockGroupedView.css'

const n=(x:number)=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(x)
const gainClass=(v:number)=>v>0?'grouped-profit':v<0?'grouped-loss':''
function StockCard({group}:{group:StockGroup}){
  const [collapsed,setCollapsed]=useState(false)
  const [selectedSale,setSelectedSale]=useState<string|null>(null)
  const [showUnmatched,setShowUnmatched]=useState(false)
  const selected=group.sells.find(s=>s.row.id===selectedSale)
  const linkedIds=new Set(selected?.match.buys.map(b=>b.id)||[])
  const remainingWarning=group.uncertainInventory
  const hasReliableSale=group.sells.length>group.uncertainSaleCount
  const hasUncertain=group.uncertainSaleCount>0||group.unmatched.length>0
  return <article className="card grouped-stock">
    <div className="grouped-stock-head">
      <div className="grouped-title">
        <div className="grouped-stock-avatar">{group.symbol}</div>
        <div><h2>{group.name}</h2><span>{group.symbol} · 買 {group.buys.length} · 賣 {group.sells.length}</span></div>
      </div>
      <div className="grouped-head-actions">
        {collapsed&&<div className="grouped-collapsed-pnl" aria-label="已確認毛損益">
          <small>已確認毛損益{hasUncertain?' · 部分待核對':''}</small>
          {hasReliableSale?<strong className={gainClass(group.reliableGrossPnl)}>
            {group.reliableGrossPnl>0?'+':''}NT$ {n(group.reliableGrossPnl)}
          </strong>:<strong className="grouped-no-pnl">—</strong>}
        </div>}
        <button type="button" className="grouped-collapse" onClick={()=>setCollapsed(x=>!x)} aria-expanded={!collapsed}>
          {collapsed?'展開':'收合'} {collapsed?<ChevronDown size={16}/>:<ChevronUp size={16}/>}
        </button>
      </div>
    </div>
    {!collapsed&&<>
      <div className="grouped-columns">
        <section className="grouped-half grouped-buys">
          <div className="grouped-half-head"><span>買進</span><small>依成交日期</small></div>
          {group.buys.length===0&&<div className="grouped-no-trades">尚無可用買進紀錄</div>}
          {group.buys.map(b=><div key={b.row.id} className={'grouped-trade '+(linkedIds.has(b.row.id)?'grouped-linked':'')}>
            <div className="grouped-trade-meta">{b.row.date}<span>{b.row.time}</span></div>
            <div className="grouped-trade-value">買 {n(b.row.quantity)} 股</div>
            <div className="grouped-trade-sub">單價 {n(b.row.price)}</div>
            <div className="grouped-trade-cost">成本 NT$ {n(b.row.gross)}</div>
            <div className="grouped-buy-balance">已配對賣出 {n(b.matchedQuantity)} 股</div>
            <div className="grouped-buy-remaining">未賣 {n(b.remainingQuantity)} 股</div>
          </div>)}
        </section>
        <section className="grouped-half grouped-sells">
          <div className="grouped-half-head"><span>賣出</span><small>依成交日期</small></div>
          {group.sells.length===0&&<div className="grouped-no-trades">尚無可完整配對的賣出</div>}
          {group.sells.map(s=><div key={s.row.id} className={'grouped-trade '+(selectedSale===s.row.id?'grouped-selected':'')}>
            <div className="grouped-trade-meta">{s.row.date}<span>{s.row.time}</span></div>
            <div className="grouped-trade-value">賣 {n(s.row.quantity)} 股</div>
            <div className="grouped-trade-sub">單價 {n(s.row.price)}</div>
            <div className="grouped-trade-cost">成交 NT$ {n(s.row.gross)}</div>
            {s.match.reliable?
              <div className="grouped-pnl">
                <strong className={gainClass(s.match.grossPnl)}>{s.match.grossPnl>0?'+':''}NT$ {n(s.match.grossPnl)}</strong>
                <small>毛損益 · 成本 {n(s.match.cost)}</small>
              </div>:
              <div className="grouped-uncertain">成本待確認<br/>不納入損益總計</div>}
            <button type="button" className="grouped-show-match" onClick={()=>setSelectedSale(selectedSale===s.row.id?null:s.row.id)}>
              {selectedSale===s.row.id?'收起配對':'查看買進配對'}
              {selectedSale===s.row.id?<ChevronUp size={13}/>:<ChevronDown size={13}/>}
            </button>
            {selectedSale===s.row.id&&<div className="grouped-match-lines">
              {s.match.buys.map((b,i)=><div key={b.id+'-'+i}>
                <b>{b.date} · {n(b.quantity)} 股</b>
                <span>買 {n(b.unitPrice)} → 賣 {n(s.row.price)}</span>
                {s.match.reliable&&<span className={gainClass(b.grossPnl)}>{b.grossPnl>0?'+':''}NT$ {n(b.grossPnl)}</span>}
              </div>)}
              {!s.match.reliable&&<p>先前有來源不明賣出，此配對只供股數查核。</p>}
            </div>}
          </div>)}
        </section>
      </div>
      <div className="grouped-stock-bottom">
        <div><small>尚未賣出</small><strong>{n(group.remainingQuantity)} 股</strong></div>
        <div><small>剩餘成本</small><strong>NT$ {n(group.remainingCost)}</strong></div>
        <div><small>已確認毛損益</small><strong className={gainClass(group.reliableGrossPnl)}>{group.reliableGrossPnl>0?'+':''}NT$ {n(group.reliableGrossPnl)}</strong></div>
      </div>
      {remainingWarning&&<p className="grouped-warning">有 {group.unmatched.length} 筆賣出未配對，剩餘股數僅供參考。</p>}
      {group.uncertainSaleCount>0&&<p className="grouped-warning">另有 {group.uncertainSaleCount} 筆成本待確認，未計入毛損益。</p>}
      {group.unmatched.length>0&&<div className="grouped-unmatched">
        <button type="button" onClick={()=>setShowUnmatched(x=>!x)}>
          {showUnmatched?'收合':'查看'} {group.unmatched.length} 筆無法配對的賣出
          {showUnmatched?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
        </button>
        {showUnmatched&&group.unmatched.map(x=><p key={x.row.id}>
          {x.row.date}　賣 {n(x.row.quantity)} 股 · 當時可用買進 {n(x.available)} 股 · 不足 {n(x.missing)} 股（未計入）
        </p>)}
      </div>}
    </>}
  </article>
}
export default function StockGroupedView({groups}:{groups:StockGroup[]}){
  const [search,setSearch]=useState('')
  const [sortMode,setSortMode]=useState<StockSortMode>('code-asc')
  const visible=useMemo(()=>{
    const q=search.trim().toLowerCase()
    const filtered=groups.filter(g=>!q||(g.symbol+' '+g.name).toLowerCase().includes(q))
    return sortStockGroups(filtered,sortMode)
  },[groups,search,sortMode])
  return <section className="grouped-view">
    <div className="grouped-toolbar">
      <div><h2>我的股票</h2><small>{visible.length} 檔</small></div>
      <div className="grouped-filters">
        <label className="grouped-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋個股或代號" aria-label="搜尋個股或代號"/></label>
        <label className="grouped-sort"><ArrowDownUp size={16}/>
          <select value={sortMode} onChange={e=>setSortMode(e.target.value as StockSortMode)} aria-label="個股排序方式">
            {STOCK_SORT_OPTIONS.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
      </div>
    </div>
    
    {visible.map(group=><StockCard key={group.symbol} group={group}/>)}
    {visible.length===0&&<div className="card grouped-empty">沒有找到符合搜尋條件的股票。</div>}
    <details className="grouped-more-info"><summary>計算說明</summary><p>依 FIFO（先買先賣）配對。毛損益未扣費稅；尚未賣出股數來自已記錄交易，可能與券商庫存不同。</p></details>
  </section>
}
