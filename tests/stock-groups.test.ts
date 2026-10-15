import test from 'node:test'
import assert from 'node:assert/strict'
import { organizeGmailHistory } from '../src/gmail-history'
import { groupTradesByStock } from '../src/stock-groups'
import type { StagedTrade } from '../src/types'
let i=0
const tx=(date:string,symbol:string,side:'buy'|'sell',quantity:number,price:number,name='台積電'):StagedTrade=>({
 id:'mock'+(++i),date,time:'10:01:00',symbol,name,side,quantity,price,gross:quantity*price,
 orderId:'ID',fee:null,tax:null,status:'pending',createdAt:date+'T10:01:00+08:00',
 importedAt:'2026-10-15T00:00:00Z'
})
test('group by ticker with two purchases and two sales, matching FIFO and keeping ten shares',()=>{
 const a=tx('2024-01-01','2330','buy',100,900)
 const b=tx('2024-01-10','2330','sell',30,1000)
 const c=tx('2024-01-15','2330','buy',20,950)
 const d=tx('2024-01-20','2330','sell',80,1100)
 const groups=groupTradesByStock(organizeGmailHistory([d,b,c,a]))
 const g=groups[0]
 assert.equal(groups.length,1)
 assert.equal(g.buyQuantity,120)
 assert.equal(g.matchedSellQuantity,110)
 assert.equal(g.remainingQuantity,10)
 assert.equal(g.remainingCost,9500)
 assert.deepEqual(g.buys.map(x=>x.matchedQuantity),[100,10])
 assert.deepEqual(g.buys.map(x=>x.remainingQuantity),[0,10])
 assert.deepEqual(g.sells[1].match.buys.map(x=>x.quantity),[70,10])
 assert.equal(g.sells[0].match.grossPnl,3000)
 assert.equal(g.sells[1].match.grossPnl,15500)
 assert.equal(g.reliableGrossPnl,18500)
})
test('later buys cannot make earlier uncovered sells valid, remaining balance flagged uncertain',()=>{
 const a=tx('2024-01-01','2330','buy',100,900)
 const b=tx('2024-01-05','2330','sell',110,1000)
 const c=tx('2024-01-10','2330','buy',20,950)
 const g=groupTradesByStock(organizeGmailHistory([c,b,a]))[0]
 assert.equal(g.sells.length,0)
 assert.equal(g.unmatched.length,1)
 assert.equal(g.remainingQuantity,120)
 assert.equal(g.uncertainInventory,true)
})
test('two tickers get independent remaining quantities and profit',()=>{
 const a=tx('2024-01-01','2330','buy',10,900)
 const b=tx('2024-02-01','0050','buy',100,100,'元大台灣50')
 const c=tx('2024-02-02','0050','sell',40,150,'元大台灣50')
 const grouped=groupTradesByStock(organizeGmailHistory([a,b,c]))
 assert.deepEqual(grouped.map(x=>x.symbol),['0050','2330'])
 assert.equal(grouped[0].remainingQuantity,60)
 assert.equal(grouped[0].reliableGrossPnl,2000)
 assert.equal(grouped[1].remainingQuantity,10)
 assert.equal(grouped[1].sells.length,0)
})
test('unmatched sale marks later apparently paired sales uncertain',()=>{
 const a=tx('2024-01-01','2330','buy',100,900)
 const b=tx('2024-01-05','2330','sell',120,1000)
 const c=tx('2024-01-10','2330','sell',30,1100)
 const g=groupTradesByStock(organizeGmailHistory([a,b,c]))[0]
 assert.equal(g.sells.length,1)
 assert.equal(g.uncertainInventory,true)
 assert.equal(g.uncertainSaleCount,1)
 assert.equal(g.reliableGrossPnl,0)
 assert.equal(g.remainingQuantity,70)
})
test('buy without sale has full documented quantity and cost',()=>{
 const a=tx('2024-01-01','2330','buy',50,1023.5)
 const g=groupTradesByStock(organizeGmailHistory([a]))[0]
 assert.equal(g.sells.length,0)
 assert.equal(g.remainingQuantity,50)
 assert.equal(g.remainingCost,51175)
})
