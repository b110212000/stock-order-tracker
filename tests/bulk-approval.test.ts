import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BULK_FEES, planBulkApprovals } from '../src/bulk-approval'
import type { StagedTrade,Trade } from '../src/types'
const row=(id:string,symbol:string,side:'buy'|'sell',date:string,quantity:number,price:number,fee:number|null=0,tax:number|null=0):StagedTrade=>({
  id:'fubon:'+date+':'+symbol+':'+(side==='buy'?'B':'S')+':'+id+':09:10:02',
  symbol,name:symbol,date,side,quantity,price,gross:quantity*price,orderId:id,time:'09:10:02',
  fee,tax,feeStatus:fee===null?'unverified':'verified',status:'pending',
  importedAt:'2026-10-15T00:00:00.000Z',createdAt:new Date(date+'T09:10:02+08:00').toISOString()
})
test('verified completed buy/sell records are approved as one coherent group',()=>{
 const input=[row('o100','3032','buy','2026-01-01',50,100,8,0),row('o101','3032','sell','2026-01-15',30,130,7,12)]
 const p=planBulkApprovals(input,[],DEFAULT_BULK_FEES)
 assert.equal(p.trades.length,2)
 assert.equal(p.blocked.length,0)
 assert.equal(p.estimatedCount,0)
 assert.equal(p.updates[0].status,'approved')
 assert.equal(p.trades[1].fee,7)
})
test('unknown fee blocks symbol in verified-only mode',()=>{
 const p=planBulkApprovals([row('o100','3032','buy','2026-01-01',10,100,null,null)],[],DEFAULT_BULK_FEES)
 assert.equal(p.trades.length,0)
 assert.match(p.blocked[0].reason,/未核對/)
})
test('estimate computes fees with a clear provenance label',()=>{
 const f={...DEFAULT_BULK_FEES,mode:'estimate' as const}
 const rows=[row('o100','3032','buy','2026-01-01',100,100,null,null),
 row('o200','3032','sell','2026-01-12',50,120,null,null)]
 const p=planBulkApprovals(rows,[],f)
 assert.equal(p.trades.length,2)
 assert.equal(p.trades[0].fee,14)
 assert.equal(p.trades[0].tax,0)
 assert.equal(p.trades[1].fee,9)
 assert.equal(p.trades[1].tax,18)
 assert.equal(p.estimatedCount,2)
 assert.match(p.trades[0].note,/費用估算/)
})
test('ETF sell tax uses separately configured ETF tax rate',()=>{
 const f={...DEFAULT_BULK_FEES,mode:'estimate' as const}
 const rows=[row('o100','0050','buy','2026-01-01',100,90,null,null),row('o200','0050','sell','2026-01-02',100,100,null,null)]
 const p=planBulkApprovals(rows,[],f)
 assert.equal(p.trades.length,2)
 assert.equal(p.trades[1].tax,10)
})
test('shortfall blocks entire symbol but allows independent valid symbol',()=>{
 const rows=[
   row('o101','3032','buy','2026-01-01',100,50,0,0),
   row('o102','3032','sell','2026-01-02',150,52,0,0),
   row('o103','0050','buy','2026-01-01',40,90,0,0)
 ]
 const p=planBulkApprovals(rows,[],DEFAULT_BULK_FEES)
 assert.equal(p.trades.length,1)
 assert.equal(p.trades[0].symbol,'0050')
 assert.equal(p.blocked[0].symbol,'3032')
 assert.equal(p.blocked[0].count,2)
})
test('manual duplicate blocks same stock to avoid inflated portfolio',()=>{
 const r=row('o101','3032','buy','2026-01-01',100,50,0,0)
 const existing:Trade=[{id:'manual1',symbol:'3032',side:'buy',date:'2026-01-01',quantity:100,price:50,fee:0,tax:0,note:'',createdAt:'2026-01-01T01:00:00Z'}]
 const p=planBulkApprovals([r],existing,DEFAULT_BULK_FEES)
 assert.equal(p.trades.length,0)
 assert.match(p.blocked[0].reason,/重複/)
})
test('existing Gmail-source ID is skipped',()=>{
 const r=row('o101','3032','buy','2026-01-01',100,50,0,0)
 const existing:Trade=[{id:'gmail:'+r.id,symbol:'3032',side:'buy',date:r.date,quantity:r.quantity,price:r.price,fee:0,tax:0,note:'',createdAt:r.createdAt}]
 const p=planBulkApprovals([r],existing,DEFAULT_BULK_FEES)
 assert.equal(p.trades.length,0)
 assert.equal(p.alreadyImported,1)
})
test('ETN with unknown charges not silently classified as ordinary stock',()=>{
 const r=row('o100','020029','buy','2026-01-01',100,5,null,null)
 const p=planBulkApprovals([r],[],{...DEFAULT_BULK_FEES,mode:'estimate'})
 assert.equal(p.trades.length,0)
 assert.match(p.blocked[0].reason,/特殊/)
})
test('rejects negative rates',()=>{
 const r=row('o101','3032','buy','2026-01-01',100,50,0,0)
 assert.throws(()=>planBulkApprovals([r],[],{...DEFAULT_BULK_FEES,stockTaxPercent:-1}),/非負數/)
})
