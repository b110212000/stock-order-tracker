import test from 'node:test'
import assert from 'node:assert/strict'
import { GUIDE_STEPS } from '../src/guide-content'

test('guide contains distinct, complete chapters in intended onboarding sequence', () => {
  assert.equal(GUIDE_STEPS.length,9)
  assert.equal(new Set(GUIDE_STEPS.map(x=>x.id)).size,GUIDE_STEPS.length)
  assert.deepEqual(GUIDE_STEPS.map(x=>x.id),[
    'start','watchlist','research','buy','sell','performance','alerts','backup','install'
  ])
  for(const step of GUIDE_STEPS){
    assert.ok(step.title.trim().length>0)
    assert.ok(step.subtitle.trim().length>0)
    assert.ok(step.instructions.length>=3)
    assert.ok(step.instructions.every(text=>text.trim().length>10))
    assert.ok(step.tip.trim().length>10)
    assert.ok(Boolean(step.target)||Boolean(step.openSettings))
  }
})
test('guide only links to available frontend routes', () => {
  const routes=new Set(['dashboard','watchlist','trades','performance','alerts'])
  for(const step of GUIDE_STEPS){
    if(step.target)assert.ok(routes.has(step.target),'unknown destination: '+step.target)
  }
})
test('guide warns about actual PWA limitations', () => {
  const content=GUIDE_STEPS.map(x=>[x.subtitle,...x.instructions,x.tip].join(' ')).join(' ')
  for(const key of ['手動報價','先進先出','備份','背景推播','GPT','主畫面']){
    assert.ok(content.includes(key),'missing guide limitation: '+key)
  }
})
