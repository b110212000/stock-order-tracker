import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import type {EnrollmentD1,EnrollmentStatement} from '../backend/src/auth-registration'
import {base64UrlEncode} from '../backend/src/auth-primitives'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const pepper=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
const base='https://orderlead-api.example.invalid'
const origin='https://b110212000.github.io'
const routes=['register','verify','login','forgot-password','reset-password','logout','me']
const token=()=>base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
const pendingJobs:Promise<unknown>[]=[]
const background={waitUntil(p:Promise<unknown>){pendingJobs.push(p)}}

/** A narrow fake for routing / limits / mail transport, not real D1 concurrency. */
class ApiD1 implements EnrollmentD1 {
  buckets=new Map<string,number>()
  pending:unknown[]=[]
  existing:{
    user_id:string,email_normalized:string,password_salt:string,
    password_hash:string,password_algorithm:string,password_iterations:number,
    password_version:number,disabled_at:string|null
  }|null=null
  readonly statements:string[]=[]
  prepare(sql:string):EnrollmentStatement{
    this.statements.push(sql)
    let args:(string|number|null)[]=[]
    const stmt:EnrollmentStatement={
      bind(...items){args=items;return stmt},
      first:async <T>():Promise<T|null>=>{
        if(sql.startsWith('SELECT user_id,email_normalized,password_salt')){
          return this.existing&&this.existing.email_normalized===args[0]?this.existing as T:null
        }
        return null
      },
      run:async()=>{
        if(sql.startsWith('INSERT INTO auth_request_limits')){
          const id=String(args[0]),max=Number(args[3]),attempts=this.buckets.get(id)||0
          if(attempts>=max)return {meta:{changes:0}}
          this.buckets.set(id,attempts+1)
          return {meta:{changes:1}}
        }
        if(sql.startsWith('INSERT INTO auth_email_signup_pending')){
          this.pending.push(args)
          return {meta:{changes:1}}
        }
        if(sql.startsWith('INSERT INTO auth_email_reset_tokens'))return {meta:{changes:1}}
        throw Error('unexpected API D1 write: '+sql)
      }
    }
    return stmt
  }
  batch():Promise<Array<{meta:{changes:number}}>>{throw Error('no batch for this router test')}
}
function env(db:EnrollmentD1,flags:{auth?:string,edge?:string,email?:string,legacy?:string,pepper?:string}={}):Env{
  return {DB:db as unknown as Env['DB'],
    AUTH_ROUTES_ENABLED:flags.auth,
    AUTH_EDGE_PROTECTED:flags.edge,
    EMAIL_AUTH_ENABLED:flags.email,
    LEGACY_DEVICE_AUTH_ENABLED:flags.legacy,
    PASSWORD_PEPPER:flags.pepper
  }
}
function req(route:string,method='POST',payload?:unknown,headers:Record<string,string>={}):Request{
  const all:Record<string,string>={'Origin':origin,'CF-Connecting-IP':'203.0.113.45',...headers}
  if(payload!==undefined)all['Content-Type']='application/json'
  return new Request(base+'/v1/auth/email/'+route,{
    method,headers:all,...(payload!==undefined?{body:JSON.stringify(payload)}:{})
  })
}
const enabled={auth:'true',edge:'true',email:'true',pepper}

test('Email routes cannot be activated without ALL three independent security gates',async()=>{
  const db=new ApiD1()
  for(const flags of [{}, {auth:'true'}, {auth:'true',edge:'true'},
    {auth:'true',email:'true'}, {edge:'true',email:'true'},
    {auth:'true',edge:'true',email:'false'}]){
    for(const route of routes){
      const res=await handleRequest(req(route),env(db,flags))
      assert.equal(res.status,503,route)
      assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
    }
  }
  assert.equal(db.statements.length,0)
})

test('retired device routes stay disabled when only Email gates are enabled',async()=>{
  const db=new ApiD1()
  const e=env(db,enabled)
  for(const url of ['/v1/auth/login','/v1/auth/register','/v1/auth/devices',
    '/v1/backups','/v1/sync','/v1/trades']){
    const res=await handleRequest(new Request(base+url),e)
    assert.equal(res.status,503,url)
  }
})

test('Origin, HTTPS, methods, query strings and preflight are checked before D1',async()=>{
  const db=new ApiD1(),e=env(db,enabled)
  const good=await handleRequest(req('register','OPTIONS',undefined,{'Access-Control-Request-Method':'POST'}),e)
  assert.equal(good.status,204)
  assert.equal(good.headers.get('Access-Control-Allow-Origin'),origin)
  assert.equal(good.headers.get('Vary'),'Origin')
  assert.equal(good.headers.get('Access-Control-Allow-Credentials'),null)
  const badMethod=await handleRequest(req('register','GET'),e)
  assert.equal(badMethod.status,405)
  for(const evilOrigin of ['null','https://b110212000.github.io.evil.example','http://localhost:5173']){
    const denied=await handleRequest(req('register','POST',{},{'Origin':evilOrigin}),e)
    assert.equal(denied.status,403,evilOrigin)
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null)
  }
  const http=await handleRequest(new Request('http://orderlead-api.example.invalid/v1/auth/email/login',{
    method:'POST',headers:{Origin:origin}}),e)
  assert.equal(http.status,403)
  const query=await handleRequest(new Request(base+'/v1/auth/email/login?token=bad',{
    method:'POST',headers:{Origin:origin}}),e)
  assert.equal(query.status,404)
  assert.equal(db.statements.length,0)
})

test('missing Cloudflare source IP or server pepper fails closed before any Email parsing',async()=>{
  const db=new ApiD1()
  const noIp=await handleRequest(new Request(base+'/v1/auth/email/register',{
    method:'POST',headers:{Origin:origin}}),env(db,enabled))
  assert.equal(noIp.status,503)
  assert.deepEqual(await noIp.json(),{error:'AUTH_UNAVAILABLE'})
  const noPepper=await handleRequest(req('register'),env(db,{...enabled,pepper:undefined}))
  assert.equal(noPepper.status,503)
  assert.equal(db.statements.length,0)
})

test('registration accepts correct payload, stores pending only and uses no public mail URL',async()=>{
  const db=new ApiD1(),e=env(db,enabled),sent:unknown[]=[]
  const mailBinding={sendAuthMail:async (payload:unknown)=>{sent.push(payload);return {accepted:true}}}
  const res=await handleRequest(req('register','POST',{
    email:' Example+signup@Example.COM ',password:'A unique sufficiently long password',
    confirmPassword:'A unique sufficiently long password'
  }),{...e,MLB_MAIL:mailBinding},background)
  assert.equal(res.status,202)
  assert.deepEqual(await res.json(),{status:'check_email_if_eligible'})
  assert.equal(db.pending.length,1)
  await Promise.all(pendingJobs.splice(0))
  assert.equal(sent.length,1)
  const args=sent[0] as {id:string,kind:string,to:string,link:string}
  assert.equal(args.kind,'verify')
  assert.equal(args.to,'example+signup@example.com')
  assert.match(args.link,/^https:\/\/b110212000.github.io\/stock-order-tracker\/#\/auth\/email-verify\/[-_A-Za-z0-9]{43}$/)
  assert.equal((db.pending[0] as unknown[]).includes('A unique sufficiently long password'),false)
  assert.equal(JSON.stringify(db.pending).includes(args.link),false)
})

test('forgot password sends generic result even for unknown and known accounts',async()=>{
  const db=new ApiD1(),e=env(db,enabled),sent:unknown[]=[]
  const extra={MLB_MAIL:{sendAuthMail:async(p:unknown)=>{sent.push(p);return {accepted:true}}}}
  const unknown=await handleRequest(req('forgot-password','POST',{email:'unknown@example.com'}),{...e,...extra},background)
  assert.equal(unknown.status,202)
  const before=sent.length
  // The adapter is not supposed to disclose existence through HTTP status.
  db.existing={user_id:crypto.randomUUID(),email_normalized:'known@example.com',
    password_salt:'abcdefghijklmnopqrstuv',password_hash:'x'.repeat(43),
    password_algorithm:'pbkdf2-sha256-pepper-v1',password_iterations:600000,
    password_version:1,disabled_at:null}
  const known=await handleRequest(req('forgot-password','POST',{email:'known@example.com'}),{...e,...extra},background)
  assert.equal(known.status,202)
  assert.deepEqual(await unknown.clone().json(),await known.json())
  await Promise.all(pendingJobs.splice(0))
  assert.equal(sent.length,before+1)
  assert.equal((sent.at(-1) as {kind:string}).kind,'reset')
})

test('D1 request quotas rate-limit IP and separately HMAC-protect per-address budget',async()=>{
  const db=new ApiD1(),e={...env(db,enabled),MLB_MAIL:{sendAuthMail:async()=>({accepted:true})}}
  const address='quota@example.com'
  // Missing transport cannot bypass IP or email quota before KDF work.
  for(let i=0;i<3;i++){
    const response=await handleRequest(req('forgot-password','POST',{email:address},
      {'CF-Connecting-IP':`203.0.113.${i+10}`}),e,background)
    assert.equal(response.status,i<2?202:429)
  }
  assert.equal([...db.buckets.keys()].every(x=>/^[0-9a-f]{64}$/.test(x)),true)
  assert.equal(JSON.stringify([...db.buckets.keys()]).includes(address),false)
})

test('no arbitrary SMTP relay and no owner UUID lookup via public Email endpoints',async()=>{
  const db=new ApiD1(),e=env(db,enabled)
  const bad=await handleRequest(req('register','POST',{
    to:'victim@example.com',email:'account@example.com',
    password:'A correct long password!',confirmPassword:'A correct long password!'
  }),e)
  assert.equal(bad.status,400)
  const invalid=await handleRequest(req('login','POST',{userId:crypto.randomUUID(),password:'long enough password'}),e)
  assert.equal(invalid.status,400)
  const unauth=await handleRequest(req('me','GET'),e)
  assert.equal(unauth.status,401)
  const noBody=await handleRequest(req('login'),e)
  assert.equal(noBody.status,400)
  const code=readFileSync(new URL('../backend/src/email-auth-api.ts',import.meta.url),'utf8')
  assert.doesNotMatch(code,/console\.log|console\.error|localStorage|smtp\.gmail\.com/)
  assert.match(code,/requestAuthEmail\(/)
  assert.match(code,/reserveEmailAddressAttempt/)
})

test('invalid Email or mismatched confirmation never creates any pending account',async()=>{
  const db=new ApiD1(),e=env(db,enabled)
  const res=await handleRequest(req('register','POST',{
    email:'person@example.com',password:'This is a long password',
    confirmPassword:'Some other long password'
  }),e)
  assert.equal(res.status,400)
  assert.equal(db.pending.length,0)
  const size=await handleRequest(req('register','POST',{
    email:'person@example.com',password:'x'.repeat(3000),confirmPassword:'x'.repeat(3000)
  }),e)
  assert.equal(size.status,413)
})
