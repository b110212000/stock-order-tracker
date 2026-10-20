import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const url='https://orderlead-api.example.invalid'
const healthy:Env={DB:{prepare(sql){
  assert.equal(sql,'SELECT 1 AS healthy')
  return {async first<T>(){return {healthy:1} as T}}
}}}
const unavailable:Env={DB:{prepare(){return {async first<T>():Promise<T|null>{throw Error('SECRET: internal d1 connection')}}}}}

test('only read-only health route succeeds after D1 check',async()=>{
  const result=await handleRequest(new Request(url+'/health'),healthy)
  assert.equal(result.status,200)
  assert.deepEqual(await result.json(),{service:'orderlead-api',status:'ok'})
  assert.equal(result.headers.get('Cache-Control'),'no-store')
  assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff')
  assert.equal(result.headers.get('Access-Control-Allow-Origin'),null)
})

test('health returns generic 503 if D1 is missing, never leaks backend errors',async()=>{
  const response=await handleRequest(new Request(url+'/health'),unavailable)
  assert.equal(response.status,503)
  const body=await response.text()
  assert.match(body,/unavailable/)
  assert.doesNotMatch(body,/SECRET|internal|connection|SELECT|D1 error/)
})

test('all sync and login endpoints fail closed with no authentication',async()=>{
  for(const path of ['/v1','/v1/sync','/v1/sync/pull','/v1/sync/push','/v1/auth','/v1/trades']){
    for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS']){
      const response=await handleRequest(new Request(url+path,{method}),healthy)
      assert.equal(response.status,503,path+' '+method)
      assert.deepEqual(await response.json(),{error:'SYNC_NOT_ENABLED'})
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
    }
  }
})

test('unknown routes and unsupported health methods cannot expose data',async()=>{
  for(const path of ['/','/debug','/admin','/api/trades']){
    const response=await handleRequest(new Request(url+path),healthy)
    assert.equal(response.status,404)
  }
  for(const method of ['POST','PUT','DELETE','OPTIONS']){
    const response=await handleRequest(new Request(url+'/health',{method}),healthy)
    assert.equal(response.status,405)
  }
})

test('D1 migration is owner-scoped, requires verified identity and keeps delete tombstones',()=>{
  const sql=readFileSync(new URL('../backend/migrations/0001_foundation.sql',import.meta.url),'utf8')
  for(const table of ['account_users','registered_devices','review_trade_records','review_trade_changes']){
    assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS '+table))
  }
  assert.match(sql,/UNIQUE\(auth_provider, auth_subject\)/)
  assert.match(sql,/PRIMARY KEY \(user_id, record_id\)/)
  assert.match(sql,/FOREIGN KEY \(user_id\) REFERENCES account_users\(id\)/)
  assert.match(sql,/deleted_at TEXT/)
  assert.match(sql,/payload_json IS NULL/)
  assert.match(sql,/revision INTEGER NOT NULL/)
  assert.match(sql,/sequence INTEGER PRIMARY KEY AUTOINCREMENT/)
  assert.match(sql,/idx_review_changes_owner_cursor/)
  assert.doesNotMatch(sql,/INSERT INTO|REPLACE INTO|DROP TABLE/)
})

test('real Cloudflare credentials stay private; D1 resource UUID is public config',()=>{
  const example=readFileSync(new URL('../backend/wrangler.example.jsonc',import.meta.url),'utf8')
  const ignore=readFileSync(new URL('../backend/.gitignore',import.meta.url),'utf8')
  assert.match(example,/REPLACE_WITH_YOUR_D1_DATABASE_ID/)
  assert.doesNotMatch(ignore,/^wrangler\.jsonc$/m)
  const config=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'))
  assert.match(config.d1_databases[0].database_id,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
  assert.equal(config.d1_databases[0].binding,'DB')
  assert.equal(config.name,'orderlead-api')
  assert.deepEqual(config.secrets,{required:['PASSWORD_PEPPER']})
  assert.deepEqual(config.vars,{
    AUTH_ROUTES_ENABLED:'true',AUTH_BASIC_LIMITS_READY:'true',EMAIL_AUTH_ENABLED:'true'
  })
  assert.doesNotMatch(JSON.stringify({...config,secrets:undefined,vars:undefined}),
    /api[_-]?token|secret|password|recovery[_-]?key|authorization/i)
  assert.match(ignore,/\.dev\.vars/)
  const source=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(source,/Authorization: Bearer|SECRET_KEY=|API_TOKEN=/)
})
