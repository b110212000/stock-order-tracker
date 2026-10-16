import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('manual sale-save path persists without a prerequisite buy check',()=>{
  const history=read('src/TradeHistoryPage.tsx')
  const model=read('src/manual-review-trades.ts')
  assert.doesNotMatch(history,/assertManualSaleCovered/)
  assert.doesNotMatch(model,/assertManualSaleCovered/)
  assert.match(history,/await addManualReviewTrade\(draft\)/)
  assert.match(history,/organizeGmailHistory\(updated\)\.unmatched\.find/)
  assert.match(history,/尚缺/)
})

test('unmatched sales appear in stock right column and count as sales',()=>{
  const history=read('src/TradeHistoryPage.tsx')
  const view=read('src/StockGroupedView.tsx')
  assert.match(history,/history\.sellCount/)
  assert.match(view,/group\.sells\.length\+group\.unmatched\.length/)
  assert.match(view,/group\.unmatched\.map/)
  assert.match(view,/grouped-pending-trade/)
  assert.match(view,/RowActions row=\{x\.row\}/)
  assert.match(view,/待配對 · 尚缺/)
  assert.doesNotMatch(view,/showUnmatched/)
})

test('unknown cost is not displayed as confirmed zero and PWA stores unchanged',()=>{
  const view=read('src/StockGroupedView.tsx')
  const db=read('src/db.ts')
  assert.match(view,/hasReliableSale\?\(group\.reliableGrossPnl/)
  assert.match(db,/const DB_VERSION = 4/)
  assert.match(db,/tx\.objectStore\('reviewTrades'\)\.add\(row\)/)
})
