import test from 'node:test'
import assert from 'node:assert/strict'
import {readTradePreview,roughShortfalls,toStaged} from '../src/import-trades'

const record={
 id:'fubon:2026-10-08:2059:B:oB799:09:55:36',date:'2026-10-08',
 symbol:'2059',name:'川湖',side:'buy',quantity:2,price:10645,gross:21290,
 orderId:'oB799',time:'09:55:36',fee:null,tax:null,feeStatus:'unverified'
}
const data=(records:unknown[])=>({format:'orderlead-gmail-trades',schema:1,records})
test('parses Gmail trade preview and keeps unknown fees null',()=>{
 const result=readTradePreview(data([record]))
 assert.equal(result.length,1)
 assert.equal(result[0].fee,null)
 assert.equal(result[0].tax,null)
 const staged=toStaged(result)
 assert.equal(staged[0].status,'pending')
 assert.equal(staged[0].createdAt,'2026-10-08T01:55:36.000Z')
})
test('rejects duplicate source IDs to protect against double importing',()=>{
 assert.throws(()=>readTradePreview(data([record,record])),/重複/)
})
test('rejects altered gross amounts and invalid shares',()=>{
 assert.throws(()=>readTradePreview(data([{...record,gross:1}])),/價金/)
 assert.throws(()=>readTradePreview(data([{...record,quantity:0}])),/價金/)
})
test('identifies sells without enough recorded buy inventory',()=>{
 const buys=readTradePreview(data([record]))
 const sales=[{date:'2026-10-09',time:'09:15:00',symbol:'2059',side:'sell',quantity:3}]
 const gaps=roughShortfalls([...buys,...sales])
 assert.equal(gaps.length,1)
 assert.equal(gaps[0].shortfall,1)
})
