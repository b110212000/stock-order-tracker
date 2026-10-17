import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPendingCloudIdentity,signCloudDeviceRequest} from '../src/cloud-identity'
import {issueDeviceLoginChallenge,verifyDeviceLogin} from '../backend/src/auth-device-login'
import type {EnrollmentD1,EnrollmentStatement} from '../backend/src/auth-registration'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'
import type {PendingCloudIdentity} from '../src/cloud-identity'

type Challenge={
  challengeId:string,userId:string,deviceId:string,purpose:string,
  digest:string,issuedAt:string,expiresAt:string,consumedAt:string|null
}
type BoundStatement=EnrollmentStatement&{sql:string,params:(string|number|null)[]}
class FakeDeviceDb implements EnrollmentD1{
  readonly identity:PendingCloudIdentity
  revoked=false
  challenge:Challenge|null=null
  batches=0
  lastVerifiedAt:string|null=null
  lastSeenAt:string|null=null
  constructor(identity:PendingCloudIdentity){this.identity=identity}
  prepare(sql:string):EnrollmentStatement{
    const stmt:BoundStatement={
      sql,params:[],
      bind(...values){stmt.params=values;return stmt},
      first:async <T>()=>{
        if(sql.startsWith('SELECT public_jwk FROM authorized_device_keys')){
          const [userId,deviceId]=stmt.params
          if(this.revoked||userId!==this.identity.userId||deviceId!==this.identity.deviceId)return null
          return {public_jwk:JSON.stringify(this.identity.publicJwk)} as T
        }
        if(sql.startsWith('SELECT c.challenge_id,')){
          const [challengeId,userId,deviceId]=stmt.params
          const c=this.challenge
          if(!c||this.revoked||c.challengeId!==challengeId||
             c.userId!==userId||c.deviceId!==deviceId)return null
          return {
            challenge_id:c.challengeId,user_id:c.userId,device_id:c.deviceId,
            purpose:c.purpose,nonce_sha256:c.digest,
            issued_at:c.issuedAt,expires_at:c.expiresAt,
            consumed_at:c.consumedAt,
            public_jwk:JSON.stringify(this.identity.publicJwk),
            revoked_at:this.revoked?new Date().toISOString():null
          } as T
        }
        throw Error('unexpected SELECT: '+sql)
      },
      run:async()=>{
        assert.match(sql,/^INSERT INTO auth_challenges /)
        const [challengeId,userId,deviceId,digest,issuedAt,expiresAt]=stmt.params
        assert.equal(this.challenge,null)
        assert.equal(userId,this.identity.userId)
        assert.equal(deviceId,this.identity.deviceId)
        this.challenge={
          challengeId:String(challengeId),userId:String(userId),deviceId:String(deviceId),
          purpose:'device-login',digest:String(digest),issuedAt:String(issuedAt),
          expiresAt:String(expiresAt),consumedAt:null
        }
        return {meta:{changes:1}}
      }
    }
    return stmt
  }
  async batch(stmts:EnrollmentStatement[]):Promise<Array<{meta:{changes:number}}>>{
    this.batches++
    const all=stmts as BoundStatement[]
    assert.equal(all.length,3)
    assert.match(all[0].sql,/^UPDATE auth_challenges SET consumed_at=\?/)
    assert.match(all[0].sql,/consumed_at IS NULL/)
    assert.match(all[0].sql,/k?\.?(?:revoked_at|revoked_at) IS NULL/)
    assert.match(all[1].sql,/^UPDATE authorized_device_keys SET last_verified_at=\?/)
    assert.match(all[1].sql,/revoked_at IS NULL/)
    assert.match(all[2].sql,/^UPDATE registered_devices SET last_seen_at=\?/)
    for(const stmt of all.slice(1)){
      assert.match(stmt.sql,/WHERE challenge_id=\? AND consumed_at=\?\)/)
    }
    const c=this.challenge
    const update=all[0].params
    if(!c||this.revoked||c.consumedAt!==null||c.challengeId!==update[1]||
      c.userId!==update[2]||c.deviceId!==update[3]||
      c.digest!==update[4]||c.expiresAt<=String(update[5])){
      return [{meta:{changes:0}},{meta:{changes:0}},{meta:{changes:0}}]
    }
    const marker=String(update[0])
    assert.equal(all[1].params.at(-2),c.challengeId)
    assert.equal(all[1].params.at(-1),marker)
    assert.equal(all[2].params.at(-2),c.challengeId)
    assert.equal(all[2].params.at(-1),marker)
    c.consumedAt=marker
    this.lastVerifiedAt=String(all[1].params[0])
    this.lastSeenAt=String(all[2].params[0])
    return [{meta:{changes:1}},{meta:{changes:1}},{meta:{changes:1}}]
  }
}

async function setup(now=Date.now()){
  const identity=await createPendingCloudIdentity()
  const db=new FakeDeviceDb(identity)
  const challenge=await issueDeviceLoginChallenge(db,identity.userId,identity.deviceId,now)
  const body=JSON.stringify({
    challengeId:challenge.challengeId,
    userId:identity.userId,deviceId:identity.deviceId
  })
  const {signature}=await signCloudDeviceRequest(identity,{
    nonce:challenge.nonce,issuedAt:challenge.issuedAt
  },{method:'POST',route:'/v1/auth/login',body})
  return {identity,db,challenge,body,signature,now}
}

test('login challenge is bound to existing active user+device and its nonce is not saved plaintext',async()=>{
  const a=await setup()
  assert.equal(a.challenge.expiresAt-a.challenge.issuedAt,120_000)
  assert.match(a.challenge.nonce,/^[A-Za-z0-9_-]{43}$/)
  assert.match(a.db.challenge?.digest??'',/^[a-f0-9]{64}$/)
  assert.notEqual(a.db.challenge?.digest,a.challenge.nonce)
  const db=new FakeDeviceDb(a.identity)
  await assert.rejects(
    ()=>issueDeviceLoginChallenge(db,'9b030000-1111-4000-8000-111111111111',a.identity.deviceId),
    /DEVICE_AUTH_FAILED/)
  db.revoked=true
  await assert.rejects(
    ()=>issueDeviceLoginChallenge(db,a.identity.userId,a.identity.deviceId),
    /DEVICE_AUTH_FAILED/)
  assert.equal(db.challenge,null)
})

test('correct device signs exact body; one-time login atomically updates challenge and last-seen metadata',async()=>{
  const a=await setup()
  const res=await verifyDeviceLogin(
    a.db,a.body,{nonce:a.challenge.nonce,signature:a.signature},a.now+5)
  assert.deepEqual(res,{
    userId:a.identity.userId,deviceId:a.identity.deviceId,
    verifiedAt:new Date(a.now+5).toISOString()
  })
  assert.equal(Object.isFrozen(res),true)
  assert.equal(a.db.batches,1)
  assert.ok(a.db.challenge?.consumedAt)
  assert.equal(a.db.lastSeenAt,res.verifiedAt)
  assert.equal(a.db.lastVerifiedAt,res.verifiedAt)
  await assert.rejects(
    ()=>verifyDeviceLogin(a.db,a.body,{nonce:a.challenge.nonce,signature:a.signature},a.now+6),
    /DEVICE_AUTH_FAILED/)
  assert.equal(a.db.batches,1)
})

test('tampering request, signature, nonce, device UUID or public key fails before writes',async()=>{
  const a=await setup()
  const other=await createPendingCloudIdentity()
  for(const mutation of [
    {body:a.body,nonce:a.challenge.nonce,signature:'invalid'},
    {body:a.body,nonce:'A'.repeat(43),signature:a.signature},
    {body:JSON.stringify({...JSON.parse(a.body),deviceId:other.deviceId}),nonce:a.challenge.nonce,signature:a.signature},
    {body:JSON.stringify({...JSON.parse(a.body),unexpected:'x'}),nonce:a.challenge.nonce,signature:a.signature},
    {body:a.body+' ',nonce:a.challenge.nonce,signature:a.signature},
    {body:'{'+'a'.repeat(1100),nonce:a.challenge.nonce,signature:a.signature}
  ]){
    await assert.rejects(
      ()=>verifyDeviceLogin(a.db,mutation.body,{nonce:mutation.nonce,signature:mutation.signature},a.now+5),
      /DEVICE_AUTH_FAILED/
    )
  }
  assert.equal(a.db.batches,0)
  assert.equal(a.db.challenge?.consumedAt,null)
  a.db.revoked=true
  await assert.rejects(
    ()=>verifyDeviceLogin(a.db,a.body,{nonce:a.challenge.nonce,signature:a.signature},a.now+5),
    /DEVICE_AUTH_FAILED/)
})

test('expired and future-dated challenges cannot be verified',async()=>{
  const a=await setup()
  await assert.rejects(
    ()=>verifyDeviceLogin(a.db,a.body,{nonce:a.challenge.nonce,signature:a.signature},a.now+120_001),
    /DEVICE_AUTH_FAILED/)
  assert.equal(a.db.batches,0)
  if(a.db.challenge)a.db.challenge.issuedAt=new Date(a.now+60_000).toISOString()
  await assert.rejects(
    ()=>verifyDeviceLogin(a.db,a.body,{nonce:a.challenge.nonce,signature:a.signature},a.now),
    /DEVICE_AUTH_FAILED/)
})

test('device revocation between proof check and D1 transaction prevents verification',async()=>{
  const a=await setup()
  const db=a.db
  const oldBatch=db.batch.bind(db)
  db.batch=async function(statements){
    this.revoked=true
    return oldBatch(statements)
  }
  await assert.rejects(
    ()=>verifyDeviceLogin(db,a.body,{nonce:a.challenge.nonce,signature:a.signature},a.now+5),
    /DEVICE_AUTH_FAILED/)
  assert.equal(db.challenge?.consumedAt,null)
  assert.equal(db.lastVerifiedAt,null)
})

test('public login and other /v1 routes still return 503; code cannot leak into live Worker',async()=>{
  const source=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(source,/from ['"].*auth-device-login/)
  const env:Env={DB:{prepare(){throw Error('should not call database')}}}
  for(const path of ['/v1/auth/challenge','/v1/auth/login','/v1/auth/register','/v1/trades']){
    for(const method of ['GET','POST','OPTIONS']){
      const response=await handleRequest(
        new Request('https://api.example.invalid'+path,{method}),env)
      assert.equal(response.status,503)
      assert.deepEqual(await response.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
})

test('SQL device check always scopes verified login and revocation',()=>{
  const source=readFileSync(new URL('../backend/src/auth-device-login.ts',import.meta.url),'utf8')
  assert.match(source,/db\.batch\(\[/)
  assert.match(source,/nonce_sha256=\?/)
  assert.match(source,/revoked_at IS NULL/)
  assert.match(source,/c\.user_id=\? AND c\.device_id=\?/)
  assert.match(source,/challenge_id=\? AND consumed_at=\?/)
  assert.doesNotMatch(source,/console\.(log|error)|Bearer |privateKey|recoveryKey/)
})
