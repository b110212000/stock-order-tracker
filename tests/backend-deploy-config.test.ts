import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'

const backend=new URL('../backend/',import.meta.url)
const read=(relative:string)=>readFileSync(new URL(relative,backend),'utf8')

test('Cloudflare Workers Builds deploys the backend only with correct D1 binding',()=>{
  // A pure JSON file is also valid JSONC, which avoids differences between
  // Cloudflare Builds/Wrangler parsers.
  const config=JSON.parse(read('wrangler.jsonc'))
  assert.equal(config.name,'orderlead-api')
  assert.equal(config.main,'src/index.ts')
  assert.ok(existsSync(new URL(config.main,backend)))
  assert.equal(config.workers_dev,true)
  assert.equal(config.d1_databases.length,1)
  const db=config.d1_databases[0]
  assert.deepEqual({
    binding:db.binding,database_name:db.database_name,database_id:db.database_id,
    migrations_dir:db.migrations_dir
  },{
    binding:'DB',database_name:'orderlead-db',
    database_id:'2a936aeb-c4f8-4827-a264-d4f56d5e8471',
    migrations_dir:'migrations'
  })
  assert.ok(existsSync(new URL(db.migrations_dir+'/0001_foundation.sql',backend)))
  assert.ok(existsSync(new URL(db.migrations_dir+'/0002_auth_credentials.sql',backend)))
  assert.equal(config.vars,undefined)
  assert.equal(config.secrets,undefined)
  assert.equal(config.account_id,undefined)
})

test('the Worker build workflow never migrates production D1 automatically',()=>{
  const backendPkg=JSON.parse(read('package.json'))
  assert.equal(backendPkg.scripts.typecheck,'tsc --noEmit')
  assert.equal(backendPkg.scripts.deploy,'wrangler deploy')
  const guide=read('README.md')
  assert.match(guide,/Root directory|Path/)
  assert.match(guide,/npm run typecheck/)
  assert.match(guide,/npx wrangler deploy/)
  assert.match(guide,/Cloudflare.*token|API token/i)
  assert.match(guide,/does not.*D1 Edit/i)
  assert.match(guide,/does not.*update Wrangler/i)
  assert.match(guide,/SYNC_NOT_ENABLED/)
  const config=read('wrangler.jsonc')
  assert.doesNotMatch(config,/cloudflare_api_token|api[_-]?token|account_id|secret|password|private_key/i)
})

test('production schema initialization files are additive and have no personal records',()=>{
  for(const sqlFile of ['0001_foundation.sql','0002_auth_credentials.sql']){
    const sql=read('migrations/'+sqlFile)
    assert.match(sql,/CREATE TABLE IF NOT EXISTS/)
    assert.doesNotMatch(sql,/^\s*(?:DROP TABLE|DELETE FROM|TRUNCATE|INSERT INTO|REPLACE INTO|UPDATE)\s/mi)
  }
  const code=read('src/index.ts')
  assert.match(code,/SYNC_NOT_ENABLED/)
  assert.match(code,/SELECT 1 AS healthy/)
})
