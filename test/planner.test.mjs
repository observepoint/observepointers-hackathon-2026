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
import { rankModels, TIMEOUT_MS } from '../src/planner/llm.js'
import { hostFrom, auditNameFor, alertNameFrom, normalizeSiteUrl } from '../src/planner/naming.js'
import { rankForSite } from '../src/planner/account.js'
import { RECIPES, allKnownSelectors } from '../src/planner/recipes/index.js'
import { unswept } from '../src/planner/recipes/_unswept.js'
import { looksLikeAmendment } from '../src/planner/amend.js'
import {
  ONBOARDING_QUESTION,
  onboardingOptions,
  loadOnboarding,
  saveOnboarding,
  biasSuggestions,
} from '../src/planner/onboarding.js'

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

// The audit path is fully verified now, so this exercises the mechanism against
// alert_from_report, whose report-widget selectors nobody has stood in front of.
const alertPlan = await createPlan('alert me when the purchase tag stops firing', {
  forceLocal: true,
})
check(
  'flags unverified selectors so nobody debugs a ghost',
  alertPlan.status === 'plan' && alertPlan.warnings.some(w => w.includes('unverified')),
  JSON.stringify(alertPlan.warnings),
)
// The audit path carries one unverified step — the optional "Switch to Advanced
// Setup" — and that must NOT warn. An optional step exists because its target may
// be absent, so not resolving is the design. Warning on it would put a permanent
// notice on three fully-swept recipes and train everyone to ignore the line.
const verifiedPlan = await createPlan('privacy audit for gap.com', {
  forceLocal: true,
  account: { consentCategories: [] },
})
check(
  'and stays quiet once a path is verified',
  verifiedPlan.warnings.length === 0,
  JSON.stringify(verifiedPlan.warnings),
)
check(
  'even though it carries an optional unverified step',
  verifiedPlan.plan.steps.some(s => s.optional && s.unverified),
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
// The prefill must be a real category NAME, never a region token. A live run filled
// "us" -- two characters, matching 67 of 79 by substring -- which is useless as a
// filter and reads as the assistant not knowing the answer.
const fanoutFill = geoFanout.plan.steps.find(s => s.id === 's9')
check(
  'prefills a real category name, not a region token',
  fanoutFill?.action.value.includes('gap.com |'),
  fanoutFill?.action.value,
)
check(
  'tells the user to pick rather than attach everything',
  geoFanout.plan.steps.some(s => /not all|pick another|pick the region/i.test(s.say)),
  geoFanout.plan.steps.map(s => s.say).join(' | '),
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
  'prefills a Canadian category rather than the word Canada',
  canada.plan.steps.some(s => /\| Canada/.test(s.action?.value ?? '')),
  canada.plan.steps.find(s => s.id === 's9')?.action.value,
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
  noGeo.plan.steps.some(s => /others cover this site|pick the region/i.test(s.say)),
  noGeo.plan.steps.map(s => s.say).join(' | '),
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
section('one audit path, both entry points')

// This used to branch: read the audit count, predict whether Create -> Audit
// opens Quick Audit or the advanced editor, emit one of two step lists. The
// prediction was the problem -- getting it wrong doesn't degrade the walkthrough,
// it points at a modal that never opened. Now the switch step is `optional`, so
// the runtime skips it when it isn't there.
const auditPath = buildPlan(
  RECIPE,
  'g',
  { siteUrl: 'gap.com' },
  { account: { consentCategories: [] } },
).plan.steps

const switchStep = auditPath.find(s => s.targetSelector.includes('switch-to-advanced'))
check('the path includes a switch-to-advanced step', Boolean(switchStep))
check('and marks it optional, so the advanced entry point skips it', switchStep?.optional === true)
check(
  'the same list serves both entry points',
  auditPath.filter(s => s.targetSelector.includes('switch-to-advanced')).length === 1,
)
check(
  'nothing targets Quick Audit-only fields any more',
  !auditPath.some(s => s.targetSelector.includes('scanURL')),
  auditPath.map(s => s.targetSelector).join(' | '),
)
// Either modal satisfies the step that opens one. Mutually exclusive, so a comma
// list is the safe kind.
const opensEditor = auditPath.find(s => s.targetSelector.includes('guide-create-new-audit'))
check(
  'opening the editor accepts whichever modal appears',
  opensEditor.completion.targetSelector.includes('op-audit-editor') &&
    opensEditor.completion.targetSelector.includes('audit-setup-modal'),
  opensEditor.completion.targetSelector,
)
// Naming after the switch is what makes one list work: Quick Audit auto-names to
// "Simple Audit - <date>", so this either sets the name or replaces that default.
check(
  'the audit is named after the switch, not before',
  auditPath.findIndex(s => s.targetSelector.startsWith('audit-editor-header-name-control')) >
    auditPath.findIndex(s => s.targetSelector.includes('switch-to-advanced')),
)
check(
  'the account no longer needs reading to choose a path',
  buildPlan(RECIPE, 'g', { siteUrl: 'gap.com' }, {})
    .plan.steps.map(s => s.id)
    .join() === auditPath.map(s => s.id).join(),
)

/* ---------------------------------------------------------------- */
section('tab selectors survive without the moonbeam patch')

const consentSteps = buildPlan(
  RECIPE,
  'g',
  { siteUrl: 'gap.com' },
  { account: { consentCategories: [], advancedAuditMode: true } },
).plan.steps

const tabStep = id => consentSteps.find(s => s.id === id).targetSelector

// Both halves resolve to the same element, so the list works with or without
// the op-selector attribute.
for (const [id, attr, position] of [
  ['s5', 'audit-tab-url-sources', 'nth-child(2)'],
  ['s7', 'audit-tab-standards', 'nth-child(4)'],
]) {
  check(`${id} prefers the attribute`, tabStep(id).includes(attr))
  check(`${id} falls back positionally`, tabStep(id).includes(position))
}

// The sub-tabs deliberately get no positional fallback: unshift() ordering plus
// a conditional Consent tab means no index is right in both layouts, and a
// confident wrong tab is worse than none.
check('sub-tabs have no positional fallback', !tabStep('s8').includes('nth-child'), tabStep('s8'))
check(
  'sub-tabs keep a text fallback instead',
  Boolean(consentSteps.find(s => s.id === 's8').targetFallback),
)
// One unverified step survives by design: the optional switch to Advanced Setup.
// Every step the run definitely passes through has been seen.
check(
  'every required step on the audit path is verified',
  consentSteps.filter(s => !s.optional).every(s => !s.unverified),
  consentSteps
    .filter(s => !s.optional && s.unverified)
    .map(s => s.id)
    .join(),
)

// A recipe-level `verified` boolean used to sit alongside the per-step flag.
// Nothing read it, it had already drifted, and it cannot answer the question for
// a recipe whose two branches differ — audit_with_rules is fully swept on the
// advanced path and not on the quick one. One source of truth only.
check(
  'no recipe carries a recipe-level verified flag',
  RECIPES.every(r => r.verified === undefined),
  RECIPES.filter(r => r.verified !== undefined)
    .map(r => r.id)
    .join(', '),
)

/* ---------------------------------------------------------------- */
section('op-selector descends only where the wrapper needs it')

// Half the bugs in this library have been one word of ` input` / ` button` too
// many or too few. Where the attribute sits is a per-template fact, so pin the
// ones we have read.
const everySelector = allKnownSelectors().map(s => s.selector)
const has = needle => everySelector.some(s => s === needle)

for (const [selector, why] of [
  ['[op-selector="quick-create-name"] input', 'on mat-form-field, descend'],
  ['[op-selector="quick-create-emails"] input', 'on a wrapping div, descend'],
  ['[op-selector="cc-name"]', 'bound onto the <input matInput> itself'],
  ['[op-selector="quick-create-customize-link"]', 'bound onto the <button> itself'],
  ['[op-selector="rule-setup-save-btn"]', 'op-modal-footer-buttons binds onto <button>'],
  ['[op-selector="quick-create-save-button"]', 'op-modal-footer-buttons binds onto <button>'],
]) {
  check(`${selector} — ${why}`, has(selector), everySelector.join('\n   '))
}

// The specific regression: a footer button selector with a ` button` descend
// looks for a button inside a button and never resolves.
check(
  'no footer-button selector descends into a child button',
  !everySelector.some(s => /(save-btn|save-button|continue-btn)"\] button/.test(s)),
  everySelector.filter(s => /btn|button/.test(s)).join(' | '),
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

// Part 3 is told it can rely on this, and three of six recipes have no swept
// selectors at all, so the fallback is load-bearing rather than decorative.
check(
  'no step anywhere ships without a text fallback',
  (() => {
    for (const recipe of RECIPES) {
      const steps = recipe.steps ?? recipe.buildSteps?.({ parameters: {} }) ?? []
      const missing = steps.filter(s => !s.targetFallback?.description)
      if (missing.length) return false
    }
    return true
  })(),
)

// The flags used to be hand-placed and had already drifted: two recipes claimed
// verified steps nobody had looked at. unswept() marks a whole list at once.
check(
  'only the swept audit recipes claim zero unverified steps',
  (() => {
    const clean = RECIPES.filter(recipe => {
      const steps = recipe.steps ?? recipe.buildSteps?.({ parameters: {} }) ?? []
      return steps.filter(s => !s.optional).every(s => !s.unverified)
    }).map(r => r.id)
    return (
      clean.join() ===
      [
        'audit_with_rules',
        'audit_with_consent_categories',
        'audit_with_alerts',
        // Reuses only selectors the three above already proved.
        'audit_with_all_standards',
        // Swept end to end on /rules/library: sidebar link, Create Rule,
        // name field, Next, Save.
        'create_first_rule',
      ].join()
    )
  })(),
)

/* ---------------------------------------------------------------- */
section('naming a region the way a person would')

const aliasCat = (id, geo, n = 0) => ({
  id,
  name: `gap.com | ${geo}`,
  labels: [],
  cmpDomain: 'gap.com',
  cmpGeo: geo,
  auditCount: n,
})
const aliasAccount = {
  consentCategories: [
    aliasCat(1, 'USA, California', 2),
    aliasCat(2, 'USA, Alabama'),
    aliasCat(3, 'Canada'),
    aliasCat(4, 'Canada, Alberta'),
    aliasCat(5, 'EU'),
    aliasCat(6, 'UK'),
  ],
  advancedAuditMode: true,
}
const searchesFor = async goal => {
  const r = await createPlan(goal, { forceLocal: true, account: aliasAccount })
  return r.plan?.steps?.find(step => step.id === 's9')?.action?.value ?? `(${r.status})`
}
const privacy = region => `check gap.com for privacy compliance in ${region}`

// The reported failure: an account that writes USA matched nothing for "the
// United States", so the plan picked the first of four by ordering.
// Asserts which geo the chosen category belongs to, not an exact string: the
// prefill is a real category name now, and the point is that it covers the region
// the user named.
for (const [said, geo] of [
  ['the United States', 'USA'],
  ['the U.S.', 'USA'],
  ['America', 'USA'],
  ['Canada', 'Canada'],
]) {
  const filled = await searchesFor(privacy(said))
  check(`"${said}" narrows to a ${geo} category`, filled.includes(geo), filled)
}

// Two-character geos used to be dropped outright by a length > 2 filter, so an
// account filing things under EU or UK could never be narrowed at all.
check(
  'a two-letter geo can be named',
  (await searchesFor(privacy('the European Union'))).includes('EU'),
  await searchesFor(privacy('the European Union')),
)
check(
  'and matched through its alias',
  (await searchesFor(privacy('the United Kingdom'))).includes('UK'),
)

// The reason bare "us" is deliberately absent from the alias table. The prefill is
// a real category name now, so the assertion is about NARROWING, not the string:
// a pronoun must not make the plan claim it filtered to a region.
const pronounPlan = await createPlan('check our site for privacy compliance for us, gap.com', {
  forceLocal: true,
  account: aliasAccount,
})
check(
  'the pronoun in "for us" does not narrow to a region',
  pronounPlan.plan.summary.includes('one per geography') &&
    !/covering|cover us\b/i.test(pronounPlan.plan.summary),
  pronounPlan.plan.summary,
)
// Bounded matching, not substring: "eu" inside another word must not count.
check(
  'a geo code inside a longer word is not a mention',
  !(await searchesFor('check gap.com for privacy compliance, reuse the queue setup')).includes(
    'EU',
  ),
)
check(
  'a sub-region still wins over its country',
  (await searchesFor(privacy('Alberta'))).includes('Alberta'),
  await searchesFor(privacy('Alberta')),
)

/* ---------------------------------------------------------------- */
section('the model gets a deadline')

check('a timeout is declared', TIMEOUT_MS > 0 && TIMEOUT_MS <= 15000, String(TIMEOUT_MS))

/* ---------------------------------------------------------------- */
section('mid-conversation edits')

const GAP_CATS = [
  {
    id: 1,
    name: 'gap.com — us,ca',
    labels: [],
    cmpDomain: 'gap.com',
    cmpGeo: 'USA, California',
    auditCount: 2,
  },
  {
    id: 2,
    name: 'gap.com | Canada',
    labels: [],
    cmpDomain: 'gap.com',
    cmpGeo: 'Canada',
    auditCount: 0,
  },
  {
    id: 3,
    name: 'gap.com | Canada, Alberta',
    labels: [],
    cmpDomain: 'gap.com',
    cmpGeo: 'Canada, Alberta',
    auditCount: 0,
  },
  {
    id: 4,
    name: 'gap.com | USA, Alabama',
    labels: [],
    cmpDomain: 'gap.com',
    cmpGeo: 'USA, Alabama',
    auditCount: 0,
  },
]
const gapAccount = { consentCategories: GAP_CATS }
const plan1 = await createPlan('Check compliance for gap.com in the United States', {
  forceLocal: true,
  account: gapAccount,
})
check('the first turn plans normally', plan1.status === 'plan', plan1.message)

// The reported bug, verbatim. On its own this sentence is unmatchable — there is
// no Canada recipe — and the information that makes it meaningful is one turn back.
const amended = await createPlan('Can i do it for Canada instead', {
  forceLocal: true,
  account: gapAccount,
  previous: plan1.plan,
})
check('a follow-up amends instead of failing to match', amended.status === 'plan', amended.message)
check('and is flagged as an edit, not a fresh plan', amended.amended === true)
check(
  'the site carries over rather than being asked for again',
  amended.plan?.parameters.siteUrl === 'https://gap.com',
  amended.plan?.parameters.siteUrl,
)
check('the new region wins', amended.plan?.summary.includes('Canada'), amended.plan?.summary)
// Replacement, not accumulation. If the old goal were still in scope, both "USA"
// and "Canada" would match and the narrowing would be meaningless.
check(
  'the superseded region is gone',
  !amended.plan?.summary.includes('USA') && !amended.plan?.summary.includes('California'),
  amended.plan?.summary,
)

// The guard. Inheriting on every unmatched message would be worse than the bug:
// you would get a consent-category walkthrough for Utah, confidently.
const offTopic = await createPlan('what is the weather in Utah', {
  forceLocal: true,
  account: gapAccount,
  previous: plan1.plan,
})
check(
  'an unrelated question after a plan is still a non-match',
  offTopic.status === 'no_match',
  JSON.stringify(offTopic).slice(0, 120),
)
check(
  'nothing is amended without a previous plan',
  (await createPlan('Can i do it for Canada instead', { forceLocal: true })).status === 'no_match',
)

// Changing their mind about the goal, not just a value: the follow-up matches a
// recipe on its own, so that wins — and the site still carries over.
const switched = await createPlan('actually alert me when something breaks instead', {
  forceLocal: true,
  account: gapAccount,
  previous: plan1.plan,
})
check(
  'a follow-up that names a different recipe switches to it',
  switched.plan?.recipeId !== 'audit_with_consent_categories',
  switched.plan?.recipeId ?? switched.status,
)

// A derived name must not survive a change to what it was derived from.
const rulesPlan = await createPlan('set up an audit for gap.com that checks my tag rules', {
  forceLocal: true,
})
check(
  'derived the first name from the first site',
  rulesPlan.plan.parameters.auditName.startsWith('gap.com'),
)
const moved = await createPlan('use example.com instead', {
  forceLocal: true,
  previous: rulesPlan.plan,
})
check('a bare value counts as an edit', moved.status === 'plan', moved.message)
check(
  'the site changes',
  moved.plan?.parameters.siteUrl === 'https://example.com',
  moved.plan?.parameters.siteUrl,
)
check(
  'and the derived name follows it rather than naming the old host',
  moved.plan?.parameters.auditName.startsWith('example.com'),
  moved.plan?.parameters.auditName,
)

// …but a name the user typed is theirs, and must survive.
const named = await createPlan(
  'set up an audit called "Q3 tag sweep" for gap.com that checks my rules',
  { forceLocal: true },
)
const renamedSite = await createPlan('actually use example.com', {
  forceLocal: true,
  previous: named.plan,
})
check(
  'a name the user chose is kept across an edit',
  renamedSite.plan?.parameters.auditName === 'Q3 tag sweep',
  renamedSite.plan?.parameters.auditName,
)

check('looksLikeAmendment needs a previous plan', !looksLikeAmendment('for Canada instead', null))
check(
  'looksLikeAmendment ignores a fragment that fits no parameter',
  !looksLikeAmendment('hello there', { recipeId: 'audit_with_rules', parameters: {} }),
)

/* ---------------------------------------------------------------- */
section('first-run onboarding')

const optionsFor = account => onboardingOptions(account === undefined ? {} : { account })
const byId = (opts, id) => opts.find(o => o.id === id)

const blindOptions = optionsFor(undefined)
check('asks one question', ONBOARDING_QUESTION.length > 0)
check('offers four answers', blindOptions.length === 4, String(blindOptions.length))
check(
  'every answer carries a label and a hint',
  blindOptions.every(o => o.label && o.hint),
)
check(
  '"not sure" deliberately maps to no recipe',
  byId(blindOptions, 'browse').recipeId === null && byId(blindOptions, 'browse').goal === null,
)
check(
  'never leaks the emptyAccount branch to the UI',
  blindOptions.every(o => o.emptyAccount === undefined),
)

// The property that keeps onboarding honest: an option is just a sentence, and
// that sentence has to reach the recipe the option claims. Without this, a
// reworded label silently starts planning something else.
for (const option of blindOptions.filter(o => o.recipeId)) {
  check(
    `"${option.label}" reaches ${option.recipeId}`,
    matchDeterministic(option.goal).recipeId === option.recipeId,
    matchDeterministic(option.goal).recipeId,
  )
}

const emptyAccount = optionsFor({ consentCategories: [], rules: [] })
check(
  'empty rule library retargets to create_first_rule',
  byId(emptyAccount, 'tags').recipeId === 'create_first_rule',
)
check(
  'empty consent library retargets to create_first_consent_category',
  byId(emptyAccount, 'privacy').recipeId === 'create_first_consent_category',
)
check(
  'a retargeted option says why',
  byId(emptyAccount, 'tags').retargeted && byId(emptyAccount, 'tags').hint.includes('empty'),
)
check(
  'retargeted goals reach their retargeted recipes',
  emptyAccount
    .filter(o => o.retargeted)
    .every(o => matchDeterministic(o.goal).recipeId === o.recipeId),
)
check(
  'alerts has nothing to retarget to, so it never does',
  byId(emptyAccount, 'alerts').recipeId === 'audit_with_alerts',
)

const fullAccount = optionsFor({ consentCategories: [{ id: 1, name: 'x' }], rules: [{ id: 1 }] })
check(
  'a populated account keeps the audit recipes',
  byId(fullAccount, 'tags').recipeId === 'audit_with_rules' &&
    byId(fullAccount, 'privacy').recipeId === 'audit_with_consent_categories',
)

// The dangerous direction: unread must never be mistaken for empty, or someone
// with a full library gets sent off to build a duplicate.
const unreadable = optionsFor({ advancedAuditMode: true })
check(
  'an unread account does not retarget',
  unreadable.every(o => !o.retargeted),
)
check(
  'a partial read only retargets the half it read',
  (() => {
    const half = optionsFor({ consentCategories: [] })
    return byId(half, 'privacy').retargeted && !byId(half, 'tags').retargeted
  })(),
)

/* ---------------------------------------------------------------- */
section('onboarding memory')

const fakeStore = () => {
  const cells = new Map()
  return { get: k => cells.get(k), set: (k, v) => void cells.set(k, v), cells }
}

const store = fakeStore()
check('first run has nothing stored', (await loadOnboarding(store)) === null)

const saved = await saveOnboarding(byId(blindOptions, 'privacy'), store)
check('remembers which option was picked', saved.optionId === 'privacy')
check('remembers the recipe behind it', saved.recipeId === 'audit_with_consent_categories')
check('stamps when', typeof saved.at === 'string' && saved.at.includes('T'))
check('reads back on the next run', (await loadOnboarding(store)).optionId === 'privacy')

const allSuggestions = suggestions()
const biased = biasSuggestions(allSuggestions, saved)
check('leads with what they came for', biased[0].recipeId === 'audit_with_consent_categories')
check('reorders without dropping anything', biased.length === allSuggestions.length)
check(
  'keeps every recipe reachable',
  new Set(biased.map(s => s.recipeId)).size === allSuggestions.length,
)
check(
  'a "not sure" answer changes nothing',
  biasSuggestions(allSuggestions, { recipeId: null })[0].recipeId === allSuggestions[0].recipeId,
)

/* ---------------------------------------------------------------- */
section('starter recipes for an empty account')

for (const [id, parameters] of [
  ['create_first_rule', { ruleSubject: 'Google Analytics fires on every page' }],
  ['create_first_consent_category', { siteUrl: 'gap.com' }],
]) {
  const recipe = RECIPES.find(r => r.id === id)
  const built = buildPlan(recipe, 'g', parameters)
  check(`${id} builds a valid plan`, built.status === 'plan', built.message)

  const steps = built.plan?.steps ?? []
  // One step to the library, not two. The sidebar's sections are always
  // expanded (app.component.ts hardcodes showTopNavBar = true, which feeds
  // [alwaysExpanded]), so there is nothing to open first.
  check(
    `${id} goes straight to the library link`,
    steps[0]?.targetSelector.startsWith('[op-selector="sidebar-standards-'),
    steps[0]?.targetSelector,
  )
  check(
    `${id} waits on a real route, since libraries are routes`,
    steps[0]?.completion.type === 'url_change',
    JSON.stringify(steps[0]?.completion),
  )
  // The bug this replaced: a step that waited for dom_mutation on a sidebar
  // link which was already on screen. A mutation observer never fires for an
  // element that does not change, so it hung on step one. Nothing may wait for
  // a nav link to appear.
  check(
    `${id} never waits for a sidebar link to appear`,
    !steps.some(
      s =>
        s.completion.type === 'dom_mutation' &&
        String(s.completion.targetSelector).includes('op-selector="sidebar-'),
    ),
  )
  check(
    `${id} names the thing but leaves the policy to the user`,
    steps.filter(s => s.actor === 'ai').length === 1,
  )
  check(
    `${id} gives every unverified step a text fallback`,
    steps.filter(s => s.unverified).every(s => s.targetFallback?.description),
  )
}

// create_first_rule is the one starter that has been walked end to end, so it is
// the fixture to hand Part 2 for the route-based shape.
check(
  'create_first_rule has no unswept steps left',
  RECIPES.find(r => r.id === 'create_first_rule').steps.every(s => !s.unverified),
)
// …and its neighbour still does, which is the point of splitting the wrapper.
// Everything here is swept except the menu row, and that one is awkward
// structurally rather than unvisited: it exists only while the menu is open, a
// state that lasts between two steps. unswept()'s id list is what lets a single
// hole sit in the middle of a confirmed sequence without rounding either way.
check(
  'create_first_consent_category has only the transient menu row left unswept',
  (() => {
    const steps = RECIPES.find(r => r.id === 'create_first_consent_category').steps
    return (
      steps
        .filter(s => s.unverified)
        .map(s => s.id)
        .join() === 's3'
    )
  })(),
  RECIPES.find(r => r.id === 'create_first_consent_category')
    .steps.filter(s => s.unverified)
    .map(s => s.id)
    .join(),
)
check(
  'unswept() with no id list still flags everything',
  unswept([{ id: 'a' }, { id: 'b' }]).every(s => s.unverified),
)
check(
  'unswept() leaves steps outside the id list untouched',
  (() => {
    const out = unswept([{ id: 'a' }, { id: 'b' }], ['b'])
    return !out[0].unverified && out[1].unverified
  })(),
)

// A sweep reported cc-create-next and cc-create-save "in DOM but hidden".
// initFooterButtons() hides five of the eight footer buttons on the create path,
// and cc-create-save sat on two buttons so it resolved to the hidden one. The
// only enabled primary after naming is "Create without selecting a report".
const ccSteps = RECIPES.find(r => r.id === 'create_first_consent_category').steps
check(
  'the consent category is created without a report, in one step',
  ccSteps.at(-1).targetSelector === '[op-selector="cc-create-without-report"]',
  ccSteps.at(-1).targetSelector,
)
check(
  'nothing targets the footer buttons that are hidden on the create path',
  !ccSteps.some(s => /cc-create-(next|prev|save)"/.test(s.targetSelector)),
  ccSteps.map(s => s.targetSelector).join(' | '),
)

// The sweep that mattered: `.mat-menu-op-button-2021 button[mat-menu-item]`
// resolved to "Import Category Data from Template", the FIRST of three rows,
// and reported itself visible. A wrong hit is worse than a miss, because a miss
// falls through to targetFallback.
const menuStep = RECIPES.find(r => r.id === 'create_first_consent_category').steps[2]
check(
  'the menu item is addressed by position from the end, not the start',
  menuStep.targetSelector.includes(':last-child'),
  menuStep.targetSelector,
)
check(
  'and prefers the op-selector when the moonbeam patch is present',
  menuStep.targetSelector.startsWith('[op-selector="cc-create-new-category"]'),
)
// Same rule as the audit tabs: a comma list is only safe when both halves are
// the same element. Here the attribute sits on the very button :last-child
// picks. It is NOT safe to point at the containing panel as a fallback — the
// panel precedes the button in document order, so querySelector would always
// return the panel and the attribute would never win.
check(
  'the fallback half does not widen to the containing menu panel',
  !/,\s*\.mat-menu-op-button-2021$/.test(menuStep.targetSelector),
)

check(
  'a rule name reads as the assertion, not a label',
  buildPlan(
    RECIPES.find(r => r.id === 'create_first_rule'),
    'g',
    {
      ruleSubject: 'the purchase tag fires on checkout',
    },
  ).plan.parameters.ruleName === 'The purchase tag fires on checkout',
)
check(
  'a consent category is named after its site',
  buildPlan(
    RECIPES.find(r => r.id === 'create_first_consent_category'),
    'g',
    {
      siteUrl: 'https://www.gap.com/x',
    },
  ).plan.parameters.categoryName === 'gap.com — Approved',
)

// The whole reason these exist: "create a rule" must not land on the audit
// recipe, which would walk someone to a picker with nothing in it.
check(
  '"create a rule" reaches the starter, not the audit',
  matchDeterministic('create a rule').recipeId === 'create_first_rule',
  matchDeterministic('create a rule').recipeId,
)
check(
  '"create a consent category" reaches the starter',
  matchDeterministic('create a consent category').recipeId === 'create_first_consent_category',
  matchDeterministic('create a consent category').recipeId,
)
// …and the audit phrasings must still reach the audit recipes.
check(
  '"set up an audit that checks my tag rules" still reaches the audit',
  matchDeterministic('set up an audit that checks my tag rules').recipeId === 'audit_with_rules',
  matchDeterministic('set up an audit that checks my tag rules').recipeId,
)
check(
  '"check our site for privacy compliance" still reaches the audit',
  matchDeterministic('check our site for privacy compliance').recipeId ===
    'audit_with_consent_categories',
  matchDeterministic('check our site for privacy compliance').recipeId,
)

/* ---------------------------------------------------------------- */
section('an empty consent library is not an unread one')

const emptyLibraryPlan = buildPlan(
  RECIPES.find(r => r.id === 'audit_with_consent_categories'),
  'g',
  { siteUrl: 'gap.com' },
  { account: { consentCategories: [], advancedAuditMode: true } },
).plan

check(
  'an empty library plans to create one',
  emptyLibraryPlan.steps.at(-2).targetSelector.includes('create-new-btn'),
  emptyLibraryPlan.steps.at(-2).targetSelector,
)
check(
  'and says so in the summary',
  emptyLibraryPlan.summary.includes('Nothing in your account'),
  emptyLibraryPlan.summary,
)

const unreadLibraryPlan = buildPlan(
  RECIPES.find(r => r.id === 'audit_with_consent_categories'),
  'g',
  { siteUrl: 'gap.com' },
  { account: { advancedAuditMode: true } },
).plan

check(
  'an unread library keeps the generic hedge',
  unreadLibraryPlan.steps.at(-1).targetSelector.includes('add-all-standards-btn'),
  unreadLibraryPlan.steps.at(-1).targetSelector,
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
