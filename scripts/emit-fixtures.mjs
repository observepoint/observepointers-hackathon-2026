/**
 * Writes example Plans to fixtures/ so Part 2 and Part 3 can build against real
 * data without running the planner (or spending a token).
 *
 * Generated from the live recipes on purpose: a hand-written fixture drifts from
 * the contract the moment someone edits schema.js, and then Part 2 is coding
 * against a shape that no longer ships.
 *
 * Run:  npm run fixtures
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPlan, answerAndRetry } from '../src/planner/index.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
mkdirSync(OUT, { recursive: true })

const cases = [
  {
    file: 'plan.audit-with-rules.json',
    goal: 'set up an audit for https://www.example.com that checks my tag rules',
  },
  {
    file: 'plan.audit-with-consent-categories.json',
    goal: 'audit https://www.example.com for GDPR consent compliance',
  },
  {
    file: 'plan.audit-with-alerts.json',
    goal: 'add alerts to my audit for https://www.example.com',
  },
  { file: 'plan.alert-from-report.json', goal: 'alert me when the purchase tag stops firing' },
]

for (const { file, goal } of cases) {
  let result = await createPlan(goal, { forceLocal: true })

  // Some goals legitimately need one more answer; bake in a sample so the
  // fixture is a finished plan rather than a half-state.
  if (result.status === 'needs_input') {
    result = answerAndRetry(result, 'the purchase tag stops firing', goal)
  }

  if (result.status !== 'plan') {
    console.error(`! ${file}: ${result.status} — ${result.message || result.question}`)
    process.exitCode = 1
    continue
  }

  writeFileSync(join(OUT, file), `${JSON.stringify(result.plan, null, 2)}\n`)
  console.log(`  wrote fixtures/${file}  (${result.plan.steps.length} steps)`)
}
