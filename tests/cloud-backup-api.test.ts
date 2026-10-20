import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const origin='https://b110212000.github.io'
const host='https://orderlead-api.example.invalid'
function request(path:string,method='GET',withOrigin=true):Request{
  return new Request(host+path,{method,headers:withOrigin?{Origin:origin}:{}})
}
const calls:string[]=[]
const env:Env={DB:{prepare(sql){calls.push(sql);return {async first<T>():Promise<T|null>{return null}}}}}
const flags={AUTH_ROUTES_ENABLED:'true',AUTH_BASIC_LIMITS_READY:'true',
  EMAIL_AUTH_ENABLED:'true'}

test('backup routes never open from Email gates alone or guessed UUID',async()=>{
  for(const path of ['/v1/backups','/v1/backups/start',
    '/v1/backups/00000000-0000-4000-8000-000000000001',
    '/v1/backups/00000000-0000-4000-8000-000000000001/chunks',
    '/v1/backups/00000000-0000-4000-8000-000000000001/complete']){
    for(const e of [env,{...env,...flags},{...env,BACKUP_RECOVERY_ENABLED:'true'}]){
      const res=await handleRequest(request(path),e)
      assert.equal(res.status,503,path)
      assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
  assert.equal(calls.length,0)
})

test('enabled backup routes reject missing origin and missing Session without D1',async()=>{
  const active:Env={...env,...flags,BACKUP_RECOVERY_ENABLED:'true'}
  const denied=await handleRequest(request('/v1/backups','GET',false),active)
  assert.equal(denied.status,403)
  const unauth=await handleRequest(request('/v1/backups'),active)
  assert.equal(unauth.status,401)
  assert.deepEqual(await unauth.json(),{error:'AUTH_REQUIRED'})
  const badPost=await handleRequest(request('/v1/backups/start','POST'),active)
  assert.equal(badPost.status,401)
  assert.equal(calls.length,0)
})

test('untrusted methods cannot create anonymous backups',async()=>{
  const active:Env={...env,...flags,BACKUP_RECOVERY_ENABLED:'true'}
  const r=await handleRequest(request('/v1/backups','OPTIONS'),active)
  assert.equal(r.status,405)
  const c=readFileSync(new URL('../backend/src/cloud-backup-api.ts',import.meta.url),'utf8')
  assert.match(c,/authenticateEmailSession\(/)
  assert.match(c,/readVerifiedCloudBackup\(/)
  assert.match(c,/completeCloudBackup\(/)
  assert.match(c,/valid.*BACKUP/vi)
  assert.doesNotMatch(c,/console\.log|localStorage|SMTP_PASSWORD|DROP TABLE/)
})
