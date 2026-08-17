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
    answer: 'jun@observepoint.com',
  },
  {
    file: 'plan.create-tag-variable-rule.json',
    goal:
      'make a rule that follows the Timing Value best practice on Google Universal Analytics — ' +
      'utt, utc and utv should all be set',
  },
  {
    file: 'plan.import-consent-from-onetrust.json',
    goal: 'import our consent categories from OneTrust for gap.com',
  },
  {
    // THE DEMO SENTENCE, and the only fixture that is an ARRAY of plans.
    //
    // Worth shipping in that shape because it is the shape Part 2 receives:
    // startWalkthrough takes an ordered array, and one request that asks for the
    // libraries to be set up and then audited is four walkthroughs. A runtime tested
    // only against single plans has never run the second one.
    file: 'plan.demo-chain.json',
    goal:
      'observepoint.com uses OneTrust — import our consent categories for Utah, then audit the ' +
      'site against them with tag rules, follow the Timing Value best practice on Google ' +
      'Universal Analytics, and alert me if anything breaks',
    answer: 'jun@observepoint.com',
    chain: true,
  },
]

for (const { file, goal, answer, chain } of cases) {
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

  const payload = chain ? result.plans : result.plan
  const steps = chain
    ? result.plans.reduce((n, p) => n + p.steps.length, 0)
    : result.plan.steps.length
  writeFileSync(join(OUT, file), `${JSON.stringify(payload, null, 2)}\n`)
  console.log(
    `  wrote fixtures/${file}  (${steps} steps${chain ? ` across ${result.plans.length} plans` : ''})`,
  )
}
