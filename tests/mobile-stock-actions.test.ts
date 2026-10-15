import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const css=readFileSync(new URL('../src/StockGroupedView.css',import.meta.url),'utf8')
const view=readFileSync(new URL('../src/StockGroupedView.tsx',import.meta.url),'utf8')
test('mobile edit/delete and date span remain visible despite legacy hide-all-spans rule',()=>{
  assert.match(css,/\.grouped-trade-meta span\{display:none\}/)
  assert.match(css,/\.grouped-trade-meta>span:first-child\s*\{[^}]*display:block;/)
  assert.match(css,/\.grouped-trade-meta \.grouped-trade-actions\s*\{[^}]*display:flex;/)
  assert.match(css,/min-width:36px;/)
})
test('buy, sell and unmatched entries show the same transaction edit and delete controls',()=>{
  assert.match(view,/function RowActions/)
  assert.match(view,/aria-label=\{'編輯/)
  assert.match(view,/aria-label=\{'刪除/)
  assert.match(view,/onEdit=\{onEdit\} onDelete=\{onDelete\}/)
  assert.match(css,/@media\(max-width:360px\)/)
})
