import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  createRecoverySecret, recoveryVerifier, encodeUrl64, decodeUrl64,
  isUuidV4, createDeviceSigningKeys, deviceProofMessage, verifyDeviceProof
} from '../backend/src/identity-crypto'
import {handleRequest} from '../backend/src/index'

const userId='a33414b8-12f0-41cb-85d6-d9d2ea7b3979'
const deviceId='316260a6-9c97-4519-afd5-dae77451e13d'
function bytes(value:string):Uint8Array{return new TextEncoder().encode(value)}
function buffer(value:Uint8Array):ArrayBuffer{
  const result=new Uint8Array(value.length)
  result.set(value)
  return result.buffer
}

test('UUIDs are identifiers, strict UUIDv4 only, never credentials',()=>{
  assert.equal(isUuidV4(userId),true)
  assert.equal(isUuidV4(deviceId),true)
  for(const id of ['', '1234',userId.toUpperCase(),
    'a33414b8-12f0-11cb-85d6-d9d2ea7b3979',
    'a33414b8-12f0-41cb-05d6-d9d2ea7b3979']){
    assert.equal(isUuidV4(id),false)
  }
})

test('recovery key has 256 random bits, canonical base64url and a server-only HMAC verifier',async()=>{
  const a=createRecoverySecret()
  const b=createRecoverySecret()
  assert.equal(a.length,43)
  assert.notEqual(a,b)
  assert.equal(decodeUrl64(a,32)?.length,32)
  assert.equal(decodeUrl64(a,16),null)
  assert.equal(decodeUrl64(a+'=',32),null)
  assert.equal(decodeUrl64(a.slice(0,-1)+'!',32),null)
  assert.equal(decodeUrl64('____',3)?.length,3)
  const pepper='REDACTED_EXAMPLE_PEPPER_NOT_A_REAL_SECRET_123456'
  const one=await recoveryVerifier(a,pepper)
  assert.equal(one.length,43)
  assert.equal(one,await recoveryVerifier(a,pepper))
  assert.notEqual(one,await recoveryVerifier(b,pepper))
  assert.notEqual(one,await recoveryVerifier(a,pepper+'2'))
  assert.throws(()=>recoveryVerifier('short',pepper))
  await assert.rejects(()=>recoveryVerifier(a,'short'),/pepper/)
})

test('private device signing key is non-extractable and public key verifies exactly signed HTTP fields',async()=>{
  const {privateKey,publicKeySpki}=await createDeviceSigningKeys()
  assert.equal(privateKey.extractable,false)
  await assert.rejects(crypto.subtle.exportKey('pkcs8',privateKey))
  const now=Math.floor(Date.now()/1000)
  const unsigned={
    userId,deviceId,method:'POST',
    pathAndQuery:'/v1/auth/devices?mode=bind',
    timestampSec:now,
    nonce:encodeUrl64(crypto.getRandomValues(new Uint8Array(16))),
    body:bytes('{"newDevice":"test"}')
  }
  const signature=encodeUrl64(new Uint8Array(await crypto.subtle.sign(
    {name:'ECDSA',hash:'SHA-256'},privateKey,buffer(await deviceProofMessage(unsigned)))))
  const valid={...unsigned,signature}
  assert.equal(signature.length,86)
  assert.equal(await verifyDeviceProof(valid,publicKeySpki,now),true)
  assert.equal(await verifyDeviceProof({...valid,body:bytes('{"newDevice":"OTHER"}')},publicKeySpki,now),false)
  assert.equal(await verifyDeviceProof({...valid,method:'GET'},publicKeySpki,now),false)
  assert.equal(await verifyDeviceProof({...valid,pathAndQuery:'/v1/auth/devices'},publicKeySpki,now),false)
  assert.equal(await verifyDeviceProof({...valid,deviceId:userId},publicKeySpki,now),false)
  assert.equal(await verifyDeviceProof({...valid,nonce:encodeUrl64(crypto.getRandomValues(new Uint8Array(16)))},publicKeySpki,now),false)
  assert.equal(await verifyDeviceProof(valid,publicKeySpki,now+121),false)
  assert.equal(await verifyDeviceProof(valid,publicKeySpki,now-121),false)
  assert.equal(await verifyDeviceProof({...valid,signature:'!!'},publicKeySpki,now),false)
  assert.equal(await verifyDeviceProof(valid,'garbage',now),false)
  const other=await createDeviceSigningKeys()
  assert.equal(await verifyDeviceProof(valid,other.publicKeySpki,now),false)
})

test('HTTP routes are still locked: a UUID or signed device is not auto-authorized',async()=>{
  const mocked={DB:{prepare(){return {async first<T>():Promise<T|null>{return {healthy:1} as T}}}}}
  for(const path of ['/v1/auth/register','/v1/auth/recover','/v1/auth/devices','/v1/sync/push']){
    for(const method of ['GET','POST','PUT','DELETE']){
      const res=await handleRequest(new Request('https://api.invalid'+path,{method,headers:{'X-User-Id':userId,'X-Device-Id':deviceId}}),mocked)
      assert.equal(res.status,503)
      assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
})

test('A-2 D1 migration scopes credentials, one-use nonces and pairing to a single owner',()=>{
  const sql=readFileSync(new URL('../backend/migrations/0002_identity_credentials.sql',import.meta.url),'utf8')
  for(const name of ['recovery_credentials','device_credentials','device_request_nonces','device_pairing_requests','auth_rate_limits']){
    assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS '+name))
  }
  assert.match(sql,/PRIMARY KEY \(user_id,device_id,nonce\)/)
  assert.match(sql,/PRIMARY KEY \(user_id,device_id\)/)
  assert.match(sql,/FOREIGN KEY \(user_id,device_id\)/)
  assert.match(sql,/FOREIGN KEY \(user_id,approved_by_device_id\)/)
  assert.match(sql,/CHECK \(state IN \('active','revoked'\)\)/)
  assert.match(sql,/length\(verifier\)=43/)
  assert.match(sql,/expires_at INTEGER/)
  assert.match(sql,/consumed_at INTEGER/)
  assert.doesNotMatch(sql,/INSERT INTO|DROP TABLE|REPLACE INTO/)
  const docs=readFileSync(new URL('../backend/IDENTITY_SECURITY.md',import.meta.url),'utf8')
  assert.match(docs,/不能.*以 Device ID 單獨復原/)
  assert.match(docs,/Cloudflare Worker Secret/)
  assert.match(docs,/503 SYNC_NOT_ENABLED/)
  assert.match(docs,/IndexedDB/)
})
