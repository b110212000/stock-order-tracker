import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import type {EnrollmentD1,EnrollmentStatement} from '../backend/src/auth-registration'
import {base64UrlEncode} from '../backend/src/auth-primitives'
import {
  prepareEmailSignup,confirmEmailSignup,loginEmailPassword,
  authenticateEmailSession,logoutEmailSession,
  preparePasswordReset,confirmPasswordReset
} from '../backend/src/email-auth-core'

const pepper=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
const now=Date.UTC(2026,9,20,12,0)
type P={pending_id:string,email_normalized:string,password_salt:string,password_hash:string,
 password_algorithm:string,password_iterations:number,verify_token_sha256:string,
 created_at:string,expires_at:string,consumed_at:string|null}
type C={user_id:string,email_normalized:string,email_verified_at:string,
 password_salt:string,password_hash:string,password_algorithm:string,password_iterations:number,
 password_version:number,created_at:string,password_changed_at:string,disabled_at:string|null}
type S={token_sha256:string,user_id:string,password_version:number,created_at:string,
 expires_at:string,revoked_at:string|null}
type R={token_sha256:string,user_id:string,created_at:string,expires_at:string,consumed_at:string|null}
type DbState={pending:P[],creds:C[],users:{id:string,email:string}[],sessions:S[],resets:R[]}
type Args=(string|number|null)[]
const changes=(n:number)=>({meta:{changes:n}})

/** Memory D1 double: every batch executes sequentially on a copy and rolls back. */
class MemoryD1 implements EnrollmentD1 {
 state:DbState={pending:[],creds:[],users:[],sessions:[],resets:[]}
 prepare(sql:string):EnrollmentStatement{
   const db=this
   const statement:EnrollmentStatement&{__sql?:string,__args?:Args}={
     __sql:sql,__args:[],
     bind(...args){statement.__args=args;return statement},
     first:async <T>():Promise<T|null>=>db.read(sql,statement.__args??[]) as T|null,
     run:async()=>db.write(sql,statement.__args??[])
   }
   return statement
 }
 async batch(stmts:EnrollmentStatement[]):Promise<Array<{meta:{changes:number}}>>{
   const previous=structuredClone(this.state),results=[]
   try{
     for(const s of stmts as (EnrollmentStatement&{__sql:string,__args:Args})[]){
       results.push(this.write(s.__sql,s.__args))
     }
     return results
   }catch(error){this.state=previous;throw error}
 }
 read(sql:string,args:Args[]):unknown{
   if(sql.startsWith('SELECT user_id,email_normalized,password_salt')){
     return this.state.creds.find(x=>x.email_normalized===args[0]&&!x.disabled_at)??null
   }
   if(sql.startsWith('SELECT pending_id FROM auth_email_signup_pending')){
     const p=this.state.pending.find(x=>x.verify_token_sha256===args[0]&&
       !x.consumed_at&&x.expires_at>String(args[1]))
     return p?{pending_id:p.pending_id}:null
   }
   if(sql.startsWith('SELECT s.user_id,s.password_version,c.password_version AS active_version')){
     const s=this.state.sessions.find(x=>x.token_sha256===args[0]&&!x.revoked_at&&x.expires_at>String(args[1]))
     const c=this.state.creds.find(x=>x.user_id===s?.user_id&&!x.disabled_at)
     return s&&c&&s.password_version===c.password_version?
       {...s,active_version:c.password_version}:null
   }
   if(sql.startsWith('SELECT r.user_id,c.password_version FROM auth_email_reset_tokens')){
     const r=this.state.resets.find(x=>x.token_sha256===args[0]&&!x.consumed_at&&x.expires_at>String(args[1]))
     const c=this.state.creds.find(x=>x.user_id===r?.user_id&&!x.disabled_at)
     return r&&c?{user_id:r.user_id,password_version:c.password_version}:null
   }
   throw Error('UNSUPPORTED D1 SELECT: '+sql)
 }
 write(sql:string,a:Args[]):{meta:{changes:number}}{
   if(sql.startsWith('INSERT INTO auth_email_signup_pending')){
     const p:P={pending_id:String(a[0]),email_normalized:String(a[1]),
       password_salt:String(a[2]),password_hash:String(a[3]),password_algorithm:String(a[4]),
       password_iterations:Number(a[5]),verify_token_sha256:String(a[6]),
       created_at:String(a[7]),expires_at:String(a[8]),consumed_at:null}
     assert(!this.state.pending.find(x=>x.verify_token_sha256===p.verify_token_sha256))
     this.state.pending.push(p);return changes(1)
   }
   if(sql.startsWith('UPDATE auth_email_signup_pending')){
     const p=this.state.pending.find(x=>x.verify_token_sha256===a[1]&&
       !x.consumed_at&&x.expires_at>String(a[2]))
     if(!p)return changes(0)
     p.consumed_at=String(a[0]);return changes(1)
   }
   if(sql.startsWith('INSERT INTO account_users')){
     const p=this.state.pending.find(x=>x.verify_token_sha256===a[2]&&x.consumed_at===a[3])
     if(!p||this.state.users.find(u=>u.email===p.email_normalized)||
       this.state.creds.find(c=>c.email_normalized===p.email_normalized))return changes(0)
     this.state.users.push({id:String(a[0]),email:p.email_normalized})
     return changes(1)
   }
   if(sql.startsWith('INSERT INTO auth_email_credentials')){
     const p=this.state.pending.find(x=>x.verify_token_sha256===a[5]&&x.consumed_at===a[6])
     if(!p||!this.state.users.find(u=>u.id===a[4]&&u.email===p.email_normalized))return changes(0)
     this.state.creds.push({
       user_id:String(a[0]),email_normalized:p.email_normalized,email_verified_at:String(a[1]),
       password_salt:p.password_salt,password_hash:p.password_hash,
       password_algorithm:p.password_algorithm,password_iterations:p.password_iterations,
       password_version:1,created_at:String(a[2]),password_changed_at:String(a[3]),
       disabled_at:null
     });return changes(1)
   }
   if(sql.startsWith('INSERT INTO auth_email_sessions')){
     const c=this.state.creds.find(x=>x.user_id===a[3]&&x.password_version===a[4]&&!x.disabled_at)
     if(!c)return changes(0)
     this.state.sessions.push({token_sha256:String(a[0]),user_id:c.user_id,
       password_version:c.password_version,created_at:String(a[1]),
       expires_at:String(a[2]),revoked_at:null})
     return changes(1)
   }
   if(sql.startsWith('UPDATE auth_email_sessions SET revoked_at')){
     const s=this.state.sessions.find(x=>x.token_sha256===a[1]&&!x.revoked_at)
     if(!s)return changes(0)
     s.revoked_at=String(a[0]);return changes(1)
   }
   if(sql.startsWith('INSERT INTO auth_email_reset_tokens')){
     this.state.resets.push({token_sha256:String(a[0]),user_id:String(a[1]),
       created_at:String(a[2]),expires_at:String(a[3]),consumed_at:null})
     return changes(1)
   }
   if(sql.startsWith('UPDATE auth_email_reset_tokens SET consumed_at=? WHERE token_sha256')){
     const r=this.state.resets.find(x=>x.token_sha256===a[1]&&
       !x.consumed_at&&x.expires_at>String(a[2])&&x.user_id===a[3])
     if(!r)return changes(0)
     r.consumed_at=String(a[0]);return changes(1)
   }
   if(sql.startsWith('UPDATE auth_email_credentials SET password_salt')){
     const c=this.state.creds.find(x=>x.user_id===a[5]&&
       x.password_version===a[6]&&!x.disabled_at)
     const r=this.state.resets.find(x=>x.token_sha256===a[7]&&
       x.user_id===a[8]&&x.consumed_at===a[9])
     if(!c||!r)return changes(0)
     c.password_salt=String(a[0]);c.password_hash=String(a[1])
     c.password_algorithm=String(a[2]);c.password_iterations=Number(a[3])
     c.password_version++;c.password_changed_at=String(a[4])
     return changes(1)
   }
   if(sql.startsWith('UPDATE auth_email_reset_tokens SET consumed_at=? WHERE user_id')){
     const c=this.state.creds.find(x=>x.user_id===a[1]&&x.password_version===a[3])
     if(!c)return changes(0)
     let affected=0
     for(const r of this.state.resets){
       if(r.user_id===a[1]&&!r.consumed_at){r.consumed_at=String(a[0]);affected++}
     }
     return changes(affected)
   }
   throw Error('UNSUPPORTED D1 DML: '+sql)
 }
}

const email='person@example.com'
const password='A long and highly unique password'
async function signup(db:MemoryD1){
  const intent=await prepareEmailSignup(db,email,password,pepper,now)
  assert.ok(intent)
  const confirmed=await confirmEmailSignup(db,intent.token,now+100)
  assert.ok(confirmed)
  return {intent,owner:confirmed.userId}
}

test('registration stores only password verifier; account is not active until one-time Email confirmation',async()=>{
 const db=new MemoryD1()
 const pending=await prepareEmailSignup(db,email,password,pepper,now)
 assert.ok(pending)
 assert.equal(db.state.creds.length,0)
 assert.equal(db.state.users.length,0)
 assert.equal(db.state.pending.length,1)
 assert.equal(JSON.stringify(db.state).includes(password),false)
 assert.equal(JSON.stringify(db.state).includes(pending.token),false)
 assert.equal(JSON.stringify(db.state).includes(pepper),false)
 const confirmed=await confirmEmailSignup(db,pending.token,now+10)
 assert.ok(confirmed)
 assert.equal(db.state.users.length,1)
 assert.equal(db.state.creds[0].email_normalized,email)
 assert.equal(db.state.creds[0].password_version,1)
 assert.equal(await confirmEmailSignup(db,pending.token,now+11),null)
 assert.equal(db.state.users.length,1)
})

test('signup token cannot be used after 30 minutes or on a different purpose',async()=>{
 const db=new MemoryD1()
 const intent=await prepareEmailSignup(db,email,password,pepper,now)
 assert.ok(intent)
 assert.equal(await confirmEmailSignup(db,intent.token,now+30*60*1000),null)
 assert.equal(db.state.creds.length,0)
 assert.equal(await confirmPasswordReset(db,intent.token,password,pepper,now+20),false)
})

test('duplicate Email registrations do not replace original account passwords or owner UUID',async()=>{
 const db=new MemoryD1(),{owner}=await signup(db)
 const again=await prepareEmailSignup(db,email,'another long password for test',pepper,now+300)
 assert.equal(again,null)
 assert.equal(db.state.users.length,1)
 assert.equal(db.state.creds[0].user_id,owner)
 assert.equal((await loginEmailPassword(db,email,password,pepper,now+500)).token.length,43)
 await assert.rejects(
   ()=>loginEmailPassword(db,email,'another long password for test',pepper,now+500),
   /EMAIL_AUTH_FAILED/)
})

test('sessions use random 256-bit token, D1 digest, owner scope, expiration and logout',async()=>{
 const db=new MemoryD1(),{owner}=await signup(db)
 const issued=await loginEmailPassword(db,email,password,pepper,now+200)
 assert.equal(issued.expiresAt,now+200+15*60*1000)
 assert.equal(db.state.sessions.length,1)
 assert.notEqual(db.state.sessions[0].token_sha256,issued.token)
 assert.match(db.state.sessions[0].token_sha256,/^[0-9a-f]{64}$/)
 assert.deepEqual(await authenticateEmailSession(db,issued.token,now+300),
   {userId:owner,expiresAt:issued.expiresAt})
 await assert.rejects(
   ()=>authenticateEmailSession(db,issued.token,issued.expiresAt),
   /AUTHENTICATION_REQUIRED/)
 await logoutEmailSession(db,issued.token,now+400)
 await assert.rejects(
   ()=>authenticateEmailSession(db,issued.token,now+401),
   /AUTHENTICATION_REQUIRED/)
 await assert.rejects(
   ()=>logoutEmailSession(db,issued.token,now+402),
   /AUTHENTICATION_REQUIRED/)
})

test('unknown account and wrong password never issue a session',async()=>{
 const db=new MemoryD1()
 await assert.rejects(
   ()=>loginEmailPassword(db,'nonexistent@example.com',password,pepper,now),
   /EMAIL_AUTH_FAILED/)
 await signup(db)
 await assert.rejects(
   ()=>loginEmailPassword(db,email,'wrong password too long to guess',pepper,now+200),
   /EMAIL_AUTH_FAILED/)
 assert.equal(db.state.sessions.length,0)
})

test('forgot password only issues tokens for verified accounts, is single-use and revokes ALL sessions',async()=>{
 const db=new MemoryD1()
 assert.equal(await preparePasswordReset(db,email,now),null)
 const {owner}=await signup(db)
 const first=await loginEmailPassword(db,email,password,pepper,now+200)
 const second=await loginEmailPassword(db,email,password,pepper,now+300)
 const reset=await preparePasswordReset(db,email,now+400)
 assert.ok(reset)
 assert.equal(JSON.stringify(db.state).includes(reset.token),false)
 const replacement='A brand new password after recovery!'
 assert.equal(await confirmPasswordReset(db,reset.token,replacement,pepper,now+500),true)
 assert.equal(db.state.creds[0].password_version,2)
 assert.equal(await confirmPasswordReset(db,reset.token,replacement,pepper,now+501),false)
 for(const session of [first,second]){
   await assert.rejects(
     ()=>authenticateEmailSession(db,session.token,now+600),
     /AUTHENTICATION_REQUIRED/)
 }
 await assert.rejects(()=>loginEmailPassword(db,email,password,pepper,now+700),/EMAIL_AUTH_FAILED/)
 const recent=await loginEmailPassword(db,email,replacement,pepper,now+800)
 assert.equal((await authenticateEmailSession(db,recent.token,now+850)).userId,owner)
})

test('15-minute reset expiration fails closed and does not change existing password',async()=>{
 const db=new MemoryD1();await signup(db)
 const reset=await preparePasswordReset(db,email,now+200)
 assert.ok(reset)
 assert.equal(await confirmPasswordReset(db,reset.token,'A new different password 1234',pepper,
   now+200+15*60*1000),false)
 assert.equal(db.state.creds[0].password_version,1)
 assert.equal((await loginEmailPassword(db,email,password,pepper,now+500)).token.length,43)
})

test('resetting password expires other unused reset links',async()=>{
 const db=new MemoryD1();await signup(db)
 const first=await preparePasswordReset(db,email,now+100)
 const second=await preparePasswordReset(db,email,now+200)
 assert.ok(first&&second)
 assert.equal(await confirmPasswordReset(db,first.token,'A changed password for tests',pepper,now+300),true)
 assert.equal(await confirmPasswordReset(db,second.token,'Another changed password for tests',pepper,now+301),false)
})

test('new D1 credential core is not imported by live Worker or exposed through UUID',async()=>{
 const router=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
 assert.doesNotMatch(router,/from ['"].*email-auth-core/)
 const env={DB:{prepare(){throw Error('must not query D1 in closed routes')}}}
 for(const url of ['/v1/auth/email/register','/v1/auth/email/verify',
   '/v1/auth/email/login','/v1/auth/email/forgot-password',
   '/v1/auth/email/reset-password','/v1/backups']){
   const {handleRequest}=await import('../backend/src/index')
   const response=await handleRequest(new Request('https://api.example.invalid'+url),env)
   assert.equal(response.status,503)
 }
})
