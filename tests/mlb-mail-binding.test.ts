import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {base64UrlEncode} from '../backend/src/auth-primitives'
import {requestAuthEmail} from '../backend/src/mlb-mail'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const randomToken=()=>base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))

test('OrderLead uses one named MLB Worker binding, no local Gmail Secrets',()=>{
  const config=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'))
  assert.deepEqual(config.services,[{
    binding:'MLB_MAIL',service:'mlb-score-notify',entrypoint:'OrderLeadMailService'
  }])
  assert.equal(config.name,'orderlead-api')
  assert.equal(config.SMTP_PASSWORD,undefined)
  assert.equal(config.SMTP_USER,undefined)
  const source=readFileSync(new URL('../backend/src/mlb-mail.ts',import.meta.url),'utf8')
  assert.doesNotMatch(source,/cloudflare:sockets|smtp\.gmail\.com|fetch\(/)
  assert.match(source,/env\.MLB_MAIL\.sendAuthMail/)
})

test('trusted backend sends purpose-bounded email through existing MLB worker',async()=>{
  const calls:unknown[]=[]
  const env={MLB_MAIL:{sendAuthMail:async(args:unknown)=>{
    calls.push(args);return {accepted:true}
  }}}
  const verify=randomToken()
  const reset=randomToken()
  await requestAuthEmail(env,'verify',' User.Name+Alt@Example.Com ',verify,crypto.randomUUID())
  await requestAuthEmail(env,'reset','User.Name+Alt@Example.Com',reset,crypto.randomUUID())
  assert.equal(calls.length,2)
  const first=calls[0] as {id:string,kind:string,to:string,link:string}
  const next=calls[1] as typeof first
  assert.match(first.id,/^[a-f0-9-]{36}$/)
  assert.notEqual(first.id,next.id)
  assert.equal(first.kind,'verify')
  assert.equal(next.kind,'reset')
  assert.equal(first.to,'user.name+alt@example.com')
  assert.equal(next.to,'user.name+alt@example.com')
  assert.equal(first.link,'https://b110212000.github.io/stock-order-tracker/#/auth/email-verify/'+verify)
  assert.equal(next.link,'https://b110212000.github.io/stock-order-tracker/#/auth/reset-password/'+reset)
  assert.equal('SMTP_PASSWORD' in env,false)
})

test('invalid credentials and missing private binding cannot attempt mail',async()=>{
  let called=0
  const env={MLB_MAIL:{sendAuthMail:async()=>{called++;return {accepted:true}}}}
  for(const [kind,email,token] of [
    ['verify','not-an-email',randomToken()],
    ['reset','evil@example.com\nBcc:bad@example.com',randomToken()],
    ['other','person@example.com',randomToken()],
    ['verify','person@example.com','invalid'],
    ['reset','person@example.com','']
  ] as const){
    await assert.rejects(
      ()=>requestAuthEmail(env,kind as 'verify'|'reset',email,token,crypto.randomUUID())
    )
  }
  await assert.rejects(
    ()=>requestAuthEmail({},'verify','person@example.com',randomToken(),crypto.randomUUID()),
    /MAIL_UNAVAILABLE/)
  assert.equal(called,0)
})

test('retrying with the same persisted UUID uses the same mail request ID',async()=>{
  const values:unknown[]=[]
  const env={MLB_MAIL:{sendAuthMail:async(payload:unknown)=>{
    values.push(payload)
    return {accepted:true}
  }}}
  const id=crypto.randomUUID(),token=randomToken()
  await requestAuthEmail(env,'verify','someone@example.com',token,id)
  await requestAuthEmail(env,'verify','someone@example.com',token,id)
  assert.equal((values[0] as {id:string}).id,id)
  assert.deepEqual(values[0],values[1])
})

test('mail RPC rejection never reports successful Email verification',async()=>{
  const env={MLB_MAIL:{sendAuthMail:async()=>({accepted:false})}}
  await assert.rejects(
    ()=>requestAuthEmail(env,'verify','person@example.com',randomToken(),crypto.randomUUID()),
    /MAIL_FAILED/)
})

test('the public OrderLead worker still does not expose registration or mail routes',async()=>{
  const index=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(index,/from ['"].*mlb-mail/)
  assert.doesNotMatch(index,/sendAuthMail\(/)
  const workerEnv:Env={DB:{prepare(){throw Error('no DB read required')}}}
  for(const route of ['/v1/auth/email/register','/v1/auth/email/reset-password','/v1/auth/email/mail','/v1/backups']){
    const response=await handleRequest(new Request('https://orderlead-api.example.invalid'+route,{method:'POST'}),workerEnv)
    assert.equal(response.status,503)
  }
})
