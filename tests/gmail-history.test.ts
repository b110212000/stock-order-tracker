import test from 'node:test'
import assert from 'node:assert/strict'
import { organizeGmailHistory } from '../src/gmail-history'
import type { StagedTrade } from '../src/types'
let serial=0
const item=(date:string,symbol:string,side:'buy'|'sell',quantity:number,time='09:20:00'):StagedTrade=>({
  id:'unit-'+(++serial),date,time,symbol,name:symbol,side,quantity,price:100,gross:quantity*100,
  orderId:'unit',fee:null,tax:null,status:'pending',createdAt:date+'T00:00:00Z',importedAt:date+'T00:00:00Z'
})
test('all buys are kept, including periodic buys not yet sold',()=>{
 const rows=[item('2024-01-02','0056','buy',100),item('2024-02-02','0056','buy',100),item('2025-01-02','0056','buy',50)]
 const x=organizeGmailHistory(rows)
 assert.equal(x.buyCount,3);assert.equal(x.included.length,3);assert.equal(x.unmatched.length,0)
})
test('a sale without sufficient earlier buys is excluded while buys remain',()=>{
 const rows=[item('2024-01-01','0056','sell',200),item('2024-02-01','0056','buy',40)]
 const x=organizeGmailHistory(rows)
 assert.equal(x.included.length,1);assert.equal(x.included[0].side,'buy')
 assert.equal(x.unmatched[0].missing,200)
})
test('selling after multiple buys pairs quantities FIFO without inventing a cost',()=>{
 const a=item('2024-01-01','2330','buy',10)
 const b=item('2024-01-10','2330','buy',20)
 const s=item('2024-01-15','2330','sell',25)
 const x=organizeGmailHistory([s,b,a])
 assert.equal(x.included.length,3)
 assert.deepEqual(x.matchedSales[0].buys.map(v=>v.quantity),[10,15])
 assert.equal(x.unmatched.length,0)
})
test('buys before 2024 do not cover sells after 2024',()=>{
 const x=organizeGmailHistory([item('2023-12-31','2382','buy',100),item('2024-01-01','2382','sell',30)])
 assert.equal(x.included.length,0);assert.equal(x.unmatched.length,1)
})
test('unmatched sells do not subtract from documented buy inventory',()=>{
 const rows=[item('2024-01-01','0050','buy',30),item('2024-01-02','0050','sell',60),item('2024-01-03','0050','sell',20)]
 const x=organizeGmailHistory(rows)
 assert.equal(x.included.length,2);assert.equal(x.unmatched.length,1)
})
test('same-day trades are ordered by actual execution time',()=>{
 const rows=[item('2024-04-10','3032','sell',10,'09:01:00'),item('2024-04-10','3032','buy',10,'09:02:00')]
 const x=organizeGmailHistory(rows)
 assert.equal(x.included.length,1);assert.equal(x.unmatched.length,1)
})
