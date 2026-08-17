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
  {
    file: 'plan.audit-with-all-standards.json',
    goal: 'set up an audit for https://www.example.com with rules, consent categories and alerts',
  },
  { file: 'plan.alert-from-report.json', goal: 'alert me when the purchase tag stops firing' },
  // The empty-account pair. Worth shipping as fixtures because they are the
  // only plans that walk the sidebar and land on a real route, so a runtime
  // that only ever tested against the audit modals hasn't exercised
  // `url_change` completions at all.
  {
    file: 'plan.create-first-rule.json',
    goal: 'create a rule',
    answer: 'Google Analytics fires on every page',
  },
  {
    file: 'plan.create-first-consent-category.json',
    goal: 'create a consent category',
    answer: 'https://www.example.com',
  },
  {
    file: 'plan.create-first-alert.json',
    goal: 'create an alert',
    answer: 'broken pages go above 10',
  },
  {
    // The demo sentence. A chained plan: import first, then the audit that uses it.
    file: 'plan.import-consent-from-onetrust.json',
    goal:
      'gap.com uses OneTrust — import our consent categories for USA, Utah, then audit the site ' +
      'against them with tag rules and alert me if anything breaks',
  },
]

for (const { file, goal, answer } of cases) {
  let result = await createPlan(goal, { forceLocal: true })

  // Some goals legitimately need one more answer; bake in a sample so the
  // fixture is a finished plan rather than a half-state.
  if (result.status === 'needs_input') {
    result = answerAndRetry(result, answer ?? 'the purchase tag stops firing', goal)
  }

  if (result.status !== 'plan') {
    console.error(`! ${file}: ${result.status} — ${result.message || result.question}`)
    process.exitCode = 1
    continue
  }

  writeFileSync(join(OUT, file), `${JSON.stringify(result.plan, null, 2)}\n`)
  console.log(`  wrote fixtures/${file}  (${result.plan.steps.length} steps)`)
}
