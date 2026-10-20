import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOUD_SESSION_KEY,forgetCloudSession,readCloudSession,
  rememberCloudSession,validCloudSession
} from '../src/cloud-email-session'

const token='A'.repeat(43)

test('cloud Email session survives component unmount and reloading same tab without storing password or Email',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')
  const values=new Map<string,string>()
  const fake={getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{values.set(key,value)},
    removeItem:(key:string)=>{values.delete(key)}}
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:fake})
  try{
    forgetCloudSession()
    const session={token,expiresAt:Date.now()+14*60*1000}
    rememberCloudSession(session)
    assert.deepEqual(readCloudSession(),session)
    assert.equal(values.has(CLOUD_SESSION_KEY),true)
    assert.deepEqual(JSON.parse(values.get(CLOUD_SESSION_KEY)!),session)
    assert.equal(values.get(CLOUD_SESSION_KEY)!.includes('email'),false)
    assert.equal(values.get(CLOUD_SESSION_KEY)!.includes('password'),false)
    // After an actual page reload, module memory starts empty. With the
    // stored token restored, /me must still verify ownership on the server.
    forgetCloudSession()
    values.set(CLOUD_SESSION_KEY,JSON.stringify(session))
    assert.deepEqual(readCloudSession(),session)
    forgetCloudSession()
    assert.equal(readCloudSession(),null)
    assert.equal(values.has(CLOUD_SESSION_KEY),false)
  }finally{
    forgetCloudSession()
    if(original)Object.defineProperty(globalThis,'sessionStorage',original)
    else Reflect.deleteProperty(globalThis,'sessionStorage')
  }
})

test('expired, malformed and oversized sessions do not authorize signed-in UI',()=>{
  const now=Date.now()
  assert.equal(validCloudSession({token,expiresAt:now+14*60*1000},now),true)
  for(const invalid of [
    {token,expiresAt:now-1},{token,expiresAt:now+1000},
    {token,expiresAt:now+16*60*1000},
    {token:'bad',expiresAt:now+14*60*1000},
    {token,expiresAt:now+14*60*1000,email:'spoofed@example.com'},
    {token,expiresAt:Number.POSITIVE_INFINITY},null
  ])assert.equal(validCloudSession(invalid,now),false)
})

test('storage-blocked mobile browsers still keep short-lived session in memory for navigation',()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')
  Object.defineProperty(globalThis,'sessionStorage',{
    configurable:true,get(){throw Error('storage disabled')}
  })
  try{
    const session={token,expiresAt:Date.now()+14*60*1000}
    rememberCloudSession(session)
    assert.deepEqual(readCloudSession(),session)
    forgetCloudSession()
    assert.equal(readCloudSession(),null)
  }finally{
    if(old)Object.defineProperty(globalThis,'sessionStorage',old)
    else Reflect.deleteProperty(globalThis,'sessionStorage')
  }
})
