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

test('editing only fees keeps the imported ID and execution amount unchanged',()=>{
 const original={...tx('fee-edit','2025-01-01','buy',100,100),fee:null,tax:null}
 const edited=editedReviewTrade(original,{...draft('2025-01-01','buy',100,100),fee:'19',tax:'0'})
 assert.equal(edited.id,original.id)
 assert.equal(edited.gross,original.gross)
 assert.equal(edited.fee,19)
 assert.equal(edited.tax,0)
 assert.equal(edited.feeStatus,'manual-entered')
 const impact=assessReviewMutation([original],original.id,edited)
 assert.equal(impact.newlyUnmatched,0)
 assert.equal(impact.recalculatedSales,0)
})
test('manually reconfirmed fees can be supplied during a price edit',()=>{
 const original={...tx('broker','2025-01-01','buy',10,100),fee:20,tax:0,feeStatus:'verified'}
 const updated=editedReviewTrade(original,{...draft('2025-01-01','buy',10,101),fee:'8',tax:'0'})
 assert.equal(updated.fee,8)
 assert.equal(updated.tax,0)
 assert.equal(updated.feeStatus,'manual-entered')
})
test('editing existing imported fees to blank marks them as unknown',()=>{
 const original={...tx('reset','2025-01-01','buy',10,100),fee:12,tax:0,feeStatus:'verified'}
 const updated=editedReviewTrade(original,{...draft('2025-01-01','buy',10,100),fee:'',tax:''})
 assert.equal(updated.fee,null)
 assert.equal(updated.tax,null)
})

test('editing a periodic investment preserves its category and missing-time source',()=>{
 const recurring=buildManualTrade({...draft('2025-01-01','buy',100,80),side:'recurring',time:''},'periodic-edit',stamp)
 const edited=editedReviewTrade(recurring,{...draft('2025-01-01','buy',100,80),side:'recurring',time:'',name:'台積電'})
 assert.equal(edited.id,recurring.id)
 assert.equal(edited.side,'buy')
 assert.equal(edited.recurring,true)
 assert.equal(edited.time,'10:45:00')
 assert.equal(edited.timeDefaulted,true)
 const converted=editedReviewTrade(recurring,{...draft('2025-01-01','buy',100,80),time:'09:20'})
 assert.equal(converted.side,'buy')
 assert.equal(converted.recurring,undefined)
 assert.equal(converted.time,'09:20:00')
 assert.equal(converted.timeDefaulted,undefined)
})
test('clearing an imported exact execution time applies the fallback and flags it',()=>{
 const source={...tx('broker-timestamp','2025-01-01','buy',50,100),time:'09:07:31',fee:5,tax:0}
 const edited=editedReviewTrade(source,{...draft('2025-01-01','buy',50,100),time:'',fee:'',tax:''})
 assert.equal(edited.id,source.id)
 assert.equal(edited.time,'10:45:00')
 assert.equal(edited.timeDefaulted,true)
 assert.equal(edited.fee,null)
 assert.equal(edited.tax,null)
})

test('prefilled default time survives an unrelated edit without losing assumption marker',()=>{
 const source=buildManualTrade({...draft('2025-01-01','buy',50,100),time:'',side:'recurring'},'assumed-1045',stamp)
 assert.equal(source.time,'10:45:00')
 assert.equal(source.timeDefaulted,true)
 // The editor now shows 10:45 and submits it unless the user changes it.
 const saved=editedReviewTrade(source,{...draft('2025-01-01','buy',50,100),time:'10:45',side:'recurring',name:'更正名稱'})
 assert.equal(saved.time,'10:45:00')
 assert.equal(saved.timeDefaulted,true)
 assert.equal(saved.recurring,true)
 assert.equal(saved.id,source.id)
 const savedAgain=editedReviewTrade(saved,{...draft('2025-01-01','buy',50,100),time:'10:45',side:'recurring',name:'更正名稱'})
 assert.equal(savedAgain.timeDefaulted,true)
})
test('changing the prefilled time makes it explicit; actual 10:45 remains explicit',()=>{
 const assumed=buildManualTrade({...draft('2025-01-01','buy',10,100),time:''},'assumed',stamp)
 const corrected=editedReviewTrade(assumed,{...draft('2025-01-01','buy',10,100),time:'09:32'})
 assert.equal(corrected.time,'09:32:00')
 assert.equal(corrected.timeDefaulted,undefined)
 const actual=buildManualTrade({...draft('2025-01-01','buy',10,100),time:'10:45'},'actual',stamp)
 assert.equal(actual.timeDefaulted,undefined)
 const unchanged=editedReviewTrade(actual,{...draft('2025-01-01','buy',10,100),time:'10:45'})
 assert.equal(unchanged.timeDefaulted,undefined)
})
test('editing an earlier broker-supplied execution time never overwrites it with 10:45',()=>{
 const real={...tx('broker-actual','2025-01-01','buy',100,100),time:'09:21:34',fee:5,tax:0}
 const edited=editedReviewTrade(real,{...draft('2025-01-01','buy',100,100),time:'09:21',name:'台積電更正'})
 assert.equal(edited.time,'09:21:34')
 assert.equal(edited.timeDefaulted,undefined)
 assert.equal(edited.fee,5)
 assert.equal(edited.tax,0)
})
