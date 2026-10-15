import type { StagedTrade } from './types'
import { organizeGmailHistory } from './gmail-history'

export type ManualTradeInput={
  date:string
  time:string
  symbol:string
  name:string
  side:'buy'|'sell'
  quantity:string
  price:string
}
const ymd=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v

/** Returns a draft record without side effects. Caller persists only after validation. */
export function buildManualTrade(input:ManualTradeInput,id:string,createdAt:string):StagedTrade{
  const symbol=input.symbol.trim().toUpperCase()
  const name=input.name.trim()
  const qty=Number(input.quantity)
  const price=Number(input.price)
  if(!ymd(input.date))throw Error('請填寫有效的成交日期')
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw Error('請填寫有效的成交時間')
  if(!/^[A-Z0-9]{4,8}$/.test(symbol))throw Error('股票代號須為 4～8 碼英數字')
  if(!name||name.length>100)throw Error('請填寫股票名稱')
  if(!['buy','sell'].includes(input.side))throw Error('請選擇買進或賣出')
  if(!Number.isSafeInteger(qty)||qty<=0)throw Error('股數須為正整數（零股可直接輸入股數）')
  if(!Number.isFinite(price)||price<=0||price>10000000)throw Error('單價須為大於零的有效數字')
  const gross=Math.round(price*qty*100)/100
  if(!Number.isFinite(gross)||gross<=0||!Number.isSafeInteger(Math.round(gross*100)))
    throw Error('成交金額超出可接受範圍')
  return {
    id:'manual:'+id,date:input.date,time:input.time+':00',
    symbol,name,side:input.side,quantity:qty,price,gross,
    orderId:'manual',fee:null,tax:null,feeStatus:'manual-unverified',
    status:'pending',createdAt,importedAt:createdAt
  }
}

/** A new manual sale must be fully backed by earlier documented buys.
 * Do not add unmatched sales which could taint future FIFO costs. */
export function assertManualSaleCovered(existing:StagedTrade[],draft:StagedTrade):void{
  if(draft.side!=='sell')return
  const r=organizeGmailHistory([...existing,draft])
  const invalid=r.unmatched.find(x=>x.row.id===draft.id)
  if(invalid)throw Error('這筆賣出缺少 '+invalid.missing+' 股可配對的歷史買進；請先補上較早的買進紀錄。')
}
