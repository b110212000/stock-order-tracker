export type Stock = {
  symbol: string
  name: string
  group: string
  note: string
  createdAt: string
  updatedAt: string
}
export type Rating = '新進場候選' | '續抱' | '等待' | '降低持有'
export type Analysis = {
  id: string
  symbol: string
  asOf: string
  rating: Rating
  demand: string
  orders: string
  ramp: string
  capacity: string
  peers: string
  institutions: string
  invalidation: string
  sources: string
  updatedAt: string
}
export type Trade = {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  date: string
  quantity: number
  price: number
  fee: number
  tax: number
  note: string
  createdAt: string
}
export type Quote = {
  symbol: string
  price: number
  asOf: string
}
export type CashFlow = {
  id: string
  date: string
  type: 'deposit' | 'withdraw' | 'dividend'
  amount: number
  symbol?: string
  note: string
}
export type AlertRule = {
  id: string
  symbol: string
  direction: 'above' | 'below'
  target: number
  enabled: boolean
  lastMet: boolean
  lastTriggered?: string
}
export type AssetSnapshot = { id: string, date: string, equity: number, cumulativeNetDeposits: number, capturedAt: string }
export type StagedTrade = {
  id: string
  symbol: string
  name: string
  date: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  gross: number
  orderId: string
  time: string
  fee: number | null
  tax: number | null
  feeStatus?: string
  status: 'pending' | 'approved' | 'skipped'
  createdAt: string
  importedAt: string
}
export type Store = 'stocks' | 'analyses' | 'trades' | 'quotes' | 'cashflows' | 'alerts' | 'snapshots' | 'imports'
export type StoreValue = Stock | Analysis | Trade | Quote | CashFlow | AlertRule | AssetSnapshot | StagedTrade
