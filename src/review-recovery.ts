import type { StagedTrade } from './types'

/** Recover the first-review dataset without altering the original legacy inbox.
 * If review data already exists, never overwrite it. */
export function selectRecoveredReviewRows(
  existing:StagedTrade[],inbox:StagedTrade[]
):{rows:StagedTrade[],recovered:number,ignored:number}{
  if(existing.length)return {rows:existing,recovered:0,ignored:0}
  const unique=new Map<string,StagedTrade>()
  let ignored=0
  for(const row of inbox){
    if(!row||typeof row.id!=='string'||!row.id||
       typeof row.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||
       typeof row.symbol!=='string'||!row.symbol||
       typeof row.name!=='string'||typeof row.time!=='string'||
       (row.side!=='buy'&&row.side!=='sell')||
       !Number.isSafeInteger(row.quantity)||row.quantity<=0||
       !Number.isFinite(row.price)||row.price<=0||
       !Number.isFinite(row.gross)||row.gross<=0){
      ignored++
      continue
    }
    if(unique.has(row.id)){ignored++;continue}
    unique.set(row.id,row)
  }
  const rows=[...unique.values()]
  return {rows,recovered:rows.length,ignored}
}
