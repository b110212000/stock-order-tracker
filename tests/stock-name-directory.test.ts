import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildManualTrade } from '../src/manual-review-trades'
import {
  createStockNameLookup, mayAutofillName, namesFromTrades, normalizeStockSymbol,
  parseBundledNames, parseMarketMirrorNames, PUBLIC_MARKET_DIRECTORY_URL, validStockSymbol
} from '../src/stock-name-directory'

test('bundled market directory contains representative TWSE, TPEx and ETF codes',()=>{
  const raw=JSON.parse(readFileSync(new URL('../public/stock-names.json',import.meta.url),'utf8')) as unknown
  const names=parseBundledNames(raw)
  assert.ok(Object.keys(names).length>2200)
  assert.equal(names['2330'],'台積電')
  assert.equal(names['6488'],'環球晶')
  assert.equal(names['0050'],'元大台灣50')
  assert.equal(names['006208'],'富邦台50')
  assert.equal(names['00919'],'群益台灣精選高息')
  assert.equal(names['5439'],'高技')
})

test('stock symbol normalization and malformed directory values are safe',()=>{
  assert.equal(normalizeStockSymbol(' 0050a '),'0050A')
  for(const code of ['2330','0050','00919','6488','00400A'])assert.equal(validStockSymbol(code),true)
  for(const code of ['','123','123456789','2330<script>','你好'])assert.equal(validStockSymbol(code),false)
  assert.deepEqual(parseBundledNames({schema:2,names:{'2330':'偽造'}}),{})
  assert.deepEqual(parseBundledNames({schema:1,names:{'2330':'台積電','bad!':'不存在','0050':''}}),{'2330':'台積電'})
  assert.deepEqual(parseMarketMirrorNames({symbols:{
    '0050':{symbol:'0050',name:'元大台灣50'},
    '6488':{symbol:'6488',name:'環球晶'},
    '00878':{symbol:'wrong',name:'不可信'},
    '2330':{name:'台積電'},
    'invalid!':{name:'壞資料'}
  }}),{'2330':'台積電','6488':'環球晶','0050':'元大台灣50'})
})

test('previously typed names are never overwritten by asynchronous lookup',()=>{
  assert.equal(mayAutofillName('',null),true)
  assert.equal(mayAutofillName('舊系統顯示','舊系統顯示'),true)
  assert.equal(mayAutofillName('我手動輸入','舊系統顯示'),false)
  assert.equal(mayAutofillName('原本編輯資料',null),false)
})

test('local snapshot resolves repeated lookups without duplicate network traffic',async()=>{
  const calls:string[]=[]
  const lookup=createStockNameLookup(async url=>{
    calls.push(url)
    assert.equal(url,'/stock-order-tracker/stock-names.json')
    return {schema:1,names:{'2330':'台積電','0050':'元大台灣50'}}
  })
  assert.equal(await lookup(' 2330 ',{},'/stock-order-tracker/'),'台積電')
  assert.equal(await lookup('0050',{},'/stock-order-tracker'),'元大台灣50')
  assert.equal(await lookup('abc',{},'/stock-order-tracker'),undefined)
  assert.deepEqual(calls,['/stock-order-tracker/stock-names.json'])
})

test('fallback to already saved local trades when offline or bundled snapshot unavailable',async()=>{
  const source=buildManualTrade({date:'2026-01-01',time:'',symbol:'00878',name:'國泰永續高股息',side:'buy',quantity:'10',price:'20'},'saved','2026-02-01')
  const history=namesFromTrades([source])
  const lookup=createStockNameLookup(async()=>{throw new Error('offline')})
  assert.equal(await lookup('00878',history,'/'),'國泰永續高股息')
  assert.equal(await lookup('9999',history,'/'),undefined)
})

test('unknown stock symbol may retrieve newer fixed-name snapshot, never sends ticker to a provider',async()=>{
  const calls:string[]=[]
  const lookup=createStockNameLookup(async url=>{
    calls.push(url)
    if(url==='/stock-order-tracker/stock-names.json')return {schema:1,names:{}}
    assert.equal(url,PUBLIC_MARKET_DIRECTORY_URL)
    return {symbols:{'6488':{symbol:'6488',name:'環球晶'},'00919':{symbol:'00919',name:'群益台灣精選高息'}}}
  })
  assert.equal(await lookup('6488',{},'/stock-order-tracker/'),'環球晶')
  assert.equal(await lookup('00919',{},'/stock-order-tracker/'),'群益台灣精選高息')
  assert.equal(calls.length,2)
  assert.ok(calls.every(url=>!url.includes('?symbol=')&&!url.includes('?stockNo=')))
})

test('React form protects manual names, prevents stale async code changes, preserves mobile columns',()=>{
  const dialog=readFileSync(new URL('../src/ManualTradeDialog.tsx',import.meta.url),'utf8')
  const page=readFileSync(new URL('../src/TradeHistoryPage.tsx',import.meta.url),'utf8')
  assert.match(dialog,/autoNameRef=useRef<string\|null>/)
  assert.match(dialog,/if\(cancelled\)return/)
  assert.match(dialog,/normalizeStockSymbol\(current\.symbol\)!==symbol/)
  assert.match(dialog,/mayAutofillName\(current\.name,autoNameRef\.current\)/)
  assert.match(dialog,/if\(key==='name'\)autoNameRef\.current=null/)
  assert.match(dialog,/if\(key==='symbol'&&value!==old\.symbol/)
  assert.match(page,/knownStockNames=\{knownStockNames\}/)
  assert.match(dialog,/manual-stock-row/)
  assert.match(dialog,/type="date"/)
  assert.match(dialog,/type="time"/)
})
