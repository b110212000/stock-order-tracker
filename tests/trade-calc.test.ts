import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTrades } from '../src/trade-calc'
import { monthlyRealized, overview, snapshotChange } from '../src/analytics'
import type { Trade } from '../src/types'

const trade=(id:string,side:'buy'|'sell',date:string,quantity:number,price:number,fee=0,tax=0):Trade=>({
  id,symbol:'3032',side,date,quantity,price,fee,tax,note:'',createdAt:'2026-10-01T00:00:00.000Z'
})

test('partial sell uses FIFO with fees and taxes',()=>{
 const p=calculateTrades([
  trade('a','buy','2026-10-01',100,80,20),
  trade('b','sell','2026-10-31',40,90,6,11)
 ])
 assert.equal(p.holdings.length,1)
 assert.equal(p.holdings[0].quantity,60)
 assert.equal(p.holdings[0].averageCost,80.2)
 assert.equal(p.holdings[0].cost,4812)
 assert.equal(p.closed[0].cost,3208)
 assert.equal(p.closed[0].proceeds,3583)
 assert.equal(p.closed[0].pnl,375)
 assert.equal(p.closed[0].holdingDays,30)
 assert.equal(p.realized,375)
})
test('multiple buys consume oldest lots first',()=>{
 const p=calculateTrades([
  trade('a','buy','2026-08-01',10,10),
  trade('b','buy','2026-09-01',10,20),
  trade('c','sell','2026-10-01',15,30,0,0)
 ])
 assert.equal(p.closed[0].cost,200)
 assert.equal(p.closed[0].proceeds,450)
 assert.equal(p.closed[0].pnl,250)
 assert.equal(p.holdings[0].quantity,5)
 assert.equal(p.holdings[0].cost,100)
})
test('overselling is rejected',()=>{
 assert.throws(()=>calculateTrades([trade('a','buy','2026-10-01',10,10),trade('b','sell','2026-10-03',11,12)]),/庫存/)
})
test('chronological sell before buy is rejected',()=>{
 assert.throws(()=>calculateTrades([trade('a','buy','2026-10-02',10,10),trade('b','sell','2026-10-01',1,12)]),/庫存/)
})
test('negative fees and fractional share counts are rejected',()=>{
 assert.throws(()=>calculateTrades([trade('a','buy','2026-10-01',10.5,10)]),/整數/)
 assert.throws(()=>calculateTrades([trade('a','buy','2026-10-01',10,10,-1)]),/負數/)
})
test('same-day sell has holdingDays zero, rather than division by zero',()=>{
 const p=calculateTrades([trade('a','buy','2026-10-01',10,10),trade('b','sell','2026-10-01',10,15)])
 assert.equal(p.closed[0].holdingDays,0)
})
test('net invested capital, dividends and manual prices affect equity',()=>{
 const t=[trade('a','buy','2026-10-01',10,80)]
 const flows=[{id:'1',date:'2026-10-01',type:'deposit' as const,amount:1000,note:''},{id:'2',date:'2026-10-02',type:'dividend' as const,amount:5,note:''}]
 const q=[{symbol:'3032',price:90,asOf:'2026-10-03'}]
 const s=overview(t,q,flows)
 assert.equal(s.cash,205)
 assert.equal(s.marketValue,900)
 assert.equal(s.equity,1105)
 assert.equal(s.profit,105)
})
test('missing quote prevents misleading complete-equity reporting',()=>{
 const s=overview([trade('a','buy','2026-10-01',10,80)],[],[])
 assert.equal(s.equity,null)
 assert.equal(s.unpriced.length,1)
})
test('month grouping uses sell date and cost basis',()=>{
 const m=monthlyRealized([trade('a','buy','2026-09-01',100,80),trade('b','sell','2026-10-01',100,90,0,0)])
 assert.equal(m.length,1)
 assert.equal(m[0].month,'2026-10')
 assert.equal(m[0].pnl,1000)
})
test('snapshot return excludes new deposits and labels as approximation',()=>{
 const before={id:'a',date:'2026-10-01',equity:10000,cumulativeNetDeposits:10000,capturedAt:'x'}
 const after={id:'b',date:'2026-10-31',equity:12000,cumulativeNetDeposits:11000,capturedAt:'x'}
 assert.equal(snapshotChange(before,after),0.1)
})
