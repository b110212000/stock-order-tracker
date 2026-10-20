import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const api='https://orderlead-api.example.invalid'
const githubOrigin='https://b110212000.github.io'
const baseHeaders={
  'CF-Connecting-IP':'203.0.113.42',
  'Origin':githubOrigin
}
const explode:Env['DB']={
  prepare(){throw Error('DB_MUST_NOT_BE_QUERIED')}
}
const env=(auth?:string,edge?:string):Env=>({
  DB:explode,AUTH_ROUTES_ENABLED:auth,AUTH_EDGE_PROTECTED:edge,
  // Legacy routes now have an independent opt-in gate to avoid accidentally
  // activating UUID login alongside the new Email login.
  LEGACY_DEVICE_AUTH_ENABLED:auth==='true'&&edge==='true'?'true':undefined
})
function request(path:string,method:string='POST',headers:Record<string,string>={}):Request{
  return new Request(api+path,{method,headers:{...baseHeaders,...headers}})
}

test('all auth and backup endpoints stay 503 with zero or one security gate flag',async()=>{
  for(const e of [env(),env('true'),env(undefined,'true'),env('false','true'),env('true','false')]){
    for(const route of ['/v1/auth/registration-challenge','/v1/auth/register',
      '/v1/auth/login-challenge','/v1/auth/login','/v1/auth/devices',
      '/v1/auth/logout','/v1/backups']){
      const res=await handleRequest(request(route),e)
      assert.equal(res.status,503,route)
      assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
})

test('even when both auth flags set, backup/trade endpoints stay disabled',async()=>{
  for(const route of ['/v1/backups','/v1/sync','/v1/trades','/v1/devices']){
    const res=await handleRequest(request(route),env('true','true'))
    assert.equal(res.status,503,route)
  }
})

test('strict Origin: preflight allowed ONLY for GitHub Pages; malicious origin fails',async()=>{
  const enabled=env('true','true')
  const res=await handleRequest(
    request('/v1/auth/login','OPTIONS',{'Access-Control-Request-Method':'POST'}),enabled)
  assert.equal(res.status,204)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),githubOrigin)
  assert.equal(res.headers.get('Vary'),'Origin')
  assert.match(res.headers.get('Access-Control-Allow-Headers')??'',/Authorization/)
  const get=await handleRequest(
    request('/v1/auth/devices','OPTIONS',{'Access-Control-Request-Method':'GET'}),enabled)
  assert.equal(get.status,204)
  const disallowed=await handleRequest(
    request('/v1/auth/login','OPTIONS',{'Access-Control-Request-Method':'DELETE'}),enabled)
  assert.equal(disallowed.status,405)

  for(const origin of [
    'null','https://b110212000.github.io.evil.example',
    'http://b110212000.github.io','http://localhost:5173'
  ]){
    const evil=await handleRequest(
      request('/v1/auth/login','OPTIONS',{'Origin':origin,
        'Access-Control-Request-Method':'POST'}),enabled)
    assert.equal(evil.status,403,origin)
    assert.equal(evil.headers.get('Access-Control-Allow-Origin'),null)
  }
})

test('missing trusted ingress IP blocks registration challenge before D1 mutation',async()=>{
  const e=env('true','true')
  const res=await handleRequest(
    new Request(api+'/v1/auth/registration-challenge',{method:'POST',
      headers:{Origin:githubOrigin}}),e)
  assert.equal(res.status,503)
  assert.deepEqual(await res.json(),{error:'AUTH_UNAVAILABLE'})
})

test('wrong method, unknown path and query strings cannot expose credentials',async()=>{
  const e=env('true','true')
  const wrong=await handleRequest(request('/v1/auth/register','GET'),e)
  assert.equal(wrong.status,405)
  const unknown=await handleRequest(request('/v1/auth/whoami'),e)
  assert.equal(unknown.status,404)
  const query=await handleRequest(request('/v1/auth/login?token=stolen'),e)
  assert.equal(query.status,404)
})

test('devices API never accepts an owner UUID without a bearer session',async()=>{
  const res=await handleRequest(request('/v1/auth/devices','GET'),env('true','true'))
  assert.equal(res.status,401)
  assert.deepEqual(await res.json(),{error:'AUTH_FAILED'})
})

test('no backend authentication or backup JSON can be publicly read by UUID',()=>{
  const src=readFileSync(new URL('../backend/src/auth-api.ts',import.meta.url),'utf8')
  const router=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.match(src,/authenticateDeviceSession/)
  assert.match(src,/reserveAuthAttempt/)
  assert.match(src,/trustedConnectingIp/)
  assert.match(router,/AUTH_ROUTES_ENABLED==='true'/)
  assert.match(router,/AUTH_EDGE_PROTECTED==='true'/)
  assert.match(router,/SYNC_NOT_ENABLED/)
  assert.doesNotMatch(src,/localStorage|console\.log|console\.error/)
})
