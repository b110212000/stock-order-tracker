import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOUD_SESSION_KEY,forgetCloudSession,readCloudSession,
  rememberCloudSession,validCloudSession
} from '../src/cloud-email-session'

const token='A'.repeat(43)
const DAY=24*60*60*1000

test('remembered cloud login survives full PWA restart, never stores Email/password',()=>{
  const oldLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const oldSession=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')
  const saved=new Map<string,string>(),tabs=new Map<string,string>()
  const store=(db:Map<string,string>)=>({
    getItem:(k:string)=>db.get(k)??null,
    setItem:(k:string,v:string)=>{db.set(k,v)},
    removeItem:(k:string)=>{db.delete(k)}
  })
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store(saved)})
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:store(tabs)})
  try{
    forgetCloudSession()
    const session={token,expiresAt:Date.now()+29*DAY}
    rememberCloudSession(session)
    assert.deepEqual(readCloudSession(),session)
    assert.deepEqual(JSON.parse(saved.get(CLOUD_SESSION_KEY)!),session)
    assert.equal(saved.get(CLOUD_SESSION_KEY)!.includes('email'),false)
    assert.equal(saved.get(CLOUD_SESSION_KEY)!.includes('password'),false)
    // A normal unmount or component recreation does not touch module memory.
    assert.deepEqual(readCloudSession(),session)
    forgetCloudSession()
    saved.set(CLOUD_SESSION_KEY,JSON.stringify(session))
    assert.deepEqual(readCloudSession(),session)
    forgetCloudSession()
    assert.equal(readCloudSession(),null)
    assert.equal(saved.has(CLOUD_SESSION_KEY),false)
  }finally{
    forgetCloudSession()
    if(oldLocal)Object.defineProperty(globalThis,'localStorage',oldLocal)
    else Reflect.deleteProperty(globalThis,'localStorage')
    if(oldSession)Object.defineProperty(globalThis,'sessionStorage',oldSession)
    else Reflect.deleteProperty(globalThis,'sessionStorage')
  }
})

test('session validation rejects expiration, spoofed emails and excessive expiry',()=>{
  const now=Date.now()
  assert.equal(validCloudSession({token,expiresAt:now+29*DAY},now),true)
  for(const value of [
    {token,expiresAt:now-1},{token,expiresAt:now+1000},
    {token,expiresAt:now+31*DAY},
    {token:'bad',expiresAt:now+29*DAY},
    {token,expiresAt:now+29*DAY,email:'spoofed@example.com'},
    {token,expiresAt:Infinity},null
  ])assert.equal(validCloudSession(value,now),false)
})

test('blocked storage continues to support in-memory navigation',()=>{
  const oldLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const oldSession=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')
  for(const k of ['localStorage','sessionStorage'])
    Object.defineProperty(globalThis,k,{configurable:true,get(){throw Error('blocked')}})
  try{
    const session={token,expiresAt:Date.now()+29*DAY}
    rememberCloudSession(session)
    assert.deepEqual(readCloudSession(),session)
    forgetCloudSession()
    assert.equal(readCloudSession(),null)
  }finally{
    if(oldLocal)Object.defineProperty(globalThis,'localStorage',oldLocal)
    else Reflect.deleteProperty(globalThis,'localStorage')
    if(oldSession)Object.defineProperty(globalThis,'sessionStorage',oldSession)
    else Reflect.deleteProperty(globalThis,'sessionStorage')
  }
})
