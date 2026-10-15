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
