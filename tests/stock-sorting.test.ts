import test from 'node:test'
import assert from 'node:assert/strict'
import { STOCK_SORT_OPTIONS, sortStockGroups } from '../src/stock-sorting'
import { groupTradesByStock } from '../src/stock-groups'
import { organizeGmailHistory } from '../src/gmail-history'
import type { StagedTrade } from '../src/types'
let id=0
function row(symbol:string,name:string,date:string,side:'buy'|'sell',quantity:number,price:number):StagedTrade {
  return {id:'sort-'+(++id),date,time:'10:00:00',symbol,name,side,quantity,price,gross:quantity*price,
    orderId:'S',status:'pending',fee:null,tax:null,createdAt:date+'T02:00:00Z',importedAt:'2026-10-15T00:00:00Z'}
}
const data=[
  row('2330','台積電','2024-01-02','buy',10,100),
  row('2330','台積電','2024-03-03','sell',5,150),
  row('0050','元大台灣50','2024-02-02','buy',20,100),
  row('0050','元大台灣50','2024-02-03','sell',10,90),
  row('2317','鴻海','2024-04-01','buy',4,50),
  row('1101','台泥','2024-01-01','sell',3,80)
]
const groups=groupTradesByStock(organizeGmailHistory(data))
const order=(mode:Parameters<typeof sortStockGroups>[1])=>sortStockGroups(groups,mode).map(g=>g.symbol)
test('sort options expose all 12 choices',()=>assert.equal(STOCK_SORT_OPTIONS.length,12))
test('code ascending and descending numeric order',()=>{
  assert.deepEqual(order('code-asc'),['0050','1101','2317','2330'])
  assert.deepEqual(order('code-desc'),['2330','2317','1101','0050'])
})
test('latest trade sorts both directions, including unmatched-only symbols',()=>{
  assert.deepEqual(order('recent-desc'),['2317','2330','0050','1101'])
  assert.deepEqual(order('recent-asc'),['1101','0050','2330','2317'])
})
test('gross profit sorting excludes unknown/no sell from ranking',()=>{
  assert.deepEqual(order('pnl-desc'),['2330','0050','1101','2317'])
  assert.deepEqual(order('pnl-asc'),['0050','2330','1101','2317'])
})
test('remaining shares and costs can sort up or down',()=>{
  assert.deepEqual(order('remaining-desc'),['0050','2330','2317','1101'])
  assert.deepEqual(order('remaining-asc'),['1101','2317','2330','0050'])
  assert.deepEqual(order('cost-desc'),['0050','2330','2317','1101'])
  assert.deepEqual(order('cost-asc'),['1101','2317','2330','0050'])
})
test('name sorting is available and all sorts preserve data order',()=>{
  const before=groups.map(g=>g.symbol)
  assert.equal(order('name-asc').length,4)
  assert.deepEqual(order('name-desc'),[...order('name-asc')].reverse())
  assert.deepEqual(groups.map(g=>g.symbol),before)
  assert.deepEqual(groups.find(g=>g.symbol==='2330')?.buys.map(b=>b.row.date),['2024-01-02'])
})
