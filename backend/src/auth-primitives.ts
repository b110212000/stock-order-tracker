/**
 * Phase A-2-1: audited building blocks only. No public authentication,
 * enrollment, recovery or synchronization endpoints are activated here.
 *
 * UUIDs identify accounts/devices but never grant access. Access in a later
 * phase requires proof of possession of an authorized per-device private key,
 * or a separately saved 256-bit recovery secret.
 */

export const RECOVERY_KEY_PREFIX='olr1_'
export type DeviceProof={
  method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE'
  route:string
  issuedAt:number
  challenge:string
  bodySha256:string
}

const encoder=new TextEncoder()
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const hex256=/^[0-9a-f]{64}$/

export function isV4Uuid(value:unknown):value is string{
  return typeof value==='string'&&uuidPattern.test(value)
}

export function base64UrlEncode(data:Uint8Array):string{
  let binary=''
  for(const byte of data)binary+=String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}

export function decode32ByteToken(value:unknown):Uint8Array|null{
  if(typeof value!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(value))return null
  try{
    const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'=')
    if(binary.length!==32)return null
    const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0))
    // Reject alternate (noncanonical) text encodings for the same bytes.
    return base64UrlEncode(bytes)===value?bytes:null
  }catch{return null}
}

/** Show once and encourage storing outside the browser; NEVER persist plaintext. */
export function newRecoveryKey():string{
  const bytes=new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return RECOVERY_KEY_PREFIX+base64UrlEncode(bytes)
}

export function validRecoveryKey(value:unknown):value is string{
  return typeof value==='string'&&value.startsWith(RECOVERY_KEY_PREFIX)&&
    decode32ByteToken(value.slice(RECOVERY_KEY_PREFIX.length))!==null
}

async function sha256Hex(value:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value))
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
}

/**
 * Safe only because a recovery key is generated from 32 random bytes.
 * No passwords, short PINs, UUIDs or human-chosen phrases may use this hash.
 * Domain separation prevents accidental reuse in another verification system.
 */
export async function recoveryVerifier(accountUuid:string,recoveryKey:string):Promise<string>{
  if(!isV4Uuid(accountUuid)||!validRecoveryKey(recoveryKey))throw Error('INVALID_CREDENTIAL_FORMAT')
  return sha256Hex('orderlead-recovery-v1\n'+accountUuid+'\n'+recoveryKey)
}

/** Fixed-size equality; no early exit when both digests are well-formed. */
export function compareVerifier(given:string,expected:string):boolean{
  if(!hex256.test(given)||!hex256.test(expected))return false
  let mismatch=0
  for(let i=0;i<64;i++)mismatch|=given.charCodeAt(i)^expected.charCodeAt(i)
  return mismatch===0
}

function validateDeviceProof(p:DeviceProof):void{
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(p.method)||
     !/^\/v1\/[a-z0-9/_-]*(?:\?[a-z0-9_=&%-]+)?$/.test(p.route)||
     !Number.isSafeInteger(p.issuedAt)||p.issuedAt<0||
     !decode32ByteToken(p.challenge)||!hex256.test(p.bodySha256)){
    throw Error('INVALID_DEVICE_PROOF_FORMAT')
  }
}

/**
 * Sign *exactly* the same UTF-8 representation on the browser and server.
 * This binds signature to method, route (incl. query), body hash, issued time,
 * and single-use challenge. Server MUST validate expiration, audience and
 * atomically consume the stored nonce; signatures alone DO NOT stop replay.
 */
export function canonicalDeviceProof(p:DeviceProof):string{
  validateDeviceProof(p)
  return [
    'orderlead-device-proof-v1',p.method,p.route,
    String(p.issuedAt),p.challenge,p.bodySha256
  ].join('\n')
}

export async function bodyDigest(body:string):Promise<string>{
  return sha256Hex(body)
}

export function publicDeviceKeyIsValid(value:unknown):value is JsonWebKey{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const key=value as JsonWebKey
  return key.kty==='EC'&&key.crv==='P-256'&&
    decode32ByteToken(key.x)!==null&&decode32ByteToken(key.y)!==null&&
    key.d===undefined&&
    (key.use===undefined||key.use==='sig')&&
    (key.key_ops===undefined||(
      key.key_ops.length===1&&key.key_ops[0]==='verify'))
}

/**
 * Cryptographic verification only. Caller must additionally authenticate
 * device ownership, validate freshness, restrict action, and consume the
 * server-issued challenge once inside a D1 transaction.
 */
export async function verifyDeviceProof(
  publicKey:unknown, proof:DeviceProof,signature:string
):Promise<boolean>{
  if(!publicDeviceKeyIsValid(publicKey))return false
  const sig=decode64ByteSignature(signature)
  if(!sig)return false
  try{
    const payload=encoder.encode(canonicalDeviceProof(proof))
    const key=await crypto.subtle.importKey(
      'jwk',publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify'])
    return await crypto.subtle.verify(
      {name:'ECDSA',hash:'SHA-256'},key,sig,payload)
  }catch{return false}
}

function decode64ByteSignature(value:unknown):Uint8Array|null{
  if(typeof value!=='string'||!/^[-_A-Za-z0-9]{86}$/.test(value))return null
  try{
    const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'==')
    const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0))
    return bytes.length===64&&base64UrlEncode(bytes)===value?bytes:null
  }catch{return null}
}
