/** Issue #91: owner-scoped, verified Email-session cloud backup API. */
import {allowedAuthOrigin,authCorsHeaders} from './auth-origin'
import {authenticateEmailSession} from './email-auth-core'
import {decode32ByteToken,isV4Uuid} from './auth-primitives'
import {
  startCloudBackup,appendCloudBackupChunk,completeCloudBackup,
  readVerifiedCloudBackup
} from './cloud-backup-d1'
import type {CloudBackupD1,AuthenticatedBackupOwner,CloudBackupRow} from './cloud-backup-d1'
import type {EnrollmentD1} from './auth-registration'
import type {CloudBackupManifest} from '../../src/cloud-backup-snapshot'

export interface BackupEnvironment{DB:CloudBackupD1&EnrollmentD1}
const headers={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'}
function reply(status:number,data:unknown,origin:string):Response{
  const h=new Headers(headers)
  authCorsHeaders(origin).forEach((v,k)=>h.set(k,v))
  return new Response(JSON.stringify(data),{status,headers:h})
}
function getToken(request:Request):string{
  const match=/^Bearer ([-_A-Za-z0-9]{43})$/.exec(request.headers.get('Authorization')||'')
  if(!match||!decode32ByteToken(match[1]))throw Error('AUTHENTICATION_REQUIRED')
  return match[1]
}
async function body(request:Request,max=270000):Promise<unknown>{
  if(request.headers.get('Content-Type')?.split(';')[0]?.toLowerCase()!=='application/json')
    throw Error('BAD_BODY')
  const length=request.headers.get('Content-Length')
  if(length&&(Number(length)>max||!Number.isFinite(Number(length))))throw Error('BAD_BODY')
  if(!request.body)throw Error('BAD_BODY')
  const reader=request.body.getReader(),chunks:Uint8Array[]=[]
  let total=0
  try{
    while(true){
      const part=await reader.read()
      if(part.done)break
      total+=part.value.byteLength
      if(total>max)throw Error('BAD_BODY')
      chunks.push(part.value)
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(total);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
  catch{throw Error('BAD_BODY')}
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
function exact(v:unknown,keys:string[]):v is Record<string,unknown>{
  return record(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',')
}
type SnapshotListRow={backup_id:string,exported_at:string,verified_at:string,
  record_count:number,transaction_count:number,byte_length:number,sha256:string}
export async function handleBackupRequest(request:Request,env:BackupEnvironment):Promise<Response>{
  const url=new URL(request.url),path=url.pathname
  const origin=allowedAuthOrigin(request,'production')
  if(!origin)return new Response(JSON.stringify({error:'ORIGIN_DENIED'}),{status:403,headers})
  if(url.protocol!=='https:'||url.search)return reply(403,{error:'REQUEST_DENIED'},origin)
  if(request.method==='OPTIONS'){
    const asked=request.headers.get('Access-Control-Request-Method')
    if(asked!=='GET'&&asked!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'},origin)
    return new Response(null,{status:204,headers:authCorsHeaders(origin)})
  }
  try{
    const bearer=getToken(request)
    // Brand is created ONLY after a real, revocable Email session lookup.
    const session=await authenticateEmailSession(env.DB,bearer)
    const owner={userId:session.userId} as AuthenticatedBackupOwner
    if(path==='/v1/backups'&&request.method==='GET'){
      const {results}=await env.DB.prepare(
        "SELECT backup_id,exported_at,verified_at,record_count,transaction_count,byte_length,sha256 FROM cloud_backup_snapshots WHERE user_id=? AND status='verified' ORDER BY verified_at DESC LIMIT 10"
      ).bind(owner.userId).all<SnapshotListRow>()
      return reply(200,{backups:results.map(r=>({
        backupId:r.backup_id,exportedAt:r.exported_at,verifiedAt:r.verified_at,
        total:r.record_count,transactions:r.transaction_count,byteLength:r.byte_length,
        sha256:r.sha256
      }))},origin)
    }
    if(path==='/v1/backups/start'&&request.method==='POST'){
      const input=await body(request,8000)
      if(!exact(input,['backupId','manifest'])||typeof input.backupId!=='string'||
        !isV4Uuid(input.backupId))throw Error('BAD_BODY')
      const state=await startCloudBackup(env.DB,owner,input.backupId,
        input.manifest as CloudBackupManifest)
      return reply(200,{state},origin)
    }
    const match=/^\/v1\/backups\/([a-f0-9-]{36})(?:\/(chunks|complete))?$/.exec(path)
    if(!match||!isV4Uuid(match[1]))return reply(404,{error:'NOT_FOUND'},origin)
    const backupId=match[1]
    if(match[2]==='chunks'&&request.method==='POST'){
      const input=await body(request)
      if(!exact(input,['rows'])||!Array.isArray(input.rows)||input.rows.length<1||
        input.rows.length>32||input.rows.some(r=>!exact(r,['storeName','recordKey','payloadJson'])||
          typeof r.storeName!=='string'||typeof r.recordKey!=='string'||
          typeof r.payloadJson!=='string'))throw Error('BAD_BODY')
      const result=await appendCloudBackupChunk(env.DB,owner,backupId,
        input.rows as CloudBackupRow[])
      return reply(200,result,origin)
    }
    if(match[2]==='complete'&&request.method==='POST'){
      const input=await body(request,100)
      if(!exact(input,[]))throw Error('BAD_BODY')
      const manifest=await completeCloudBackup(env.DB,owner,backupId)
      return reply(200,{verified:true,manifest},origin)
    }
    if(!match[2]&&request.method==='GET'){
      // Only verified snapshots are returned; reconstruct and checksum server side.
      const prepared=await readVerifiedCloudBackup(env.DB,owner,backupId)
      return reply(200,{manifest:prepared.manifest,payload:prepared.canonicalPayload},origin)
    }
    return reply(405,{error:'METHOD_NOT_ALLOWED'},origin)
  }catch(error){
    const reason=error instanceof Error?error.message:''
    if(reason==='AUTHENTICATION_REQUIRED')return reply(401,{error:'AUTH_REQUIRED'},origin)
    if(reason==='BAD_BODY'||reason==='CLOUD_BACKUP_INVALID')
      return reply(400,{error:'INVALID_BACKUP'},origin)
    // Do not leak SQL, tokens, PII or internal failures.
    return reply(503,{error:'BACKUP_UNAVAILABLE'},origin)
  }
}
