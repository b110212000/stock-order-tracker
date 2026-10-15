import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const shell=readFileSync(new URL('../src/AppShell.css',import.meta.url),'utf8')
const legacy=readFileSync(new URL('../src/TradeHistoryPage.css',import.meta.url),'utf8')
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')

test('App shell fills the visual viewport without making the whole document scrollable',()=>{
  assert.match(shell,/\.app\.review-shell\s*\{[^}]*position:fixed;/)
  assert.match(shell,/\.app\.review-shell\s*\{[^}]*height:100dvh;/)
  assert.match(shell,/html,body,#root\s*\{[^}]*overflow:hidden;/)
})
test('only the main area scrolls between an anchored header and bottom navigation',()=>{
  assert.match(shell,/\.app\.review-shell \.review-app-header\s*\{[^}]*position:absolute;/)
  assert.match(shell,/\.app\.review-shell \.main\s*\{[^}]*top:var\(--ol-header-height\);[^}]*bottom:var\(--ol-bottom-height\);[^}]*overflow-y:auto;/)
  assert.match(shell,/\.app\.review-shell \.review-app-nav\s*\{[^}]*position:absolute;/)
  assert.match(shell,/\.app\.review-shell \.review-app-nav\s*\{[^}]*inset:auto 0 0;/)
  assert.match(app,/<header className="header review-app-header">/)
  assert.match(app,/<nav className="bottom-nav review-app-nav"/)
})
test('safe-area padding covers the iPhone notch and home indicator',()=>{
  assert.match(shell,/--ol-header-height:calc\(56px \+ env\(safe-area-inset-top,0px\)\)/)
  assert.match(shell,/--ol-bottom-height:calc\(62px \+ env\(safe-area-inset-bottom,0px\)\)/)
})
test('page titles are sticky, no leftover two-row Grid regression can override layout',()=>{
  assert.match(shell,/\.review-shell \.history-heading,[\s\S]*?\.review-shell \.settings-screen>h1\s*\{[^}]*position:sticky;/)
  assert.doesNotMatch(legacy,/\.review-shell\.app\s*\{[^}]*grid-template-rows:/)
})
