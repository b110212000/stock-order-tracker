import test from 'node:test'
import assert from 'node:assert/strict'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const root='https://orderlead-api.example.invalid/health/email-readiness'
const origin='https://b110212000.github.io'
function req(method='GET',allowed=true):Request{
  return new Request(root,{method,headers:allowed?{'Origin':origin}:{}})
}
test('registration readiness probes only non-sensitive binding presence and COUNT, never D1 writes or SMTP',async()=>{
  const statements:string[]=[]
  const base:Env={
    DB:{prepare(sql){statements.push(sql);return {
      first:async<T>()=>({total:0} as T)
    }}},
    MLB_MAIL:{sendAuthMail:async()=>{throw Error('must not send')}}
  }
  const ok=await handleRequest(req(),base)
  assert.equal(ok.status,200)
  assert.deepEqual(await ok.json(),{status:'ready',mailBinding:'ready',pendingTable:'ready'})
  assert.deepEqual(statements,['SELECT COUNT(*) AS total FROM auth_email_signup_pending'])
  const mailMissing=await handleRequest(req(),{...base,MLB_MAIL:undefined})
  assert.equal(mailMissing.status,503)
  assert.deepEqual(await mailMissing.json(),
    {status:'unavailable',mailBinding:'missing',pendingTable:'ready'})
  const dbMissing=await handleRequest(req(),{
    ...base,DB:{prepare(){throw Error('internal secret!')}}
  })
  assert.equal(dbMissing.status,503)
  assert.deepEqual(await dbMissing.json(),
    {status:'unavailable',mailBinding:'ready',pendingTable:'unavailable'})
  const denied=await handleRequest(req('GET',false),base)
  assert.equal(denied.status,403)
  const method=await handleRequest(req('POST'),base)
  assert.equal(method.status,405)
  assert.equal(statements.length,2)
})
