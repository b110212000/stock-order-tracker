import type { Trade } from './types'

export type Lot = { date: string, quantity: number, unitCost: number }
export type Holding = { symbol: string, quantity: number, cost: number, averageCost: number }
export type Closed = { tradeId: string, symbol: string, date: string, quantity: number, proceeds: number, cost: number, pnl: number, roi: number, holdingDays: number }
export type Portfolio = { holdings: Holding[], closed: Closed[], realized: number, totalBought: number, totalSold: number }
const round = (x: number) => Math.round(x * 1000000) / 1000000
const daysBetween = (buy: string, sell: string) => Math.max(0, Math.round((Date.parse(sell + 'T00:00:00Z') - Date.parse(buy + 'T00:00:00Z')) / 86400000))
export function validateTrade(t: Trade): void {
  if(!/^[0-9A-Za-z]{2,8}$/.test(t.symbol)) throw Error('請輸入正確的股票代號')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || Number.isNaN(Date.parse(t.date))) throw Error('交易日期格式錯誤')
  if(!Number.isSafeInteger(t.quantity)||t.quantity<=0) throw Error('股數必須是正整數，零股也請填實際股數')
  if(!Number.isFinite(t.price)||t.price<=0) throw Error('成交價必須大於 0')
  if(!Number.isFinite(t.fee)||t.fee<0||!Number.isFinite(t.tax)||t.tax<0) throw Error('手續費及稅金不得為負數')
  if(t.side!=='buy'&&t.side!=='sell') throw Error('交易類型錯誤')
  if(t.side==='sell' && (t.fee+t.tax)>=t.quantity*t.price) throw Error('賣出費用不能高於或等於成交金額')
}
export function calculateTrades(source: Trade[]): Portfolio {
  const holdings = new Map<string,Lot[]>()
  const closed: Closed[]=[]
  let realized=0,totalBought=0,totalSold=0
  const trades=[...source].sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))
  for(const trade of trades){
    validateTrade(trade)
    const lots=holdings.get(trade.symbol)||[]
    const gross=trade.quantity*trade.price
    if(trade.side==='buy'){
      const total=gross+trade.fee+trade.tax
      totalBought+=total
      lots.push({date:trade.date,quantity:trade.quantity,unitCost:total/trade.quantity})
      holdings.set(trade.symbol,lots)
      continue
    }
    const available=lots.reduce((n,l)=>n+l.quantity,0)
    if(available<trade.quantity)throw Error(trade.date+' '+trade.symbol+' 賣出 '+trade.quantity+' 股，但可用庫存只有 '+available+' 股。請先修正買賣紀錄。')
    const net=gross-trade.fee-trade.tax
    let remain=trade.quantity, cost=0, weightedDays=0
    while(remain>0){
      const lot=lots[0]
      const matched=Math.min(remain,lot.quantity)
      cost+=matched*lot.unitCost
      weightedDays+=matched*daysBetween(lot.date,trade.date)
      lot.quantity-=matched
      remain-=matched
      if(lot.quantity===0)lots.shift()
    }
    const pnl=net-cost
    realized+=pnl;totalSold+=net
    closed.push({tradeId:trade.id,symbol:trade.symbol,date:trade.date,quantity:trade.quantity,proceeds:round(net),cost:round(cost),pnl:round(pnl),roi:cost>0?pnl/cost:0,holdingDays:weightedDays/trade.quantity})
    holdings.set(trade.symbol,lots)
  }
  const result:Holding[]=[]
  for(const [symbol,lots] of holdings){
    const quantity=lots.reduce((n,l)=>n+l.quantity,0)
    if(!quantity)continue
    const cost=lots.reduce((n,l)=>n+l.quantity*l.unitCost,0)
    result.push({symbol,quantity,cost:round(cost),averageCost:round(cost/quantity)})
  }
  result.sort((a,b)=>a.symbol.localeCompare(b.symbol))
  return {holdings:result,closed,realized:round(realized),totalBought:round(totalBought),totalSold:round(totalSold)}
}
export const dollars = (n:number)=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(n)
