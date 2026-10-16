import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const manual=readFileSync(new URL('../src/ManualTradeDialog.css',import.meta.url),'utf8')
const backup=readFileSync(new URL('../src/BackupPanel.css',import.meta.url),'utf8')
const settings=readFileSync(new URL('../src/SettingsPage.css',import.meta.url),'utf8')
const dialog=readFileSync(new URL('../src/ManualTradeDialog.tsx',import.meta.url),'utf8')

test('normal iPhones use the original paired form; only narrow 320-374px screens stack fields',()=>{
  assert.match(manual,/@media\(max-width:374px\)/)
  assert.match(manual,/@media\(min-width:375px\) and \(max-width:479px\)\s*\{\s*\.manual-overlay \.manual-fields-scroll \.two-fields\s*\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(manual,/@media\(min-width:480px\) and \(max-width:600px\)\s*\{\s*\.manual-overlay \.manual-fields-scroll \.two-fields\s*\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  // Guard against v1.18.1's single-column override inside the 375-479px band.
  const compactOverride=manual.split('@media(max-width:479px){').at(-1)?.split('@media(min-width:375px)')[0]
  assert.ok(compactOverride)
  assert.doesNotMatch(compactOverride,/grid-template-columns:minmax\(0,1fr\)/)
  for(const field of ['manual-date-row','manual-stock-row','manual-numeric-row','manual-fees-row'])
    assert.match(dialog,new RegExp(field))
})
test('iPhone native picker inputs fit paired columns without hiding controls',()=>{
  assert.match(manual,/\.manual-overlay \.manual-trade-dialog \.manual-fields-scroll :is\(input,select\)\s*\{[^}]*max-inline-size:100%/)
  assert.match(manual,/\.manual-overlay \.manual-trade-dialog \.manual-fields-scroll \.manual-date-row :is\(input\[type=date\],input\[type=time\]\)\s*\{[^}]*padding-inline:6px/)
  assert.match(manual,/input::-webkit-datetime-edit\s*\{[^}]*min-width:0/)
  assert.match(manual,/font-size:16px/)
})

test('editor keeps save outside independently scrollable fields and follows keyboard viewport',()=>{
  assert.match(dialog,/manual-fields-scroll/)
  assert.match(dialog,/manual-dialog-footer/)
  assert.ok(dialog.indexOf('manual-fields-scroll')<dialog.indexOf('<footer className="manual-dialog-footer">'))
  assert.match(dialog,/window\.visualViewport/)
  assert.match(dialog,/viewport\?\.addEventListener\('resize',adjust\)/)
  assert.match(manual,/\.manual-fields-scroll\s*\{[^}]*overflow-y:auto/)
  assert.match(manual,/\.manual-dialog-footer\s*\{[^}]*padding:/)
  assert.match(manual,/@media\(max-height:430px\)/)
})
test('backup controls stack on phones and also respond to the actual card width',()=>{
  assert.match(backup,/container:orderlead-backup\s*\/\s*inline-size/)
  assert.match(backup,/@container orderlead-backup \(max-width:390px\)/)
  assert.match(backup,/@media\(max-width:480px\)/)
  assert.match(backup,/\.backup-panel \.backup-actions,[\s\S]*?\.backup-panel \.backup-inline\s*\{grid-template-columns:minmax\(0,1fr\)/)
})
test('backup previews and settings cards never force a horizontal page scroll',()=>{
  assert.match(backup,/\.backup-panel \.backup-preview,[\s\S]*?overflow-wrap:anywhere/)
  assert.match(settings,/\.settings-screen,\.settings-screen \.settings-list\s*\{[^}]*overflow-x:clip/)
})

test('native iOS date/time pickers no longer participate in grid intrinsic sizing',()=>{
  assert.match(dialog,/manual-picker-shell/)
  assert.match(dialog,/manual-picker-display/)
  assert.match(dialog,/type="date" aria-label="成交日期"/)
  assert.match(dialog,/type="time" aria-label="成交時間（選填）"/)
  assert.match(dialog,/draft\.time\|\|'選填'/)
  assert.match(manual,/\.manual-picker-shell\s*\{[^}]*position:relative;/)
  assert.match(manual,/\.manual-picker-shell :is\(input\[type=date\],input\[type=time\]\)\s*\{[^}]*position:absolute;/)
  assert.match(manual,/\.manual-picker-shell :is\(input\[type=date\],input\[type=time\]\)\s*\{[^}]*opacity:0;/)
  assert.match(manual,/\.manual-picker-shell:focus-within/)
})
test('recurring is an explicit choice and time input can remain empty',()=>{
  assert.match(dialog,/<option value="recurring">定期定額<\/option>/)
  assert.match(dialog,/date:localDate\(\),time:''/)
  assert.match(dialog,/editing\.timeDefaulted\?'':editing\.time\.slice\(0,5\)/)
  assert.doesNotMatch(dialog,/type="time"[^>]*required/)
  assert.doesNotMatch(dialog,/10:45/)
})
