import test from 'node:test'
import assert from 'node:assert/strict'
import { organizeGmailHistory } from '../src/gmail-history'
import type { StagedTrade } from '../src/types'
let serial=0
const item=(date:string,symbol:string,side:'buy'|'sell',quantity:number,
  price=100,time='09:20:00'):StagedTrade=>({
  id:'unit-'+(++serial),date,time,symbol,name:symbol,side,quantity,price,
  gross:quantity*price,orderId:'unit',fee:null,tax:null,status:'pending',
  createdAt:date+'T00:00:00Z',importedAt:date+'T00:00:00Z'
})
test('all buys remain visible including periodic buys never sold',()=>{
 const rows=[item('2024-01-02','0056','buy',100),item('2024-02-02','0056','buy',100),
             item('2025-01-02','0056','buy',50)]
 const r=organizeGmailHistory(rows)
 assert.equal(r.buyCount,3);assert.equal(r.included.length,3)
 assert.equal(r.matchedSales.length,0);assert.equal(r.reliableGrossPnl,0)
})
test('FIFO sale correctly splits uneven buys and calculates gross P&L',()=>{
 const a=item('2024-01-01','2330','buy',10,900)
 const b=item('2024-02-01','2330','buy',10,950)
 const c=item('2024-03-01','2330','buy',10,1000)
 const sale=item('2024-04-01','2330','sell',25,1100)
 const r=organizeGmailHistory([sale,b,c,a])
 assert.equal(r.matchedSales.length,1)
 const m=r.matchedSales[0]
 assert.equal(m.reliable,true)
 assert.deepEqual(m.buys.map(x=>x.quantity),[10,10,5])
 assert.deepEqual(m.buys.map(x=>x.cost),[9000,9500,5000])
 assert.deepEqual(m.buys.map(x=>x.grossPnl),[2000,1500,500])
 assert.equal(m.cost,23500);assert.equal(m.proceeds,27500)
 assert.equal(m.grossPnl,4000)
 assert.ok(Math.abs((m.grossRoi||0)-4000/23500)<0.000001)
 assert.equal(r.reliableGrossPnl,4000)
})
test('gross losses and break-even cases are supported without fees',()=>{
 const b=item('2024-01-01','0050','buy',10,100)
 const s=item('2024-01-02','0050','sell',6,90)
 const s2=item('2024-01-03','0050','sell',4,100)
 const r=organizeGmailHistory([s2,b,s])
 assert.equal(r.matchedSales[0].grossPnl,-60)
 assert.equal(r.matchedSales[1].grossPnl,0)
 assert.equal(r.reliableGrossPnl,-60)
})
test('unmatched sale is excluded, buys remain and taints later provisional matches',()=>{
 const buy=item('2024-01-02','0056','buy',40,100)
 const missing=item('2024-01-03','0056','sell',100,120)
 const later=item('2024-01-04','0056','sell',20,130)
 const r=organizeGmailHistory([later,missing,buy])
 assert.equal(r.included.length,2)
 assert.equal(r.unmatched.length,1)
 assert.equal(r.unmatched[0].missing,60)
 assert.equal(r.matchedSales.length,1)
 assert.equal(r.matchedSales[0].reliable,false)
 assert.equal(r.matchedSales[0].grossPnl,600)
 assert.equal(r.reliableGrossPnl,0)
 assert.equal(r.uncertainSaleCount,1)
})
test('one symbol with missing history does not taint other symbols',()=>{
 const xs=[item('2024-01-01','0056','sell',10),
 item('2024-01-02','0050','buy',10,100),item('2024-01-03','0050','sell',10,120)]
 const r=organizeGmailHistory(xs)
 assert.equal(r.reliableSaleCount,1);assert.equal(r.reliableGrossPnl,200)
})
test('older purchases can cover later sales without a hardcoded start year',()=>{
 const r=organizeGmailHistory([item('2023-12-31','2382','buy',100),
 item('2024-01-01','2382','sell',30)])
 assert.equal(r.included.length,2);assert.equal(r.unmatched.length,0)
 assert.equal(r.matchedSales.length,1)
})
test('same-day trades obey execution time, not input order',()=>{
 const sale=item('2024-04-10','3032','sell',10,110,'09:01:00')
 const buy=item('2024-04-10','3032','buy',10,100,'09:02:00')
 const r=organizeGmailHistory([buy,sale])
 assert.equal(r.included.length,1);assert.equal(r.unmatched.length,1)
})
test('uses reported Gmail gross, not price-times-quantity for per-lot allocation',()=>{
 const buy=item('2024-01-01','2330','buy',3,100.01)
 buy.gross=300
 const sell=item('2024-01-04','2330','sell',2,105.01)
 sell.gross=210
 const r=organizeGmailHistory([sell,buy])
 assert.equal(r.matchedSales[0].cost,200)
 assert.equal(r.matchedSales[0].proceeds,210)
 assert.equal(r.matchedSales[0].grossPnl,10)
})

test('known buy and sell charges are prorated through FIFO to calculate optional net P&L',()=>{
 const buy=item('2024-01-01','2330','buy',100,100)
 buy.fee=10;buy.tax=0
 const sale=item('2024-02-01','2330','sell',30,120)
 sale.fee=6;sale.tax=9
 const m=organizeGmailHistory([sale,buy]).matchedSales[0]
 assert.equal(m.grossPnl,600)
 assert.equal(m.netPnl,582) // 600 - (10 * 30/100) - 6 - 9
 assert.equal(organizeGmailHistory([sale,buy]).reliableGrossPnl,600)
})
test('unknown fees never become zero, and tainted matches have no confirmed net P&L',()=>{
 const buy=item('2024-01-01','0050','buy',10,100)
 buy.fee=0;buy.tax=null
 const sell=item('2024-02-01','0050','sell',10,110)
 sell.fee=0;sell.tax=0
 assert.equal(organizeGmailHistory([buy,sell]).matchedSales[0].netPnl,null)
 buy.tax=0
 assert.equal(organizeGmailHistory([buy,sell]).matchedSales[0].netPnl,100)
 const invalid=item('2024-01-15','0050','sell',20,110)
 assert.equal(organizeGmailHistory([buy,invalid,sell]).matchedSales[0].netPnl,null)
})
