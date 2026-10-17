import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  createDeviceSession,authenticateDeviceSession,
  revokeDeviceSession,listMyAuthorizedDevices
} from '../backend/src/auth-sessions'
import type {EnrollmentD1,EnrollmentStatement} from '../backend/src/auth-registration'
import type {VerifiedDevice} from '../backend/src/auth-device-login'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

type Session={
  token_sha256:string,user_id:string,device_id:string,
  issued_at:string,expires_at:string,revoked_at:string|null
}
type Args=(string|number|null)[]
type D1Stmt=EnrollmentStatement&{all<T>():Promise<{results:T[]}>}

class SessionDb implements EnrollmentD1 {
  sessions=new Map<string,Session>()
  publicJwk='{}'
  deviceRevoked=false
  lastQuery=''
  calls:string[]=[]
  readonly userId=crypto.randomUUID()
  readonly deviceId=crypto.randomUUID()
  prepare(sql:string):D1Stmt{
    let args:Args=[]
    this.calls.push(sql)
    const statement:D1Stmt={
      bind(...items){args=items;return statement},
      first:async <T>():Promise<T|null>=>{
        assert.match(sql,/^SELECT s\.user_id,s\.device_id/)
        const session=this.sessions.get(String(args[0]))
        if(!session||session.revoked_at!==null||this.deviceRevoked||
          session.expires_at<=String(args[1]))return null
        return {
          ...session,device_revoked_at:null
        } as T
      },
      all:async <T>():Promise<{results:T[]}>=>{
        assert.match(sql,/^SELECT d\.device_id,d\.label/)
        this.lastQuery=sql
        assert.deepEqual(args,[this.userId])
        return {results:[{device_id:this.deviceId,label:'iPhone',
          last_seen_at:'2026-10-17T01:00:00.000Z',
          created_at:'2026-10-16T01:00:00.000Z'}] as T[]}
      },
      run:async()=>{
        if(sql.startsWith('INSERT INTO auth_device_sessions')){
          const [hash,userId,deviceId,issued,expiry,selectUser,selectDevice]=args
          assert.equal(userId,selectUser)
          assert.equal(deviceId,selectDevice)
          if(this.deviceRevoked||this.sessions.has(String(hash)))return {meta:{changes:0}}
          this.sessions.set(String(hash),{
            token_sha256:String(hash),user_id:String(userId),
            device_id:String(deviceId),issued_at:String(issued),
            expires_at:String(expiry),revoked_at:null
          })
          return {meta:{changes:1}}
        }
        if(sql.startsWith('UPDATE auth_device_sessions SET revoked_at')){
          const session=this.sessions.get(String(args[1]))
          if(!session||session.revoked_at)return {meta:{changes:0}}
          session.revoked_at=String(args[0])
          return {meta:{changes:1}}
        }
        throw Error('Unexpected SQL: '+sql)
      }
    }
    return statement
  }
  batch():Promise<Array<{meta:{changes:number}}>>{throw Error('not needed')}
}

function proof(db:SessionDb,now:number):VerifiedDevice{
  return {userId:db.userId,deviceId:db.deviceId,verifiedAt:new Date(now).toISOString()}
}

test('session is generated from freshly verified device, stored hashed, scoped and expires in 15 minutes',async()=>{
  const db=new SessionDb(),now=Date.now()
  const issued=await createDeviceSession(db,proof(db,now),now)
  assert.match(issued.token,/^[a-zA-Z0-9_-]{43}$/)
  assert.equal(issued.expiresAt-now,900_000)
  assert.equal(db.sessions.size,1)
  const only=[...db.sessions.values()][0]
  assert.match(only.token_sha256,/^[a-f0-9]{64}$/)
  assert.notEqual(only.token_sha256,issued.token)
  assert.equal(only.user_id,db.userId)
  assert.equal(only.device_id,db.deviceId)
  const authorized=await authenticateDeviceSession(db,issued.token,now+1)
  assert.deepEqual(authorized,{
    userId:db.userId,deviceId:db.deviceId,expiresAt:issued.expiresAt
  })
  assert.equal(Object.isFrozen(authorized),true)
  await assert.rejects(
    ()=>authenticateDeviceSession(db,issued.token,issued.expiresAt),
    /AUTHENTICATION_REQUIRED/)
})

test('cannot create sessions from a stale, malformed, future or revoked device proof',async()=>{
  const db=new SessionDb(),now=Date.now()
  const legitimate=proof(db,now)
  await assert.rejects(
    ()=>createDeviceSession(db,{...legitimate,verifiedAt:new Date(now-40_000).toISOString()},now),
    /AUTHENTICATION_REQUIRED/)
  await assert.rejects(
    ()=>createDeviceSession(db,{...legitimate,verifiedAt:new Date(now+40_000).toISOString()},now),
    /AUTHENTICATION_REQUIRED/)
  await assert.rejects(
    ()=>createDeviceSession(db,{...legitimate,userId:'someone'},now),
    /AUTHENTICATION_REQUIRED/)
  db.deviceRevoked=true
  await assert.rejects(()=>createDeviceSession(db,legitimate,now),/AUTHENTICATION_REQUIRED/)
  assert.equal(db.sessions.size,0)
})

test('session stops working immediately when device is revoked, even before expiry',async()=>{
  const db=new SessionDb(),now=Date.now()
  const session=await createDeviceSession(db,proof(db,now),now)
  db.deviceRevoked=true
  await assert.rejects(
    ()=>authenticateDeviceSession(db,session.token,now+10),
    /AUTHENTICATION_REQUIRED/)
})

test('logout revokes the current token and invalid or replayed logout is denied',async()=>{
  const db=new SessionDb(),now=Date.now()
  const session=await createDeviceSession(db,proof(db,now),now)
  await revokeDeviceSession(db,session.token,now+1)
  await assert.rejects(
    ()=>authenticateDeviceSession(db,session.token,now+2),
    /AUTHENTICATION_REQUIRED/)
  await assert.rejects(
    ()=>revokeDeviceSession(db,session.token,now+2),
    /AUTHENTICATION_REQUIRED/)
  await assert.rejects(
    ()=>authenticateDeviceSession(db,'bad',now+2),
    /AUTHENTICATION_REQUIRED/)
  const other=await createDeviceSession(db,proof(db,now),now)
  assert.notEqual(other.token,session.token)
  assert.ok(await authenticateDeviceSession(db,other.token,now+5))
})

test('list devices is derived ONLY from authenticated token, no client-supplied user UUID',async()=>{
  const db=new SessionDb(),now=Date.now()
  const session=await createDeviceSession(db,proof(db,now),now)
  assert.deepEqual(await listMyAuthorizedDevices(db,session.token,now+1),[
    {deviceId:db.deviceId,label:'iPhone',
      lastSeenAt:'2026-10-17T01:00:00.000Z',
      createdAt:'2026-10-16T01:00:00.000Z'}
  ])
  assert.match(db.lastQuery,/WHERE d\.user_id=\? AND k\.revoked_at IS NULL/)
  await assert.rejects(
    ()=>listMyAuthorizedDevices(db,crypto.randomUUID(),now+1),
    /AUTHENTICATION_REQUIRED/)
})

test('session tables remain scoped and never persist the raw bearer token',()=>{
  const sql=readFileSync(
    new URL('../backend/migrations/0004_auth_sessions_limits.sql',import.meta.url),'utf8')
  assert.match(sql,/CREATE TABLE IF NOT EXISTS auth_device_sessions/)
  assert.match(sql,/token_sha256 TEXT PRIMARY KEY/)
  assert.match(sql,/REFERENCES authorized_device_keys\(user_id,device_id\)/)
  assert.match(sql,/CREATE TABLE IF NOT EXISTS auth_request_limits/)
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM|private_jwk|bearer_token TEXT/)
})

test('new session core is not routed and every public /v1 path still refuses',async()=>{
  const src=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(src,/from ['"].*auth-sessions/)
  const env:Env={DB:{prepare(){throw Error('no auth database access allowed')}}}
  for(const path of ['/v1/auth/register','/v1/auth/login','/v1/auth/devices','/v1/backups']){
    const res=await handleRequest(
      new Request('https://orderlead-api.example.invalid'+path),env)
    assert.equal(res.status,503)
    assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
  }
})
