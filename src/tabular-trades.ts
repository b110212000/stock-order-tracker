import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate'
import type {SourceTrade} from './import-trades'

const HEADERS=['日期(必)','股票代號(必)','交易類型(必)','股數(必)','成交價(必)','成交時間(選)','手續費(選)','交易稅(選)'] as const
const SAMPLE=[
 ['2026-11-02','2330','買進','10','1450','','1',''],
 ['2026-11-04','0050','定期定額','20','65.5','','',''],
 ['2026-11-06','2330','賣出','5','1490','13:25','1','2']
]
const MAX_ROWS=10000
const MAX_XML=16*1024*1024
export type TabularDraft=Omit<SourceTrade,'name'|'feeStatus'> & {row:number,recurring:boolean,timeDefaulted:boolean}
export type TabularResult={drafts:TabularDraft[],errors:string[]}

function xmlEscape(value:string):string{
 return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}
function unescapeXml(value:string):string{
 return value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(?:amp|lt|gt|quot|apos);/gi,m=>{
  if(m==='&amp;')return '&'
  if(m==='&lt;')return '<'
  if(m==='&gt;')return '>'
  if(m==='&quot;')return '"'
  if(m==='&apos;')return "'"
  const hit=/^&#(x[0-9a-f]+|[0-9]+);$/i.exec(m)
  if(!hit)return m
  const n=hit[1].toLowerCase().startsWith('x')?parseInt(hit[1].slice(1),16):Number(hit[1])
  return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):''
 })
}
function attr(tag:string,name:string):string|undefined{
 const found=new RegExp('(?:^|\\s)'+name.replace(':','\\:')+'\\s*=\\s*("([^"]*)"|\'([^\']*)\')').exec(tag)
 return found?unescapeXml(found[2]??found[3]??''):undefined
}
function onlySafeXml(text:string):string{
 if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text))throw Error('Excel 含不支援的 XML 定義')
 return text
}
function columnIndex(ref:string):number{
 const match=/^([A-Z]+)\d*$/i.exec(ref)
 if(!match)return -1
 let index=0
 for(const ch of match[1].toUpperCase())index=index*26+ch.charCodeAt(0)-64
 return index-1
}
function parseCsv(text:string):{row:number,cells:string[]}[]{
 const result:{row:number,cells:string[]}[]=[]
 let cells:string[]=[],field='',quoted=false,afterQuote=false,row=1,start=1
 const emit=()=>{cells.push(field);result.push({row:start,cells});cells=[];field='';afterQuote=false}
 for(let i=0;i<text.length;i++){
  const ch=text[i]
  if(quoted){
   if(ch==='"'&&text[i+1]==='"'){field+='"';i++}
   else if(ch==='"'){quoted=false;afterQuote=true}
   else {field+=ch;if(ch==='\n')row++}
   continue
  }
  if(ch==='"'&&field===''){quoted=true;continue}
  if(ch==='"'&&afterQuote){throw Error('CSV 第 '+row+' 列引號格式不正確')}
  if(ch===',' ){cells.push(field);field='';afterQuote=false;continue}
  if(ch==='\n'||ch==='\r'){
   if(ch==='\r'&&text[i+1]==='\n')i++
   emit();row++;start=row
   continue
  }
  if(afterQuote&&ch.trim()!=='')throw Error('CSV 第 '+row+' 列引號後有多餘文字')
  if(!afterQuote)field+=ch
 }
 if(quoted)throw Error('CSV 引號未結束（從第 '+start+' 列開始）')
 if(field!==''||cells.length>0)emit()
 return result
}
function csvCell(s:string):string{
 return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s
}
export function createCsvTemplate():Uint8Array{
 return strToU8('\ufeff'+[HEADERS,...SAMPLE].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n')
}
function sheetCell(value:string,ref:string,style=''):string{
 return '<c r="'+ref+'" t="inlineStr"'+(style?' s="'+style+'"':'')+'><is><t>'+xmlEscape(value)+'</t></is></c>'
}
export function createExcelTemplate():Uint8Array{
 const rows=[HEADERS,...SAMPLE]
 const sheetRows=rows.map((values,index)=>
  '<row r="'+(index+1)+'">'+values.map((value,i)=>
   sheetCell(value,String.fromCharCode(65+i)+(index+1),index===0?'1':i===1?'2':'')
  ).join('')+'</row>'
 ).join('')
 const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
 const types=declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
  '<Default Extension="xml" ContentType="application/xml"/>'+
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
  '</Types>'
 const rels=declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
 const workbook=declaration+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '+
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
  '<sheets><sheet name="交易紀錄" sheetId="1" r:id="rId1"/></sheets></workbook>'
 const workbookRels=declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'+
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
 const styles=declaration+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'+
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'+
  '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'+
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'
 const sheet=declaration+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<dimension ref="A1:H4"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>'+
  '<cols><col min="1" max="1" width="19" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>'+
  '<col min="3" max="3" width="18" customWidth="1"/><col min="4" max="8" width="16" customWidth="1"/></cols>'+
  '<sheetData>'+sheetRows+'</sheetData></worksheet>'
 const archive={
  '[Content_Types].xml':strToU8(types),
  '_rels/.rels':strToU8(rels),
  'xl/workbook.xml':strToU8(workbook),
  'xl/_rels/workbook.xml.rels':strToU8(workbookRels),
  'xl/styles.xml':strToU8(styles),
  'xl/worksheets/sheet1.xml':strToU8(sheet)
 }
 return zipSync(archive,{level:5})
}
function cellTexts(xml:string):string{
 const text=[...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(hit=>unescapeXml(hit[1]))
 return text.join('')
}
function extractXml(files:Record<string,Uint8Array>,path:string):string{
 const bytes=files[path]
 if(!bytes)throw Error('Excel 缺少工作表：'+path)
 return onlySafeXml(strFromU8(bytes))
}
function readExcel(bytes:Uint8Array):{row:number,cells:string[]}[]{
 if(bytes.length>10*1024*1024)throw Error('Excel 超過 10 MB')
 let total=0
 const files=unzipSync(bytes,{filter:({name,originalSize})=>{
  const wanted=(name==='xl/workbook.xml'||name==='xl/_rels/workbook.xml.rels'||name==='xl/styles.xml'||
   name==='xl/sharedStrings.xml'||/^xl\/worksheets\/[^/]+\.xml$/.test(name))
  if(!wanted)return false
  if(originalSize>MAX_XML)throw Error('Excel 工作表過大')
  total+=originalSize
  if(total>MAX_XML)throw Error('Excel 解壓資料量過大')
  return true
 }})
 const workbook=extractXml(files,'xl/workbook.xml')
 const sheetTag=[...workbook.matchAll(/<sheet\s+([^>]*?)\/?>/g)].map(v=>v[1])
 const selected=sheetTag.find(t=>attr(t,'name')==='交易紀錄')??sheetTag[0]
 if(!selected)throw Error('Excel 沒有工作表')
 const relId=attr(selected,'r:id')
 if(!relId)throw Error('Excel 工作表連結錯誤')
 const relXml=extractXml(files,'xl/_rels/workbook.xml.rels')
 const relationships=[...relXml.matchAll(/<Relationship\s+([^>]*?)\/?>/g)].map(v=>v[1])
 const target=relationships.find(tag=>attr(tag,'Id')===relId)
 const rawTarget=target&&attr(target,'Target')
 if(!rawTarget||rawTarget.includes('..')||rawTarget.includes('\\')||rawTarget.includes('://'))
  throw Error('Excel 工作表路徑不正確')
 const path=rawTarget.startsWith('/')?rawTarget.slice(1):rawTarget.startsWith('xl/')?rawTarget:'xl/'+rawTarget
 if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path))throw Error('Excel 工作表路徑不正確')
 const sheet=extractXml(files,path)
 const shared=files['xl/sharedStrings.xml']?extractXml(files,'xl/sharedStrings.xml'):''
 const strings=[...shared.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(v=>cellTexts(v[1]))
 const date1904=/date1904="(?:1|true)"/.test(workbook)
 const result:{row:number,cells:string[]}[]=[]
 for(const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)){
  const number=Number(attr(rowMatch[1],'r'))||result.length+1
  if(number>MAX_ROWS+100)throw Error('Excel 列數超過上限')
  const cells:string[]=[]
  for(const cm of rowMatch[2].matchAll(/<c\b([^>]*?)>([\s\S]*?)<\/c>/g)){
   const index=columnIndex(attr(cm[1],'r')??'')
   if(index<0||index>100)throw Error('Excel 儲存格欄位不正確')
   if(/<f(?:\s|>)/.test(cm[2]))throw Error('Excel 第 '+number+' 列含公式，請改成固定值')
   const type=attr(cm[1],'t')
   const v=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cm[2])?.[1]??''
   const value=type==='inlineStr'?cellTexts(cm[2]):type==='s'?strings[Number(v)]??'':unescapeXml(v)
   cells[index]=value
  }
  result.push({row:number,cells})
 }
 if(result.length===0)throw Error('Excel 工作表沒有資料')
 // Store date-system marker only in a sentinel, never in a user column.
 if(date1904)result.push({row:0,cells:['__EXCEL_1904__']})
 return result
}
function normalizeHeader(s:string):string{
 return s.trim().replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')').replace(/\((必|選)\)$/,'')
}
function dateFromSerial(raw:string,system1904:boolean):string{
 const n=Number(raw)
 if(!Number.isFinite(n)||n<1||n>300000)throw Error('Excel 日期不正確')
 const millis=Date.UTC(system1904?1904:1899,system1904?0:11,system1904?1:30)+Math.floor(n)*86400000
 return new Date(millis).toISOString().slice(0,10)
}
function tradeDate(s:string,excel:boolean,system1904:boolean):string{
 let raw=s.trim()
 if(excel&&/^\d{1,6}(?:\.\d+)?$/.test(raw))raw=dateFromSerial(raw,system1904)
 const match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw)
 if(!match)throw Error('日期須為 YYYY-MM-DD 或 YYYY/MM/DD')
 const normalized=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0')
 const d=new Date(normalized+'T00:00:00Z')
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==normalized)throw Error('日期不存在')
 return normalized
}
function tradeTime(raw:string,excel:boolean):{time:string,defaulted:boolean}{
 const s=raw.trim()
 if(!s)return {time:'10:45:00',defaulted:true}
 if(excel&&/^(?:0(?:\.\d+)?|\.\d+)$/.test(s)&&Number(s)<1){
  const seconds=Math.round(Number(s)*86400)%86400
  return {time:[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':'),defaulted:false}
 }
 const parts=/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(s)
 if(!parts)throw Error('成交時間須為 HH:mm 或 HH:mm:ss')
 return {time:parts[1]+':'+parts[2]+':'+(parts[3]??'00'),defaulted:false}
}
function numberField(raw:string,label:string,integer=false,optional=false):number|null{
 const s=raw.trim().replace(/,/g,'')
 if(!s&&optional)return null
 if(!s||!/^\d+(?:\.\d+)?$/.test(s))throw Error(label+'須填有效的非負數')
 const n=Number(s)
 if(!Number.isFinite(n)||n>1000000000||(integer&&!Number.isSafeInteger(n)))
  throw Error(label+'數值不正確')
 if(!optional&&n<=0)throw Error(label+'須大於 0')
 return n
}
function stableId(key:string):string{
 let a=2166136261,b=5381
 for(let i=0;i<key.length;i++){
  a=Math.imul(a^key.charCodeAt(i),16777619)>>>0
  b=(Math.imul(b,33)^key.charCodeAt(i))>>>0
 }
 return 'orderlead-sheet:'+a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0')
}
export function parseTabularTrades(bytes:Uint8Array,filename:string):TabularResult{
 if(bytes.length===0||bytes.length>10*1024*1024)throw Error('檔案為空或超過 10 MB')
 const excel=/\.xlsx$/i.test(filename)
 if(!excel&&!/\.csv$/i.test(filename))throw Error('請選擇 Excel 或 CSV 交易檔')
 let rows:{row:number,cells:string[]}[]
 try{
  if(excel)rows=readExcel(bytes)
  else{
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\ufeff/,'')
   rows=parseCsv(raw)
  }
 }catch(e){
  if(e instanceof Error&&(/Excel|CSV|10 MB|工作表/.test(e.message)))throw e
  throw Error('檔案無法解析，請使用 OrderLead 匯入範本')
 }
 const system1904=rows.some(v=>v.row===0&&v.cells[0]==='__EXCEL_1904__')
 rows=rows.filter(v=>v.row!==0)
 const nonEmpty=rows.filter(v=>v.cells.some(s=>String(s??'').trim()))
 if(nonEmpty.length<2)throw Error('表格沒有交易資料')
 if(nonEmpty.length>MAX_ROWS+1)throw Error('交易筆數超過 10,000 筆')
 const header=nonEmpty[0].cells.map(s=>normalizeHeader(String(s??'')))
 const required=['日期','股票代號','交易類型','股數','成交價']
 const lookup=new Map<string,number>()
 for(let i=0;i<header.length;i++){
  const name=header[i]
  if(lookup.has(name))throw Error('表頭重複：'+name)
  lookup.set(name,i)
 }
 for(const field of required)if(!lookup.has(field))throw Error('缺少必填欄位：'+field)
 const value=(cells:string[],key:string):string=>String(cells[lookup.get(key)??-1]??'').trim()
 const drafts:TabularDraft[]=[],errors:string[]=[],counts=new Map<string,number>()
 for(const raw of nonEmpty.slice(1)){
  const row=raw.row
  try{
   const date=tradeDate(value(raw.cells,'日期'),excel,system1904)
   let symbol=value(raw.cells,'股票代號').toUpperCase()
   if(excel&&/^\d{1,3}$/.test(symbol))symbol=symbol.padStart(4,'0')
   if(!/^[A-Z0-9]{4,8}$/.test(symbol))throw Error('股票代號不正確，請確認前置零')
   const typed=value(raw.cells,'交易類型')
   const side=typed==='買進'||typed==='現買'||typed.toLowerCase()==='buy'||typed==='定期定額'?'buy':
    typed==='賣出'||typed==='現賣'||typed.toLowerCase()==='sell'?'sell':null
   if(!side)throw Error('交易類型須為買進、賣出或定期定額')
   const quantity=numberField(value(raw.cells,'股數'),'股數',true) as number
   const price=numberField(value(raw.cells,'成交價'),'成交價') as number
   if(price>10000000)throw Error('成交價過大')
   const parsedTime=tradeTime(value(raw.cells,'成交時間'),excel)
   const fee=numberField(value(raw.cells,'手續費'),'手續費',false,true)
   const tax=numberField(value(raw.cells,'交易稅'),'交易稅',false,true)
   const gross=Math.round(quantity*price*100)/100
   if(!Number.isFinite(gross)||gross<=0||gross>1000000000000)throw Error('成交價金異常')
   const recurring=typed==='定期定額'
   const signature=JSON.stringify([date,symbol,side,recurring,quantity,price,parsedTime.time,fee,tax])
   const occurrence=counts.get(signature)??0
   counts.set(signature,occurrence+1)
   drafts.push({
    row,id:stableId(signature)+':'+occurrence,date,symbol,side,quantity,price,gross,
    orderId:'sheet',time:parsedTime.time,timeDefaulted:parsedTime.defaulted,recurring,
    fee,tax
   })
  }catch(e){errors.push('第 '+row+' 列：'+(e instanceof Error?e.message:'內容不正確'))}
 }
 return {drafts,errors}
}
export async function resolveTabularNames(
 drafts:readonly TabularDraft[],resolve:(symbol:string)=>Promise<string|undefined>
):Promise<{records:SourceTrade[],errors:string[]}>{
 const unique=[...new Set(drafts.map(d=>d.symbol))]
 const names=new Map<string,string|undefined>()
 for(const symbol of unique)names.set(symbol,await resolve(symbol))
 const errors:string[]=[],records:SourceTrade[]=[]
 for(const row of drafts){
  const name=names.get(row.symbol)
  if(!name){errors.push('第 '+row.row+' 列：查無股票代號 '+row.symbol+'，請確認代號');continue}
  const {row:_,...rest}=row
  records.push({...rest,name,feeStatus:'unverified'})
 }
 return {records,errors}
}
