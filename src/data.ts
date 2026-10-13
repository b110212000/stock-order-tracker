export type Page = 'dashboard' | 'watchlist' | 'trades' | 'performance'
export type Theme = 'system' | 'light' | 'dark'
export const WATCHLIST = [
  { symbol: '8210', name: '勤誠', group: 'AI伺服器 / 機殼' },
  { symbol: '2301', name: '光寶科', group: 'AI電源' },
  { symbol: '5465', name: '富驊', group: '伺服器 / 網通' },
  { symbol: '6913', name: '鴻呈', group: '高速線材' },
  { symbol: '6412', name: '群電', group: '電源供應器' },
  { symbol: '3032', name: '偉訓', group: 'AI機櫃 / 散熱' },
  { symbol: '2345', name: '智邦', group: '高速網通' },
  { symbol: '8299', name: '群聯', group: 'NAND / SSD' }
] as const
export const RELEASES = [
  ['v1.0.0','前端 UI / PWA'],
  ['v1.1.0','可編輯股票觀察清單'],
  ['v1.2.0','訂單領先分析介面'],
  ['v1.3.0','交易紀錄 / 庫存成本'],
  ['v1.4.0','資金績效 / 月化報酬'],
  ['v1.5.0','提醒規則 / 資料備份'],
  ['v2.0.0','後端與 GPT API（後續）']
] as const
