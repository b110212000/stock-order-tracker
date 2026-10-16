import type { StagedTrade } from './types'

export type MatchedBuy = {
  id:string
  date:string
  quantity:number
  unitPrice:number
  cost:number
  proceeds:number
  grossPnl:number
}
export type MatchedSale = {
  id:string
  buys:MatchedBuy[]
  proceeds:number
  cost:number
  grossPnl:number
  netPnl:number|null
  grossRoi:number|null
  reliable:boolean
  reason?:string
}
export type UnmatchedSale = { row:StagedTrade, available:number, missing:number }
export type HistoryReview = {
  included:StagedTrade[]
  unmatched:UnmatchedSale[]
  matchedSales:MatchedSale[]
  rawCount:number
  buyCount:number
  sellCount:number
  reliableGrossPnl:number
  reliableSaleCount:number
  uncertainSaleCount:number
}
type Lot = { id:string,date:string,remaining:number,unitCost:number,unitPrice:number,unitFees:number|null }
const compare=(a:StagedTrade,b:StagedTrade)=>a.date.localeCompare(b.date)||
  a.time.localeCompare(b.time)||a.id.localeCompare(b.id)
const rounded=(value:number)=>Math.round((value+Number.EPSILON)*100)/100
const verified=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0

/** Only documented transactions (manual or imported), not a brokerage holdings or tax ledger.
 * All buys stay visible. Unmatched sales are excluded entirely without consuming buy lots.
 * Once a symbol has an unknown-origin sale, later provisional FIFO matches remain visible,
 * but their calculated P&L must NOT be reported as reliable or included in totals. */
export function organizeGmailHistory(source:StagedTrade[]):HistoryReview {
  const rows=source.filter(x=>x.side==='buy'||x.side==='sell')
    .sort(compare)
  const inventory=new Map<string,Lot[]>()
  const tainted=new Set<string>()
  const included:StagedTrade[]=[]
  const unmatched:UnmatchedSale[]=[]
  const matchedSales:MatchedSale[]=[]
  let buyCount=0,sellCount=0,reliableGrossPnl=0,reliableSaleCount=0,uncertainSaleCount=0

  for(const row of rows) {
    if(!Number.isSafeInteger(row.quantity)||row.quantity<=0||
       !Number.isFinite(row.gross)||row.gross<=0)continue
    const lots=inventory.get(row.symbol)||[]
    if(row.side==='buy'){
      buyCount++
      included.push(row)
      lots.push({id:row.id,date:row.date,remaining:row.quantity,
        unitCost:row.gross/row.quantity,unitPrice:row.price,
        unitFees:verified(row.fee)&&verified(row.tax)?(row.fee+row.tax)/row.quantity:null})
      inventory.set(row.symbol,lots)
      continue
    }
    sellCount++
    const available=lots.reduce((n,l)=>n+l.remaining,0)
    if(available<row.quantity){
      unmatched.push({row,available,missing:row.quantity-available})
      tainted.add(row.symbol)
      // Unmatched sale is excluded and does not consume documented buys.
      // Therefore subsequent matches of this symbol cannot claim reliable P&L.
      continue
    }
    const buys:MatchedBuy[]=[]
    let remaining=row.quantity,cost=0,buyFees=0,knownBuyFees=true
    while(remaining>0){
      const lot=lots[0]
      const used=Math.min(remaining,lot.remaining)
      const allocatedCost=used*lot.unitCost
      const allocatedProceeds=used*row.gross/row.quantity
      cost+=allocatedCost
      if(lot.unitFees===null)knownBuyFees=false
      else buyFees+=used*lot.unitFees
      remaining-=used
      lot.remaining-=used
      buys.push({
        id:lot.id,date:lot.date,quantity:used,unitPrice:lot.unitPrice,
        cost:rounded(allocatedCost),proceeds:rounded(allocatedProceeds),
        grossPnl:rounded(allocatedProceeds-allocatedCost)
      })
      if(!lot.remaining)lots.shift()
    }
    const proceeds=rounded(row.gross)
    cost=rounded(cost)
    const grossPnl=rounded(proceeds-cost)
    const reliable=!tainted.has(row.symbol)
    // Show a net figure only when every matched buy lot and the sale
    // have explicit fee + tax values. Unknown never means zero.
    const netPnl=reliable&&knownBuyFees&&verified(row.fee)&&verified(row.tax)?
      rounded(grossPnl-buyFees-row.fee-row.tax):null
    const sale:MatchedSale={
      id:row.id,buys,proceeds,cost,grossPnl,netPnl,
      grossRoi:cost>0?grossPnl/cost:null,reliable,
      reason:reliable?undefined:'該股票先前有無法配對的賣出，可能已使用這些買進股數；本筆成本待確認。'
    }
    included.push(row)
    matchedSales.push(sale)
    if(reliable){reliableGrossPnl+=grossPnl;reliableSaleCount++}
    else uncertainSaleCount++
  }
  return {
    included:included.reverse(),unmatched:unmatched.reverse(),
    matchedSales,rawCount:rows.length,buyCount,sellCount,
    reliableGrossPnl:rounded(reliableGrossPnl),reliableSaleCount,uncertainSaleCount
  }
}
