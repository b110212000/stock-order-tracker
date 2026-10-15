import type { StagedTrade } from './types'
import type { ManualTradeInput } from './manual-review-trades'
import { buildManualTrade } from './manual-review-trades'
import { organizeGmailHistory } from './gmail-history'

/** Reuse exactly the same validation as a newly entered transaction.
 * Keep the original source ID so imports remain idempotent; never silently
 * carry the source broker's fee/tax into a changed quantity or price. */
export function editedReviewTrade(original:StagedTrade,input:ManualTradeInput):StagedTrade{
  const draft=buildManualTrade(input,'edit',original.createdAt)
  // The time picker has minute precision; preserve broker-provided seconds
  // when the visible HH:mm value was not changed.
  const time=original.time.slice(0,5)===input.time?original.time:draft.time
  // Preserve exact broker gross if only display metadata changed.
  const gross=original.price===draft.price&&original.quantity===draft.quantity?
    original.gross:draft.gross
  const changedMoney=original.price!==draft.price||
    original.quantity!==draft.quantity||original.side!==draft.side||
    original.date!==draft.date||original.symbol!==draft.symbol||
    original.time!==time
  return {
    ...original,date:draft.date,time,symbol:draft.symbol,
    name:draft.name,side:draft.side,quantity:draft.quantity,price:draft.price,
    gross,
    fee:changedMoney?null:original.fee,
    tax:changedMoney?null:original.tax,
    feeStatus:changedMoney?'manual-edited-unverified':original.feeStatus
  }
}

export type ReviewImpact={
  newlyUnmatched:number
  shortageShares:number
  recalculatedSales:number
}
/** Explicitly detect whether a user edit/delete changes downstream FIFO facts. */
export function assessReviewMutation(
  before:StagedTrade[],targetId:string,next:StagedTrade|null
):ReviewImpact{
  if(!before.some(x=>x.id===targetId))throw Error('找不到要修改的交易，請重新整理')
  if(next&&next.id!==targetId)throw Error('編輯時不可更改來源識別碼')
  const old=organizeGmailHistory(before)
  const updated=before.filter(x=>x.id!==targetId)
  if(next)updated.push(next)
  const after=organizeGmailHistory(updated)
  const oldMatched=new Map(old.matchedSales.map(x=>[x.id,x]))
  const afterMatched=new Map(after.matchedSales.map(x=>[x.id,x]))
  const converted=after.unmatched.filter(x=>oldMatched.has(x.row.id))
  const recalculatedSales=[...oldMatched.entries()].filter(([id,prior])=>{
    if(id===targetId&&!next)return false
    const current=afterMatched.get(id)
    if(!current)return false
    return current.grossPnl!==prior.grossPnl||
      current.reliable!==prior.reliable||
      JSON.stringify(current.buys.map(l=>[l.id,l.quantity,l.cost]))!==
      JSON.stringify(prior.buys.map(l=>[l.id,l.quantity,l.cost]))
  }).length
  return {
    newlyUnmatched:converted.length,
    shortageShares:converted.reduce((total,x)=>total+x.missing,0),
    recalculatedSales
  }
}

export function mutationPrompt(row:StagedTrade,action:'delete'|'edit',impact:ReviewImpact):string{
  const heading=(action==='delete'?'刪除':'修改')+' '+row.name+' '+(row.side==='buy'?'買進':'賣出')+' '+row.quantity+' 股？'
  const effects=[
    impact.newlyUnmatched>0?
      '注意：會有 '+impact.newlyUnmatched+' 筆原本可配對的賣出變成缺少買進來源（不足 '+impact.shortageShares+' 股），相關毛損益將不再認列。':'',
    impact.recalculatedSales>0?'會重新計算 '+impact.recalculatedSales+' 筆賣出的 FIFO 配對／毛損益。':''
  ].filter(Boolean)
  return heading+(effects.length?'\n\n'+effects.join('\n'):'')+
    (action==='delete'?'\n\n刪除後無法在 App 中復原。':'')
}
