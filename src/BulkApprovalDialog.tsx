import { useMemo, useState } from 'react'
import { AlertTriangle, Download, ShieldCheck, X } from 'lucide-react'
import { approveImportedTrades, list, STORE_NAMES } from './db'
import { DEFAULT_BULK_FEES, planBulkApprovals } from './bulk-approval'
import type { BulkFeeOptions } from './bulk-approval'
import type { StagedTrade, StoreValue, Trade } from './types'

type Props = {
  staged:StagedTrade[]
  existing:Trade[]
  onClose:()=>void
  onImported:(count:number,skipped:number,estimated:number)=>void
}
export default function BulkApprovalDialog({staged,existing,onClose,onImported}:Props){
  const [options,setOptions]=useState<BulkFeeOptions>({...DEFAULT_BULK_FEES})
  const [acknowledged,setAcknowledged]=useState(false)
  const [backedUp,setBackedUp]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const calculation=useMemo(()=>{
    try{return {plan:planBulkApprovals(staged,existing,options),error:''}}
    catch(e){return {plan:null,error:e instanceof Error?e.message:String(e)}}
  },[staged,existing,options])
  const plan=calculation.plan
  const skipped=plan?.blocked.reduce((n,x)=>n+x.count,0)||0
  function adjust(key:keyof BulkFeeOptions,value:number){
    setOptions(previous=>({...previous,[key]:value}))
    setAcknowledged(false)
  }
  async function exportBackup(){
    setBusy(true);setError('')
    try{
      const data:Record<string,StoreValue[]>={}
      for(const store of STORE_NAMES)data[store]=await list<StoreValue>(store)
      const payload=JSON.stringify({
        format:'orderlead-backup',schema:1,exportedAt:new Date().toISOString(),data
      },null,2)
      const url=URL.createObjectURL(new Blob([payload],{type:'application/json'}))
      const a=document.createElement('a')
      a.href=url
      a.download='orderlead-before-bulk-import-'+new Date().toLocaleDateString('sv-SE')+'.json'
      document.body.appendChild(a);a.click();a.remove()
      setTimeout(()=>URL.revokeObjectURL(url),3000)
      setBackedUp(true)
    }catch(e){setError('備份未成功：'+String(e))}
    finally{setBusy(false)}
  }
  async function execute(){
    if(!plan||!plan.trades.length||!backedUp||!acknowledged)return
    setBusy(true);setError('')
    try{
      const [currentStaged,current]=await Promise.all([
        list<StagedTrade>('imports'),list<Trade>('trades')
      ])
      const latest=planBulkApprovals(currentStaged,current,options)
      const signature=(rows:Trade[])=>rows.map(t=>t.id).sort().join('|')
      if(signature(latest.trades)!==signature(plan.trades)){
        throw Error('交易紀錄在預覽後有變更，請關閉視窗重新核對')
      }
      if(!window.confirm('確定批次寫入 '+latest.trades.length+' 筆交易？'+
        (latest.estimatedCount?'其中 '+latest.estimatedCount+' 筆包含「估算費用」，績效僅供參考。':'')+
        '其餘不確定紀錄仍保留在待核對清單。'))return
      await approveImportedTrades(latest.updates,latest.trades)
      onImported(latest.trades.length,latest.blocked.reduce((n,x)=>n+x.count,0),latest.estimatedCount)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
    <section className="dialog bulk-dialog" role="dialog" aria-modal="true" aria-label="批次核對與匯入">
      <button className="close" aria-label="關閉" disabled={busy} onClick={onClose}><X size={19}/></button>
      <h2>一鍵核對可通過的交易</h2>
      <p className="subtle">會先做費用、重複交易及 FIFO 庫存預檢，只核准符合條件的股票整組交易。未通過者仍待核對。</p>

      <label className="form-label">費用處理方式
        <select className="form-input" value={options.mode} onChange={e=>{setOptions(x=>({...x,mode:e.target.value as BulkFeeOptions['mode']}));setAcknowledged(false)}}>
          <option value="verified">僅匯入已填寫實際費用的交易（最保守）</option>
          <option value="estimate">用指定費率估算未知費用（可大量通過）</option>
        </select>
      </label>
      {options.mode==='estimate'&&<div className="bulk-fee-panel">
        <div className="import-warning"><AlertTriangle size={18}/><p>以下是你可調整的預估參數，<b>不是富邦實際交割費用</b>。不包含券商折扣、當沖優惠、證券特殊稅制等因素；例如 ETN 將先排除。</p></div>
        <div className="bulk-fee-grid">
          <label className="form-label">手續費率 (%)<input className="form-input" min="0" max="10" step="0.0001" type="number" value={options.commissionPercent} onChange={e=>adjust('commissionPercent',Number(e.target.value))}/></label>
          <label className="form-label">每筆最低手續費 (元)<input className="form-input" min="0" step="1" type="number" value={options.minimumFee} onChange={e=>adjust('minimumFee',Number(e.target.value))}/></label>
          <label className="form-label">一般股票賣出稅 (%)<input className="form-input" min="0" max="10" step="0.01" type="number" value={options.stockTaxPercent} onChange={e=>adjust('stockTaxPercent',Number(e.target.value))}/></label>
          <label className="form-label">ETF 賣出稅 (%)<input className="form-input" min="0" max="10" step="0.01" type="number" value={options.fundTaxPercent} onChange={e=>adjust('fundTaxPercent',Number(e.target.value))}/></label>
        </div>
        <p className="field-help">股票與 ETF 以代號粗分類；任何有差異的交割制度，應另外依對帳單更正。本模式的「核對通過」只代表資料與庫存檢查通過，不代表費用已查證。</p>
      </div>}

      {plan?<div className="bulk-summary">
        <div><strong>{plan.trades.length}</strong><small>預計批次核准</small></div>
        <div><strong>{skipped}</strong><small>暫留待核對</small></div>
        <div><strong>{plan.alreadyImported}</strong><small>已存在而略過</small></div>
        <div><strong>{plan.estimatedCount}</strong><small>使用預估費用</small></div>
      </div>:<p className="error-msg" role="alert">{calculation.error}</p>}

      {Boolean(plan?.blocked.length)&&<details className="bulk-blocked">
        <summary>查看無法批次核准的股票（{plan?.blocked.length} 檔）</summary>
        <div className="bulk-reasons">{plan?.blocked.map(x=><p key={x.symbol}><b>{x.symbol} · {x.count} 筆</b><span>{x.reason}</span></p>)}</div>
      </details>}

      <div className="bulk-backup">
        <button className="mini-button" type="button" disabled={busy} onClick={()=>void exportBackup()}><Download size={16}/> {backedUp?'重新下載匯入前備份':'先下載完整備份'}</button>
        <span>{backedUp?'備份已開始下載；請確認檔案儲存成功。':'為保護交易紀錄，批次寫入前請先備份。'}</span>
      </div>
      <label className="bulk-accept"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>
        <span>我已檢查批次筆數、保存備份，了解沒有通過檢查的交易不會匯入，{options.mode==='estimate'?'也了解估算費用與實際交割可能不同。':'並且費用必須已經核對。'}</span>
      </label>
      {error&&<p className="error-msg" role="alert">{error}</p>}
      <div className="bulk-buttons">
        <button className="mini-button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary" disabled={busy||!backedUp||!acknowledged||!plan?.trades.length} onClick={()=>void execute()}><ShieldCheck size={16}/>{busy?'核准中…': '確認批次通過 '+(plan?.trades.length||0)+' 筆'}</button>
      </div>
    </section>
  </div>
}
