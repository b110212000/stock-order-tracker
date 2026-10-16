import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const manual=readFileSync(new URL('../src/ManualTradeDialog.css',import.meta.url),'utf8')
const backup=readFileSync(new URL('../src/BackupPanel.css',import.meta.url),'utf8')
const settings=readFileSync(new URL('../src/SettingsPage.css',import.meta.url),'utf8')
const dialog=readFileSync(new URL('../src/ManualTradeDialog.tsx',import.meta.url),'utf8')

test('compact phones use one field per row instead of clipping iOS date and time inputs',()=>{
  assert.match(manual,/@media\(max-width:479px\)[\s\S]*?\.manual-overlay \.manual-fields-scroll \.two-fields\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/)
  assert.match(manual,/@media\(min-width:480px\) and \(max-width:600px\)/)
  assert.match(manual,/\.manual-overlay \.manual-trade-dialog \.manual-fields-scroll :is\(input,select\)\s*\{[^}]*max-inline-size:100%/)
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
