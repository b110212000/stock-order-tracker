import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {base64UrlEncode} from '../backend/src/auth-primitives'
import {
  normalizeEmailAddress,normalizePassword,createPasswordVerifier,
  verifyPassword,newEmailActionToken,emailActionTokenDigest,
  matchesEmailActionToken,PASSWORD_ITERATIONS,PASSWORD_KDF,
  EMAIL_RESET_TTL_MS,EMAIL_VERIFY_TTL_MS
} from '../backend/src/email-password-primitives'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const pepper=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
const anotherPepper=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))

test('Email normalization is case-insensitive; plus labels are not merged with other mailboxes',()=>{
  assert.equal(normalizeEmailAddress('  John.Doe+Deals@Example.COM  '),'john.doe+deals@example.com')
  assert.notEqual(normalizeEmailAddress('j.ohndoe@gmail.com'),normalizeEmailAddress('johndoe@gmail.com'))
  for(const bad of ['',42,'x@invalid','x@@mail.com','a..b@mail.com',
    '.a@mail.com','a.@mail.com','x@bad..com','x@-bad.com','x@bad-.com',
    'x@bad.c','x@bad.com?x=1','x@bad.com\nBcc:evil@x.com','你好@sample.com']){
    assert.throws(()=>normalizeEmailAddress(bad),/INVALID_EMAIL/,String(bad))
  }
})

test('human password minimum and Unicode NFC normalization are validated, never trivially SHA256ed',()=>{
  assert.equal(normalizePassword('correct horse battery staple'),'correct horse battery staple')
  // 5-character passwords are allowed for personal-use recovery, and the
  // former 12-to-14 character UI/backend mismatch is fixed.
  for(const accepted of ['abcde','123456789012','12345678901234','a'.repeat(15),'密碼abc']){
    assert.equal(normalizePassword(accepted),accepted.normalize('NFC'))
  }
  assert.equal([...normalizePassword('😀'.repeat(5))].length,5)
  assert.equal(normalizePassword('é'.repeat(16)),normalizePassword('e\u0301'.repeat(16)))
  for(const bad of ['',null,123,'abcd','😀'.repeat(4),'a'.repeat(129),
    'safe password\nunsafe','password\0'.repeat(4)]){
    assert.throws(()=>normalizePassword(bad),/INVALID_PASSWORD/)
  }
  assert.ok(PASSWORD_ITERATIONS>=600_000)
  assert.equal(PASSWORD_KDF,'pbkdf2-sha256-pepper-v1')
})

test('password verifier uses CSPRNG salt, secret pepper and slow PBKDF2, accepts only correct password',async()=>{
  const password='I create a sufficiently long password 🔒'
  const first=await createPasswordVerifier(password,pepper)
  const second=await createPasswordVerifier(password,pepper)
  assert.notEqual(first.passwordSalt,second.passwordSalt)
  assert.notEqual(first.passwordHash,second.passwordHash)
  assert.match(first.passwordSalt,/^[A-Za-z0-9_-]{22}$/)
  assert.match(first.passwordHash,/^[A-Za-z0-9_-]{43}$/)
  assert.equal(first.passwordIterations,600_000)
  assert.equal(first.passwordAlgorithm,PASSWORD_KDF)
  assert.equal(JSON.stringify(first).includes(password),false)
  assert.equal(JSON.stringify(first).includes(pepper),false)
  assert.equal(await verifyPassword(password,pepper,first),true)
  assert.equal(await verifyPassword(password+'!',pepper,first),false)
  assert.equal(await verifyPassword(password,anotherPepper,first),false)
})

test('reject invalid pepper and verifier metadata (no insecure fallback)',async()=>{
  await assert.rejects(()=>createPasswordVerifier('some long and secure password','test'),/PASSWORD_PEPPER_UNAVAILABLE/)
  const valid=await createPasswordVerifier('some long and secure password',pepper)
  await assert.rejects(()=>verifyPassword('some long and secure password','invalid',valid),
    /PASSWORD_PEPPER_UNAVAILABLE/)
  await assert.rejects(()=>verifyPassword('some long and secure password',pepper,
    {...valid,passwordIterations:1}),/INVALID_PASSWORD_VERIFIER/)
  await assert.rejects(()=>verifyPassword('some long and secure password',pepper,
    {...valid,passwordSalt:'invalid'}),/INVALID_PASSWORD_VERIFIER/)
  await assert.rejects(()=>verifyPassword('some long and secure password',pepper,
    {...valid,passwordAlgorithm:'md5' as typeof PASSWORD_KDF}),/INVALID_PASSWORD_VERIFIER/)
})

test('Email verification and reset tokens have different hashes, random values and fixed expiry policy',async()=>{
  const a=await newEmailActionToken('reset-password')
  const b=await newEmailActionToken('reset-password')
  const confirmation=await newEmailActionToken('verify-email')
  assert.notEqual(a.token,b.token)
  assert.notEqual(a.tokenSha256,b.tokenSha256)
  assert.match(a.token,/^[A-Za-z0-9_-]{43}$/)
  assert.match(a.tokenSha256,/^[a-f0-9]{64}$/)
  assert.equal(await matchesEmailActionToken('reset-password',a.token,a.tokenSha256),true)
  assert.equal(await matchesEmailActionToken('verify-email',a.token,a.tokenSha256),false)
  assert.equal(await matchesEmailActionToken('reset-password',b.token,a.tokenSha256),false)
  assert.equal(await matchesEmailActionToken('reset-password','fake',a.tokenSha256),false)
  assert.notEqual(await emailActionTokenDigest('verify-email',a.token),a.tokenSha256)
  assert.equal(EMAIL_RESET_TTL_MS,15*60*1000)
  assert.equal(EMAIL_VERIFY_TTL_MS,30*60*1000)
  assert.notEqual(confirmation.token,a.token)
})

test('0005 migration is strictly additive and isolates verified/pending identity and new password sessions',()=>{
  const sql=readFileSync(new URL('../backend/migrations/0005_email_password_auth.sql',import.meta.url),'utf8')
  const statements=sql.replace(/--[^\n]*/g,'')
  for(const table of ['auth_email_credentials','auth_email_signup_pending',
    'auth_email_reset_tokens','auth_email_sessions']){
    assert.match(statements,new RegExp('CREATE TABLE IF NOT EXISTS '+table))
  }
  assert.match(statements,/UNIQUE COLLATE NOCASE/)
  assert.match(statements,/password_iterations>=600000/)
  assert.match(statements,/password_version INTEGER NOT NULL DEFAULT 1/)
  assert.match(statements,/verify_token_sha256 TEXT NOT NULL UNIQUE/)
  assert.match(statements,/FOREIGN KEY\(user_id\) REFERENCES account_users\(id\)/)
  assert.match(statements,/FOREIGN KEY\(user_id\) REFERENCES auth_email_credentials\(user_id\)/)
  // ON DELETE CASCADE is a foreign-key rule, not an actual DELETE query.
  assert.doesNotMatch(statements,/^\s*(?:DROP|DELETE\s+FROM|UPDATE\s+\w+|REPLACE\s+INTO|ALTER\s+TABLE|TRUNCATE)\b/gmi)
  assert.doesNotMatch(statements,/CREATE TABLE IF NOT EXISTS (?:review_trade_records|cloud_backup_entries|auth_device_sessions)/)
})

test('schema, primitives, and old app do not activate Email endpoints or move financial data',async()=>{
  const router=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  const worker=readFileSync(new URL('../backend/src/auth-api.ts',import.meta.url),'utf8')
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  const config=readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8')
  assert.doesNotMatch(router,/from ['"].*email-password-primitives/)
  assert.doesNotMatch(worker,/email-password-primitives|auth_email_credentials/)
  const deploy=JSON.parse(config)
  assert.equal(deploy.secrets,undefined)
  assert.deepEqual(deploy.vars,{
    AUTH_ROUTES_ENABLED:'true',AUTH_BASIC_LIMITS_READY:'true',
    EMAIL_AUTH_ENABLED:'true',BACKUP_RECOVERY_ENABLED:'true'
  })
  assert.equal(deploy.vars.PASSWORD_PEPPER,undefined)
  assert.equal(deploy.vars.BACKUP_RECOVERY_ENABLED,'true')
  assert.doesNotMatch(config,/RESEND_API_KEY|SMTP_PASSWORD|SMTP_USER/)
  assert.match(app,/const VERSION='1\.22\.2'/)
  const env:Env={DB:{prepare(){throw Error('no real DB access')}}}
  for(const path of ['/v1/auth/email/register','/v1/auth/email/login',
    '/v1/auth/email/forgot-password','/v1/auth/email/reset-password',
    '/v1/backups','/v1/auth/login']){
    const res=await handleRequest(new Request('https://example.invalid'+path,{method:'POST'}),env)
    assert.equal(res.status,503,path)
    assert.deepEqual(await res.json(),{error:'SYNC_NOT_ENABLED'})
  }
})
