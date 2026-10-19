import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPendingCloudIdentity,signCloudDeviceRequest} from '../src/cloud-identity'
import {
  CLOUD_AUTH_DB_NAME,validStoredCloudDevice,
  savePendingCloudDevice,readCloudDevice,markCloudDeviceRegistered
} from '../src/cloud-device-storage'
import {base64UrlEncode,verifyDeviceProof} from '../backend/src/auth-primitives'

type FakeRequest<T> = {
  result:T
  onsuccess:(()=>void)|null
  onerror:(()=>void)|null
}
type FakeTransaction={
  oncomplete:(()=>void)|null
  onerror:(()=>void)|null
  onabort:(()=>void)|null
  aborted:boolean
  failed:boolean
  pending:number
  abort():void
  objectStore(name:string):{
    get(key:string):FakeRequest<unknown>
    add(value:unknown):FakeRequest<unknown>
    put(value:unknown):FakeRequest<unknown>
  }
}

/**
 * Minimal async IndexedDB double: schedules each request, fires transaction
 * completion only after pending requests settle, and never mutates other DBs.
 */
function createFakeIndexedDB(){
  const opens:string[]=[]
  const writes:unknown[]=[]
  let initialized=false
  let slot:unknown
  const storeNames={contains:(name:string)=>initialized&&name==='device-identities'}
  const db={
    objectStoreNames:storeNames,
    createObjectStore(name:string,{keyPath}:{keyPath:string}){
      assert.equal(name,'device-identities')
      assert.equal(keyPath,'slot')
      initialized=true
    },
    close(){},
    transaction(name:string,mode:IDBTransactionMode):FakeTransaction{
      assert.equal(name,'device-identities')
      const tx:FakeTransaction={
        oncomplete:null,onerror:null,onabort:null,
        aborted:false,failed:false,pending:0,
        abort(){tx.aborted=true;queueMicrotask(()=>tx.onabort?.())},
        objectStore(storeName:string){
          assert.equal(storeName,'device-identities')
          function request<T>(work:()=>T):FakeRequest<T>{
            tx.pending++
            const req:FakeRequest<T>={result:undefined as T,onsuccess:null,onerror:null}
            queueMicrotask(()=>{
              if(tx.aborted)return
              try{
                req.result=work()
                req.onsuccess?.()
              }catch{
                tx.failed=true
                req.onerror?.()
                tx.onerror?.()
                tx.aborted=true
                tx.onabort?.()
              }finally{
                tx.pending--
                queueMicrotask(()=>{
                  if(tx.pending===0&&!tx.aborted&&!tx.failed)tx.oncomplete?.()
                })
              }
            })
            return req
          }
          return {
            get(key:string){
              assert.equal(key,'active')
              return request(()=>slot===undefined?undefined:structuredClone(slot))
            },
            add(row:unknown){
              assert.equal(mode,'readwrite')
              return request(()=>{
                if(slot!==undefined)throw Error('ConstraintError')
                slot=structuredClone(row)
                writes.push(structuredClone(row))
                return 'active'
              })
            },
            put(row:unknown){
              assert.equal(mode,'readwrite')
              return request(()=>{
                slot=structuredClone(row)
                writes.push(structuredClone(row))
                return 'active'
              })
            }
          }
        }
      }
      return tx
    }
  }
  const factory={
    open(name:string,version:number){
      opens.push(name)
      assert.equal(version,1)
      const req:{
        result:typeof db
        onupgradeneeded:(()=>void)|null
        onsuccess:(()=>void)|null
        onerror:(()=>void)|null
      }={result:db,onupgradeneeded:null,onsuccess:null,onerror:null}
      queueMicrotask(()=>{
        if(!initialized)req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    }
  } as unknown as IDBFactory
  return {factory,opens,writes,getStored:()=>slot}
}

test('off-device recovery key acknowledgement is required before creating a key store',async()=>{
  const mem=createFakeIndexedDB()
  const draft=await createPendingCloudIdentity()
  await assert.rejects(
    ()=>savePendingCloudDevice(draft,false,mem.factory),
    /RECOVERY_BACKUP_REQUIRED/)
  assert.equal(mem.opens.length,0)
  assert.equal(mem.writes.length,0)
})

test('persisted nonextractable P-256 key can still sign after simulated PWA restart',async()=>{
  const mem=createFakeIndexedDB()
  const draft=await createPendingCloudIdentity()
  await savePendingCloudDevice(draft,true,mem.factory)
  const stored=await readCloudDevice(mem.factory)
  assert.ok(stored)
  assert.equal(stored.state,'pending')
  assert.equal(stored.userId,draft.userId)
  assert.equal(stored.deviceId,draft.deviceId)
  assert.equal(stored.privateKey.extractable,false)
  assert.equal(validStoredCloudDevice(stored),true)
  assert.equal(mem.opens.every(x=>x===CLOUD_AUTH_DB_NAME),true)
  assert.equal(JSON.stringify(mem.getStored()).includes(draft.recoveryKey),false)
  assert.equal('recoveryKey' in (mem.getStored() as object),false)
  assert.equal('privateJwk' in (mem.getStored() as object),false)
  const nonce=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const issuedAt=Date.now()
  const body=JSON.stringify({userId:stored.userId,deviceId:stored.deviceId})
  const proof=await signCloudDeviceRequest(
    stored,{nonce,issuedAt},{method:'POST',route:'/v1/auth/login',body}
  )
  assert.equal(await verifyDeviceProof(stored.publicJwk,proof.proof,proof.signature),true)
})

test('a second identity cannot silently replace a previously saved private key',async()=>{
  const mem=createFakeIndexedDB()
  const first=await createPendingCloudIdentity()
  const second=await createPendingCloudIdentity()
  await savePendingCloudDevice(first,true,mem.factory)
  await assert.rejects(
    ()=>savePendingCloudDevice(second,true,mem.factory),
    /CLOUD_IDENTITY_ALREADY_EXISTS_OR_STORAGE_FAILED/)
  const stored=await readCloudDevice(mem.factory)
  assert.equal(stored?.userId,first.userId)
  assert.equal(mem.writes.length,1)
})

test('registered marker only changes when matching user and device are confirmed',async()=>{
  const mem=createFakeIndexedDB()
  const identity=await createPendingCloudIdentity()
  await savePendingCloudDevice(identity,true,mem.factory)
  await assert.rejects(
    ()=>markCloudDeviceRegistered(crypto.randomUUID(),identity.deviceId,mem.factory),
    /CLOUD_IDENTITY_REGISTER_CONFIRMATION_FAILED/)
  assert.equal((await readCloudDevice(mem.factory))?.state,'pending')
  await markCloudDeviceRegistered(identity.userId,identity.deviceId,mem.factory)
  const stored=await readCloudDevice(mem.factory)
  assert.equal(stored?.state,'registered')
  assert.ok(stored?.registeredAt)
  assert.equal(stored?.privateKey.extractable,false)
  assert.equal('recoveryKey' in (mem.getStored() as object),false)
  await markCloudDeviceRegistered(identity.userId,identity.deviceId,mem.factory)
  assert.equal(mem.writes.length,2)
})

test('strictly reject extractable or corrupted private keys',async()=>{
  const draft=await createPendingCloudIdentity()
  const forged={slot:'active',userId:draft.userId,deviceId:draft.deviceId,
    publicJwk:draft.publicJwk,privateKey:draft.privateKey,
    recoveryVerifierSha256:draft.recoveryVerifierSha256,state:'pending',
    createdAt:new Date().toISOString(),registeredAt:null}
  assert.equal(validStoredCloudDevice(forged),true)
  assert.equal(validStoredCloudDevice({...forged,privateKey:{...draft.privateKey,extractable:true}}),false)
  assert.equal(validStoredCloudDevice({...forged,recoveryVerifierSha256:draft.recoveryKey}),false)
  assert.equal(validStoredCloudDevice({...forged,publicJwk:{...draft.publicJwk,d:'secret'}}),false)
  assert.equal(validStoredCloudDevice({...forged,state:'registered',registeredAt:null}),false)
})

test('existing trades IndexedDB, PWA UI and disabled APIs remain untouched',()=>{
  const storage=readFileSync(new URL('../src/cloud-device-storage.ts',import.meta.url),'utf8')
  const db=readFileSync(new URL('../src/db.ts',import.meta.url),'utf8')
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  const server=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.equal(CLOUD_AUTH_DB_NAME,'orderlead-cloud-auth')
  assert.match(db,/const DB_NAME = 'orderlead-local'/)
  const executable=storage.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')
  assert.doesNotMatch(executable,/orderlead-local|localStorage|sessionStorage|console\.log|console\.error/)
  assert.doesNotMatch(app,/from ['"].*cloud-device-storage/)
  assert.match(server,/AUTH_ROUTES_ENABLED==='true'/)
  assert.match(server,/AUTH_EDGE_PROTECTED==='true'/)
  assert.match(server,/SYNC_NOT_ENABLED/)
})
