import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { organizeGmailHistory } from '../src/gmail-history'
import { groupTradesByStock } from '../src/stock-groups'
import { toStaged } from '../src/import-trades'
import { parseTradeImportBytes } from '../src/import-file'

const record={
 id:'fubon:2026-10-08:2059:B:oB799:09:55:36',date:'2026-10-08',symbol:'2059',name:'川湖',side:'buy',
 quantity:2,price:10645,gross:21290,orderId:'oB799',time:'09:55:36',fee:null,tax:null
}
const payload=JSON.stringify({format:'orderlead-gmail-trades',schema:1,records:[record]})
test('accepts the exact Gmail JSON schema as a local file',()=>{
 const entries=parseTradeImportBytes(strToU8(payload),'orderlead_matched.json')
 assert.equal(entries.length,1);assert.equal(entries[0].symbol,'2059')
})
test('supports ZIP containing one JSON with a separate text matching report',()=>{
 const archive=zipSync({'orderlead_matched.json':strToU8(payload),'matching_report.txt':strToU8('私人核對摘要')})
 const entries=parseTradeImportBytes(archive,'orderlead_import.zip')
 assert.equal(entries[0].quantity,2)
})
test('rejects non-trade backup file and invalid ZIPs without modification',()=>{
 assert.throws(()=>parseTradeImportBytes(strToU8(JSON.stringify({format:'orderlead-backup'})),'other.json'),/交易匯入範例 JSON/)
 const archive=zipSync({'notes.txt':strToU8('nothing')})
 assert.throws(()=>parseTradeImportBytes(archive,'other.zip'),/ZIP 裡必須/)
})
test('rejects unsupported file extensions with explanation',()=>{
 assert.throws(()=>parseTradeImportBytes(strToU8('hello'),'statement.pdf'),/json 或 .zip/)
})

test('the Settings downloadable JSON is parsed by the actual importer and FIFO',()=>{
 const bytes=new Uint8Array(readFileSync(new URL('../public/trade-import-example.json',import.meta.url)))
 const entries=parseTradeImportBytes(bytes,'OrderLead_交易匯入範例.json')
 assert.equal(entries.length,3)
 assert.deepEqual(entries.map(x=>x.side),['buy','sell','buy'])
 assert.deepEqual(entries.map(x=>x.quantity),[100,30,20])
 assert.deepEqual(entries.map(x=>x.gross),[90000,30000,19000])
 const history=organizeGmailHistory(toStaged(entries))
 const [group]=groupTradesByStock(history)
 assert.equal(history.matchedSales.length,1)
 assert.equal(history.reliableGrossPnl,3000)
 assert.equal(group.remainingQuantity,90)
 assert.equal(group.remainingCost,82000)
 assert.deepEqual(parseTradeImportBytes(bytes,'again.json').map(x=>x.id),entries.map(x=>x.id))
})
test('generic import accepts a ZIP with optional fields, without legacy broker IDs',()=>{
 const bytes=new Uint8Array(readFileSync(new URL('../public/trade-import-example.json',import.meta.url)))
 const zip=zipSync({'example.json':bytes,'README.txt':strToU8('test only')})
 assert.equal(parseTradeImportBytes(zip,'generic.zip').length,3)
})
test('generic import validates date, quantity and direction, and rejects duplicate IDs',()=>{
 const sample={
  format:'orderlead-trades',schema:1,
  records:[{date:'2026-01-10',symbol:'0050',name:'台灣50',side:'buy',quantity:5,price:100}]
 }
 assert.equal(parseTradeImportBytes(strToU8(JSON.stringify(sample)),'sample.json')[0].time,'09:00:00')
 sample.records[0].date='2026-02-30'
 assert.throws(()=>parseTradeImportBytes(strToU8(JSON.stringify(sample)),'sample.json'),/日期錯誤/)
 sample.records[0].date='2026-01-10'
 sample.records[0].quantity=0
 assert.throws(()=>parseTradeImportBytes(strToU8(JSON.stringify(sample)),'sample.json'),/股數或價格/)
 const duplicate={
  format:'orderlead-trades',schema:1,
  records:[
   {id:'fixed-1',date:'2026-01-10',symbol:'0050',name:'台灣50',side:'buy',quantity:5,price:100},
   {id:'fixed-1',date:'2026-01-11',symbol:'0050',name:'台灣50',side:'sell',quantity:3,price:101}
  ]
 }
 assert.throws(()=>parseTradeImportBytes(strToU8(JSON.stringify(duplicate)),'sample.json'),/ID 重複/)
})
