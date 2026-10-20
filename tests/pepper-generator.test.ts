import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {decode32ByteToken} from '../backend/src/auth-primitives'

const html=readFileSync(new URL('../public/pepper-generator.html',import.meta.url),'utf8')
const script=readFileSync(new URL('../public/pepper-generator.js',import.meta.url),'utf8')

test('mobile key generator never sends or persists a private value',()=>{
  assert.match(html,/name="viewport"/)
  assert.match(html,/script src="\.\/pepper-generator\.js"/)
  assert.match(html,/connect-src 'none'/)
  assert.match(html,/noindex,nofollow,noarchive/)
  assert.match(html,/orderlead-api/)
  assert.match(html,/PASSWORD_PEPPER/)
  assert.match(script,/crypto\.getRandomValues\(bytes\)/)
  assert.match(script,/new Uint8Array\(32\)/)
  assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|cookie\s*=|console\./)
  assert.doesNotMatch(html,/<script\b(?![^>]*\bsrc=)/i)
})

test('browser generator creates canonical 43-character base64url and copies it',async()=>{
  const bindings=new Map<string,{value?:string,disabled?:boolean,textContent?:string,
    focus?:()=>void,select?:()=>void,addEventListener:(name:string,fn:()=>unknown)=>void}>()
  const callbacks=new Map<string,()=>unknown>()
  for(const id of ['secret','generate','copy','status']){
    bindings.set(id,{
      value:'',disabled:id==='copy',textContent:'',
      addEventListener(_name,fn){callbacks.set(id,fn)}
    })
  }
  let copied=''
  const sandbox={
    document:{getElementById:(id:string)=>bindings.get(id)},
    crypto:{getRandomValues:(buffer:Uint8Array)=>crypto.getRandomValues(buffer)},
    navigator:{clipboard:{writeText:async(text:string)=>{copied=text}}},
    btoa
  }
  runInNewContext(script,sandbox)
  const generate=callbacks.get('generate')
  assert.ok(generate)
  generate()
  const secret=bindings.get('secret')?.value
  assert.equal(secret?.length,43)
  assert.match(secret??'',/^[A-Za-z0-9_-]{43}$/)
  assert.equal(decode32ByteToken(secret)?.length,32)
  assert.equal(bindings.get('copy')?.disabled,false)
  const copy=callbacks.get('copy')
  assert.ok(copy)
  await copy()
  assert.equal(copied,secret)
})
