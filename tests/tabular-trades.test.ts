import test from 'node:test'
import assert from 'node:assert/strict'
import {strToU8} from 'fflate'
import {createExcelTemplate,createCsvTemplate,parseTabularTrades,resolveTabularNames} from '../src/tabular-trades'

test('Excel template includes required/optional Chinese headers and can be reimported',async()=>{
 const parsed=parseTabularTrades(createExcelTemplate(),'OrderLead_交易匯入範本.xlsx')
 assert.deepEqual(parsed.errors,[])
 assert.equal(parsed.drafts.length,3)
 assert.equal(parsed.drafts[0].symbol,'2330')
 assert.equal(parsed.drafts[1].symbol,'0050')
 assert.equal(parsed.drafts[1].recurring,true)
 assert.equal(parsed.drafts[1].side,'buy')
 assert.equal(parsed.drafts[1].time,'10:45:00')
 assert.equal(parsed.drafts[1].timeDefaulted,true)
 assert.equal(parsed.drafts[1].fee,null)
 assert.equal(parsed.drafts[0].fee,1)
 assert.equal(parsed.drafts[2].tax,2)
 const names=await resolveTabularNames(parsed.drafts,async symbol=>({'2330':'台積電','0050':'元大台灣50'} as Record<string,string>)[symbol])
 assert.deepEqual(names.errors,[])
 assert.equal(names.records[1].name,'元大台灣50')
 assert.equal(names.records[1].recurring,true)
})
test('CSV template is UTF-8 BOM, labels are parsed and original zero-prefixed symbols survive',()=>{
 const template=createCsvTemplate()
 assert.equal(template[0],0xef)
 const parsed=parseTabularTrades(template,'trades.csv')
 assert.deepEqual(parsed.errors,[])
 assert.deepEqual(parsed.drafts.map(r=>r.symbol),['2330','0050','2330'])
 assert.equal(parsed.drafts[0].fee,1)
 assert.equal(parsed.drafts[0].tax,null)
})
test('optional fees distinguish blank from confirmed zero, aliases and CRLF are accepted',()=>{
 const raw=[
  '日期（必）,股票代號（必）,交易類型（必）,股數（必）,成交價（必）,成交時間（選）,手續費（選）,交易稅（選）',
  '2026/11/11,006208,買進,12,50.2,,0,',
  '2026-11-12,2330,現賣,1,1500,13:25,,7'
 ].join('\r\n')
 const parsed=parseTabularTrades(strToU8(raw),'import.csv')
 assert.deepEqual(parsed.errors,[])
 assert.equal(parsed.drafts[0].symbol,'006208')
 assert.equal(parsed.drafts[0].fee,0)
 assert.equal(parsed.drafts[0].tax,null)
 assert.equal(parsed.drafts[1].side,'sell')
 assert.equal(parsed.drafts[1].time,'13:25:00')
})
test('reordered rows preserve IDs; two legitimate identical trades remain distinct',()=>{
 const header='日期(必),股票代號(必),交易類型(必),股數(必),成交價(必)'
 const a='2026-11-11,0050,買進,2,55.5'
 const b='2026-11-12,2330,賣出,1,1500'
 const first=parseTabularTrades(strToU8([header,a,b,a].join('\n')),'trades.csv')
 const moved=parseTabularTrades(strToU8([header,a,a,b].join('\n')),'trades.csv')
 assert.equal(new Set(first.drafts.map(r=>r.id)).size,3)
 assert.deepEqual(first.drafts.map(r=>r.id).sort(),moved.drafts.map(r=>r.id).sort())
})
test('malformed rows report physical line, never silently become partial valid import',()=>{
 const data=['日期(必),股票代號(必),交易類型(必),股數(必),成交價(必),手續費(選)',
  '2026-11-01,0050,買進,10,50,',
  '2026-11-02,2330,買進,0,1500,',
  '2026-11-03,2330,賣出,10,1520,-5'].join('\n')
 const p=parseTabularTrades(strToU8(data),'input.csv')
 assert.equal(p.drafts.length,1)
 assert.equal(p.errors.length,2)
 assert.match(p.errors[0],/第 3 列/)
 assert.match(p.errors[1],/第 4 列/)
})
test('unknown name blocks completed preview with original physical row number',async()=>{
 const p=parseTabularTrades(strToU8('日期(必),股票代號(必),交易類型(必),股數(必),成交價(必)\n2026-11-01,9999,買進,2,20'),'a.csv')
 const result=await resolveTabularNames(p.drafts,async()=>undefined)
 assert.equal(result.records.length,0)
 assert.match(result.errors[0],/第 2 列：查無股票代號 9999/)
})
test('rejects broken files, missing fields, duplicate headers and ambiguous dates',()=>{
 assert.throws(()=>parseTabularTrades(strToU8('not zip'),'invalid.xlsx'),/檔案無法解析|Excel/)
 assert.throws(()=>parseTabularTrades(strToU8('a,b\n1,2'),'invalid.csv'),/缺少必填欄位/)
 assert.throws(()=>parseTabularTrades(strToU8('日期(必),日期(選)\n1,2'),'dup.csv'),/表頭重複/)
 const row='日期(必),股票代號(必),交易類型(必),股數(必),成交價(必)\n2026-02-30,0050,買進,1,50'
 const p=parseTabularTrades(strToU8(row),'invalid.csv')
 assert.match(p.errors[0],/日期不存在/)
})

test('changing optional fee values in an exported sheet does not duplicate identical execution',()=>{
 const header='日期(必),股票代號(必),交易類型(必),股數(必),成交價(必),手續費(選),交易稅(選)'
 const original=parseTabularTrades(strToU8(header+'\n2026-11-02,2330,買進,10,1450,,'),'a.csv')
 const edited=parseTabularTrades(strToU8(header+'\n2026-11-02,2330,買進,10,1450,1,0'),'b.csv')
 assert.equal(original.drafts[0].id,edited.drafts[0].id)
 assert.equal(original.drafts[0].fee,null)
 assert.equal(edited.drafts[0].fee,1)
})
