import type { StockGroup } from './stock-groups'

export const STOCK_SORT_OPTIONS=[
  {value:'code-asc',label:'股票代號：小到大'},
  {value:'code-desc',label:'股票代號：大到小'},
  {value:'name-asc',label:'股票名稱：正序'},
  {value:'name-desc',label:'股票名稱：反序'},
  {value:'recent-desc',label:'最近交易：新到舊'},
  {value:'recent-asc',label:'最近交易：舊到新'},
  {value:'pnl-desc',label:'已確認毛損益：高到低'},
  {value:'pnl-asc',label:'已確認毛損益：低到高'},
  {value:'remaining-desc',label:'未賣股數：多到少'},
  {value:'remaining-asc',label:'未賣股數：少到多'},
  {value:'cost-desc',label:'未賣成本：高到低'},
  {value:'cost-asc',label:'未賣成本：低到高'}
] as const

export type StockSortMode=(typeof STOCK_SORT_OPTIONS)[number]['value']
const symbolCompare=(a:StockGroup,b:StockGroup)=>
  a.symbol.localeCompare(b.symbol,'en',{numeric:true,sensitivity:'base'})

/** Does not mutate FIFO trades or the original stock group array.
 * Unconfirmed sales cannot make a symbol look like a zero-profit trade. */
export function sortStockGroups(groups:StockGroup[],mode:StockSortMode):StockGroup[]{
  const [kind,direction]=mode.split('-') as [string,string]
  const desc=direction==='desc'
  return [...groups].sort((a,b)=>{
    let cmp=0
    switch(kind){
      case 'code':
        cmp=symbolCompare(a,b)
        break
      case 'name':
        cmp=a.name.localeCompare(b.name,'zh-TW',{numeric:true,sensitivity:'base'})
        break
      case 'recent':
        cmp=a.latestDate.localeCompare(b.latestDate)
        break
      case 'pnl':{
        const aKnown=a.sells.length>a.uncertainSaleCount
        const bKnown=b.sells.length>b.uncertainSaleCount
        if(aKnown!==bKnown)return aKnown?-1:1
        if(!aKnown)return symbolCompare(a,b)
        cmp=a.reliableGrossPnl-b.reliableGrossPnl
        break
      }
      case 'remaining':
        cmp=a.remainingQuantity-b.remainingQuantity
        break
      case 'cost':
        cmp=a.remainingCost-b.remainingCost
        break
      default:
        return symbolCompare(a,b)
    }
    return (desc?-cmp:cmp)||symbolCompare(a,b)
  })
}
