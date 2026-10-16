import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  base64UrlEncode,bodyDigest,canonicalDeviceProof,compareVerifier,
  decode32ByteToken,isV4Uuid,newRecoveryKey,publicDeviceKeyIsValid,
  recoveryVerifier,validRecoveryKey,verifyDeviceProof
} from '../backend/src/auth-primitives'
import type {DeviceProof} from '../backend/src/auth-primitives'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const USER='2cab9306-3c2e-45c9-ab23-73d4e3ef344e'
const DEVICE='45ac96f5-2638-4a9f-8222-b49aa442403b'
function randomChallenge(){
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

test('user and device UUID are public identifiers, not authentication tokens',()=>{
  assert.ok(isV4Uuid(USER))
  assert.ok(isV4Uuid(DEVICE))
  assert.equal(isV4Uuid('123456'),false)
  assert.equal(isV4Uuid('00000000-0000-4000-0000-000000000000'),false)
  assert.equal(isV4Uuid('2CAB9306-3C2E-45C9-AB23-73D4E3EF344E'),false)
  assert.equal(validRecoveryKey(USER),false)
})

test('recovery key has 32 cryptographic random bytes, separate from the user UUID',async()=>{
  const key=newRecoveryKey()
  const other=newRecoveryKey()
  assert.equal(key.startsWith('olr1_'),true)
  assert.equal(key.length,48)
  assert.notEqual(key,other)
  assert.equal(validRecoveryKey(key),true)
  assert.equal(decode32ByteToken(key.slice(5))?.length,32)
  for(const weak of ['1234','olr1_123456','olr1_'+USER,key+'x'])assert.equal(validRecoveryKey(weak),false)
  const verifier=await recoveryVerifier(USER,key)
  assert.match(verifier,/^[0-9a-f]{64}$/)
  assert.equal(compareVerifier(verifier,await recoveryVerifier(USER,key)),true)
  assert.equal(compareVerifier(verifier,await recoveryVerifier(USER,other)),false)
  const otherUser='c8ce1c42-88db-4783-a4da-7d1b38a826aa'
  assert.notEqual(verifier,await recoveryVerifier(otherUser,key))
  await assert.rejects(()=>recoveryVerifier(USER,USER),/INVALID_CREDENTIAL_FORMAT/)
})

test('verifier equality rejects malformed values and changed digest bytes',()=>{
  const h='a'.repeat(64)
  assert.equal(compareVerifier(h,h),true)
  assert.equal(compareVerifier(h,'b'+h.slice(1)),false)
  assert.equal(compareVerifier('AAAA',h),false)
  assert.equal(compareVerifier('A'.repeat(64),h),false)
})

test('device proof binds signer to route, method, time, nonce and request body',async()=>{
  const pair=await crypto.subtle.generateKey(
    {name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const pub=await crypto.subtle.exportKey('jwk',pair.publicKey)
  assert.equal(publicDeviceKeyIsValid(pub),true)
  assert.equal(publicDeviceKeyIsValid({...pub,d:'not-allowed-private-part'}),false)
  assert.equal(publicDeviceKeyIsValid({...pub,crv:'P-384'}),false)
  const proof:DeviceProof={
    method:'POST',route:'/v1/devices/authorize',issuedAt:1760653800000,
    challenge:randomChallenge(),bodySha256:await bodyDigest('{"device":"'+DEVICE+'"}')
  }
  const raw=new TextEncoder().encode(canonicalDeviceProof(proof))
  const sig=base64UrlEncode(new Uint8Array(
    await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,raw)))
  assert.equal(await verifyDeviceProof(pub,proof,sig),true)
  assert.equal(await verifyDeviceProof(pub,{...proof,method:'GET'},sig),false)
  assert.equal(await verifyDeviceProof(pub,{...proof,route:'/v1/devices/delete'},sig),false)
  assert.equal(await verifyDeviceProof(pub,{...proof,issuedAt:proof.issuedAt+1},sig),false)
  assert.equal(await verifyDeviceProof(pub,{...proof,challenge:randomChallenge()},sig),false)
  assert.equal(await verifyDeviceProof(pub,{...proof,bodySha256:await bodyDigest('changed')},sig),false)
  assert.equal(await verifyDeviceProof(pub,proof,'bad-signature'),false)
  assert.equal(await verifyDeviceProof({...pub,d:'private-key-material'},proof,sig),false)
})

test('invalid challenge, route, body digest and time cannot create signed payload',async()=>{
  const digest=await bodyDigest('')
  const proof:DeviceProof={
    method:'POST',route:'/v1/devices',issuedAt:Date.now(),
    challenge:randomChallenge(),bodySha256:digest
  }
  assert.throws(()=>canonicalDeviceProof({...proof,challenge:'short'}),/INVALID_DEVICE_PROOF_FORMAT/)
  assert.throws(()=>canonicalDeviceProof({...proof,route:'https://other.example/v1/devices'}),/INVALID_DEVICE_PROOF_FORMAT/)
  assert.throws(()=>canonicalDeviceProof({...proof,bodySha256:'abc'}),/INVALID_DEVICE_PROOF_FORMAT/)
  assert.throws(()=>canonicalDeviceProof({...proof,issuedAt:NaN}),/INVALID_DEVICE_PROOF_FORMAT/)
  assert.match(digest,/^[0-9a-f]{64}$/)
})

test('D1 authentication tables are user-scoped, revocable, challenge-bound',()=>{
  const sql=readFileSync(new URL('../backend/migrations/0002_auth_credentials.sql',import.meta.url),'utf8')
  for(const name of ['account_recovery_verifiers','authorized_device_keys','auth_challenges'])
    assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS '+name))
  assert.match(sql,/PRIMARY KEY \(user_id, device_id\)/)
  assert.match(sql,/REFERENCES registered_devices\(user_id,device_id\)/)
  assert.match(sql,/FOREIGN KEY \(user_id\) REFERENCES account_users\(id\)/)
  assert.match(sql,/revoked_at TEXT/)
  assert.match(sql,/consumed_at TEXT/)
  assert.match(sql,/nonce_sha256 TEXT NOT NULL/)
  assert.match(sql,/CHECK \(expires_at > issued_at\)/)
  assert.doesNotMatch(sql,/INSERT INTO|DROP TABLE|REPLACE INTO/)
  assert.doesNotMatch(sql,/private_jwk|secret_key|recovery_key TEXT/)
})

test('no new registration or recovery routes are accessible before A-2-2',async()=>{
  const env:Env={DB:{prepare(){throw Error('Auth routes must not query D1')}}}
  for(const route of ['/v1/register','/v1/device/challenge','/v1/device/authorize','/v1/recover','/v1/sync']){
    for(const method of ['GET','POST','PUT','DELETE']){
      const res=await handleRequest(new Request('https://api.example.invalid'+route,{method}),env)
      assert.equal(res.status,503,route+' '+method)
      assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
})
