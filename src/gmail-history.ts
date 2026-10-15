import type { StagedTrade } from './types'

export type MatchedBuy = { id:string, date:string, quantity:number }
export type MatchedSale = { id:string, buys:MatchedBuy[] }
export type UnmatchedSale = { row:StagedTrade, available:number, missing:number }
export type HistoryReview = {
  included:StagedTrade[]
  unmatched:UnmatchedSale[]
  matchedSales:MatchedSale[]
  rawCount:number
  buyCount:number
  sellCount:number
}
type Lot = { id:string,date:string,remaining:number }
const compare=(a:StagedTrade,b:StagedTrade)=>a.date.localeCompare(b.date)||
  a.time.localeCompare(b.time)||a.id.localeCompare(b.id)

/** 2024+ confirmed email transactions only.
 * All buys stay visible. Exclude any sale that can't be fully covered by earlier buys.
 * This is NOT a calculation of the user's real current securities balance. */
export function organizeGmailHistory(source:StagedTrade[],since='2024-01-01'):HistoryReview {
  const rows=source.filter(x=>x.date>=since && (x.side==='buy'||x.side==='sell'))
    .sort(compare)
  const inventory=new Map<string,Lot[]>()
  const included:StagedTrade[]=[]
  const unmatched:UnmatchedSale[]=[]
  const matchedSales:MatchedSale[]=[]
  let buyCount=0,sellCount=0
  for(const row of rows) {
    if(!Number.isSafeInteger(row.quantity)||row.quantity<=0)continue
    const lots=inventory.get(row.symbol)||[]
    if(row.side==='buy'){
      buyCount++
      included.push(row)
      lots.push({id:row.id,date:row.date,remaining:row.quantity})
      inventory.set(row.symbol,lots)
      continue
    }
    sellCount++
    const available=lots.reduce((n,l)=>n+l.remaining,0)
    if(available<row.quantity){
      unmatched.push({row,available,missing:row.quantity-available})
      // Unmatched sale is excluded entirely and consumes no documented buy lots.
      // Reported remaining lots are not claimed to be current holdings.
      continue
    }
    const buys:MatchedBuy[]=[]
    let remaining=row.quantity
    while(remaining>0){
      const lot=lots[0]
      const used=Math.min(remaining,lot.remaining)
      remaining-=used
      lot.remaining-=used
      buys.push({id:lot.id,date:lot.date,quantity:used})
      if(!lot.remaining)lots.shift()
    }
    included.push(row)
    matchedSales.push({id:row.id,buys})
  }
  return {included:included.reverse(),unmatched:unmatched.reverse(),
    matchedSales,rawCount:rows.length,buyCount,sellCount}
}
