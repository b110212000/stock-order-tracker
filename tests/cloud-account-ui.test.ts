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

test('Settings keeps local backup and opens cloud account for verification deep links',()=>{
  assert.match(settings,/cloudOpen,setCloudOpen/)
  assert.match(settings,/email-verify\|reset-password/)
  assert.match(settings,/雲端帳號/)
  assert.match(settings,/Email 登入 · 備份／還原/)
  assert.match(settings,/aria-expanded=\{cloudOpen\}/)
  assert.match(settings,/CloudAccountPanel version=\{version\}/)
  assert.match(settings,/backupOpen&&<BackupPanel version=\{version\}/)
})

test('Email forms, verified cloud upload and optional restore are wired, never storing a raw bearer token',()=>{
  assert.match(panel,/Email 登入/)
  assert.match(panel,/readCloudSession\(\)/)
  assert.match(panel,/rememberCloudSession\(newSession\)/)
  assert.match(panel,/forgetCloudSession\(\)/)
  assert.match(panel,/\/v1\/auth\/email\/me/)
  assert.match(panel,/已登入：\{verifiedEmail\}/)
  assert.match(panel,/checkingSession/)
  assert.match(panel,/長期未使用，請重新登入/)
  assert.match(panel,/forgot-password/)
  assert.match(panel,/reset-password/)
  assert.match(panel,/email-verify/)
  assert.match(panel,/minLength=\{5\}/)
  assert.match(panel,/密碼至少 5 字元/)
  assert.match(panel,/value\.error==='INVALID_OR_EXPIRED_LINK'/)
  assert.match(panel,/Email 或密碼格式不正確/)
  assert.match(panel,/SYNC_NOT_ENABLED/)
  assert.match(panel,/SIGNUP_STORAGE/)
  assert.match(panel,/MAIL_BINDING/)
  assert.doesNotMatch(panel,/Cloudflare 雲端服務尚未開放/)
  assert.doesNotMatch(panel,/輸入或驗證連結無效/)
  assert.doesNotMatch(panel,/minLength=\{12\}/)
  assert.ok(panel.includes('prepareLocalCloudBackup(version)'))
  assert.ok(panel.includes("syncState==='syncing'?'同步中…'"))
  assert.ok(panel.includes("syncState==='synced'?'已同步':'未同步'"))
  assert.ok(panel.includes('rememberSyncMarker('))
  assert.ok(panel.includes('matchedCloudSync('))
  assert.doesNotMatch(panel,/正在準備九張資料表/)
  assert.doesNotMatch(panel,/正在上傳 /)
  assert.doesNotMatch(panel,/雲端備份完成，已驗證 /)
  assert.match(panel,/planFirstCloudUpload\(/)
  assert.match(panel,/verifyCloudBackupSnapshot\(/)
  assert.match(panel,/restoreLocalData\(/)
  assert.match(panel,/merge/)
  assert.match(panel,/window\.prompt/)
  assert.doesNotMatch(panel,/createPendingCloudIdentity|savePendingCloudDevice/)
  assert.doesNotMatch(panel,/localStorage|sessionStorage|console\.log|console\.error/)
  assert.doesNotMatch(panel,/deleteDatabase|replaceAll\(/)
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

test('v1.22.6 adds offline UI while production auth and backup routes stay disabled by default',async()=>{
  assert.match(app,/const VERSION='1\.22\.6'/)
  assert.equal(pkg.version,'1.22.6')
  const env:Env={DB:{prepare(){throw Error('must not touch remote D1')}}}
  for(const path of ['/v1/auth/email/register','/v1/auth/email/login',
    '/v1/auth/email/forgot-password','/v1/auth/email/reset-password',
    '/v1/auth/register','/v1/backups']){
    const res=await handleRequest(new Request('https://orderlead-api.example.invalid'+path,{method:'POST'}),env)
    assert.equal(res.status,503)
    assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
  }
})
