/**
 * Issue #73 / #53: INERT Email + password credential primitives for Workers.
 * No production routing, no real Email sending and no D1 data mutation here.
 *
 * Human-selected passwords MUST NOT use the legacy SHA-256 recoveryVerifier().
 * Use a fresh 128-bit salt, a SECRET 256-bit Cloudflare pepper, and
 * Cloudflare production caps each PBKDF2 invocation at 100,000 rounds.
 * New verifiers use a seven-stage chained construction (7 x 100k, NOT the
 * same output as a standard 700k PBKDF2). Existing standard 600k verifiers
 * remain explicitly distinguished by their recorded passwordIterations.
 * Argon2id is preferred if an audited Worker-compatible KDF is available.
 * Benchmark Workers CPU before production signup is considered functional.
 *
 * PASSWORD_PEPPER must be a Cloudflare Worker SECRET, never committed to
 * GitHub, returned to browsers, or included in a log / error / URL.
 */
import {base64UrlEncode,bodyDigest,compareVerifier,decode32ByteToken} from './auth-primitives'

export const PASSWORD_KDF='pbkdf2-sha256-pepper-v1' as const
/** Composite KDF v2 metadata sentinel: seven sequential 100k PBKDF2 calls. */
export const PASSWORD_ITERATIONS=700_000
export const LEGACY_PASSWORD_ITERATIONS=600_000
const WORKER_PBKDF2_CALL_MAX=100_000
export const EMAIL_VERIFY_TTL_MS=30*60*1000
export const EMAIL_RESET_TTL_MS=15*60*1000

const encoder=new TextEncoder()
const hex256=/^[a-f0-9]{64}$/
const base64Salt=/^[A-Za-z0-9_-]{22}$/
const base64Digest=/^[A-Za-z0-9_-]{43}$/

export type PasswordVerifier=Readonly<{
  passwordAlgorithm:typeof PASSWORD_KDF
  passwordIterations:number
  passwordSalt:string
  passwordHash:string
}>
export type EmailActionPurpose='verify-email'|'reset-password'

/**
 * Deliberately support a strict ASCII-mailbox subset in v1. All accepted
 * addresses have a single canonical spelling; non-ASCII/quoted mailboxes
 * fail with a clear validation error. Do NOT apply Gmail-specific dot or
 * plus-address transforms, which can conflate distinct actual mailboxes.
 */
export function normalizeEmailAddress(input:unknown):string{
  if(typeof input!=='string')throw Error('INVALID_EMAIL')
  const email=input.trim().toLowerCase()
  if(email.length<6||email.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[-a-z0-9.]+$/.test(email))throw Error('INVALID_EMAIL')
  const parts=email.split('@')
  if(parts.length!==2)return failEmail()
  const [local,domain]=parts
  if(local.length<1||local.length>64||local.startsWith('.')||local.endsWith('.')||
    local.includes('..')||!domain.includes('.')||domain.includes('..'))return failEmail()
  const labels=domain.split('.')
  if(labels.some(label=>label.length<1||label.length>63||label.startsWith('-')||label.endsWith('-')))return failEmail()
  if(!/^[a-z]{2,63}$/.test(labels[labels.length-1]))return failEmail()
  return email
}
function failEmail():never{throw Error('INVALID_EMAIL')}

/**
 * Passwords stay opaque: no forced uppercase/symbol rules or trimming.
 * NFC normalization is applied consistently on registration and login.
 * 5-128 Unicode code points (personal use); 1KB byte cap to prevent CPU/DoS expansion.
 */
export function normalizePassword(input:unknown):string{
  if(typeof input!=='string'||input.includes('\0'))throw Error('INVALID_PASSWORD')
  const password=input.normalize('NFC')
  const codePoints=[...password].length
  if(codePoints<5||codePoints>128||encoder.encode(password).byteLength>1024||
    /[\u0000-\u001f\u007f]/.test(password))throw Error('INVALID_PASSWORD')
  return password
}
function validatePepper(pepper:string):void{
  if(!decode32ByteToken(pepper))throw Error('PASSWORD_PEPPER_UNAVAILABLE')
}
function randomSalt():string{
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
}
function saltBytes(salt:string):Uint8Array{
  if(!base64Salt.test(salt))throw Error('INVALID_PASSWORD_VERIFIER')
  try{
    const text=atob(salt.replace(/-/g,'+').replace(/_/g,'/')+'==')
    const bytes=Uint8Array.from(text,c=>c.charCodeAt(0))
    if(bytes.length!==16||base64UrlEncode(bytes)!==salt)throw Error('INVALID_PASSWORD_VERIFIER')
    return bytes
  }catch{throw Error('INVALID_PASSWORD_VERIFIER')}
}
function validateVerifier(v:PasswordVerifier):void{
  if(!v||v.passwordAlgorithm!==PASSWORD_KDF||
    !Number.isSafeInteger(v.passwordIterations)||
    ![LEGACY_PASSWORD_ITERATIONS,PASSWORD_ITERATIONS].includes(v.passwordIterations)||
    typeof v.passwordSalt!=='string'||typeof v.passwordHash!=='string'||
    !base64Digest.test(v.passwordHash)||!decode32ByteToken(v.passwordHash)){
    throw Error('INVALID_PASSWORD_VERIFIER')
  }
  saltBytes(v.passwordSalt)
}
async function derive(password:string,pepper:string,salt:string,iterations:number):Promise<string>{
  validatePepper(pepper)
  const secret=decode32ByteToken(pepper)
  if(!secret)throw Error('PASSWORD_PEPPER_UNAVAILABLE')
  // HMAC pepper before expensive KDF so stolen D1 values alone are insufficient
  // for offline guessing without the independently protected Worker secret.
  const hmac=await crypto.subtle.importKey(
    'raw',new Uint8Array(secret).buffer,{name:'HMAC',hash:'SHA-256'},false,['sign']
  )
  const peppered=await crypto.subtle.sign(
    'HMAC',hmac,encoder.encode('orderlead-email-password-v1\n'+password)
  )
  if(iterations===LEGACY_PASSWORD_ITERATIONS){
    // Preserve original verifier algorithm; NEVER treat stored 600k hashes as
    // composite hashes. These require an environment allowing a 600k call.
    const key=await crypto.subtle.importKey('raw',peppered,'PBKDF2',false,['deriveBits'])
    const derived=await crypto.subtle.deriveBits({
      name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(saltBytes(salt)).buffer,
      iterations
    },key,256)
    return base64UrlEncode(new Uint8Array(derived))
  }
  if(iterations!==PASSWORD_ITERATIONS)throw Error('INVALID_PASSWORD_VERIFIER')
  // Seven *serial* 100k WebCrypto invocations. Each stage is salted and
  // domain-separated; the 32-byte derived output becomes the next key.
  // This is a composite password KDF, NOT standard PBKDF2(700k).
  const baseSalt=saltBytes(salt)
  let intermediate=new Uint8Array(peppered)
  for(let stage=0;stage<PASSWORD_ITERATIONS/WORKER_PBKDF2_CALL_MAX;stage++){
    const key=await crypto.subtle.importKey(
      'raw',new Uint8Array(intermediate).buffer,'PBKDF2',false,['deriveBits'])
    const stepSalt=new Uint8Array(18)
    stepSalt.set(baseSalt,0)
    stepSalt[16]=2 // composite KDF version
    stepSalt[17]=stage
    intermediate=new Uint8Array(await crypto.subtle.deriveBits({
      name:'PBKDF2',hash:'SHA-256',salt:stepSalt.buffer,
      iterations:WORKER_PBKDF2_CALL_MAX
    },key,256))
  }
  return base64UrlEncode(intermediate)
}
function equalDigest(a:string,b:string):boolean{
  if(!base64Digest.test(a)||!base64Digest.test(b))return false
  let diff=0
  for(let i=0;i<43;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i)
  return diff===0
}

/** Produces only a verifier, no password or pepper storage. */
export async function createPasswordVerifier(
  password:unknown,pepper:string
):Promise<PasswordVerifier>{
  const normalized=normalizePassword(password)
  validatePepper(pepper)
  const passwordSalt=randomSalt()
  const passwordHash=await derive(normalized,pepper,passwordSalt,PASSWORD_ITERATIONS)
  return Object.freeze({
    passwordAlgorithm:PASSWORD_KDF,
    passwordIterations:PASSWORD_ITERATIONS,passwordSalt,passwordHash
  })
}

/** Require same error outcome for nonexisting Email and invalid password at API layer. */
export async function verifyPassword(
  password:unknown,pepper:string,verifier:PasswordVerifier
):Promise<boolean>{
  validateVerifier(verifier)
  validatePepper(pepper)
  let normalized:string
  try{normalized=normalizePassword(password)}catch{return false}
  const result=await derive(normalized,pepper,verifier.passwordSalt,verifier.passwordIterations)
  return equalDigest(result,verifier.passwordHash)
}

/** High-entropy Email proof/reset token, shown only to the verified Email sender. */
export async function newEmailActionToken(
  purpose:EmailActionPurpose
):Promise<Readonly<{token:string,tokenSha256:string}>>{
  if(purpose!=='verify-email'&&purpose!=='reset-password')throw Error('INVALID_TOKEN_PURPOSE')
  const token=base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  return {token,tokenSha256:await emailActionTokenDigest(purpose,token)}
}

/**
 * Domain-separated token hashing stops a reset link being reused as an Email
 * verification link. Link validation MUST enforce the proper D1 row's expiry,
 * NULL consumed_at and atomic change. A digest match is not authorization.
 */
export async function emailActionTokenDigest(
  purpose:EmailActionPurpose,token:unknown
):Promise<string>{
  if((purpose!=='verify-email'&&purpose!=='reset-password')||
    !decode32ByteToken(token))throw Error('INVALID_EMAIL_ACTION_TOKEN')
  return bodyDigest('orderlead-email-action-v1\n'+purpose+'\n'+token)
}
export async function matchesEmailActionToken(
  purpose:EmailActionPurpose,token:unknown,expectedDigest:string
):Promise<boolean>{
  if(!hex256.test(expectedDigest))return false
  try{return compareVerifier(await emailActionTokenDigest(purpose,token),expectedDigest)}
  catch{return false}
}
