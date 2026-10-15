import test from 'node:test'
import assert from 'node:assert/strict'
import { selectRecoveredReviewRows } from '../src/review-recovery'
import type { StagedTrade } from '../src/types'
function make(id:string,date='2024-01-02'):StagedTrade{
 return {id,date,symbol:'0050',name:'元大台灣50',side:'buy',quantity:10,price:150,gross:1500,orderId:'o1',time:'09:03:00',fee:null,tax:null,status:'pending',createdAt:'2024-01-02T01:03:00.000Z',importedAt:'2026-10-15T00:00:00.000Z'}
}
test('recovers legacy Gmail 2024+ trades when review store is empty',()=>{
 const a=make('a'),b=make('b')
 const output=selectRecoveredReviewRows([],[a,b])
 assert.deepEqual(output.rows,[a,b])
 assert.equal(output.recovered,2)
 assert.equal(output.ignored,0)
})
test('never replaces existing review history, even if an old inbox has more rows',()=>{
 const reviewed=make('review'),legacy=make('legacy')
 const output=selectRecoveredReviewRows([reviewed],[legacy])
 assert.deepEqual(output.rows,[reviewed])
 assert.equal(output.recovered,0)
})
test('leaves the old input records and their approved state untouched',()=>{
 const item={...make('one'),status:'approved' as const}
 const inbox=[item]
 const output=selectRecoveredReviewRows([],inbox)
 assert.equal(inbox[0].status,'approved')
 assert.strictEqual(output.rows[0],item)
})
test('does not reintroduce pre-2024 or malformed legacy rows',()=>{
 const invalid={...make('bad'),time:null} as unknown as StagedTrade
 const out=selectRecoveredReviewRows([],[make('old','2023-12-12'),invalid,make('new')])
 assert.equal(out.rows.length,1)
 assert.equal(out.rows[0].id,'new')
 assert.equal(out.ignored,2)
})
test('rejects duplicate source IDs in legacy records',()=>{
 const output=selectRecoveredReviewRows([],[make('same'),make('same')])
 assert.equal(output.rows.length,1)
 assert.equal(output.ignored,1)
})
