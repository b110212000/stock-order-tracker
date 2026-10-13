import type { Stock, Store, StoreValue } from './types'
import { WATCHLIST } from './data'

const DB_NAME = 'orderlead-local'
const DB_VERSION = 2
export const STORE_NAMES: Store[] = ['stocks', 'analyses', 'trades', 'quotes', 'cashflows', 'alerts', 'snapshots']
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const today = () => new Date().toLocaleDateString('sv-SE')

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of STORE_NAMES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: store === 'stocks' || store === 'quotes' ? 'symbol' : 'id' })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('無法開啟本機資料庫'))
    request.onblocked = () => reject(new Error('資料庫正在被另一個分頁使用'))
  })
}
async function transaction<T>(store: Store, mode: IDBTransactionMode, fn: (object: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    let output: T
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    req.onsuccess = () => { output = req.result }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => { db.close(); resolve(output) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error || new Error('儲存中斷')) }
  })
}
export async function list<T extends StoreValue>(store: Store): Promise<T[]> {
  return transaction<T[]>(store, 'readonly', object => object.getAll())
}
export async function save<T extends StoreValue>(store: Store, value: T): Promise<void> {
  await transaction(store, 'readwrite', object => object.put(value))
}
export async function drop(store: Store, key: string): Promise<void> {
  await transaction(store, 'readwrite', object => object.delete(key))
}
export async function seedStocks(): Promise<void> {
  const existing = await list<Stock>('stocks')
  if (existing.length) return
  // New installs receive default watchlist; an intentionally empty watchlist stays empty.
  const db = await open()
  const tx = db.transaction('stocks', 'readwrite')
  const object = tx.objectStore('stocks')
  const current = now()
  for (const item of WATCHLIST) {
    object.put({ ...item, note: '', createdAt: current, updatedAt: current })
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}
export async function clearAll(): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAMES, 'readwrite')
    STORE_NAMES.forEach(store => tx.objectStore(store).clear())
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}
// Intentionally keep a sentinel so deleting the last stock does not reseed on next load.
export async function initialize(): Promise<void> {
  if (localStorage.getItem('orderlead-seeded') === '1') return
  await seedStocks()
  localStorage.setItem('orderlead-seeded', '1')
}
