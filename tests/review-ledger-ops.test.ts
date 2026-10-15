import test from 'node:test'
import assert from 'node:assert/strict'
import { editedReviewTrade,assessReviewMutation,mutationPrompt } from '../src/review-ledger-ops'
import { buildManualTrade } from '../src/manual-review-trades'
import { organizeGmailHistory } from '../src/gmail-history'
const stamp='2026-10-15T08:00:00Z'
function tx(id:string,date:string,side:'buy'|'sell',quantity:number,price:number){
 return buildManualTrade({date,time:'09:00',symbol:'2330',name:'台積電',side,quantity:String(quantity),price:String(price)},id,stamp)
}
const draft=(date:string,side:'buy'|'sell',qty:number,price:number)=>({
 date,time:'09:00',symbol:'2330',name:'台積電',side,quantity:String(qty),price:String(price)
})
test('edit buy price keeps its id but changes the downstream FIFO P&L',()=>{
 const b=tx('b','2025-01-01','buy',100,900)
 const s=tx('s','2025-02-01','sell',30,1000)
 const updated=editedReviewTrade(b,draft('2025-01-01','buy',100,950))
 assert.equal(updated.id,b.id)
 assert.equal(updated.createdAt,b.createdAt)
 assert.equal(updated.gross,95000)
 assert.equal(organizeGmailHistory([updated,s]).reliableGrossPnl,1500)
 const impact=assessReviewMutation([b,s],b.id,updated)
 assert.equal(impact.recalculatedSales,1)
 assert.equal(impact.newlyUnmatched,0)
})
test('reducing a buy below later sell quantity flags newly unmatched sales',()=>{
 const b=tx('b','2025-01-01','buy',100,900)
 const s=tx('s','2025-02-01','sell',80,1000)
 const updated=editedReviewTrade(b,draft('2025-01-01','buy',50,900))
 const impact=assessReviewMutation([b,s],b.id,updated)
 assert.equal(impact.newlyUnmatched,1)
 assert.equal(impact.shortageShares,30)
 assert.match(mutationPrompt(b,'edit',impact),/不足 30 股/)
})
test('deleting the buy warns and removes recognized P&L, not unrelated trade records',()=>{
 const b=tx('b','2025-01-01','buy',100,900)
 const s=tx('s','2025-02-01','sell',30,1000)
 const impact=assessReviewMutation([b,s],b.id,null)
 assert.equal(impact.newlyUnmatched,1)
 assert.equal(impact.shortageShares,30)
 assert.match(mutationPrompt(b,'delete',impact),/刪除後無法/)
})
test('deleting a sale restores the known unsold buy count',()=>{
 const b=tx('b','2025-01-01','buy',100,900)
 const s=tx('s','2025-02-01','sell',30,1000)
 assert.equal(assessReviewMutation([b,s],s.id,null).newlyUnmatched,0)
 const after=organizeGmailHistory([b])
 assert.equal(after.included.length,1)
 assert.equal(after.reliableGrossPnl,0)
})
test('edit unsupported source sale can correct date and quantity without changing ID',()=>{
 const sale=tx('s','2024-05-01','sell',40,100)
 const revised=editedReviewTrade(sale,draft('2024-03-01','sell',30,120))
 assert.equal(revised.id,sale.id)
 assert.equal(revised.gross,3600)
 assert.equal(assessReviewMutation([sale],sale.id,revised).newlyUnmatched,0)
})
test('editing imported trade price clears source actual fee and tax',()=>{
 const b={...tx('b','2025-01-01','buy',10,100),fee:12,tax:4,feeStatus:'verified'}
 const revised=editedReviewTrade(b,draft('2025-01-01','buy',10,110))
 assert.equal(revised.fee,null)
 assert.equal(revised.tax,null)
 assert.equal(revised.feeStatus,'manual-edited-unverified')
 assert.equal(revised.id,b.id)
})
test('editing name only retains fee status, while invalid input is rejected',()=>{
 const b={...tx('b','2025-01-01','buy',10,100),fee:5,tax:0,feeStatus:'verified'}
 const renamed=editedReviewTrade(b,{...draft('2025-01-01','buy',10,100),name:'台積電新名'})
 assert.equal(renamed.fee,5)
 assert.equal(renamed.tax,0)
 assert.throws(()=>editedReviewTrade(b,{...draft('2025-01-01','buy',0,100)}),/股數/)
})

test('editing an imported row preserves execution seconds and broker gross when unchanged',()=>{
 const source={...tx('b','2025-01-01','buy',3,100.01),time:'09:05:47',gross:300,fee:5,tax:0}
 const draftValue={...draft('2025-01-01','buy',3,100.01),time:'09:05',name:'台積電'}
 const edited=editedReviewTrade(source,draftValue)
 assert.equal(edited.time,'09:05:47')
 assert.equal(edited.gross,300)
 assert.equal(edited.fee,5)
 assert.equal(edited.tax,0)
})

test('changing a buy into an unsupported sell requires a shortage warning',()=>{
 const buy=tx('first','2025-01-01','buy',10,100)
 const changed=editedReviewTrade(buy,draft('2025-01-01','sell',10,100))
 const impact=assessReviewMutation([buy],buy.id,changed)
 assert.equal(impact.newlyUnmatched,1)
 assert.equal(impact.shortageShares,10)
 assert.match(mutationPrompt(buy,'edit',impact),/無法配對/)
})
