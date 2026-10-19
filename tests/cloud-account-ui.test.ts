import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const panel=readFileSync(new URL('../src/CloudAccountPanel.tsx',import.meta.url),'utf8')
const layout=readFileSync(new URL('../src/CloudAccountPanel.css',import.meta.url),'utf8')
const settings=readFileSync(new URL('../src/SettingsPage.tsx',import.meta.url),'utf8')
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))

test('Settings retains a collapsed cloud account entry and local backup controls',()=>{
  assert.match(settings,/const \[cloudOpen,setCloudOpen\]=useState\(false\)/)
  assert.match(settings,/雲端帳號/)
  assert.match(settings,/Email＋密碼登入 · 開發中/)
  assert.match(settings,/aria-expanded=\{cloudOpen\}/)
  assert.match(settings,/cloudOpen&&<div id="orderlead-cloud-account"><CloudAccountPanel\/>/)
  assert.match(settings,/backupOpen&&<BackupPanel version=\{version\}\/>/)
})

test('new Email-password decision is reflected without a fake working signup form',()=>{
  assert.match(panel,/Email＋密碼登入/)
  assert.match(panel,/信箱驗證/)
  assert.match(panel,/Email 安全重設忘記的密碼/)
  assert.match(panel,/雲端登入尚未開放/)
  assert.match(panel,/交易資料仍只存放在這台裝置/)
  assert.match(panel,/原有資料會保留/)
  assert.match(panel,/系統不會刪除或覆蓋它/)
  assert.doesNotMatch(panel,/createPendingCloudIdentity|savePendingCloudDevice/)
  assert.doesNotMatch(panel,/draft\.recoveryKey|password.*input|<input|<form/)
  assert.doesNotMatch(panel,/fetch\(|XMLHttpRequest|axios|new WebSocket/)
  assert.doesNotMatch(panel,/localStorage|sessionStorage|window\.location|console\.log|console\.error/)
  assert.doesNotMatch(panel,/deleteDatabase|\.clear\(|\.delete\(|replaceAll\(/)
})

test('mobile layout still uses narrow screen and current theme variables',()=>{
  assert.match(layout,/max-width:100%/)
  assert.match(layout,/min-width:0/)
  assert.match(layout,/overflow-wrap:anywhere/)
  assert.match(layout,/@container cloud-account/)
  assert.match(layout,/@media \(max-width:480px\)/)
  assert.match(layout,/var\(--surface\)/)
  assert.match(layout,/var\(--text\)/)
})

test('UX correction only bumps patch version, all public auth and backup routes remain disabled',async()=>{
  assert.match(app,/const VERSION='1\.21\.1'/)
  assert.equal(pkg.version,'1.21.1')
  const env:Env={DB:{prepare(){throw Error('must not touch remote D1')}}}
  for(const path of ['/v1/auth/email/register','/v1/auth/email/login',
    '/v1/auth/email/forgot-password','/v1/auth/email/reset-password',
    '/v1/auth/register','/v1/backups']){
    const res=await handleRequest(new Request('https://orderlead-api.example.invalid'+path,{method:'POST'}),env)
    assert.equal(res.status,503)
    assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
  }
})
