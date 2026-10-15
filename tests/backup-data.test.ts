import test from 'node:test'
import assert from 'node:assert/strict'
import {STORE_NAMES} from '../src/db'
import {buildBackup,planRestore,parseBackupBytes,summarizeBackup,validateFullBackup} from '../src/backup-data'
import type {BackupStores} from '../src/backup-data'
import type {StagedTrade} from '../src/types'

function empty():BackupStores{
  return Object.fromEntries(STORE_NAMES.map(s=>[s,[]])) as BackupStores
}
function buy(id:string):StagedTrade{
 return {id,symbol:'2330',name:'台積電',date:'2025-01-01',time:'09:00:00',
 side:'buy',quantity:10,price:100,gross:1000,fee:null,tax:null,
 orderId:'manual',status:'pending',createdAt:'2025-01-01T01:00:00Z',importedAt:'2025-01-01T01:00:00Z'}
}
const asBytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v))
test('full backup includes ALL nine IDB stores, preserving private manual and edited records',()=>{
 const data=empty()
 data.reviewTrades=[{...buy('manual:a'),price:123,gross:1230}]
 data.imports=[buy('legacy:x')]
 data.trades=[{id:'old-trade',symbol:'2330',side:'buy',date:'2021-01-01',
 quantity:3,price:400,fee:2,tax:0,note:'',createdAt:'2021-01-01T00:00:00Z'}]
 data.cashflows=[{id:'cash:1',date:'2025-01-01',amount:1000,type:'deposit'}]
 const backup=buildBackup(data,'1.16.0')
 const restored=parseBackupBytes(asBytes(backup))
 assert.equal(restored.schema,1)
 assert.equal(restored.stores.reviewTrades[0].gross,1230)
 assert.equal(restored.stores.imports.length,1)
 assert.equal(restored.stores.trades.length,1)
 assert.equal(restored.stores.cashflows.length,1)
 assert.equal(summarizeBackup(restored).total,4)
})
test('merge keeps local edits if keys conflict and appends missing keys',()=>{
 const existing=empty(),other=empty()
 existing.reviewTrades=[buy('id:a')]
 other.reviewTrades=[{...buy('id:a'),price:999,gross:9990},buy('id:b')]
 const merged=planRestore(existing,other,'merge')
 assert.equal(merged.reviewTrades.length,2)
 assert.equal(merged.reviewTrades[0].price,100)
 assert.equal(merged.reviewTrades[1].id,'id:b')
 assert.equal(existing.reviewTrades.length,1)
})
test('replace makes exact restored snapshot while source is unchanged',()=>{
 const current=empty(),incoming=empty()
 current.reviewTrades=[buy('old')]
 incoming.reviewTrades=[buy('new')]
 assert.deepEqual(planRestore(current,incoming,'replace').reviewTrades.map(x=>x.id),['new'])
 assert.equal(current.reviewTrades[0].id,'old')
})
test('reject incomplete, other schema, duplicate keys and damaged transaction records',()=>{
 const valid=buildBackup(empty(),'1.16.0')
 const partial={...valid,stores:{reviewTrades:[]}}
 assert.throws(()=>validateFullBackup(partial),/數量不正確/)
 assert.throws(()=>validateFullBackup({...valid,schema:5}),/不是可還原/)
 const duplicate=empty()
 duplicate.reviewTrades=[buy('x'),buy('x')]
 assert.throws(()=>buildBackup(duplicate,'1.16.0'),/重複/)
 const invalid=empty()
 invalid.reviewTrades=[{...buy('x'),quantity:-3}]
 assert.throws(()=>buildBackup(invalid,'1.16.0'),/不完整/)
})
test('reject malformed or oversized backups before writing anything',()=>{
 assert.throws(()=>parseBackupBytes(asBytes('oops')),/不是可還原/)
 assert.throws(()=>parseBackupBytes(new TextEncoder().encode('{broken')),/不是有效 JSON/)
 assert.throws(()=>parseBackupBytes(new Uint8Array(25*1024*1024+1)),/超過/)
})
