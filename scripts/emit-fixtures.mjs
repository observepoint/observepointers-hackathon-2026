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
  { file: 'plan.create-api-key.json', goal: 'I need an API key called "CI bot"' },
  { file: 'plan.add-rules-to-audit.json', goal: 'add rules to my audit "Q3 Production Audit"' },
  {
    file: 'plan.alert-on-failure.json',
    goal: 'I want to be alerted when checkout breaks on https://shop.example.com',
  },
]

for (const { file, goal } of cases) {
  let result = await createPlan(goal, { forceLocal: true })

  // Some goals legitimately need one more answer; bake in a sample so the
  // fixture is a finished plan rather than a half-state.
  if (result.status === 'needs_input') {
    result = answerAndRetry(result, 'https://shop.example.com', goal)
  }

  if (result.status !== 'plan') {
    console.error(`! ${file}: ${result.status} — ${result.message || result.question}`)
    process.exitCode = 1
    continue
  }

  writeFileSync(join(OUT, file), `${JSON.stringify(result.plan, null, 2)}\n`)
  console.log(`  wrote fixtures/${file}  (${result.plan.steps.length} steps)`)
}
