import type { StagedTrade } from './types'

export type SourceTrade = {
  id: string
  date: string
  symbol: string
  name: string
  side: 'buy'|'sell'
  quantity: number
  price: number
  gross: number
  orderId: string
  time: string
  fee: number|null
  tax: number|null
  feeStatus?: string
}

const isRecord=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)
const ymd=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)
export function readTradePreview(json:unknown):SourceTrade[]{
  if(!isRecord(json)||json.format!=='orderlead-gmail-trades'||json.schema!==1||!Array.isArray(json.records))throw Error('請選擇 OrderLead 郵件交易預覽 JSON')
  if(json.records.length<1||json.records.length>10000)throw Error('交易筆數不在允許範圍內')
  const ids=new Set<string>()
  return json.records.map((value:unknown,i:number)=>{
    if(!isRecord(value))throw Error('第 '+(i+1)+' 筆資料格式不正確')
    const v=value
    if(typeof v.id!=='string'||!/^fubon:\d{4}-\d{2}-\d{2}:[A-Za-z0-9]{4,8}:[BS]:[A-Za-z0-9]{3,16}:\d{2}:\d{2}:\d{2}$/.test(v.id)||ids.has(v.id))throw Error('第 '+(i+1)+' 筆識別碼不正確或重複')
    ids.add(v.id)
    if(typeof v.date!=='string'||!ymd(v.date)||typeof v.symbol!=='string'||!/^[A-Za-z0-9]{4,8}$/.test(v.symbol)||typeof v.name!=='string'||!v.name.trim()||v.name.length>100)throw Error('第 '+(i+1)+' 筆股票或日期有誤')
    if(v.side!=='buy'&&v.side!=='sell')throw Error('第 '+(i+1)+' 筆買賣方向錯誤')
    if(!num(v.quantity)||!Number.isSafeInteger(v.quantity)||v.quantity<=0||!num(v.price)||v.price<=0||!num(v.gross)||v.gross<=0||Math.abs(v.gross-v.price*v.quantity)>1.01)throw Error('第 '+(i+1)+' 筆成交數量、價格或價金不一致')
    if(typeof v.orderId!=='string'||v.orderId.length>40||typeof v.time!=='string'||!/^\d{2}:\d{2}:\d{2}$/.test(v.time))throw Error('第 '+(i+1)+' 筆委託或時間錯誤')
    if(v.fee!==null&&(!num(v.fee)||v.fee<0))throw Error('第 '+(i+1)+' 筆手續費錯誤')
    if(v.tax!==null&&(!num(v.tax)||v.tax<0))throw Error('第 '+(i+1)+' 筆交易稅錯誤')
    return {id:v.id,date:v.date,symbol:v.symbol,name:v.name,side:v.side,quantity:v.quantity,price:v.price,gross:v.gross,orderId:v.orderId,time:v.time,fee:v.fee,tax:v.tax,feeStatus:typeof v.feeStatus==='string'?v.feeStatus:'unverified'} as SourceTrade
  })
}
export function toStaged(rows:SourceTrade[]):StagedTrade[]{
 return rows.map(x=>({
  ...x, status:'pending',importedAt:new Date().toISOString(),id:x.id,
  createdAt:new Date(x.date+'T'+x.time+'+08:00').toISOString()
 }))
}
export function roughShortfalls(source: {date:string,time?:string,symbol:string,side:string,quantity:number}[]){
 const inventory=new Map<string,number>()
 const errors:{date:string,symbol:string,shortfall:number}[]=[]
 for(const row of [...source].sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''))){
  const available=inventory.get(row.symbol)||0
  if(row.side==='sell'&&row.quantity>available)errors.push({date:row.date,symbol:row.symbol,shortfall:row.quantity-available})
  inventory.set(row.symbol,available+(row.side==='buy'?row.quantity:-row.quantity))
 }
 return errors
}

/** Public import template format for any user / broker.
 * The legacy Gmail schema remains readable for existing downloaded files,
 * but is no longer required for new imports. */
export function readAnyTradePreview(json:unknown):SourceTrade[]{
  if(isRecord(json)&&json.format==='orderlead-gmail-trades')return readTradePreview(json)
  if(!isRecord(json)||json.format!=='orderlead-trades'||json.schema!==1||!Array.isArray(json.records))
    throw Error('請使用 OrderLead 交易匯入範例 JSON')
  if(!json.records.length||json.records.length>10000)
    throw Error('交易筆數須為 1～10,000 筆')
  const ids=new Set<string>()
  return json.records.map((value:unknown,i:number)=>{
    const row=i+1
    if(!isRecord(value))throw Error('第 '+row+' 筆交易格式錯誤')
    const v=value
    if(typeof v.date!=='string'||!ymd(v.date))throw Error('第 '+row+' 筆日期錯誤，須為 YYYY-MM-DD')
    if(typeof v.symbol!=='string'||!/^[a-zA-Z0-9]{4,8}$/.test(v.symbol)||
       typeof v.name!=='string'||!v.name.trim()||v.name.length>100)
      throw Error('第 '+row+' 筆股票代號或名稱錯誤')
    if(v.side!=='buy'&&v.side!=='sell')throw Error('第 '+row+' 筆 side 須填 buy 或 sell')
    if(!num(v.quantity)||!Number.isSafeInteger(v.quantity)||v.quantity<=0||
       !num(v.price)||v.price<=0||v.price>10000000)
      throw Error('第 '+row+' 筆股數或價格不正確')
    const time=v.time===undefined?'09:00:00':v.time
    if(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time))
      throw Error('第 '+row+' 筆時間錯誤，須為 HH:mm 或 HH:mm:ss')
    const normalizedTime=time.length===5?time+':00':time
    const expectedGross=Math.round(v.quantity*v.price*100)/100
    const gross=v.gross===undefined?expectedGross:v.gross
    if(!num(gross)||gross<=0||!Number.isSafeInteger(Math.round(gross*100))||
       Math.abs(gross-v.quantity*v.price)>1.01)
      throw Error('第 '+row+' 筆成交價金與股數、價格不一致')
    const fee=v.fee===undefined?null:v.fee
    const tax=v.tax===undefined?null:v.tax
    if(fee!==null&&(!num(fee)||fee<0))throw Error('第 '+row+' 筆手續費錯誤')
    if(tax!==null&&(!num(tax)||tax<0))throw Error('第 '+row+' 筆交易稅錯誤')
    const canonical=JSON.stringify([v.date,normalizedTime,v.symbol.toUpperCase(),v.name.trim(),
      v.side,v.quantity,v.price,gross])
    // Stable, two independent non-cryptographic hashes + occurrence index.
    // Reimporting the identical file will produce the identical IDs and skip duplicates.
    let hashA=2166136261,hashB=5381
    for(let j=0;j<canonical.length;j++){
      const ch=canonical.charCodeAt(j)
      hashA=Math.imul(hashA^ch,16777619)>>>0
      hashB=(Math.imul(hashB,33)^ch)>>>0
    }
    const generated='orderlead-import:'+hashA.toString(16).padStart(8,'0')+
      hashB.toString(16).padStart(8,'0')+':'+i
    const id=v.id===undefined?generated:v.id
    if(typeof id!=='string'||!(/^[a-zA-Z0-9:._-]{1,100}$/.test(id))||ids.has(id))
      throw Error('第 '+row+' 筆交易 ID 重複或不正確')
    ids.add(id)
    const orderId=v.orderId===undefined?'file':v.orderId
    if(typeof orderId!=='string'||orderId.length>40)throw Error('第 '+row+' 筆委託單號錯誤')
    return {
      id,date:v.date,time:normalizedTime,symbol:v.symbol.toUpperCase(),
      name:v.name.trim(),side:v.side,quantity:v.quantity,
      price:v.price,gross,orderId,fee,tax,feeStatus:'unverified'
    } as SourceTrade
  })
}
