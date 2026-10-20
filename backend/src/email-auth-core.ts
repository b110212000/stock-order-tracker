/**
 * Issue #75: NOT ROUTED Email credential D1 core.
 * No public /v1/email routes are enabled by importing this module.
 * Passwords never enter D1, logs or message queues. All owner IDs here are
 * created by the server or read from verified D1 records, not client UUIDs.
 *
 * IMPORTANT: D1 batch is transactionally atomic on Cloudflare. These
 * functions still need real D1 replay/concurrency testing before activation.
 */
import {base64UrlEncode,bodyDigest,decode32ByteToken,isV4Uuid} from './auth-primitives'
import {
  createPasswordVerifier,verifyPassword,normalizeEmailAddress,
  newEmailActionToken,emailActionTokenDigest,EMAIL_RESET_TTL_MS,
  EMAIL_VERIFY_TTL_MS,PASSWORD_KDF
} from './email-password-primitives'
import type {PasswordVerifier} from './email-password-primitives'
import type {EnrollmentD1} from './auth-registration'

type StoredCredential={
  user_id:string
  email_normalized:string
  password_salt:string
  password_hash:string
  password_algorithm:string
  password_iterations:number
  password_version:number
  disabled_at:string|null
}
type ResetRow={user_id:string,password_version:number}
type VerifiedSessionRow={
  user_id:string,password_version:number,active_version:number,
  created_at:string,expires_at:string
}
const MINUTES_15=15*60*1000
const iso=(ms:number)=>new Date(ms).toISOString()
const validClock=(now:number)=>Number.isSafeInteger(now)&&now>=0&&now<8_640_000_000_000_000
const invalid=():never=>{throw Error('EMAIL_AUTH_FAILED')}
const authenticated=():never=>{throw Error('AUTHENTICATION_REQUIRED')}
const validToken=(token:unknown):token is string=>decode32ByteToken(token)!==null

async function lookupEmail(db:EnrollmentD1,email:string):Promise<StoredCredential|null>{
  return db.prepare(
    'SELECT user_id,email_normalized,password_salt,password_hash,password_algorithm,password_iterations,password_version,disabled_at FROM auth_email_credentials WHERE email_normalized=? AND disabled_at IS NULL LIMIT 1'
  ).bind(email).first<StoredCredential>()
}
function verifierFrom(row:StoredCredential):PasswordVerifier{
  if(!isV4Uuid(row.user_id)||!Number.isSafeInteger(row.password_version)||
    row.password_version<1||row.password_algorithm!==PASSWORD_KDF)return invalid()
  return {
    passwordSalt:row.password_salt,passwordHash:row.password_hash,
    passwordIterations:row.password_iterations,passwordAlgorithm:PASSWORD_KDF
  }
}
async function sessionHash(token:string):Promise<string>{
  return bodyDigest('orderlead-email-session-v1\n'+token)
}

export type EmailMailIntent=Readonly<{
  /** Only the trusted route may pass these to the private MLB mail RPC. */
  kind:'verify'|'reset'
  email:string
  token:string
  messageId:string
}>
export type IssuedEmailSession=Readonly<{token:string,expiresAt:number}>
export type AuthenticatedEmailOwner=Readonly<{userId:string,expiresAt:number}>

/**
 * Pending registration does not reserve the permanent Email account.
 * No server account is created until an Email verification token is consumed.
 * The caller must reserve IP + email rate budgets BEFORE calling this.
 */
export async function prepareEmailSignup(
  db:EnrollmentD1,emailInput:unknown,password:unknown,
  pepper:string,now=Date.now()
):Promise<EmailMailIntent|null>{
  if(!validClock(now))return invalid()
  const email=normalizeEmailAddress(emailInput)
  let verifier:PasswordVerifier
  try{verifier=await createPasswordVerifier(password,pepper)}
  catch(error){
    if(error instanceof Error&&['INVALID_PASSWORD','PASSWORD_PEPPER_UNAVAILABLE'].includes(error.message))
      throw error
    // Constant diagnostic category, never SQL messages or credentials.
    throw Error('SIGNUP_HASH_UNAVAILABLE')
  }
  // KDF above executes even for an existing Email to reduce enumeration timing.
  let already:StoredCredential|null
  try{already=await lookupEmail(db,email)}
  catch{throw Error('SIGNUP_LOOKUP_UNAVAILABLE')}
  if(already)return null
  const {token,tokenSha256}=await newEmailActionToken('verify-email')
  const pendingId=crypto.randomUUID()
  let changes:number
  try{
    const result=await db.prepare(
      'INSERT INTO auth_email_signup_pending (pending_id,email_normalized,password_salt,password_hash,password_algorithm,password_iterations,verify_token_sha256,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)'
    ).bind(pendingId,email,verifier.passwordSalt,verifier.passwordHash,
      verifier.passwordAlgorithm,verifier.passwordIterations,
      tokenSha256,iso(now),iso(now+EMAIL_VERIFY_TTL_MS)).run()
    changes=result.meta.changes
  }catch{throw Error('SIGNUP_WRITE_UNAVAILABLE')}
  if(changes!==1)return invalid()
  return {kind:'verify',email,token,messageId:pendingId}
}

/**
 * A failed verification never creates a usable account; one-time consume,
 * account_users and verified password credentials are in a single D1 batch.
 * A stale/duplicate or already-registered address returns false.
 */
export async function confirmEmailSignup(
  db:EnrollmentD1,token:unknown,now=Date.now()
):Promise<{userId:string}|null>{
  if(!validToken(token)||!validClock(now))return null
  const digest=await emailActionTokenDigest('verify-email',token)
  const row=await db.prepare(
    'SELECT pending_id FROM auth_email_signup_pending WHERE verify_token_sha256=? AND consumed_at IS NULL AND expires_at>? LIMIT 1'
  ).bind(digest,iso(now)).first<{pending_id:string}>()
  if(!row||!isV4Uuid(row.pending_id))return null
  const owner=crypto.randomUUID(),stamp=iso(now)
  const batch=await db.batch([
    db.prepare(
      'UPDATE auth_email_signup_pending SET consumed_at=? WHERE verify_token_sha256=? AND consumed_at IS NULL AND expires_at>?'
    ).bind(stamp,digest,stamp),
    db.prepare(
      "INSERT INTO account_users (id,auth_provider,auth_subject,created_at) SELECT ?,'email',p.email_normalized,? FROM auth_email_signup_pending p WHERE p.verify_token_sha256=? AND p.consumed_at=? AND NOT EXISTS (SELECT 1 FROM account_users a WHERE a.auth_provider='email' AND a.auth_subject=p.email_normalized) AND NOT EXISTS (SELECT 1 FROM auth_email_credentials c WHERE c.email_normalized=p.email_normalized)"
    ).bind(owner,stamp,digest,stamp),
    db.prepare(
      'INSERT INTO auth_email_credentials (user_id,email_normalized,email_verified_at,password_salt,password_hash,password_algorithm,password_iterations,password_version,created_at,password_changed_at,disabled_at) SELECT ?,p.email_normalized,?,p.password_salt,p.password_hash,p.password_algorithm,p.password_iterations,1,?,?,NULL FROM auth_email_signup_pending p INNER JOIN account_users a ON a.id=? AND a.auth_provider=\'email\' AND a.auth_subject=p.email_normalized WHERE p.verify_token_sha256=? AND p.consumed_at=?'
    ).bind(owner,stamp,stamp,stamp,owner,digest,stamp)
  ])
  if(batch.length!==3||batch.some(r=>r.meta.changes!==1))return null
  return {userId:owner}
}

/**
 * Unknown addresses execute a dummy *600k iteration* password KDF, to avoid
 * a fast "account does not exist" oracle. The API still must use a shared
 * error response, a per-address/IP throttle, and an edge WAF.
 */
export async function loginEmailPassword(
  db:EnrollmentD1,emailInput:unknown,password:unknown,pepper:string,
  now=Date.now()
):Promise<IssuedEmailSession>{
  if(!validClock(now))return invalid()
  const email=normalizeEmailAddress(emailInput)
  const row=await lookupEmail(db,email)
  if(!row){
    // Unknown addresses must return the SAME error for malformed passwords
    // as known addresses. Otherwise short/invalid passwords leak existence.
    try{await createPasswordVerifier(password,pepper)}
    catch(error){
      if(error instanceof Error&&error.message==='PASSWORD_PEPPER_UNAVAILABLE')
        throw error
    }
    return invalid()
  }
  const good=await verifyPassword(password,pepper,verifierFrom(row))
  if(!good)return invalid()
  const token=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const stamp=iso(now),expiresAt=now+MINUTES_15
  const result=await db.prepare(
    'INSERT INTO auth_email_sessions (token_sha256,user_id,password_version,created_at,expires_at,revoked_at) SELECT ?,user_id,password_version,?,?,NULL FROM auth_email_credentials WHERE user_id=? AND password_version=? AND disabled_at IS NULL'
  ).bind(await sessionHash(token),stamp,iso(expiresAt),
    row.user_id,row.password_version).run()
  if(result.meta.changes!==1)return invalid()
  return {token,expiresAt}
}

/** Validate the token, its remaining life, owner and CURRENT password version. */
export async function authenticateEmailSession(
  db:EnrollmentD1,token:unknown,now=Date.now()
):Promise<AuthenticatedEmailOwner>{
  if(!validToken(token)||!validClock(now))return authenticated()
  const row=await db.prepare(
    'SELECT s.user_id,s.password_version,c.password_version AS active_version,s.created_at,s.expires_at FROM auth_email_sessions s INNER JOIN auth_email_credentials c ON c.user_id=s.user_id WHERE s.token_sha256=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.disabled_at IS NULL AND s.password_version=c.password_version LIMIT 1'
  ).bind(await sessionHash(token),iso(now)).first<VerifiedSessionRow>()
  if(!row||!isV4Uuid(row.user_id)||row.password_version!==row.active_version||
    !Number.isSafeInteger(row.active_version))return authenticated()
  const created=Date.parse(row.created_at),expiresAt=Date.parse(row.expires_at)
  if(!validClock(created)||!validClock(expiresAt)||created>now||
    expiresAt<=now||expiresAt-created!==MINUTES_15)return authenticated()
  return {userId:row.user_id,expiresAt}
}

export async function logoutEmailSession(
  db:EnrollmentD1,token:unknown,now=Date.now()
):Promise<void>{
  await authenticateEmailSession(db,token,now)
  const result=await db.prepare(
    'UPDATE auth_email_sessions SET revoked_at=? WHERE token_sha256=? AND revoked_at IS NULL'
  ).bind(iso(now),await sessionHash(token as string)).run()
  if(result.meta.changes!==1)return authenticated()
}

/**
 * This accepts only a VERIFIED and active email credential. The caller must
 * return the same generic public response for missing/present email. Rate
 * budgets are reserved separately before invoking.
 */
export async function preparePasswordReset(
  db:EnrollmentD1,emailInput:unknown,now=Date.now()
):Promise<EmailMailIntent|null>{
  if(!validClock(now))return invalid()
  const email=normalizeEmailAddress(emailInput)
  const row=await lookupEmail(db,email)
  if(!row)return null
  verifierFrom(row)
  const {token,tokenSha256}=await newEmailActionToken('reset-password')
  const result=await db.prepare(
    'INSERT INTO auth_email_reset_tokens (token_sha256,user_id,created_at,expires_at,consumed_at) VALUES (?,?,?,?,NULL)'
  ).bind(tokenSha256,row.user_id,iso(now),iso(now+EMAIL_RESET_TTL_MS)).run()
  if(result.meta.changes!==1)return invalid()
  return {kind:'reset',email,token,messageId:crypto.randomUUID()}
}

/**
 * Reset invalidates ALL sessions immediately through password_version CAS,
 * even on other devices. Every step is part of one atomic Cloudflare D1 batch.
 * A failed/expired/replayed token returns false without granting a session.
 */
export async function confirmPasswordReset(
  db:EnrollmentD1,token:unknown,newPassword:unknown,
  pepper:string,now=Date.now()
):Promise<boolean>{
  if(!validToken(token)||!validClock(now))return false
  const digest=await emailActionTokenDigest('reset-password',token)
  const row=await db.prepare(
    'SELECT r.user_id,c.password_version FROM auth_email_reset_tokens r INNER JOIN auth_email_credentials c ON r.user_id=c.user_id WHERE r.token_sha256=? AND r.consumed_at IS NULL AND r.expires_at>? AND c.disabled_at IS NULL LIMIT 1'
  ).bind(digest,iso(now)).first<ResetRow>()
  if(!row||!isV4Uuid(row.user_id)||!Number.isSafeInteger(row.password_version)||
    row.password_version<1)return false
  const v=await createPasswordVerifier(newPassword,pepper),stamp=iso(now)
  const result=await db.batch([
    db.prepare(
      'UPDATE auth_email_reset_tokens SET consumed_at=? WHERE token_sha256=? AND consumed_at IS NULL AND expires_at>? AND user_id=?'
    ).bind(stamp,digest,stamp,row.user_id),
    db.prepare(
      'UPDATE auth_email_credentials SET password_salt=?,password_hash=?,password_algorithm=?,password_iterations=?,password_version=password_version+1,password_changed_at=? WHERE user_id=? AND password_version=? AND disabled_at IS NULL AND EXISTS (SELECT 1 FROM auth_email_reset_tokens WHERE token_sha256=? AND user_id=? AND consumed_at=?)'
    ).bind(v.passwordSalt,v.passwordHash,v.passwordAlgorithm,v.passwordIterations,
      stamp,row.user_id,row.password_version,digest,row.user_id,stamp),
    db.prepare(
      'UPDATE auth_email_reset_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM auth_email_credentials WHERE user_id=? AND password_version=?)'
    ).bind(stamp,row.user_id,row.user_id,row.password_version+1)
  ])
  return result.length===3&&result[0].meta.changes===1&&result[1].meta.changes===1
}
