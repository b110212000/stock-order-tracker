import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {allowedAuthOrigin,authCorsHeaders} from '../backend/src/auth-origin'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

const base='https://orderlead-api.example.invalid/v1/auth/login'
function request(origin?:string){
  return new Request(base,{method:'POST',headers:origin?{'Origin':origin}:{}})
}

test('production auth origin must equal trusted Pages origin, never a sibling subdomain',()=>{
  assert.equal(allowedAuthOrigin(request('https://b110212000.github.io')),
    'https://b110212000.github.io')
  for(const evil of [
    'https://b110212000.github.io.evil.example',
    'https://b110212000.github.io:444',
    'https://evil-b110212000.github.io',
    'http://b110212000.github.io',
    'https://b110212000.github.io/',
    'https://b110212000.github.io.evil.example/',
    'https://b110212000.github.io@evil.example',
    'null','file://','http://localhost:5173',
    'https://localhost:5173'
  ]){
    assert.equal(allowedAuthOrigin(request(evil)),null,evil)
  }
  assert.equal(allowedAuthOrigin(request()),null)
})

test('local development Origins are allowed only in development mode',()=>{
  for(const host of ['http://localhost:5173','http://127.0.0.1:5173']){
    assert.equal(allowedAuthOrigin(request(host),'development'),host)
    assert.equal(allowedAuthOrigin(request(host),'production'),null)
  }
  assert.equal(allowedAuthOrigin(request('http://localhost:5174'),'development'),null)
  assert.equal(allowedAuthOrigin(request('http://192.168.1.9:5173'),'development'),null)
})

test('CORS emits only exact requested allowed origin, never a wildcard',()=>{
  const headers=authCorsHeaders('https://b110212000.github.io')
  assert.equal(headers.get('Access-Control-Allow-Origin'),'https://b110212000.github.io')
  assert.equal(headers.get('Vary'),'Origin')
  assert.equal(headers.get('Access-Control-Allow-Headers'),
    'Content-Type,X-OrderLead-Nonce,X-OrderLead-Signature')
  assert.equal(headers.get('Access-Control-Allow-Methods'),'POST,OPTIONS')
  assert.throws(()=>authCorsHeaders('https://b110212000.github.io.evil.example'),
    /INVALID_CORS_ORIGIN/)
})

test('origin helper not imported by live Worker, all auth preflight requests stay locked',async()=>{
  const worker=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(worker,/from ['"].*auth-origin/)
  const env:Env={DB:{prepare(){throw Error('should never query D1')}}}
  const response=await handleRequest(
    new Request(base,{method:'OPTIONS',headers:{Origin:'https://b110212000.github.io'}}),
    env)
  assert.equal(response.status,503)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
})
