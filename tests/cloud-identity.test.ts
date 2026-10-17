import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  createPendingCloudIdentity,signCloudDeviceRequest
} from '../src/cloud-identity'
import {
  base64UrlEncode,isV4Uuid,publicDeviceKeyIsValid,
  recoveryVerifier,verifyDeviceProof
} from '../backend/src/auth-primitives'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

test('first installation produces separate randomized UUID v4 identifiers and 256-bit backup key',async()=>{
  const first=await createPendingCloudIdentity()
  const second=await createPendingCloudIdentity()
  assert.equal(isV4Uuid(first.userId),true)
  assert.equal(isV4Uuid(first.deviceId),true)
  assert.notEqual(first.userId,first.deviceId)
  assert.notEqual(first.userId,second.userId)
  assert.notEqual(first.deviceId,second.deviceId)
  assert.notEqual(first.recoveryKey,second.recoveryKey)
  assert.equal(first.recoveryKey.startsWith('olr1_'),true)
  assert.equal(first.recoveryKey.length,48)
  assert.match(first.recoveryVerifierSha256,/^[0-9a-f]{64}$/)
  assert.equal(
    first.recoveryVerifierSha256,await recoveryVerifier(first.userId,first.recoveryKey))
  assert.notEqual(first.recoveryVerifierSha256,first.recoveryKey)
  assert.equal(JSON.stringify({
    userId:first.userId,deviceId:first.deviceId,publicJwk:first.publicJwk,
    recoveryVerifierSha256:first.recoveryVerifierSha256
  }).includes(first.recoveryKey),false)
})

test('device signing private key is non-exportable, while public key is valid ECDSA P-256',async()=>{
  const identity=await createPendingCloudIdentity()
  assert.equal(identity.privateKey.extractable,false)
  assert.equal(identity.privateKey.type,'private')
  assert.equal(identity.publicJwk.kty,'EC')
  assert.equal(identity.publicJwk.crv,'P-256')
  assert.equal(identity.publicJwk.d,undefined)
  assert.equal(publicDeviceKeyIsValid(identity.publicJwk),true)
  await assert.rejects(
    ()=>crypto.subtle.exportKey('jwk',identity.privateKey),
    /extract|InvalidAccess|key is not extractable/i)
})

test('device challenge signature verifies only for unchanged route/method/body/nonce/time',async()=>{
  const identity=await createPendingCloudIdentity()
  const issuedAt=Date.now()
  const nonce=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const body=JSON.stringify({userId:identity.userId,deviceId:identity.deviceId})
  const result=await signCloudDeviceRequest(identity,{nonce,issuedAt},{
    method:'POST',route:'/v1/auth/login',body
  })
  assert.equal(result.proof.bodySha256.length,64)
  assert.equal(await verifyDeviceProof(identity.publicJwk,result.proof,result.signature),true)
  assert.equal(await verifyDeviceProof(identity.publicJwk,{...result.proof,method:'GET'},result.signature),false)
  assert.equal(await verifyDeviceProof(identity.publicJwk,{...result.proof,route:'/v1/auth/recover'},result.signature),false)
  assert.equal(await verifyDeviceProof(identity.publicJwk,{...result.proof,issuedAt:issuedAt+1},result.signature),false)
  assert.equal(await verifyDeviceProof(identity.publicJwk,{...result.proof,challenge:base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))},result.signature),false)
  const wrong=await createPendingCloudIdentity()
  assert.equal(await verifyDeviceProof(wrong.publicJwk,result.proof,result.signature),false)
})

test('expired or future-dated challenge is rejected client-side',async()=>{
  const identity=await createPendingCloudIdentity()
  const nonce=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const req={method:'POST' as const,route:'/v1/auth/login',body:'{}'}
  await assert.rejects(
    ()=>signCloudDeviceRequest(identity,{nonce,issuedAt:Date.now()-130_000},req),
    /CHALLENGE_EXPIRED/)
  await assert.rejects(
    ()=>signCloudDeviceRequest(identity,{nonce,issuedAt:Date.now()+130_000},req),
    /CHALLENGE_EXPIRED/)
})

test('PWA does not import identity draft and no registration endpoint is public yet',async()=>{
  const index=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  assert.doesNotMatch(index,/from ['"].*cloud-identity/)
  const env:Env={DB:{prepare(){throw Error('disabled route must not query D1')}}}
  for(const method of ['GET','POST']){
    for(const path of ['/v1/auth/register','/v1/auth/login','/v1/auth/challenge']){
      const res=await handleRequest(new Request('https://orderlead-api.example.invalid'+path,{method}),env)
      assert.equal(res.status,503)
      assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
})
