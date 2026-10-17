import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {STORE_NAMES} from '../src/db'
import {buildBackup} from '../src/backup-data'
import type {BackupStores} from '../src/backup-data'
import {buildCloudBackupSnapshot,verifyCloudBackupSnapshot} from '../src/cloud-backup-snapshot'
import {planFirstCloudUpload} from '../src/cloud-backup-chunks'
import {
  startCloudBackup,appendCloudBackupChunk,completeCloudBackup,
  readVerifiedCloudBackup
} from '../backend/src/cloud-backup-d1'
import type {
  CloudBackupD1,CloudStatement,AuthenticatedBackupOwner
} from '../backend/src/cloud-backup-d1'
import {handleRequest} from '../backend/src/index'
import type {Env} from '../backend/src/index'

type Snapshot={
  user_id:string,backup_id:string,schema_version:number,app_version:string,
  exported_at:string,created_at:string,status:string,sha256:string,
  byte_length:number,record_count:number,transaction_count:number,
  manifest_json:string,verified_at:string|null
}
type Entry={
  user_id:string,backup_id:string,store_name:string,record_key:string,
  payload_json:string,payload_sha256:string
}
type Params=(string|number|null)[]
class FakeD1 implements CloudBackupD1{
  snapshots=new Map<string,Snapshot>()
  entries=new Map<string,Entry>()
  queries:string[]=[]
  batches=0
  private snapshotKey(u:string,b:string){return u+'|'+b}
  private entryKey(u:string,b:string,s:string,k:string){return [u,b,s,k].join('|')}
  prepare(sql:string):CloudStatement{
    this.queries.push(sql)
    let params:Params=[]
    const stmt:CloudStatement={
      bind(...v){params=v;return stmt},
      first:async <T>():Promise<T|null>=>{
        const [u,b]=params
        if(sql.startsWith('SELECT backup_id,schema_version')){
          return (this.snapshots.get(this.snapshotKey(String(u),String(b)))??null) as T|null
        }
        if(sql.startsWith('SELECT payload_json,payload_sha256')){
          const [owner,backup,store,key]=params
          return (this.entries.get(this.entryKey(String(owner),String(backup),String(store),String(key)))??null) as T|null
        }
        throw Error('Unexpected SELECT: '+sql)
      },
      all:async <T>():Promise<{results:T[]}>=>{
        assert.match(sql,/SELECT store_name,record_key,payload_json,payload_sha256 FROM cloud_backup_entries/)
        const [u,b,limit,offset]=params
        const rows=[...this.entries.values()]
          .filter(x=>x.user_id===u&&x.backup_id===b)
          .sort((a,c)=>(a.store_name+'|'+a.record_key).localeCompare(c.store_name+'|'+c.record_key))
          .slice(Number(offset),Number(offset)+Number(limit))
        return {results:rows as T[]}
      },
      run:async()=>{
        if(sql.startsWith('INSERT INTO cloud_backup_snapshots')){
          const [u,b,schema,app,exported,created,sha,size,count,trades,manifest]=params
          const key=this.snapshotKey(String(u),String(b))
          if(this.snapshots.has(key))return {meta:{changes:0}}
          this.snapshots.set(key,{
            user_id:String(u),backup_id:String(b),schema_version:Number(schema),
            app_version:String(app),exported_at:String(exported),created_at:String(created),
            status:'staging',sha256:String(sha),byte_length:Number(size),
            record_count:Number(count),transaction_count:Number(trades),
            manifest_json:String(manifest),verified_at:null
          })
          return {meta:{changes:1}}
        }
        if(sql.startsWith('INSERT INTO cloud_backup_entries')){
          const [u,b,store,id,payload,sha]=params
          const key=this.entryKey(String(u),String(b),String(store),String(id))
          const snapshot=this.snapshots.get(this.snapshotKey(String(u),String(b)))
          if(!snapshot||snapshot.status!=='staging'||this.entries.has(key))
            return {meta:{changes:0}}
          this.entries.set(key,{
            user_id:String(u),backup_id:String(b),store_name:String(store),
            record_key:String(id),payload_json:String(payload),payload_sha256:String(sha)
          })
          return {meta:{changes:1}}
        }
        if(sql.startsWith('UPDATE cloud_backup_snapshots SET status=')){
          const [verified,u,b,subU,subB,expected,...rest]=params
          assert.equal(subU,u);assert.equal(subB,b)
          const snapshot=this.snapshots.get(this.snapshotKey(String(u),String(b)))
          if(!snapshot||snapshot.status!=='staging')return {meta:{changes:0}}
          const rows=[...this.entries.values()].filter(x=>x.user_id===u&&x.backup_id===b)
          if(rows.length!==expected)return {meta:{changes:0}}
          for(let i=0;i<STORE_NAMES.length;i++){
            const [u2,b2,store,count]=rest.slice(i*4,i*4+4)
            assert.equal(u2,u);assert.equal(b2,b)
            if(rows.filter(x=>x.store_name===store).length!==count)return {meta:{changes:0}}
          }
          snapshot.status='verified';snapshot.verified_at=String(verified)
          return {meta:{changes:1}}
        }
        throw Error('Unexpected UPDATE: '+sql)
      }
    }
    return stmt
  }
  async batch(statements:CloudStatement[]){
    this.batches++
    const results=[]
    for(const statement of statements)results.push(await statement.run())
    return results
  }
}
const user=crypto.randomUUID()
const owner={userId:user} as AuthenticatedBackupOwner
const secondOwner={userId:crypto.randomUUID()} as AuthenticatedBackupOwner

function makeStores():BackupStores{
  const groups=Object.fromEntries(STORE_NAMES.map(s=>[s,[]])) as BackupStores
  groups.reviewTrades=[
    {id:'manual:a',symbol:'2330',name:'台積電',date:'2026-10-17',
      time:'10:30:00',side:'buy',quantity:3,price:1500,gross:4500,
      orderId:'manual',status:'pending',fee:null,tax:null,note:'私人財務',
      createdAt:'2026-10-17T01:00:00Z',importedAt:'2026-10-17T01:00:00Z'},
    {id:'manual:b',symbol:'2317',name:'鴻海',date:'2026-10-17',
      time:'11:30:00',side:'sell',quantity:4,price:120,gross:480,
      orderId:'manual',status:'pending',fee:null,tax:null,
      createdAt:'2026-10-17T02:00:00Z',importedAt:'2026-10-17T02:00:00Z'}
  ]
  groups.stocks=[{symbol:'2330',name:'台積電',group:'半導體',note:'',
    createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z'}]
  groups.cashflows=[{id:'deposit:a',date:'2026-10-17',amount:1234,type:'deposit',note:'私有'}]
  return groups
}
async function prepared(){
  const snap=await buildCloudBackupSnapshot(buildBackup(makeStores(),'1.20.0'))
  const plan=await planFirstCloudUpload(snap)
  return {snap,plan}
}

test('chunk plan includes nine-table snapshot content without network or local mutations',async()=>{
  const {snap,plan}=await prepared()
  assert.equal(plan.totalRows,4)
  assert.equal(plan.chunks.flat().length,4)
  assert.equal(snap.manifest.storeCounts.reviewTrades,2)
  assert.equal(snap.manifest.storeCounts.cashflows,1)
  assert.equal(snap.manifest.storeCounts.imports,0)
  assert.equal(await verifyCloudBackupSnapshot(snap.canonicalPayload,snap.manifest),true)
  const db=new FakeD1()
  assert.equal(db.queries.length,0)
  assert.match(plan.backupId,/^[0-9a-f-]{36}$/)
})

test('staging, resumable chunks, server-side D1 readback and verified download',async()=>{
  const {snap,plan}=await prepared()
  const db=new FakeD1()
  assert.equal(await startCloudBackup(db,owner,plan.backupId,snap.manifest),'staging')
  assert.equal(await startCloudBackup(db,owner,plan.backupId,snap.manifest),'staging')
  await assert.rejects(
    ()=>startCloudBackup(db,owner,plan.backupId,{...snap.manifest,sha256:'0'.repeat(64)}),
    /CLOUD_BACKUP_INVALID/)
  for(const chunk of plan.chunks){
    assert.deepEqual(await appendCloudBackupChunk(db,owner,plan.backupId,chunk),
      {accepted:chunk.length})
    // Network response lost? A same-byte retry must be harmless.
    assert.deepEqual(await appendCloudBackupChunk(db,owner,plan.backupId,chunk),
      {accepted:chunk.length})
  }
  const manifest=await completeCloudBackup(db,owner,plan.backupId)
  assert.equal(manifest.sha256,snap.manifest.sha256)
  assert.equal(db.snapshots.get(user+'|'+plan.backupId)?.status,'verified')
  const downloaded=await readVerifiedCloudBackup(db,owner,plan.backupId)
  assert.deepEqual(downloaded,snap)
  assert.equal(await startCloudBackup(db,owner,plan.backupId,snap.manifest),'verified')
  await assert.rejects(
    ()=>appendCloudBackupChunk(db,owner,plan.backupId,plan.chunks[0]),
    /CLOUD_BACKUP_INVALID/)
})

test('a different account can neither start someone else backup id nor read its data',async()=>{
  const {snap,plan}=await prepared()
  const db=new FakeD1()
  await startCloudBackup(db,owner,plan.backupId,snap.manifest)
  await appendCloudBackupChunk(db,owner,plan.backupId,plan.chunks[0])
  await assert.rejects(
    ()=>readVerifiedCloudBackup(db,secondOwner,plan.backupId),
    /CLOUD_BACKUP_INVALID/)
  await assert.rejects(
    ()=>completeCloudBackup(db,secondOwner,plan.backupId),
    /CLOUD_BACKUP_INVALID/)
  assert.equal(db.snapshots.has(secondOwner.userId+'|'+plan.backupId),false)
})

test('a lost response may retry identical records, but conflicting row IDs never overwrite',async()=>{
  const {snap,plan}=await prepared()
  const db=new FakeD1()
  await startCloudBackup(db,owner,plan.backupId,snap.manifest)
  const rows=plan.chunks[0]
  await appendCloudBackupChunk(db,owner,plan.backupId,rows)
  const orig=db.entries.values().next().value as Entry
  const before=orig.payload_json
  const first=rows[0]
  const changed=JSON.stringify({...JSON.parse(first.payloadJson),note:'changed'})
  await assert.rejects(
    ()=>appendCloudBackupChunk(db,owner,plan.backupId,[{...first,payloadJson:changed}]),
    /CLOUD_BACKUP_INVALID/)
  assert.equal(orig.payload_json,before)
})

test('missing, corrupted, or extra cloud rows prevent false verified status',async()=>{
  const {snap,plan}=await prepared()
  const db=new FakeD1()
  await startCloudBackup(db,owner,plan.backupId,snap.manifest)
  await assert.rejects(
    ()=>completeCloudBackup(db,owner,plan.backupId),
    /CLOUD_BACKUP_INVALID/)
  assert.equal(db.snapshots.get(user+'|'+plan.backupId)?.status,'staging')
  for(const chunk of plan.chunks)await appendCloudBackupChunk(db,owner,plan.backupId,chunk)
  const item=[...db.entries.values()][0]
  item.payload_json=item.payload_json+' ' // stored byte content now mismatches saved SHA-256
  await assert.rejects(()=>completeCloudBackup(db,owner,plan.backupId),/CLOUD_BACKUP_INVALID/)
  assert.equal(db.snapshots.get(user+'|'+plan.backupId)?.status,'staging')
})

test('bad chunk count, invalid JSON and mismatched record key fail before any D1 writing',async()=>{
  const {snap,plan}=await prepared()
  const db=new FakeD1()
  await startCloudBackup(db,owner,plan.backupId,snap.manifest)
  const row=plan.chunks[0][0]
  const cases=[
    [{...row,recordKey:'another-id'}],
    [{...row,payloadJson:'not-json'}],
    [{...row,payloadJson:'{}'}],
    Array.from({length:33},()=>row),
    [row,row],
    [{...row,payloadJson:'x'.repeat(65537)}]
  ]
  for(const bad of cases){
    await assert.rejects(
      ()=>appendCloudBackupChunk(db,owner,plan.backupId,bad as typeof plan.chunks[0]),
      /CLOUD_BACKUP_INVALID|備份/)
  }
  assert.equal(db.entries.size,0)
})

test('D1 upload engine is deliberately unexposed until authentication and session exist',async()=>{
  const code=readFileSync(new URL('../backend/src/index.ts',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../src/BackupPanel.tsx',import.meta.url),'utf8')
  assert.doesNotMatch(code,/from ['"].*cloud-backup-d1/)
  assert.doesNotMatch(ui,/cloud-backup-chunks|startCloudBackup/)
  const env:Env={DB:{prepare(){throw Error('must not query DB')}}}
  for(const path of ['/v1/backups','/v1/backups/start','/v1/backups/upload','/v1/backups/finish']){
    const res=await handleRequest(new Request('https://api.example.invalid'+path,{method:'POST'}),env)
    assert.equal(res.status,503)
  }
  const storage=readFileSync(new URL('../backend/src/cloud-backup-d1.ts',import.meta.url),'utf8')
  assert.match(storage,/SELECT .* FROM cloud_backup_entries/)
  assert.match(storage,/status='staging'/)
  assert.match(storage,/SET status='verified'/)
  assert.doesNotMatch(storage,/console\.log|console\.error|localStorage|indexedDB|DELETE FROM/)
})
