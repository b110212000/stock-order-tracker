import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPendingCloudIdentity,signCloudDeviceRequest} from '../src/cloud-identity'
import {isV4Uuid} from '../backend/src/auth-primitives'
import {
  enrollFirstDevice,issueRegistrationChallenge
} from '../backend/src/auth-registration'
import type {
  EnrollmentD1,EnrollmentStatement,RegistrationChallenge
} from '../backend/src/auth-registration'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

type ChallengeRow={
  challenge_id:string,purpose:string,user_id:string|null,device_id:string|null,
  nonce_sha256:string,issued_at:string,expires_at:string,consumed_at:string|null
}

class FakeRegistrationDb implements EnrollmentD1{
  challenge:ChallengeRow|null=null
  calls:string[]=[]
  batches=0
  prepare(sql:string):EnrollmentStatement{
    this.calls.push(sql)
    let params:(string|number|null)[]=[]
    const stmt:EnrollmentStatement={
      bind(...values){params=values;return stmt},
      first:async <T>()=>{
        if(!sql.startsWith('SELECT challenge_id,'))throw Error('unexpected first query')
        return (this.challenge?.challenge_id===params[0]?this.challenge:null) as T|null
      },
      run:async()=>{
        if(!sql.startsWith('INSERT INTO auth_challenges'))throw Error('unexpected run')
        assert.equal(this.challenge,null)
        assert.equal(params.length,4)
        this.challenge={
          challenge_id:params[0] as string,
          user_id:null,device_id:null,purpose:'registration',
          nonce_sha256:params[1] as string,
          issued_at:params[2] as string,
          expires_at:params[3] as string,
          consumed_at:null
        }
        return {meta:{changes:1}}
      }
    }
    // Preserve bound parameters for the transaction simulator below.
    Object.assign(stmt,{get _params(){return params}})
    return stmt
  }
  async batch(stmts:EnrollmentStatement[]):Promise<Array<{meta:{changes:number}}>>{
    this.batches++
    assert.equal(stmts.length,5)
    const sql=this.calls.slice(-5)
    assert.match(sql[0],/^UPDATE auth_challenges SET consumed_at=\?/)
    for(let i=1;i<5;i++){
      assert.match(sql[i],/WHERE EXISTS \(SELECT 1 FROM auth_challenges WHERE challenge_id=\? AND consumed_at=\?\)/)
    }
    assert.match(sql[1],/^INSERT INTO account_users/)
    assert.match(sql[2],/^INSERT INTO registered_devices/)
    assert.match(sql[3],/^INSERT INTO account_recovery_verifiers/)
    assert.match(sql[4],/^INSERT INTO authorized_device_keys/)
    const p=(stmts[0] as EnrollmentStatement&{_params:string[]})._params
    const existing=this.challenge
    if(!existing||existing.consumed_at!==null||existing.challenge_id!==p[1]){
      return Array.from({length:5},()=>({meta:{changes:0}}))
    }
    existing.consumed_at=p[0]
    const marker=p[0]
    for(let i=1;i<5;i++){
      const bound=(stmts[i] as EnrollmentStatement&{_params:string[]})._params
      assert.equal(bound[bound.length-2],existing.challenge_id)
      assert.equal(bound[bound.length-1],marker)
    }
    return Array.from({length:5},()=>({meta:{changes:1}}))
  }
}

async function validPayload(db:FakeRegistrationDb,now:number){
  const identity=await createPendingCloudIdentity()
  const challenge=await issueRegistrationChallenge(db,now)
  const raw=JSON.stringify({
    challengeId:challenge.challengeId,userId:identity.userId,
    deviceId:identity.deviceId,publicJwk:identity.publicJwk,
    recoveryVerifierSha256:identity.recoveryVerifierSha256
  })
  const signed=await signCloudDeviceRequest(
    identity,{nonce:challenge.nonce,issuedAt:challenge.issuedAt},
    {method:'POST',route:'/v1/auth/register',body:raw}
  )
  return {identity,challenge,raw,signature:signed.signature}
}

test('registration challenge has a random nonce, UUID and expires in 120 seconds',async()=>{
  const db=new FakeRegistrationDb()
  const ch=await issueRegistrationChallenge(db,Date.now())
  assert.ok(isV4Uuid(ch.challengeId))
  assert.match(ch.nonce,/^[A-Za-z0-9_-]{43}$/)
  assert.equal(ch.expiresAt-ch.issuedAt,120_000)
  assert.ok(db.challenge)
  assert.equal(db.challenge.user_id,null)
  assert.equal(db.challenge.device_id,null)
  assert.notEqual(db.challenge.nonce_sha256,ch.nonce)
  assert.match(db.challenge.nonce_sha256,/^[a-f0-9]{64}$/)
})

test('valid P-256 enrollment consumes the nonce and conditionally inserts four linked tables atomically',async()=>{
  const db=new FakeRegistrationDb()
  const now=Date.now()
  const {identity,challenge,raw,signature}=await validPayload(db,now)
  const reply=await enrollFirstDevice(db,raw,{nonce:challenge.nonce,signature},now+5)
  assert.deepEqual(reply,{userId:identity.userId,deviceId:identity.deviceId})
  assert.equal(db.batches,1)
  assert.ok(db.challenge?.consumed_at)
  await assert.rejects(
    ()=>enrollFirstDevice(db,raw,{nonce:challenge.nonce,signature},now+5),
    /REGISTRATION_INVALID/
  )
  assert.equal(db.batches,1)
})

test('invalid recovery verifier, public key and malformed body are rejected before any D1 mutation',async()=>{
  const db=new FakeRegistrationDb()
  const now=Date.now()
  const {challenge,raw,signature}=await validPayload(db,now)
  const req=JSON.parse(raw)
  for(const body of [
    JSON.stringify({...req,recoveryVerifierSha256:'1234'}),
    JSON.stringify({...req,publicJwk:{...req.publicJwk,d:'private-key-material'}}),
    JSON.stringify({...req,unexpected:'no'}),
    JSON.stringify({...req,userId:req.deviceId}),
    '{invalid-json',
    ' '.repeat(4097)
  ]){
    await assert.rejects(
      ()=>enrollFirstDevice(db,body,{nonce:challenge.nonce,signature},now),
      /REGISTRATION_INVALID/
    )
  }
  assert.equal(db.batches,0)
  assert.equal(db.challenge?.consumed_at,null)
})

test('signature must bind actual JSON bytes, signed route, device public key and nonce',async()=>{
  const db=new FakeRegistrationDb()
  const now=Date.now()
  const {challenge,raw,signature,identity}=await validPayload(db,now)
  const wrong=await createPendingCloudIdentity()
  const req=JSON.parse(raw)
  const attacks=[
    {raw:JSON.stringify({...req,deviceId:wrong.deviceId}),signature,nonce:challenge.nonce},
    {raw:JSON.stringify({...req,publicJwk:wrong.publicJwk}),signature,nonce:challenge.nonce},
    {raw,signature:'bad-signature',nonce:challenge.nonce},
    {raw,signature,nonce:'A'.repeat(43)}
  ]
  for(const attack of attacks){
    await assert.rejects(
      ()=>enrollFirstDevice(db,attack.raw,{
        nonce:attack.nonce,signature:attack.signature
      },now),/REGISTRATION_INVALID/
    )
  }
  assert.equal(db.batches,0)
  assert.equal(db.challenge?.consumed_at,null)
  assert.equal(req.userId,identity.userId)
})

test('expired and pre-consumed registration challenges fail closed',async()=>{
  const db=new FakeRegistrationDb()
  const now=Date.now()
  const {challenge,raw,signature}=await validPayload(db,now)
  await assert.rejects(
    ()=>enrollFirstDevice(db,raw,{nonce:challenge.nonce,signature},now+120_001),
    /REGISTRATION_INVALID/
  )
  assert.equal(db.batches,0)
  if(db.challenge)db.challenge.consumed_at=new Date(now).toISOString()
  await assert.rejects(
    ()=>enrollFirstDevice(db,raw,{nonce:challenge.nonce,signature},now+1),
    /REGISTRATION_INVALID/
  )
  assert.equal(db.batches,0)
})

test('module is not live: registration endpoints remain locked even with D1 present',async()=>{
  const index=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(index,/from ['"].*auth-registration/)
  const env:Env={DB:{prepare(){throw Error('never touch D1 for disabled registration')}}}
  for(const path of ['/v1/auth/challenge','/v1/auth/register','/v1/auth/login','/v1/trades']){
    for(const method of ['GET','POST','OPTIONS']){
      const res=await handleRequest(
        new Request('https://orderlead-api.example.invalid'+path,{method}),env)
      assert.equal(res.status,503,path+' '+method)
      assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
})

test('schema remains non-secret and registration SQL is transaction-gated',()=>{
  const source=readFileSync(new URL('../backend/src/auth-registration.ts',import.meta.url),'utf8')
  assert.match(source,/db\.batch\(statements\)/)
  assert.match(source,/consumed_at IS NULL/)
  assert.match(source,/nonce_sha256=\?/)
  assert.match(source,/WHERE '\+scope/)
  assert.doesNotMatch(source,/console\.log|console\.error|Bearer |privateKey|recoveryKey/)
})
