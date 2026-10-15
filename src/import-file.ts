import { strFromU8, unzipSync } from 'fflate'
import { readTradePreview } from './import-trades'
import type { SourceTrade } from './import-trades'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024

/** Offline parsing; no Gmail API or server upload. Both JSON and ZIP are supported. */
export function parseTradeImportBytes(bytes:Uint8Array, filename:string):SourceTrade[]{
  if(bytes.length===0||bytes.length>MAX_IMPORT_BYTES)throw Error('檔案為空，或大小超過 10 MB')
  const zip=/\.zip$/i.test(filename)
  const json=/\.json$/i.test(filename)
  if(!zip&&!json)throw Error('請選擇 .json 或 .zip 交易匯入檔；不能直接選擇券商 PDF')
  try{
    let content=bytes
    if(zip){
      const files=unzipSync(bytes,{
        filter:({name,originalSize})=>name.toLowerCase().endsWith('.json')&&
          !name.startsWith('__MACOSX/')&&originalSize<=MAX_IMPORT_BYTES
      })
      const candidates=Object.entries(files).filter(([name])=>name.toLowerCase().endsWith('.json'))
      if(candidates.length!==1)throw Error('ZIP 裡必須剛好有一個 JSON 交易匯入檔')
      content=candidates[0][1]
    }
    if(content.length>MAX_IMPORT_BYTES)throw Error('解壓後 JSON 超過 10 MB')
    const parsed:unknown=JSON.parse(strFromU8(content))
    return readTradePreview(parsed)
  }catch(e){
    if(e instanceof SyntaxError)throw Error('JSON 內容無法解析，請確認下載的是交易匯入檔')
    throw e
  }
}
