/**
 * Part 1 tests. No API key, no network — every path here runs on the
 * deterministic matcher, which is exactly the path that has to keep working
 * when the free tier runs dry.
 *
 * Run:  npm test
 */

import { createPlan, buildPlan, answerAndRetry, suggestions } from '../src/planner/index.js'
import { validatePlan } from '../src/planner/schema.js'
import { render, placeholdersIn } from '../src/planner/template.js'
import { matchDeterministic } from '../src/planner/match.js'
import { rankModels } from '../src/planner/llm.js'
import { RECIPES } from '../src/planner/recipes/index.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = s => console.log(`\n${s}`)

/* ---------------------------------------------------------------- */
section('template rendering')

const rendered = render(
  { a: 'Hello {{parameters.name}}', b: ['{{parameters.name}}'] },
  { parameters: { name: 'Jun' } },
)
check('substitutes in strings', rendered.value.a === 'Hello Jun')
check('substitutes deeply through arrays', rendered.value.b[0] === 'Jun')
check('reports nothing missing when all resolve', rendered.missing.length === 0)

const partial = render('{{parameters.known}} {{parameters.unknown}}', {
  parameters: { known: 'x' },
})
check('reports missing placeholders', partial.missing.includes('parameters.unknown'))
check(
  'leaves an unresolved placeholder visible rather than blanking it',
  partial.value.includes('{{parameters.unknown}}'),
  partial.value,
)
check(
  'finds placeholders in a template',
  placeholdersIn({ s: '{{parameters.a}}' }).includes('parameters.a'),
)

/* ---------------------------------------------------------------- */
section('plan schema')

const valid = {
  recipeId: 'r',
  goal: 'g',
  summary: 's',
  executionMode: 'templated',
  parameters: {},
  steps: [
    {
      id: 's1',
      actor: 'user',
      targetSelector: '#a',
      say: 'do it',
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
check(
  'accepts a minimal valid plan',
  validatePlan(valid).length === 0,
  validatePlan(valid).join('; '),
)
check(
  'rejects a missing recipeId',
  validatePlan({ ...valid, recipeId: '' }).some(e => e.includes('recipeId')),
)
check(
  'rejects an unknown executionMode',
  validatePlan({ ...valid, executionMode: 'freestyle' }).length > 0,
)
check(
  'rejects empty steps',
  validatePlan({ ...valid, steps: [] }).some(e => e.includes('non-empty')),
)
check(
  'rejects duplicate step ids',
  validatePlan({ ...valid, steps: [valid.steps[0], valid.steps[0]] }).some(e =>
    e.includes('duplicated'),
  ),
)
check(
  'requires an action on an ai step',
  validatePlan({ ...valid, steps: [{ ...valid.steps[0], actor: 'ai' }] }).some(e =>
    e.includes('requires action'),
  ),
)
check(
  'forbids an action on a user step',
  validatePlan({
    ...valid,
    steps: [{ ...valid.steps[0], action: { type: 'click' } }],
  }).some(e => e.includes('must not carry an action')),
)
check(
  'requires a value for fill_text',
  validatePlan({
    ...valid,
    steps: [{ ...valid.steps[0], actor: 'ai', action: { type: 'fill_text' } }],
  }).some(e => e.includes('action.value')),
)
check(
  'requires a target for dom_mutation completion',
  validatePlan({
    ...valid,
    steps: [{ ...valid.steps[0], completion: { type: 'dom_mutation', condition: 'visible' } }],
  }).some(e => e.includes('targetSelector')),
)
// The one that would actually reach a user: a form filled with "{{parameters.x}}".
check(
  'rejects a plan with unresolved placeholders',
  validatePlan({
    ...valid,
    steps: [{ ...valid.steps[0], say: 'type {{parameters.name}}' }],
  }).some(e => e.includes('unresolved')),
)

/* ---------------------------------------------------------------- */
section('recipe library integrity')

for (const recipe of RECIPES) {
  const declared = new Set(recipe.parameters.map(p => `parameters.${p.name}`))
  const used = placeholdersIn([recipe.steps, recipe.summaryTemplate])
  const undeclared = used.filter(p => !declared.has(p))
  check(
    `${recipe.id}: every placeholder is a declared parameter`,
    undeclared.length === 0,
    undeclared.join(', '),
  )

  const filled = Object.fromEntries(
    recipe.parameters.map(p => [p.name, p.example || p.default || 'x']),
  )
  const built = buildPlan(recipe, 'test goal', filled)
  check(
    `${recipe.id}: builds a schema-valid plan`,
    built.status === 'plan',
    JSON.stringify(built).slice(0, 200),
  )

  const required = recipe.parameters.filter(p => p.required)
  if (required.length) {
    const withoutRequired = { ...filled }
    delete withoutRequired[required[0].name]
    const partialPlan = buildPlan(recipe, 'test goal', withoutRequired)
    check(
      `${recipe.id}: asks instead of inventing a missing required value`,
      partialPlan.status === 'needs_input',
    )
  }
}

/* ---------------------------------------------------------------- */
section('intent matching (no model)')

const apiKeyMatch = matchDeterministic('I need an API key for our CI pipeline')
check(
  'matches the API key recipe',
  apiKeyMatch.recipeId === 'create_api_key',
  JSON.stringify(apiKeyMatch),
)

const alertMatch = matchDeterministic('I want to be alerted when checkout breaks on example.com')
check(
  'matches the alert recipe',
  alertMatch.recipeId === 'alert_on_rule_failure',
  JSON.stringify(alertMatch),
)
check(
  'extracts a URL from the goal',
  alertMatch.parameters.siteUrl === 'example.com',
  JSON.stringify(alertMatch.parameters),
)
check(
  'extracts the failure condition after "when"',
  (alertMatch.parameters.conditionSummary || '').startsWith('checkout breaks'),
  alertMatch.parameters.conditionSummary,
)

const quoted = matchDeterministic('create an api key called "Deploy bot"')
check(
  'extracts a quoted name',
  quoted.parameters.keyName === 'Deploy bot',
  JSON.stringify(quoted.parameters),
)

const nonsense = matchDeterministic('what is the weather in Utah')
check(
  'does not force a match on an unrelated question',
  nonsense.recipeId === null,
  JSON.stringify(nonsense),
)

/* ---------------------------------------------------------------- */
section('createPlan end to end (forceLocal)')

const planned = await createPlan('I need an API key called "CI bot"', { forceLocal: true })
check('returns a plan', planned.status === 'plan', JSON.stringify(planned).slice(0, 200))
check('plan is schema-valid', planned.status === 'plan' && validatePlan(planned.plan).length === 0)
check('carries the goal through', planned.plan?.goal.includes('CI bot'))
check('uses the extracted parameter', planned.plan?.parameters.keyName === 'CI bot')
check(
  'substitutes the parameter into a step',
  planned.plan?.steps.some(s => s.action?.value === 'CI bot'),
  JSON.stringify(planned.plan?.steps.map(s => s.action)),
)
check('applies a declared default', planned.plan?.parameters.keyDescription?.length > 0)
check('marks execution mode', planned.plan?.executionMode === 'templated')

const needsInput = await createPlan('alert me when the purchase tag stops firing', {
  forceLocal: true,
})
check(
  'asks for the missing site',
  needsInput.status === 'needs_input',
  JSON.stringify(needsInput).slice(0, 160),
)
check(
  'asks exactly one question',
  typeof needsInput.question === 'string' && needsInput.question.length > 0,
)

const resumed = answerAndRetry(
  needsInput,
  'https://shop.example.com',
  'alert me when the purchase tag stops firing',
)
check(
  'resumes into a plan once answered',
  resumed.status === 'plan',
  JSON.stringify(resumed).slice(0, 200),
)
check(
  'uses the answer',
  resumed.plan?.parameters.siteUrl === 'https://shop.example.com',
  JSON.stringify(resumed.plan?.parameters),
)

const noMatch = await createPlan('what is the capital of France', { forceLocal: true })
check('reports no match rather than guessing', noMatch.status === 'no_match')
check('offers what it can do instead', noMatch.suggestions.length === RECIPES.length)

const empty = await createPlan('   ', { forceLocal: true })
check('handles an empty goal', empty.status === 'no_match')

check(
  'suggestions carry an example phrasing',
  suggestions().every(s => s.example),
)

/* ---------------------------------------------------------------- */
section('warnings')

const alertPlan = answerAndRetry(
  await createPlan('alert me when checkout breaks', { forceLocal: true }),
  'example.com',
  'alert me when checkout breaks',
)
check(
  'flags unverified selectors so nobody debugs a ghost',
  alertPlan.status === 'plan' && alertPlan.warnings.some(w => w.includes('unverified')),
  JSON.stringify(alertPlan.warnings),
)

/* ---------------------------------------------------------------- */
section('gemini model ranking')

const chat = name => ({ name, supportedGenerationMethods: ['generateContent'] })
const ranked = rankModels([
  chat('models/gemini-2.5-flash'),
  chat('models/gemini-3.6-flash'),
  chat('models/gemini-3.6-pro'),
  chat('models/gemini-3.6-flash-lite'),
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  chat('models/imagen-4.0-generate'),
])
check('picks the newest flash model', ranked[0] === 'gemini-3.6-flash', ranked.join(', '))
check('drops non-chat models', !ranked.some(m => /embedding|imagen/.test(m)))
check(
  'deprioritises lite',
  ranked.indexOf('gemini-3.6-flash-lite') > ranked.indexOf('gemini-3.6-flash'),
)

console.log(failures ? `\n${failures} check(s) failed\n` : `\nall checks passed\n`)
process.exit(failures ? 1 : 0)
