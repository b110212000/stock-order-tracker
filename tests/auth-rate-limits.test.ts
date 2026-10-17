import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  reserveAuthAttempt,trustedConnectingIp,authRateWindowMs
} from '../backend/src/auth-rate-limits'
import type {EnrollmentD1,EnrollmentStatement} from '../backend/src/auth-registration'

class FakeRateD1 implements EnrollmentD1{
  buckets=new Map<string,{attempts:number,window:number,expires:string}>()
  calls=0
  prepare(sql:string):EnrollmentStatement{
    assert.match(sql,/^INSERT INTO auth_request_limits/)
    assert.match(sql,/ON CONFLICT\(bucket_id\) DO UPDATE SET attempts=/)
    assert.match(sql,/WHERE auth_request_limits\.attempts < \?/)
    let params:(string|number|null)[]=[]
    const stmt:EnrollmentStatement={
      bind(...values){params=values;return stmt},
      first:async <T>():Promise<T|null>=>{throw Error('no read allowed')},
      run:async()=>{
        this.calls++
        const [id,window,expires,limit]=params
        assert.match(String(id),/^[a-f0-9]{64}$/)
        const row=this.buckets.get(String(id))
        if(!row){
          this.buckets.set(String(id),{attempts:1,window:Number(window),expires:String(expires)})
          return {meta:{changes:1}}
        }
        if(row.attempts>=Number(limit))return {meta:{changes:0}}
        row.attempts++
        return {meta:{changes:1}}
      }
    }
    return stmt
  }
  batch():Promise<Array<{meta:{changes:number}}>>{throw Error('not needed')}
}

test('fixed 5-minute IP registration challenge quota denies seventh request',async()=>{
  const db=new FakeRateD1(),now=Date.now()
  for(let i=0;i<6;i++)await reserveAuthAttempt(db,'registration-challenge','203.0.113.7',now)
  await assert.rejects(
    ()=>reserveAuthAttempt(db,'registration-challenge','203.0.113.7',now),
    /AUTH_RATE_LIMITED/)
  assert.equal(db.buckets.size,1)
  assert.equal([...db.buckets.values()][0].attempts,6)
  assert.equal([...db.buckets.keys()][0].includes('203.0.113.7'),false)
  assert.equal(authRateWindowMs,300_000)
})

test('a new fixed window resets quota, a different IP has its own quota',async()=>{
  const db=new FakeRateD1(),now=180_000_000_000
  for(let i=0;i<6;i++)await reserveAuthAttempt(db,'registration-challenge','203.0.113.7',now)
  await reserveAuthAttempt(db,'registration-challenge','203.0.113.8',now)
  await reserveAuthAttempt(db,'registration-challenge','203.0.113.7',now+300_000)
  assert.equal(db.buckets.size,3)
})

test('per-account quota is shared across multiple IPs to slow distributed guessing',async()=>{
  const db=new FakeRateD1(),userId=crypto.randomUUID(),now=180_000_000_000
  for(let i=0;i<8;i++){
    await reserveAuthAttempt(db,'device-login',`2001:db8::${i+1}`,now,userId)
  }
  await assert.rejects(
    ()=>reserveAuthAttempt(db,'device-login','2001:db8::99',now,userId),
    /AUTH_RATE_LIMITED/)
  assert.equal(db.buckets.size,10) // 9 distinct IP buckets + 1 shared account bucket
  const account=[...db.buckets.values()].find(x=>x.attempts===8)
  assert.equal(account?.attempts,8)
})

test('invalid IP and user UUID fail closed before database access',async()=>{
  const db=new FakeRateD1()
  for(const ip of ['','not-an-ip','127.0.0.1, 1.1.1.1','1.2.3.999','203.0.113.7:8000']){
    await assert.rejects(
      ()=>reserveAuthAttempt(db,'device-login',ip,Date.now()),
      /AUTH_RATE_UNAVAILABLE/)
  }
  await assert.rejects(
    ()=>reserveAuthAttempt(db,'device-login','203.0.113.7',Date.now(),'bad-uuid'),
    /AUTH_RATE_UNAVAILABLE/)
  assert.equal(db.calls,0)
})

test('only trusted Cloudflare ingress IP is extracted, never spoofable forwarded headers',()=>{
  const headers=new Headers({
    'CF-Connecting-IP':'2001:db8::1',
    'X-Forwarded-For':'203.0.113.250',
    'X-Real-IP':'203.0.113.251'
  })
  const req=new Request('https://api.example.invalid/v1/auth/login',{headers})
  assert.equal(trustedConnectingIp(req),'2001:db8::1')
  assert.throws(
    ()=>trustedConnectingIp(new Request('https://api.example.invalid/v1/auth/login')),
    /AUTH_RATE_UNAVAILABLE/)
  const poisoned=new Request('https://api.example.invalid/',{
    headers:{'CF-Connecting-IP':'127.0.0.1, 192.0.2.1'}
  })
  assert.throws(()=>trustedConnectingIp(poisoned),/AUTH_RATE_UNAVAILABLE/)
})

test('rate limiter is not publicly routed before origin and edge safeguards exist',()=>{
  const index=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(index,/from ['"].*auth-rate-limits/)
  const module=readFileSync(new URL('../backend/src/auth-rate-limits.ts',import.meta.url),'utf8')
  assert.doesNotMatch(module,/console\.log|console\.error|X-Forwarded-For'\)/)
})
