import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read=(file:string)=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const form=read('src/ManualTradeDialog.tsx')
const formCss=read('src/ManualTradeDialog.css')
const backupCss=read('src/BackupPanel.css')
const settingsCss=read('src/SettingsPage.css')

test('dialog is portaled out of fixed scrolling App shell and respects keyboard viewport',()=>{
 assert.match(form,/createPortal\(/)
 assert.match(form,/document\.body/)
 assert.match(form,/visualViewport/)
 assert.match(form,/viewport\.height/)
 assert.match(form,/manual-keyboard-open/)
 assert.match(formCss,/\.manual-overlay\.manual-keyboard-open \.manual-dialog-footer/)
})
test('dialog has scrollable fields and a separate fixed Save action inside visible screen',()=>{
 assert.match(form,/manual-fields-scroll/)
 assert.match(form,/manual-dialog-footer/)
 assert.match(formCss,/grid-template-rows:minmax\(0,1fr\) auto/)
 assert.match(formCss,/\.manual-fields-scroll\{[\s\S]*?overflow-y:auto;/)
 assert.match(formCss,/\.manual-dialog-footer \.primary\{[^}]*min-height:48px/)
})
test('mobile fields use width-aware two-column layouts with narrow-device single column fallback',()=>{
 for(const name of ['manual-date-row','manual-stock-row','manual-numeric-row'])
   assert.match(form,new RegExp(name))
 assert.match(formCss,/@media\(min-width:375px\) and \(max-width:600px\)/)
 assert.match(formCss,/@media\(max-width:374px\)/)
 assert.match(formCss,/\.manual-fields-scroll \.two-fields\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(formCss,/font-size:16px/)
})
test('backup actions remain a two-column grid on normal phones and stack only when very narrow',()=>{
 assert.match(backupCss,/\.backup-actions,\.backup-inline\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(backupCss,/@media\(max-width:355px\)\{[\s\S]*?\.backup-actions,\.backup-inline\{grid-template-columns:minmax\(0,1fr\)\}/)
 assert.doesNotMatch(backupCss,/@media\(max-width:520px\)\{[^}]*\.backup-actions,\.backup-inline\{grid-template-columns:minmax\(0,1fr\)/)
})
test('settings actions do not force card beyond available phone width',()=>{
 assert.match(settingsCss,/\.settings-item-label\{overflow-wrap:anywhere\}/)
 assert.match(settingsCss,/\.settings-action\{min-width:0;max-width:45%/)
 assert.match(settingsCss,/@media\(max-width:380px\)/)
})

test('trade fee fields remain inside scrolling phone form, not a fixed-height footer',()=>{
 assert.match(form,/manual-fees-row/)
 assert.match(form,/手續費（NT\$）/)
 assert.match(form,/交易稅（NT\$）/)
 assert.match(form,/draft\.fee/)
 assert.match(form,/draft\.tax/)
 assert.match(formCss,/\.manual-fields-scroll \.two-fields/)
})
