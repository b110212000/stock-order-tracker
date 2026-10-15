import type { StagedTrade, Trade } from './types'
import { calculateTrades } from './trade-calc'

export type BulkFeeOptions={
  mode:'verified'|'estimate'
  commissionPercent:number
  minimumFee:number
  stockTaxPercent:number
  fundTaxPercent:number
}
export const DEFAULT_BULK_FEES:BulkFeeOptions={
  mode:'verified',commissionPercent:0.1425,minimumFee:0,
  stockTaxPercent:0.3,fundTaxPercent:0.1
}
export type BlockedSymbol={symbol:string,count:number,reason:string}
export type BulkPlan={
  trades:Trade[]
  updates:StagedTrade[]
  blocked:BlockedSymbol[]
  alreadyImported:number
  sourceDuplicates:number
  estimatedCount:number
  pendingCount:number
}
const fingerprint=(t:Pick<Trade,'date'|'symbol'|'side'|'quantity'|'price'>)=>
  [t.date,t.symbol,t.side,t.quantity,Number(t.price).toFixed(5)].join('|')

function validateRates(f:BulkFeeOptions){
  for(const [name,value] of [
    ['手續費率',f.commissionPercent],['最低手續費',f.minimumFee],
    ['股票賣出稅率',f.stockTaxPercent],['ETF 賣出稅率',f.fundTaxPercent]
  ] as const){
    if(!Number.isFinite(value)||value<0||value> (name==='最低手續費'?100000:10)){
      throw new Error(name+'必須是合法的非負數')
    }
  }
}
function feeFor(row:StagedTrade,f:BulkFeeOptions) {
  if(row.fee!==null&&row.tax!==null) {
    return {fee:row.fee,tax:row.tax,estimated:false}
  }
  if(f.mode!=='estimate')return null
  // ETNs, special securities and corporate actions may have different taxation.
  // Do not silently classify these as ordinary stocks or ETFs.
  if(/^02\d{4}$/.test(row.symbol))return null
  const fund=/^00\d{2,4}[A-Z]?$/.test(row.symbol)
  const commission=Math.max(f.minimumFee,Math.round(row.gross*f.commissionPercent/100))
  const tax=row.side==='buy'?0:Math.round(row.gross*(fund?f.fundTaxPercent:f.stockTaxPercent)/100)
  const fees={fee:row.fee??commission,tax:row.tax??tax,estimated:true}
  if(row.side==='sell'&&fees.fee+fees.tax>=row.gross)return null
  return fees
}
function toTrade(row:StagedTrade,fees:NonNullable<ReturnType<typeof feeFor>>):Trade{
  return {
    id:'gmail:'+row.id,symbol:row.symbol,side:row.side,
    date:row.date,quantity:row.quantity,price:row.price,
    fee:fees.fee,tax:fees.tax,createdAt:row.createdAt,
    note:'富邦成交回報；委託 '+row.orderId+'；'+row.name+'；'+
      (fees.estimated?'【費用估算，非實際交割費用】':'【費用已手動核對】')
  }
}
export function planBulkApprovals(staged:StagedTrade[],existing:Trade[],fees:BulkFeeOptions):BulkPlan{
  validateRates(fees)
  // A pre-existing invalid ledger must be repaired before modifying any records.
  calculateTrades(existing)
  const pending=staged.filter(x=>x.status==='pending')
  const approvedIdSet=new Set(existing.map(x=>x.id))
  const manualSignatures=new Set(existing.filter(x=>!x.id.startsWith('gmail:')).map(fingerprint))
  const grouped=new Map<string,StagedTrade[]>()
  let alreadyImported=0,sourceDuplicates=0
  for(const row of pending){
    if(approvedIdSet.has('gmail:'+row.id)){alreadyImported++;continue}
    const current=grouped.get(row.symbol)||[]
    current.push(row);grouped.set(row.symbol,current)
  }
  const accepted:Trade[]=[],updates:StagedTrade[]=[],blocked:BlockedSymbol[]=[]
  let estimatedCount=0
  for(const [symbol,rows] of grouped){
    const skip=(reason:string)=>blocked.push({symbol,count:rows.length,reason})
    if(rows.some(row=>manualSignatures.has(fingerprint(row)))) {
      skip('與手動交易日期、股數及成交價格相同，無法排除重複匯入')
      continue
    }
    const candidates:{row:StagedTrade,trade:Trade,est:boolean}[]=[]
    let reason=''
    for(const row of rows){
      const x=feeFor(row,fees)
      if(!x){
        reason=fees.mode==='verified'
          ?'含尚未核對的手續費或證交稅'
          :'含特殊證券稅率不明或無效估算費用'
        break
      }
      candidates.push({row,trade:toTrade(row,x),est:x.estimated})
    }
    if(reason){skip(reason);continue}
    const proposed=candidates.map(c=>c.trade)
    try {
      calculateTrades([...existing,...accepted,...proposed])
    }catch(e){
      skip('FIFO 庫存驗證未通過：'+(e instanceof Error?e.message:String(e)))
      continue
    }
    for(const c of candidates) {
      accepted.push(c.trade)
      updates.push({...c.row,fee:c.trade.fee,tax:c.trade.tax,
        feeStatus:c.est?'estimated':'verified',status:'approved'})
      if(c.est)estimatedCount++
    }
  }
  return {trades:accepted,updates,blocked,alreadyImported,sourceDuplicates,
    estimatedCount,pendingCount:pending.length}
}
