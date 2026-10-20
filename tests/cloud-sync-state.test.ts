import test from 'node:test'
import assert from 'node:assert/strict'
import {STORE_NAMES} from '../src/db'
import type {CloudBackupManifest} from '../src/cloud-backup-snapshot'
import {
  contentSignature,matchedCloudSync,readSyncMarker,rememberSyncMarker,
  SYNC_MARKER_KEY
} from '../src/cloud-sync-state'

const id='5cf9c735-df57-48a0-b73a-dd7a2b2ccc00'
const hash='a'.repeat(64)
function manifest():CloudBackupManifest{
  return {
    format:'orderlead-cloud-snapshot-v1',
    schema:1,exportedAt:'2026-10-20T01:00:00.000Z',appVersion:'1.22.6',
    sha256:hash,byteLength:1000,total:1,transactions:1,
    storeCounts:Object.fromEntries(STORE_NAMES.map(n=>[n,n==='reviewTrades'?1:0])) as CloudBackupManifest['storeCounts'],
    storeSha256:Object.fromEntries(STORE_NAMES.map(n=>[n,hash])) as CloudBackupManifest['storeSha256']
  }
}

test('content identity ignores export timestamp and App version but detects changed local row data',async()=>{
  const first=manifest()
  const sig=await contentSignature(first)
  assert.match(sig,/^[0-9a-f]{64}$/)
  assert.equal(await contentSignature({...first,
    exportedAt:'2030-01-01T12:00:00Z',appVersion:'9.9.9',sha256:'b'.repeat(64)
  }),sig)
  assert.notEqual(await contentSignature({...first,
    storeSha256:{...first.storeSha256,reviewTrades:'b'.repeat(64)}
  }),sig)
  assert.notEqual(await contentSignature({...first,
    storeCounts:{...first.storeCounts,reviewTrades:2}
  }),sig)
})

test('synced is only true for matching content AND server-listed verified backup ID',async()=>{
  const sig=await contentSignature(manifest())
  const marker={backupId:id,contentSignature:sig}
  assert.equal(matchedCloudSync(marker,sig,[id]),true)
  assert.equal(matchedCloudSync(null,sig,[id]),false)
  assert.equal(matchedCloudSync(marker,sig,[]),false)
  assert.equal(matchedCloudSync(marker,'b'.repeat(64),[id]),false)
  assert.equal(matchedCloudSync(marker,sig,['19a8f3a0-a1e0-4ab5-b481-fe1720363410']),false)
})

test('sync marker contains only backup UUID and content signature, no raw trading records',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const values=new Map<string,string>()
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(k:string)=>values.get(k)??null,
    setItem:(k:string,v:string)=>{values.set(k,v)}
  }})
  try{
    const signature=await contentSignature(manifest())
    rememberSyncMarker({backupId:id,contentSignature:signature})
    assert.deepEqual(readSyncMarker(),{backupId:id,contentSignature:signature})
    const stored=values.get(SYNC_MARKER_KEY)!
    assert.deepEqual(Object.keys(JSON.parse(stored)).sort(),['backupId','contentSignature'])
    assert.equal(stored.includes('reviewTrades'),false)
    assert.equal(stored.includes('price'),false)
    values.set(SYNC_MARKER_KEY,'{"backupId":"not-a-uuid","contentSignature":"raw personal text"}')
    assert.equal(readSyncMarker(),null)
  }finally{
    if(old)Object.defineProperty(globalThis,'localStorage',old)
    else Reflect.deleteProperty(globalThis,'localStorage')
  }
})

test('no browser storage is interpreted as unsynced, never a false positive',()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked')}})
  try{
    rememberSyncMarker({backupId:id,contentSignature:hash})
    assert.equal(readSyncMarker(),null)
    assert.equal(matchedCloudSync(readSyncMarker(),hash,[id]),false)
  }finally{
    if(old)Object.defineProperty(globalThis,'localStorage',old)
    else Reflect.deleteProperty(globalThis,'localStorage')
  }
})
