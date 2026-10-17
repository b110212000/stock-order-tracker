import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {STORE_NAMES} from '../src/db'
import {buildBackup} from '../src/backup-data'
import type {BackupStores} from '../src/backup-data'
import type {StagedTrade} from '../src/types'
import {
  CLOUD_BACKUP_FORMAT,buildCloudBackupSnapshot,
  verifyCloudBackupSnapshot
} from '../src/cloud-backup-snapshot'

const empty=():BackupStores=>
  Object.fromEntries(STORE_NAMES.map(x=>[x,[]])) as BackupStores
function example(id:string):StagedTrade{
  return {
    id,symbol:'2330',name:'台積電',date:'2026-10-17',time:'10:45:00',
    side:'buy',quantity:10,price:1500,gross:15000,fee:null,tax:null,
    orderId:'manual',status:'pending',createdAt:'2026-10-17T03:00:00Z',
    importedAt:'2026-10-17T03:00:00Z',recurring:true,timeDefaulted:true
  }
}
function populated():BackupStores{
  const stores=empty()
  stores.reviewTrades=[example('manual:b'),{...example('manual:a'),price:1000,gross:10000}]
  stores.imports=[example('legacy:a')]
  stores.stocks=[{symbol:'2330',name:'台積電',group:'半導體',note:'不需上傳公開 GitHub',
    createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z'}]
  stores.quotes=[{symbol:'2330',price:1500,asOf:'2026-10-17'}]
  stores.trades=[{id:'legacy',symbol:'2330',side:'buy',date:'2024-01-01',quantity:3,
    price:300,fee:1,tax:0,note:'保留來源',createdAt:'2024-01-01T00:00:00Z'}]
  stores.cashflows=[{id:'flow-1',date:'2026-10-17',type:'deposit',amount:15000,note:'手動'}]
  stores.alerts=[{id:'alert-1',symbol:'2330',direction:'above',target:1600,enabled:true,lastMet:false}]
  stores.snapshots=[{id:'snap-1',date:'2026-10-17',equity:16000,cumulativeNetDeposits:15000,
    capturedAt:'2026-10-17T12:00:00Z'}]
  stores.analyses=[{id:'analysis-1',symbol:'2330',asOf:'2026-10-17',
    rating:'續抱',demand:'',orders:'',ramp:'',capacity:'',peers:'',institutions:'',
    invalidation:'',sources:'',updatedAt:'2026-10-17T12:00:00Z'}]
  return stores
}

test('first cloud snapshot includes all nine stores and retains all trade fields',async()=>{
  const input=buildBackup(populated(),'1.20.0')
  const result=await buildCloudBackupSnapshot(input)
  assert.equal(result.manifest.format,CLOUD_BACKUP_FORMAT)
  assert.equal(result.manifest.schema,1)
  assert.equal(Object.keys(result.manifest.storeCounts).length,9)
  assert.equal(result.manifest.total,10)
  assert.equal(result.manifest.transactions,2)
  assert.equal(result.manifest.storeCounts.reviewTrades,2)
  assert.equal(result.manifest.storeCounts.imports,1)
  assert.match(result.manifest.sha256,/^[a-f0-9]{64}$/)
  assert.ok(result.manifest.byteLength>0)
  const payload=JSON.parse(result.canonicalPayload)
  assert.deepEqual(Object.keys(payload.stores).sort(),[...STORE_NAMES].sort())
  const row=payload.stores.reviewTrades.find((x:StagedTrade)=>x.id==='manual:b')
  assert.equal(row.recurring,true)
  assert.equal(row.timeDefaulted,true)
  assert.equal(row.fee,null)
  assert.equal(payload.stores.stocks[0].note,'不需上傳公開 GitHub')
  assert.equal(await verifyCloudBackupSnapshot(result.canonicalPayload,result.manifest),true)
})

test('same records in different table order / insertion order hash identically',async()=>{
  const source=buildBackup(populated(),'1.20.0')
  const one=await buildCloudBackupSnapshot(source)
  const reordered=JSON.parse(JSON.stringify(source))
  reordered.stores.reviewTrades.reverse()
  reordered.stores.stocks[0]={
    updatedAt:reordered.stores.stocks[0].updatedAt,
    note:reordered.stores.stocks[0].note,
    symbol:reordered.stores.stocks[0].symbol,
    group:reordered.stores.stocks[0].group,
    name:reordered.stores.stocks[0].name,
    createdAt:reordered.stores.stocks[0].createdAt
  }
  const two=await buildCloudBackupSnapshot(reordered)
  assert.equal(one.canonicalPayload,two.canonicalPayload)
  assert.equal(one.manifest.sha256,two.manifest.sha256)
  assert.deepEqual(one.manifest.storeSha256,two.manifest.storeSha256)
  assert.equal(source.stores.reviewTrades[0].id,'manual:b')
})

test('tampering one trade or field, count, checksum or payload ordering fails verification',async()=>{
  const source=buildBackup(populated(),'1.20.0')
  const {canonicalPayload,manifest}=await buildCloudBackupSnapshot(source)
  const parsed=JSON.parse(canonicalPayload)
  parsed.stores.reviewTrades[0].price+=100
  assert.equal(await verifyCloudBackupSnapshot(JSON.stringify(parsed),manifest),false)
  assert.equal(await verifyCloudBackupSnapshot(canonicalPayload,{...manifest,total:manifest.total+1}),false)
  assert.equal(await verifyCloudBackupSnapshot(canonicalPayload,{
    ...manifest,storeCounts:{...manifest.storeCounts,reviewTrades:99}
  }),false)
  assert.equal(await verifyCloudBackupSnapshot(canonicalPayload,{
    ...manifest,storeSha256:{...manifest.storeSha256,reviewTrades:'0'.repeat(64)}
  }),false)
  assert.equal(await verifyCloudBackupSnapshot(canonicalPayload,{
    ...manifest,sha256:'0'.repeat(64)
  }),false)
  assert.equal(await verifyCloudBackupSnapshot(canonicalPayload.replace('manual:a','manual:z'),manifest),false)
})

test('reject incomplete nine-table snapshot, duplicate ID and malformed record',async()=>{
  const current=buildBackup(populated(),'1.20.0')
  const incomplete=JSON.parse(JSON.stringify(current))
  delete incomplete.stores.quotes
  await assert.rejects(()=>buildCloudBackupSnapshot(incomplete),/數量不正確/)
  const duplicate=JSON.parse(JSON.stringify(current))
  duplicate.stores.reviewTrades.push(duplicate.stores.reviewTrades[0])
  await assert.rejects(()=>buildCloudBackupSnapshot(duplicate),/重複/)
  const malformed=JSON.parse(JSON.stringify(current))
  malformed.stores.reviewTrades[0].quantity=-10
  await assert.rejects(()=>buildCloudBackupSnapshot(malformed),/不完整/)
})

test('an empty or >25MB snapshot cannot be called a completed initial backup',async()=>{
  await assert.rejects(()=>buildCloudBackupSnapshot(buildBackup(empty(),'1.20.0')),/空白資料/)
  const tooLarge=populated()
  tooLarge.stocks[0]={...tooLarge.stocks[0],note:'x'.repeat(25*1024*1024)}
  await assert.rejects(
    ()=>buildCloudBackupSnapshot(buildBackup(tooLarge,'1.20.0')),
    /超過 25 MB/
  )
})

test('new cloud schema is strictly owner-scoped and never drops local or remote data',()=>{
  const sql=readFileSync(new URL('../backend/migrations/0003_first_cloud_backup.sql',import.meta.url),'utf8')
  for(const table of ['cloud_backup_snapshots','cloud_backup_entries']){
    assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS '+table))
  }
  for(const name of STORE_NAMES)assert.ok(sql.includes("'"+name+"'"))
  assert.match(sql,/PRIMARY KEY \(user_id,backup_id\)/)
  assert.match(sql,/PRIMARY KEY \(user_id,backup_id,store_name,record_key\)/)
  assert.match(sql,/FOREIGN KEY \(user_id\) REFERENCES account_users\(id\)/)
  assert.match(sql,/status='verified' AND verified_at IS NOT NULL/)
  assert.doesNotMatch(sql,/^\s*(?:DROP|TRUNCATE|DELETE|INSERT|REPLACE|UPDATE)\s/mi)
})

test('new snapshot generation is not wired to public /v1 endpoints or live App',()=>{
  const server=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  assert.doesNotMatch(server,/cloud-backup-snapshot|cloud_backup_snapshots/)
  assert.doesNotMatch(app,/cloud-backup-snapshot|prepareLocalCloudBackup/)
  assert.match(server,/SYNC_NOT_ENABLED/)
})
