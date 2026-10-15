import test from 'node:test'
import assert from 'node:assert/strict'
import { sameScope,isOrderLeadCache } from '../src/repair-scope'
const path='https://b110212000.github.io/stock-order-tracker/'
test('unregister only the application scope, not other SW registrations',()=>{
  assert.equal(sameScope(path,path),true)
  assert.equal(sameScope(path.slice(0,-1),path),true)
  assert.equal(sameScope('https://b110212000.github.io/race-tracker/',path),false)
  assert.equal(sameScope('https://malicious.github.io/stock-order-tracker/',path),false)
})
test('clear matching Workbox caches without disturbing other GitHub Pages PWA apps',()=>{
  assert.equal(isOrderLeadCache('workbox-precache-v2-'+path,path),true)
  assert.equal(isOrderLeadCache('workbox-runtime-'+path,path),true)
  assert.equal(isOrderLeadCache('workbox-precache-v2-https://b110212000.github.io/race-tracker/',path),false)
  assert.equal(isOrderLeadCache('shared-api-cache',path),false)
})
test('ignore invalid cache scopes',()=>{
  assert.equal(isOrderLeadCache('workbox-precache-v2-https://example.com/foo','invalid-url'),false)
})
