import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManualTrade,assertManualSaleCovered } from '../src/manual-review-trades'
import { organizeGmailHistory } from '../src/gmail-history'
const base={date:'2023-02-01',time:'09:01',symbol:'2330',name:'台積電',side:'buy' as const,quantity:'15',price:'552.5'}
const stamp='2026-10-15T01:00:00.000Z'
test('new users can create the first buy without email imports and any year works',()=>{
 const buy=buildManualTrade(base,'1',stamp)
 const history=organizeGmailHistory([buy])
 assert.equal(buy.quantity,15);assert.equal(buy.gross,8287.5)
 assert.equal(history.included.length,1)
 assert.equal(history.buyCount,1)
 assert.equal(history.matchedSales.length,0)
})
test('manual sell from an older buy is paired by FIFO',()=>{
 const b=buildManualTrade(base,'2',stamp)
 const s=buildManualTrade({...base,side:'sell',date:'2025-03-01',quantity:'5',price:'900'},'3',stamp)
 assert.doesNotThrow(()=>assertManualSaleCovered([b],s))
 const history=organizeGmailHistory([s,b])
 assert.equal(history.matchedSales.length,1)
 assert.equal(history.matchedSales[0].grossPnl,1737.5)
})
test('manual sell with no earlier buy rejected, including future buy',()=>{
 const s=buildManualTrade({...base,side:'sell',date:'2020-01-01',quantity:'5'},'4',stamp)
 assert.throws(()=>assertManualSaleCovered([],s),/請先補上/)
 const b=buildManualTrade({...base,date:'2020-02-01'},'5',stamp)
 assert.throws(()=>assertManualSaleCovered([b],s),/缺少 5 股/)
})
test('prevents invalid date, fractional quantity and bad prices',()=>{
 assert.throws(()=>buildManualTrade({...base,date:'2023-02-30'},'6',stamp),/日期/)
 assert.throws(()=>buildManualTrade({...base,quantity:'0.5'},'6',stamp),/整數/)
 assert.throws(()=>buildManualTrade({...base,price:'0'},'6',stamp),/單價/)
 assert.throws(()=>buildManualTrade({...base,symbol:'!'},'6',stamp),/代號/)
})

test('optional actual fee and tax are saved; blank is unknown, zero is confirmed',()=>{
 const blank=buildManualTrade({...base,fee:'',tax:''},'fee-blank',stamp)
 assert.equal(blank.fee,null);assert.equal(blank.tax,null)
 const paid=buildManualTrade({...base,fee:'12.50',tax:'0'},'fee-paid',stamp)
 assert.equal(paid.fee,12.5)
 assert.equal(paid.tax,0)
 assert.equal(paid.feeStatus,'manual-entered')
 const original=buildManualTrade(base,'fee-legacy',stamp)
 assert.equal(original.fee,null)
})
test('invalid negative, precision, notation and oversized fees are rejected',()=>{
 for(const invalid of ['-1','1.001','1e3','NaN','100000001','0.0001'])
   assert.throws(()=>buildManualTrade({...base,fee:invalid},'bad',stamp),/手續費/)
 for(const invalid of ['-0.01','1.999','Infinity'])
   assert.throws(()=>buildManualTrade({...base,tax:invalid},'bad',stamp),/交易稅/)
})
