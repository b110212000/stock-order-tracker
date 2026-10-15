import type { HistoryReview, MatchedSale, UnmatchedSale } from './gmail-history'
import type { StagedTrade } from './types'

export type BuyPosition={
  row:StagedTrade
  matchedQuantity:number
  remainingQuantity:number
  remainingCost:number
}
export type SalePosition={row:StagedTrade,match:MatchedSale}
export type StockGroup={
  symbol:string
  name:string
  buys:BuyPosition[]
  sells:SalePosition[]
  unmatched:UnmatchedSale[]
  buyQuantity:number
  matchedSellQuantity:number
  remainingQuantity:number
  remainingCost:number
  reliableGrossPnl:number
  uncertainSaleCount:number
  uncertainInventory:boolean
  latestDate:string
}
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100
const compare=(a:StagedTrade,b:StagedTrade)=>
  a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id)

/** UI projection only. Never infer real brokerage balances from incomplete email. */
export function groupTradesByStock(history:HistoryReview):StockGroup[]{
  const groups=new Map<string,StockGroup>()
  const matches=new Map(history.matchedSales.map(m=>[m.id,m]))
  const ensure=(symbol:string,name:string):StockGroup=>{
    const old=groups.get(symbol)
    if(old)return old
    const group:StockGroup={symbol,name,buys:[],sells:[],unmatched:[],
      buyQuantity:0,matchedSellQuantity:0,remainingQuantity:0,remainingCost:0,
      reliableGrossPnl:0,uncertainSaleCount:0,uncertainInventory:false,latestDate:''}
    groups.set(symbol,group)
    return group
  }
  for(const row of history.included){
    const group=ensure(row.symbol,row.name)
    if(row.date>group.latestDate)group.latestDate=row.date
    if(row.side==='buy') {
      group.buyQuantity+=row.quantity
      group.buys.push({row,matchedQuantity:0,remainingQuantity:row.quantity,remainingCost:row.gross})
    }else{
      const match=matches.get(row.id)
      if(!match)continue
      group.matchedSellQuantity+=row.quantity
      group.sells.push({row,match})
      if(match.reliable)group.reliableGrossPnl+=match.grossPnl
      else group.uncertainSaleCount++
    }
  }
  for(const missing of history.unmatched){
    const group=ensure(missing.row.symbol,missing.row.name)
    group.unmatched.push(missing)
    group.uncertainInventory=true
    if(missing.row.date>group.latestDate)group.latestDate=missing.row.date
  }
  for(const group of groups.values()){
    const consumption=new Map<string,number>()
    for(const s of group.sells){
      for(const lot of s.match.buys)consumption.set(lot.id,(consumption.get(lot.id)||0)+lot.quantity)
    }
    for(const buy of group.buys){
      const used=consumption.get(buy.row.id)||0
      buy.matchedQuantity=used
      buy.remainingQuantity=Math.max(0,buy.row.quantity-used)
      buy.remainingCost=round(buy.row.gross*buy.remainingQuantity/buy.row.quantity)
      group.remainingQuantity+=buy.remainingQuantity
      group.remainingCost+=buy.remainingCost
    }
    group.remainingCost=round(group.remainingCost)
    group.reliableGrossPnl=round(group.reliableGrossPnl)
    group.buys.sort((a,b)=>compare(a.row,b.row))
    group.sells.sort((a,b)=>compare(a.row,b.row))
    group.unmatched.sort((a,b)=>compare(a.row,b.row))
  }
  return [...groups.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol,'en',{numeric:true}))
}
