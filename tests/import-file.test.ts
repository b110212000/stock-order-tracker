import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
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
test('rejects non-Gmail backup file and invalid ZIPs without modification',()=>{
 assert.throws(()=>parseTradeImportBytes(strToU8(JSON.stringify({format:'orderlead-backup'})),'other.json'),/預覽 JSON/)
 const archive=zipSync({'notes.txt':strToU8('nothing')})
 assert.throws(()=>parseTradeImportBytes(archive,'other.zip'),/ZIP 裡必須/)
})
test('rejects unsupported file extensions with explanation',()=>{
 assert.throws(()=>parseTradeImportBytes(strToU8('hello'),'statement.pdf'),/json 或 .zip/)
})
