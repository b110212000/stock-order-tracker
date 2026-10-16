import type { StagedTrade } from './types'

// Fixed URLs only. No user-entered ticker, portfolio data or credentials are
// sent to the public market mirror. A bundled same-origin snapshot is primary.
export const PUBLIC_MARKET_DIRECTORY_URL=
  'https://raw.githubusercontent.com/u159753123-G/codex-taiwan-market-data/main/data/market/codex_stock_prices_latest.json'

export type NameDirectory=Record<string,string>
type JsonFetcher=(url:string)=>Promise<unknown>

export function normalizeStockSymbol(value:string):string{
  return value.trim().toUpperCase()
}
export function validStockSymbol(symbol:string):boolean{
  return /^[A-Z0-9]{4,8}$/.test(symbol)
}
function record(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==='object'&&!Array.isArray(value)
}
function safeName(name:unknown):name is string{
  return typeof name==='string'&&name.trim().length>0&&name.trim().length<=100
}
function asDirectory(value:unknown):NameDirectory{
  if(!record(value))return {}
  const names:NameDirectory={}
  for(const [code,name] of Object.entries(value)){
    const symbol=normalizeStockSymbol(code)
    if(validStockSymbol(symbol)&&safeName(name))names[symbol]=name.trim()
  }
  return names
}
/** Source is our bundled JSON, compiled from an official-data-derived snapshot. */
export function parseBundledNames(raw:unknown):NameDirectory{
  if(!record(raw)||raw.schema!==1||!record(raw.names))return {}
  return asDirectory(raw.names)
}
/** Read only the name/code portion of the public TWSE/TPEx-derived mirror. */
export function parseMarketMirrorNames(raw:unknown):NameDirectory{
  if(!record(raw)||!record(raw.symbols))return {}
  const names:NameDirectory={}
  for(const [code,entry] of Object.entries(raw.symbols)){
    if(!record(entry)||!safeName(entry.name))continue
    const symbol=normalizeStockSymbol(code)
    if(validStockSymbol(symbol)&&(!safeName(entry.symbol)||normalizeStockSymbol(entry.symbol)===symbol)){
      names[symbol]=entry.name.trim()
    }
  }
  return names
}
/** Offline fallback from existing reviewed trades; newer records take priority. */
export function namesFromTrades(rows:readonly StagedTrade[]):NameDirectory{
  const names:NameDirectory={}
  const byDate=[...rows].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time))
  for(const row of byDate){
    const symbol=normalizeStockSymbol(row.symbol)
    if(validStockSymbol(symbol)&&safeName(row.name))names[symbol]=row.name.trim()
  }
  return names
}

async function browserJson(url:string):Promise<unknown>{
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),7000)
  try{
    const response=await fetch(url,{signal:controller.signal})
    if(!response.ok)throw new Error('stock directory HTTP '+response.status)
    return await response.json() as unknown
  }finally{clearTimeout(timeout)}
}
const CACHE_KEY='orderlead-stock-names-public-cache-v1'
function readCachedNames():NameDirectory{
  try{
    const raw=localStorage.getItem(CACHE_KEY)
    if(!raw)return {}
    const parsed=JSON.parse(raw) as unknown
    return asDirectory(record(parsed)?parsed.names:undefined)
  }catch{return {}}
}
function writeCachedNames(names:NameDirectory):void{
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({names,savedAt:Date.now()}))}
  catch{ /* Safari storage may be disabled. The bundled directory still works. */ }
}

/** Never overwrite a name typed by the user or already present on an edited trade. */
export function mayAutofillName(current:string,lastAuto:string|null):boolean{
  return current.trim()===''||(lastAuto!==null&&current===lastAuto)
}

/** Injectable factory for deterministic tests; no lookup sends the entered code. */
export function createStockNameLookup(request:JsonFetcher=browserJson){
  const bundles=new Map<string,Promise<NameDirectory>>()
  let latest:Promise<NameDirectory>|undefined
  async function bundled(baseUrl:string):Promise<NameDirectory>{
    const base=baseUrl.endsWith('/')?baseUrl:baseUrl+'/'
    let pending=bundles.get(base)
    if(!pending){
      pending=request(base+'stock-names.json').then(parseBundledNames).catch(()=>({}))
      bundles.set(base,pending)
    }
    return pending
  }
  async function live():Promise<NameDirectory>{
    if(!latest){
      latest=request(PUBLIC_MARKET_DIRECTORY_URL).then(parseMarketMirrorNames).then(names=>{
        if(Object.keys(names).length>0)writeCachedNames(names)
        return names
      }).catch(()=>({}))
    }
    return latest
  }
  return async (rawSymbol:string,history:NameDirectory,baseUrl:string):Promise<string|undefined>=>{
    const symbol=normalizeStockSymbol(rawSymbol)
    if(!validStockSymbol(symbol))return undefined
    const packaged=await bundled(baseUrl)
    if(packaged[symbol])return packaged[symbol]
    const past=history[symbol]
    if(past)return past
    const cached=readCachedNames()
    if(cached[symbol])return cached[symbol]
    const fresh=await live()
    return fresh[symbol]
  }
}

export const lookupStockName=createStockNameLookup()
