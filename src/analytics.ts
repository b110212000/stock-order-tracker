import type { AssetSnapshot, CashFlow, Quote, Trade } from './types'
import { calculateTrades } from './trade-calc'

export function overview(trades: Trade[], quotes: Quote[], cashflows: CashFlow[]) {
  const p=calculateTrades(trades)
  const netInvested=cashflows.reduce((s,f)=>s+(f.type==='deposit'?f.amount:f.type==='withdraw'?-f.amount:0),0)
  const dividends=cashflows.filter(f=>f.type==='dividend').reduce((n,f)=>n+f.amount,0)
  const cash=netInvested+dividends-p.totalBought+p.totalSold
  const unpriced=p.holdings.filter(h=>!quotes.some(q=>q.symbol===h.symbol&&Number.isFinite(q.price)&&q.price>0))
  const marketValue=p.holdings.reduce((n,h)=>n+(quotes.find(q=>q.symbol===h.symbol)?.price||0)*h.quantity,0)
  const equity=unpriced.length?null:cash+marketValue
  const unrealized=unpriced.length?null:marketValue-p.holdings.reduce((n,h)=>n+h.cost,0)
  const profit=equity===null?null:equity-netInvested
  return {p,netInvested,dividends,cash,marketValue,equity,unrealized,profit,unpriced}
}
export function monthlyRealized(trades:Trade[]) {
  const closed=calculateTrades(trades).closed
  const months=new Map<string,{month:string,pnl:number,count:number,cost:number,avgDays:number,monthlyEquivalent:number|null}>()
  for(const t of closed){
    const m=t.date.slice(0,7)
    const v=months.get(m)||{month:m,pnl:0,count:0,cost:0,avgDays:0,monthlyEquivalent:null}
    v.pnl+=t.pnl;v.count++;v.cost+=t.cost;v.avgDays+=t.holdingDays
    months.set(m,v)
  }
  return [...months.values()].sort((a,b)=>b.month.localeCompare(a.month)).map(m=>({...m,avgDays:m.avgDays/m.count,monthlyEquivalent:m.cost>0?(m.pnl/m.cost):null}))
}
export function snapshotChange(a:AssetSnapshot,b:AssetSnapshot) {
  if(a.equity<=0||b.date<=a.date)return null
  const netAdded=b.cumulativeNetDeposits-a.cumulativeNetDeposits
  return (b.equity-a.equity-netAdded)/a.equity
}
