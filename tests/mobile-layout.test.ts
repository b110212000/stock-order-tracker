import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=(name:string)=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8')
const dialog=source('ManualTradeDialog.tsx')
const modalCSS=source('ManualTradeDialog.css')
const backupCSS=source('BackupPanel.css')
const settingsCSS=source('SettingsPage.css')

test('add/edit transaction uses a body portal separate from viewport locked App shell',()=>{
  assert.match(dialog,/createPortal\(<div ref=\{overlayRef\}/)
  assert.match(dialog,/document\.body\)/)
  assert.match(modalCSS,/\.manual-overlay\.overlay\s*\{[^}]*z-index:100;/)
  assert.match(modalCSS,/\.manual-overlay \.manual-trade-dialog\.dialog\.form-dialog\s*\{/)
})
test('mobile transaction editor retains fixed header, internal scrolling and a visible save footer',()=>{
  assert.match(dialog,/className="manual-dialog-header"/)
  assert.match(dialog,/className="manual-fields-scroll"/)
  assert.match(dialog,/className="manual-dialog-footer"/)
  assert.match(modalCSS,/\.manual-overlay \.manual-trade-dialog form\s*\{[^}]*grid-template-rows:minmax\(0,1fr\) auto;/)
  assert.match(modalCSS,/\.manual-fields-scroll\s*\{[^}]*overflow-y:auto;/)
  assert.match(modalCSS,/@media\(max-width:600px\)\s*\{[\s\S]*?\.manual-overlay \.manual-trade-dialog\.dialog\.form-dialog\s*\{[^}]*height:100%;/)
  assert.match(modalCSS,/@media\(max-width:600px\)[\s\S]*?\.manual-fields-scroll \.two-fields\{grid-template-columns:minmax\(0,1fr\)/)
})
test('editor reacts to iPhone keyboard visual viewport and keeps date/time input fluid',()=>{
  assert.match(dialog,/window\.visualViewport/)
  assert.match(dialog,/viewport\?\.addEventListener\('resize',adjust\)/)
  assert.match(dialog,/viewport\?\.addEventListener\('scroll',adjust\)/)
  assert.match(modalCSS,/font-size:16px; \/\* iPhone Safari does not zoom/)
  assert.match(modalCSS,/min-width:0;/)
  assert.match(modalCSS,/env\(safe-area-inset-bottom,0px\)/)
})
test('backup buttons adapt at phone width; preview select and long content never exceed card',()=>{
  assert.match(backupCSS,/\.backup-actions,\.backup-inline\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(backupCSS,/@media\(max-width:520px\)\s*\{[\s\S]*?\.backup-actions,\.backup-inline\{grid-template-columns:minmax\(0,1fr\)/)
  assert.match(backupCSS,/\.backup-preview select\s*\{[^}]*width:100%;/)
  assert.match(backupCSS,/\.backup-prepared,\.backup-preview\s*\{[^}]*min-width:0;/)
  assert.match(settingsCSS,/\.settings-screen,\.settings-list,\.settings-share-content,\.settings-item\{min-width:0;max-width:100%\}/)
})
