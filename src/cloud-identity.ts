/**
 * Phase A-2-2 / Issue #53: a client-side *pending* identity.
 *
 * Deliberately NOT imported by the live PWA until registration and recovery
 * have an end-to-end, server-verified implementation. Creating this value does
 * not create an account and is NOT a promise that trades are backed up.
 *
 * Recovery secret must be displayed only during onboarding and saved OUTSIDE
 * the browser; do not persist, log, include in a URL, or send to analytics.
 */
import {
  base64UrlEncode, bodyDigest, canonicalDeviceProof,
  newRecoveryKey, publicDeviceKeyIsValid, recoveryVerifier
} from '../backend/src/auth-primitives'
import type {DeviceProof} from '../backend/src/auth-primitives'

export type PendingCloudIdentity=Readonly<{
  userId:string
  deviceId:string
  publicJwk:JsonWebKey
  /** Non-extractable Web Crypto signing key, never sent to the backend. */
  privateKey:CryptoKey
  /** 256-bit out-of-band recovery secret: reveal only once, never log/store. */
  recoveryKey:string
  /** Only this verifier may be stored by the backend. */
  recoveryVerifierSha256:string
}>

export type ChallengeToSign=Readonly<{
  /** Issued by the server; never choose or invent the challenge locally. */
  nonce:string
  /** Server's issuance timestamp, in milliseconds since Unix epoch. */
  issuedAt:number
}>

export async function createPendingCloudIdentity():Promise<PendingCloudIdentity>{
  if(typeof crypto?.randomUUID!=='function'||!crypto.subtle)throw Error('CRYPTO_UNAVAILABLE')
  const userId=crypto.randomUUID()
  const deviceId=crypto.randomUUID()
  const recoveryKey=newRecoveryKey()

  // Public key is exportable even though the private key is non-extractable.
  const keys=await crypto.subtle.generateKey(
    {name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']
  )
  if(keys.privateKey.extractable)throw Error('PRIVATE_KEY_MUST_NOT_BE_EXTRACTABLE')
  const publicJwk=await crypto.subtle.exportKey('jwk',keys.publicKey)
  if(!publicDeviceKeyIsValid(publicJwk))throw Error('INVALID_PUBLIC_KEY')

  return {
    userId,deviceId,publicJwk,
    privateKey:keys.privateKey,
    recoveryKey,
    recoveryVerifierSha256:await recoveryVerifier(userId,recoveryKey)
  }
}

/**
 * Device proof for a server challenge. Returned signature is a *separate*
 * header; it MUST NOT be inserted back into requestBody after signing.
 * Challenge expires after two minutes. The server still must validate and
 * consume it atomically before authenticating.
 */
export async function signCloudDeviceRequest(
  identity:Pick<PendingCloudIdentity,'privateKey'>,
  challenge:ChallengeToSign,
  request:Readonly<{
    method:DeviceProof['method']
    route:string
    body:string
  }>
):Promise<{proof:DeviceProof,signature:string}>{
  if(!Number.isSafeInteger(challenge.issuedAt)||
     Math.abs(Date.now()-challenge.issuedAt)>120_000){
    throw Error('CHALLENGE_EXPIRED')
  }
  if(identity.privateKey.type!=='private'||identity.privateKey.extractable||
     identity.privateKey.algorithm.name!=='ECDSA'){
    throw Error('INVALID_DEVICE_PRIVATE_KEY')
  }
  const proof:DeviceProof={
    method:request.method,route:request.route,
    issuedAt:challenge.issuedAt,challenge:challenge.nonce,
    bodySha256:await bodyDigest(request.body)
  }
  // Input format validation and canonicalization are shared with Workers.
  const message=new TextEncoder().encode(canonicalDeviceProof(proof))
  const signature=await crypto.subtle.sign(
    {name:'ECDSA',hash:'SHA-256'},identity.privateKey,message
  )
  return {proof,signature:base64UrlEncode(new Uint8Array(signature))}
}
