/**
 * Issue #53 — browser-local durable device key store.
 *
 * This is a SEPARATE IndexedDB database. It never opens, upgrades, clears or
 * modifies the existing "orderlead-local" transaction database.
 *
 * This module has NO network calls and is intentionally not imported by the
 * live App until server authentication + recovery UI pass real-device review.
 *
 * An off-device recovery-key backup MUST be confirmed before saving pending
 * identity. Its plaintext is intentionally NOT persisted: after a refresh
 * the user must use their offline copy. Never put tokens/keys in localStorage.
 */
import {isV4Uuid,publicDeviceKeyIsValid} from '../backend/src/auth-primitives'
import type {PendingCloudIdentity} from './cloud-identity'

export const CLOUD_AUTH_DB_NAME='orderlead-cloud-auth'
const CLOUD_AUTH_DB_VERSION=1
const STORE_NAME='device-identities'
const SLOT='active'
const SHA256=/^[0-9a-f]{64}$/

export type StoredCloudDeviceIdentity=Readonly<{
  slot:'active'
  userId:string
  deviceId:string
  publicJwk:JsonWebKey
  /** CryptoKey stored by IndexedDB structured clone. Never export it. */
  privateKey:CryptoKey
  recoveryVerifierSha256:string
  state:'pending'|'registered'
  createdAt:string
  registeredAt:string|null
}>

function invalid():never{throw Error('CLOUD_IDENTITY_INVALID')}

/** Reject corrupted records or any accidentally extractable signing key. */
export function validStoredCloudDevice(value:unknown):value is StoredCloudDeviceIdentity{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const row=value as Partial<StoredCloudDeviceIdentity>
  const key=row.privateKey
  const algorithm=key?.algorithm as EcKeyAlgorithm|undefined
  return row.slot==='active'&&isV4Uuid(row.userId)&&isV4Uuid(row.deviceId)&&
    row.userId!==row.deviceId&&publicDeviceKeyIsValid(row.publicJwk)&&
    typeof row.recoveryVerifierSha256==='string'&&SHA256.test(row.recoveryVerifierSha256)&&
    (row.state==='pending'||row.state==='registered')&&
    typeof row.createdAt==='string'&&Number.isFinite(Date.parse(row.createdAt))&&
    (row.registeredAt===null||(row.state==='registered'&&
      typeof row.registeredAt==='string'&&Number.isFinite(Date.parse(row.registeredAt))))&&
    (row.state==='pending'?row.registeredAt===null:row.registeredAt!==null)&&
    !!key&&key.type==='private'&&key.extractable===false&&
    algorithm?.name==='ECDSA'&&algorithm.namedCurve==='P-256'&&
    Array.isArray(key.usages)&&key.usages.includes('sign')
}

async function openCloudAuthDb(factory:IDBFactory):Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const req=factory.open(CLOUD_AUTH_DB_NAME,CLOUD_AUTH_DB_VERSION)
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(STORE_NAME)){
        req.result.createObjectStore(STORE_NAME,{keyPath:'slot'})
      }
    }
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(Error('CLOUD_IDENTITY_STORAGE_UNAVAILABLE'))
    req.onblocked=()=>reject(Error('CLOUD_IDENTITY_STORAGE_BLOCKED'))
  })
}
function getFactory(factory?:IDBFactory):IDBFactory{
  const selected=factory??(typeof indexedDB!=='undefined'?indexedDB:null)
  if(!selected)throw Error('CLOUD_IDENTITY_STORAGE_UNAVAILABLE')
  return selected
}

/**
 * An explicit confirmation comes from a separate onboarding screen that must
 * show the recovery secret exactly once and ask the user to store it OUTSIDE
 * this phone/browser. This function does not attempt to persist that secret.
 *
 * IndexedDB.add() (not put) prevents overwriting an existing device identity,
 * including an interrupted-but-possibly-server-registered one.
 */
export async function savePendingCloudDevice(
  pending:PendingCloudIdentity,
  confirmedOfflineRecoveryBackup:boolean,
  factory?:IDBFactory
):Promise<void>{
  if(confirmedOfflineRecoveryBackup!==true)throw Error('RECOVERY_BACKUP_REQUIRED')
  const row:StoredCloudDeviceIdentity={
    slot:SLOT,
    userId:pending.userId,
    deviceId:pending.deviceId,
    privateKey:pending.privateKey,
    publicJwk:pending.publicJwk,
    recoveryVerifierSha256:pending.recoveryVerifierSha256,
    state:'pending',
    createdAt:new Date().toISOString(),
    registeredAt:null
  }
  if(!validStoredCloudDevice(row))return invalid()
  const db=await openCloudAuthDb(getFactory(factory))
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,'readwrite')
      const request=tx.objectStore(STORE_NAME).add(row)
      request.onerror=()=>{ /* transaction abort handles the failure */ }
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(Error('CLOUD_IDENTITY_ALREADY_EXISTS_OR_STORAGE_FAILED'))
      tx.onabort=()=>reject(Error('CLOUD_IDENTITY_ALREADY_EXISTS_OR_STORAGE_FAILED'))
    })
  }finally{db.close()}
}

/** Returns only the device credential; the recovery secret cannot be read back. */
export async function readCloudDevice(
  factory?:IDBFactory
):Promise<StoredCloudDeviceIdentity|null>{
  const db=await openCloudAuthDb(getFactory(factory))
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,'readonly')
      let value:unknown
      const request=tx.objectStore(STORE_NAME).get(SLOT)
      request.onsuccess=()=>{value=request.result}
      tx.oncomplete=()=>{
        if(value===undefined){resolve(null);return}
        if(!validStoredCloudDevice(value)){reject(Error('CLOUD_IDENTITY_CORRUPTED'));return}
        resolve(value)
      }
      tx.onerror=()=>reject(Error('CLOUD_IDENTITY_READ_FAILED'))
      tx.onabort=()=>reject(Error('CLOUD_IDENTITY_READ_FAILED'))
    })
  }finally{db.close()}
}

/**
 * Call ONLY after authenticated server enrollment response has been checked
 * against this exact user+device. A lost network response must NOT erase
 * pending key material: retry a signed login before marking registered.
 */
export async function markCloudDeviceRegistered(
  userId:string,deviceId:string,factory?:IDBFactory
):Promise<void>{
  if(!isV4Uuid(userId)||!isV4Uuid(deviceId))return invalid()
  const db=await openCloudAuthDb(getFactory(factory))
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,'readwrite')
      const store=tx.objectStore(STORE_NAME)
      let error='CLOUD_IDENTITY_REGISTER_CONFIRMATION_FAILED'
      const get=store.get(SLOT)
      get.onsuccess=()=>{
        const value:unknown=get.result
        if(!validStoredCloudDevice(value)||
          value.userId!==userId||value.deviceId!==deviceId){
          tx.abort()
          return
        }
        if(value.state==='registered')return
        const updated:StoredCloudDeviceIdentity={
          ...value,state:'registered',registeredAt:new Date().toISOString()
        }
        store.put(updated)
      }
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(Error(error))
      tx.onabort=()=>reject(Error(error))
    })
  }finally{db.close()}
}
