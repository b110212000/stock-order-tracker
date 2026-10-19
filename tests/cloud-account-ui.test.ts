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

test('Settings has a collapsed cloud-account entry that mounts only on explicit expansion',()=>{
  assert.match(settings,/const \[cloudOpen,setCloudOpen\]=useState\(false\)/)
  assert.match(settings,/雲端帳號/)
  assert.match(settings,/本機金鑰準備 · 雲端尚未開放/)
  assert.match(settings,/aria-expanded=\{cloudOpen\}/)
  assert.match(settings,/cloudOpen&&<div id="orderlead-cloud-account"><CloudAccountPanel\/>/)
  assert.match(settings,/aria-controls="orderlead-cloud-account"/)
  assert.match(settings,/backupOpen&&<BackupPanel version=\{version\}\/>/)
  assert.match(app,/<SettingsPage/)
})

test('the client never claims successful cloud registration or cloud backup',()=>{
  assert.match(panel,/尚未建立雲端帳號/)
  assert.match(panel,/雲端登入與交易上傳尚未開放/)
  assert.match(panel,/待連線註冊/)
  assert.match(panel,/本機設備金鑰已安全保存，但尚未建立雲端帳號，也沒有備份任何交易/)
  assert.doesNotMatch(panel,/fetch\(|XMLHttpRequest|axios|new WebSocket|云端備份成功|雲端備份成功/)
  const executable=panel.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')
  assert.doesNotMatch(executable,/localStorage|sessionStorage|window\.location|console\.log|console\.error/)
  assert.doesNotMatch(panel,/markCloudDeviceRegistered|clearAll\(|replaceAll\(|DELETE FROM/)
})

test('recovery key exists only as transient draft before explicit off-device confirmation',()=>{
  assert.match(panel,/createPendingCloudIdentity\(\)/)
  assert.match(panel,/readCloudDevice\(\)/)
  assert.match(panel,/draft\.recoveryKey/)
  assert.match(panel,/draft\.userId/)
  assert.match(panel,/acknowledged&&|!acknowledged/)
  assert.match(panel,/savePendingCloudDevice\(draft,true\)/)
  assert.match(panel,/setDraft\(null\)/)
  assert.match(panel,/我已將/)
  assert.match(panel,/保存到此裝置以外/)
  assert.match(panel,/取消，不儲存/)
  assert.match(panel,/剪貼簿內容可能被其他 App 讀取/)
  // No recovery secret is supplied to the storage API and there is
  // no navigation handler that transmits it to a remote endpoint.
  assert.doesNotMatch(panel,/savePendingCloudDevice\(draft\.recoveryKey/)
})

test('existing or damaged identity never allows silent overwrite or regeneration',()=>{
  assert.match(panel,/loadState!=='empty'/)
  assert.match(panel,/const existing=await readCloudDevice\(\)/)
  assert.match(panel,/setLoadState\('existing'\)/)
  assert.match(panel,/無法讀取本機設備金鑰/)
  assert.doesNotMatch(panel,/deleteDatabase|\.clear\(|\.delete\(|markCloudDeviceRegistered/)
})

test('mobile layout is width-safe and light-dark theme reuses app variables',()=>{
  assert.match(layout,/max-width:100%/)
  assert.match(layout,/min-width:0/)
  assert.match(layout,/overflow-wrap:anywhere/)
  assert.match(layout,/@container cloud-account/)
  assert.match(layout,/@media \(max-width:480px\)/)
  assert.match(layout,/var\(--surface\)/)
  assert.match(layout,/var\(--text\)/)
  assert.match(layout,/min-height:44px/)
})

test('new visible feature gets minor version bump, backend trade routes stay unavailable',async()=>{
  assert.match(app,/const VERSION='1\.21\.0'/)
  assert.equal(pkg.version,'1.21.0')
  const db={prepare(){throw Error('should not touch financial D1')}}
  const env:Env={DB:db}
  for(const path of ['/v1/auth/register','/v1/auth/login','/v1/backups','/v1/sync']){
    const response=await handleRequest(new Request('https://example.invalid'+path),env)
    assert.equal(response.status,503)
    assert.deepEqual(await response.json(),{error:'SYNC_NOT_ENABLED'})
  }
})
