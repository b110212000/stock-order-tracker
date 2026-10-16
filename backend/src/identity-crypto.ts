/**
 * OrderLead A-2 identity primitives; NOT YET EXPOSED VIA HTTP.
 *
 * A user UUID and a device UUID are non-secret identifiers. They never grant
 * access to data. Authentication will require an authorized device signature
 * or a high-entropy recovery secret. The future HTTP layer MUST atomically
 * store a unique nonce and verify the device has not been revoked BEFORE
 * treating a valid signature as an authenticated session.
 */
const encoder=new TextEncoder()
const RECOVERY_LENGTH=32
const NONCE_LENGTH=16
const SIGNATURE_LENGTH=64 // WebCrypto P-256 ECDSA (r||s), not DER
const MAX_CLOCK_SKEW=120 // seconds
const MAX_SIGNED_BODY=1024*1024

export function isUuidV4(input:string):boolean{
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input)
}

/** base64url without padding; canonical string check rejects alternate encodings. */
export function encodeUrl64(input:Uint8Array):string{
  let binary=''
  for(const byte of input)binary+=String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
export function decodeUrl64(input:string,expectedBytes:number):Uint8Array|null{
  if(!Number.isInteger(expectedBytes)||expectedBytes<1||expectedBytes>4096||
    !/^[A-Za-z0-9_-]+$/.test(input)||input.length>6000)return null
  try{
    const binary=atob(input.replace(/-/g,'+').replace(/_/g,'/')+
      '='.repeat((4-input.length%4)%4))
    if(binary.length!==expectedBytes)return null
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0))
    if(encodeUrl64(bytes)!==input)return null
    return bytes
  }catch{return null}
}
function bufferOf(bytes:Uint8Array):ArrayBuffer{
  const dest=new Uint8Array(bytes.length)
  dest.set(bytes)
  return dest.buffer
}
export function createRecoverySecret():string{
  return encodeUrl64(crypto.getRandomValues(new Uint8Array(RECOVERY_LENGTH)))
}
/** HMAC with a server-held pepper, not an unkeyed digest stored beside data. */
export async function recoveryVerifier(recovery:string,serverPepper:string):Promise<string>{
  if(!decodeUrl64(recovery,RECOVERY_LENGTH))throw Error('Invalid recovery secret format')
  if(encoder.encode(serverPepper).length<32)throw Error('Server pepper is not configured')
  const secret=await crypto.subtle.importKey('raw',bufferOf(encoder.encode(serverPepper)),
    {name:'HMAC',hash:'SHA-256'},false,['sign'])
  const value=await crypto.subtle.sign('HMAC',secret,
    bufferOf(encoder.encode('orderlead/recovery/v1/'+recovery)))
  return encodeUrl64(new Uint8Array(value))
}

/** Non-extractable PRIVATE signing key; public SPKI may be exported. */
export async function createDeviceSigningKeys():Promise<{
  privateKey:CryptoKey,publicKeySpki:string
}>{
  const pair=await crypto.subtle.generateKey(
    {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']) as CryptoKeyPair
  if(pair.privateKey.extractable)throw Error('Private key unexpectedly extractable')
  const spki=await crypto.subtle.exportKey('spki',pair.publicKey)
  return {privateKey:pair.privateKey,publicKeySpki:encodeUrl64(new Uint8Array(spki))}
}
async function publicDeviceKey(spki:string):Promise<CryptoKey|null>{
  // P-256 SubjectPublicKeyInfo is typically 91 bytes; reject oversized inputs.
  if(spki.length>256||spki.length<60)return null
  try{
    const binary=atob(spki.replace(/-/g,'+').replace(/_/g,'/')+
      '='.repeat((4-spki.length%4)%4))
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0))
    if(encodeUrl64(bytes)!==spki||bytes.length<64||bytes.length>150)return null
    return await crypto.subtle.importKey('spki',bufferOf(bytes),
      {name:'ECDSA',namedCurve:'P-256'},false,['verify'])
  }catch{return null}
}

export type SignedDeviceRequest={
  userId:string
  deviceId:string
  method:string
  pathAndQuery:string
  timestampSec:number
  nonce:string
  body:Uint8Array
  signature:string
}
/** Produce exactly the same canonical bytes on browser and server. */
export async function deviceProofMessage(fields:Omit<SignedDeviceRequest,'signature'>):Promise<Uint8Array>{
  const digest=await crypto.subtle.digest('SHA-256',bufferOf(fields.body))
  return encoder.encode([
    'orderlead-device-proof-v1',
    fields.userId,fields.deviceId,fields.method,fields.pathAndQuery,
    String(fields.timestampSec),fields.nonce,encodeUrl64(new Uint8Array(digest))
  ].join('\n'))
}
/**
 * Only cryptographic proof; NOT an authorization decision.
 *
 * Future route MUST additionally verify in D1:
 * (1) device belongs to authenticated user and is active
 * (2) one-time nonce insertion succeeds, unique(user_id,device_id,nonce)
 * (3) account / device not revoked; enforce origin and rate limits
 */
export async function verifyDeviceProof(fields:SignedDeviceRequest,
  publicKeySpki:string,nowSec=Math.floor(Date.now()/1000)):Promise<boolean>{
  if(!isUuidV4(fields.userId)||!isUuidV4(fields.deviceId)||
    !Number.isSafeInteger(fields.timestampSec)||!Number.isSafeInteger(nowSec)||
    Math.abs(nowSec-fields.timestampSec)>MAX_CLOCK_SKEW||
    !decodeUrl64(fields.nonce,NONCE_LENGTH)||
    !decodeUrl64(fields.signature,SIGNATURE_LENGTH)||
    !['GET','POST','PUT','PATCH','DELETE'].includes(fields.method)||
    !/^\/v1\/[a-zA-Z0-9/_-]*(?:\?[a-zA-Z0-9=&_%+.-]*)?$/.test(fields.pathAndQuery)||
    fields.body.length>MAX_SIGNED_BODY)return false
  const key=await publicDeviceKey(publicKeySpki)
  if(!key)return false
  const signature=decodeUrl64(fields.signature,SIGNATURE_LENGTH)
  if(!signature)return false
  try{
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,
      bufferOf(signature),bufferOf(await deviceProofMessage(fields)))
  }catch{return false}
}
