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
import { hostFrom, auditNameFor, alertNameFrom, normalizeSiteUrl } from '../src/planner/naming.js'
import { rankForSite } from '../src/planner/account.js'
import { RECIPES, allKnownSelectors } from '../src/planner/recipes/index.js'

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

const alertMatch = matchDeterministic('alert me when the purchase tag stops firing')
check(
  'matches the alert recipe',
  alertMatch.recipeId === 'alert_from_report',
  JSON.stringify(alertMatch),
)
check(
  'extracts the failure condition after "when"',
  (alertMatch.parameters.conditionSummary || '').startsWith('the purchase tag'),
  alertMatch.parameters.conditionSummary,
)

const auditMatch = matchDeterministic(
  'set up an audit for https://www.example.com that checks my tag rules',
)
check(
  'matches the rules recipe',
  auditMatch.recipeId === 'audit_with_rules',
  JSON.stringify(auditMatch),
)
check(
  'extracts a URL from the goal',
  auditMatch.parameters.siteUrl === 'https://www.example.com',
  JSON.stringify(auditMatch.parameters),
)

// The three audit recipes share a shape, so intent has to separate them.
check(
  'distinguishes consent categories from rules',
  matchDeterministic('audit example.com for GDPR consent compliance').recipeId ===
    'audit_with_consent_categories',
  JSON.stringify(matchDeterministic('audit example.com for GDPR consent compliance')),
)
check(
  'distinguishes attaching alerts from creating one',
  matchDeterministic('add alerts to my audit').recipeId === 'audit_with_alerts',
  JSON.stringify(matchDeterministic('add alerts to my audit')),
)

const quoted = matchDeterministic(
  'set up an audit called "Q3 tag sweep" for gap.com that checks my rules',
)
check(
  'extracts a quoted name',
  quoted.parameters.auditName === 'Q3 tag sweep',
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

const planned = await createPlan(
  'set up an audit called "CI sweep" for gap.com that checks my tag rules',
  {
    forceLocal: true,
  },
)
check('returns a plan', planned.status === 'plan', JSON.stringify(planned).slice(0, 200))
check('plan is schema-valid', planned.status === 'plan' && validatePlan(planned.plan).length === 0)
check('carries the goal through', planned.plan?.goal.includes('CI sweep'))
check('uses the extracted parameter', planned.plan?.parameters.auditName === 'CI sweep')
check(
  'substitutes the parameter into a step',
  planned.plan?.steps.some(s => s.action?.value === 'CI sweep'),
  JSON.stringify(planned.plan?.steps.map(s => s.action)),
)
check('applies a derived default', planned.plan?.parameters.siteUrl === 'https://gap.com')
check('marks execution mode', planned.plan?.executionMode === 'templated')

// No URL anywhere in the goal, and siteUrl is required — it must ask rather
// than invent one, because Part 2 would type an invented URL into a real form.
const needsInput = await createPlan('set up an audit that checks my tag rules', {
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
  'set up an audit that checks my tag rules',
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

const auditPlan = await createPlan(
  'set up an audit for https://www.example.com that checks my tag rules',
  { forceLocal: true },
)
check(
  'flags unverified selectors so nobody debugs a ghost',
  auditPlan.status === 'plan' && auditPlan.warnings.some(w => w.includes('unverified')),
  JSON.stringify(auditPlan.warnings),
)

/* ---------------------------------------------------------------- */
section('naming')

check('strips protocol and www', hostFrom('https://www.gap.com') === 'gap.com')
check('strips path, query and fragment', hostFrom('https://gap.com/checkout?a=1#x') === 'gap.com')
check('strips a port', hostFrom('http://localhost:4200/x') === 'localhost')
check('leaves a bare host alone', hostFrom('gap.com') === 'gap.com')
check('lowercases', hostFrom('HTTPS://WWW.GAP.COM') === 'gap.com')
check('survives an empty value', hostFrom('') === '')

check(
  'audit names lead with the site and say what they check',
  auditNameFor('Consent & privacy')({ siteUrl: 'https://www.gap.com/x' }) ===
    'gap.com — Consent & privacy',
)
check(
  'audit names degrade sensibly with no site',
  auditNameFor('Consent & privacy')({}) === 'Consent & privacy audit',
)
check(
  'alert names carry the condition',
  alertNameFrom({ conditionSummary: 'the purchase tag stops firing' }) ===
    'Alert: The purchase tag stops firing',
)
check(
  'alert names truncate rather than run on',
  alertNameFrom({ conditionSummary: 'x'.repeat(80) }).length < 60,
  alertNameFrom({ conditionSummary: 'x'.repeat(80) }),
)

// The trap: a derived name computed BEFORE the user supplied the URL must not
// be frozen into the final plan. Only user-supplied values may persist.
const derivedLate = answerAndRetry(
  await createPlan('check our site for privacy compliance', { forceLocal: true }),
  'gap.com',
  'check our site for privacy compliance',
)
check(
  'recomputes a derived name after a clarifying answer',
  derivedLate.plan?.parameters.auditName === 'gap.com — Consent & privacy',
  derivedLate.plan?.parameters.auditName,
)
check(
  'a user-supplied name still wins over the derived one',
  buildPlan(
    RECIPES.find(r => r.id === 'audit_with_consent_categories'),
    'g',
    { siteUrl: 'gap.com', auditName: 'Q3 privacy sweep' },
  ).plan.parameters.auditName === 'Q3 privacy sweep',
)

/* ---------------------------------------------------------------- */
section('account state — matching categories to a site')

const cats = [
  { id: 1, name: 'Gap EU — GDPR', labels: [] },
  { id: 2, name: 'Marketing approved', labels: ['gap.com'] },
  { id: 3, name: 'Old Navy US', labels: [] },
]

const rankedCats = rankForSite(cats, 'gap.com')
check('flags a name match', rankedCats.find(c => c.id === 1).matches === true)
check('flags a label match', rankedCats.find(c => c.id === 2).matches === true)
check('leaves unrelated categories unflagged', rankedCats.find(c => c.id === 3).matches === false)
check('sorts matches first', rankedCats[0].matches === true && rankedCats.at(-1).matches === false)
// Returning everything, flagged, rather than filtering: a user may know the
// right category even when its name says nothing about the domain.
check('returns every category, not just matches', rankedCats.length === cats.length)
check(
  'handles an unknown host without throwing',
  rankForSite(cats, '').every(c => !c.matches),
)
check(
  'does not match on a two-letter fragment',
  rankForSite([{ id: 9, name: 'EU cookies', labels: [] }], 'eu.com').every(c => !c.matches),
)

/* ---------------------------------------------------------------- */
section('state-aware planning')

const RECIPE = RECIPES.find(r => r.id === 'audit_with_consent_categories')
const withAccount = categories =>
  buildPlan(RECIPE, 'g', { siteUrl: 'gap.com' }, { account: { consentCategories: categories } })

// Blind: the plan has to hedge, and the hedge is the three-step branch.
const blind = buildPlan(RECIPE, 'g', { siteUrl: 'gap.com' })
check('falls back to generic steps with no account', blind.status === 'plan')
check(
  'generic plan still searches rather than naming a category',
  blind.plan.steps.some(s => s.say.includes('Search for the category')),
)

// A match: name it, and drop the branch entirely.
const matched = withAccount([
  { id: 1, name: 'Gap EU — GDPR', labels: [], cmpDomain: 'gap.com' },
  { id: 2, name: 'Unrelated', labels: [], cmpDomain: 'other.com' },
])
check('names the matching category in the summary', matched.plan.summary.includes('Gap EU — GDPR'))
check(
  'fills the search box with the real name',
  matched.plan.steps.some(s => s.action?.value === 'Gap EU — GDPR'),
)
check(
  'drops the "or create one instead" branch when something matches',
  !matched.plan.steps.some(s => s.say.includes('Create')),
  JSON.stringify(matched.plan.steps.map(s => s.say)),
)

// No match: creating one becomes the plan, not a footnote.
const unmatched = withAccount([{ id: 3, name: 'Unrelated', labels: [], cmpDomain: 'other.com' }])
check(
  'says up front that nothing covers the site',
  unmatched.plan.summary.includes('Nothing in your account'),
)
check(
  'makes creating a category the actual path',
  unmatched.plan.steps.some(s => s.say.includes('create one here')),
)
check(
  'never emits duplicate step ids across branches',
  new Set(unmatched.plan.steps.map(s => s.id)).size === unmatched.plan.steps.length,
)

// A CMP-synced account has one category per geography, not one per site. The
// real account returned 79 for observepoint.com; naming the first is arbitrary
// and attaches the wrong region's approvals.
const geoFanout = withAccount(
  ['Canada', 'Canada, Alberta', 'USA, Alabama', 'USA, California', 'Germany'].map((geo, i) => ({
    id: 10 + i,
    name: `Analytical Cookies | gap.com | ${geo}`,
    labels: [],
    cmpDomain: 'gap.com',
  })),
)
check('spots a CMP geo fan-out', geoFanout.plan.summary.includes('one per geography'))
check(
  'filters the picker by site instead of naming one arbitrarily',
  geoFanout.plan.steps.some(s => s.action?.value === 'gap.com'),
  JSON.stringify(geoFanout.plan.steps.map(s => s.action?.value)),
)
check(
  'tells the user to pick rather than attach everything',
  geoFanout.plan.steps.some(s => s.say.includes('not all of them')),
)
check(
  'still names a single match when there is no fan-out',
  matched.plan.steps.some(s => s.action?.value === 'Gap EU — GDPR'),
)

// Stating a region should narrow the fan-out rather than being ignored.
const geoAccount = ['Canada', 'Canada, Alberta', 'USA, Alabama', 'USA, California', 'Germany'].map(
  (geo, i) => ({
    id: 20 + i,
    name: `Analytical Cookies | gap.com | ${geo}`,
    labels: [],
    cmpDomain: 'gap.com',
    cmpGeo: geo,
    auditCount: geo === 'USA, California' ? 12 : 1,
  }),
)
const planFor = goal =>
  buildPlan(RECIPE, goal, { siteUrl: 'gap.com' }, { account: { consentCategories: geoAccount } })

const alberta = planFor('privacy audit for gap.com for Alberta')
check(
  'a uniquely named region resolves to one category',
  alberta.plan.summary.includes('Canada, Alberta'),
)
check(
  'and gets searched for by name',
  alberta.plan.steps.some(
    s => s.action?.value === 'Analytical Cookies | gap.com | Canada, Alberta',
  ),
)

const canada = planFor('privacy audit for gap.com for Canada')
check('a region covering several narrows to those', canada.plan.summary.includes('2 of your 5'))
check(
  'filters the picker by the region, not the domain',
  canada.plan.steps.some(s => s.action?.value === 'Canada'),
)
check(
  "keeps the account's own casing",
  canada.plan.summary.includes('Canada') && !canada.plan.summary.includes('canada'),
)
// Contradicting yourself is worse than saying less: never push the popular
// choice at someone who already named a different region.
check(
  'does not suggest the most-used one once a region is named',
  !canada.plan.steps.some(s => s.say.includes('USA, California')),
  JSON.stringify(canada.plan.steps.map(s => s.say)),
)

const noGeo = planFor('privacy audit for gap.com')
check(
  'with no region, suggests what their other audits use',
  noGeo.plan.summary.includes('USA, California') && noGeo.plan.summary.includes('12 of them'),
)
check(
  'and still leaves the choice to them',
  noGeo.plan.steps.some(s => s.say.includes('not all of them')),
)

/* ---------------------------------------------------------------- */
section('url normalisation')

check('adds a scheme', normalizeSiteUrl('Gap.com') === 'https://gap.com')
check(
  'lowercases the host only',
  normalizeSiteUrl('HTTPS://WWW.Gap.com/Checkout') === 'https://www.gap.com/Checkout',
)
check(
  'leaves a good url alone',
  normalizeSiteUrl('https://shop.example.com') === 'https://shop.example.com',
)
check('survives nonsense', normalizeSiteUrl('') === '')

/* ---------------------------------------------------------------- */
section('quick vs advanced audit creation')

// moonbeam's createWebAudit() opens the ADVANCED editor unless advanced mode is
// explicitly off, and storage.service returns `value ?? true` — so advanced is
// the default. A live check confirmed it. Planning the Quick Audit path for
// everyone pointed half the steps at a modal that never opens.
const pathFor = advanced =>
  buildPlan(
    RECIPE,
    'g',
    { siteUrl: 'gap.com' },
    { account: { consentCategories: [], advancedAuditMode: advanced } },
  ).plan.steps.map(s => s.targetSelector)

const advancedPath = pathFor(true)
const quickPath = pathFor(false)

check(
  'advanced path never waits on the Quick Audit modal',
  !advancedPath.some(sel => sel.includes('web-audit-switch-to-advanced-setup')),
  advancedPath.join(' | '),
)
check(
  'advanced path names the audit in the editor header',
  advancedPath.some(sel => sel.startsWith('audit-editor-header-name-control')),
)
check(
  'quick path still switches to advanced for Standards',
  quickPath.some(sel => sel.includes('web-audit-switch-to-advanced-setup')),
)
check(
  'quick path uses the quick-setup name field',
  quickPath.some(sel => sel.includes('audit-setup-name')),
)
check(
  'both reach the Standards tab',
  [advancedPath, quickPath].every(p => p.some(sel => sel.includes('audit-tab-standards'))),
)
check(
  'defaults to advanced when the account state is unknown',
  pathFor(undefined).join() === advancedPath.join(),
)

/* ---------------------------------------------------------------- */
section('selector catalogue')

const catalogue = allKnownSelectors()
check('collects selectors from every recipe', catalogue.length > 15, String(catalogue.length))
check(
  'deduplicates the shared audit path',
  new Set(catalogue.map(c => c.selector)).size === catalogue.length,
)
check(
  'labels each with its recipe and step',
  catalogue.every(c => /^[a-z_]+\/s\d+$/.test(c.id)),
  catalogue.find(c => !/^[a-z_]+\/s\d+$/.test(c.id))?.id,
)
check(
  'reaches recipes that build steps dynamically',
  catalogue.some(c => c.id.startsWith('audit_with_consent_categories/')),
)
check(
  'every entry carries a selector',
  catalogue.every(c => c.selector),
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
