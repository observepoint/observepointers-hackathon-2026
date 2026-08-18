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
import {
  RECIPES,
  allKnownSelectors,
  representativeParameters,
} from '../src/planner/recipes/index.js'
import { unswept } from '../src/planner/recipes/_unswept.js'
import { SIDEBAR_ANCHORS } from '../src/shared/selectors.js'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTargetSelector, applyOperators, cssPartOf } from '../src/content/selector-query.js'
import { looksLikeAmendment } from '../src/planner/amend.js'
import { demoMatch, DEMO_GOAL } from '../src/planner/demo.js'
import { advanceModeFor } from '../src/content/advance.js'
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
// Even blind it says what to TYPE. "Search for the category that covers this site"
// is an instruction with the useful half missing -- the user is staring at a search
// box wondering what the thing is called. We cannot know the category name without
// the account, but we know the site, and its name almost always contains it.
check(
  'a blind plan still prefills something searchable',
  blind.plan.steps.some(s => s.action?.value === 'gap.com'),
  JSON.stringify(blind.plan.steps.map(s => s.action?.value)),
)
check(
  'and admits it is guessing at the name',
  blind.plan.steps.some(s => /best guess at the name/.test(s.say)),
  blind.plan.steps.map(s => s.say).join(' | '),
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
  // Scoped to the hedge, not to the word "Create": the entry step legitimately
  // says "Click Create New in the left sidebar", which made a bare substring
  // check fail the moment that path changed.
  !matched.plan.steps.some(s => /create one|create a new consent/i.test(s.say)),
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
// OneTrust-imported names carry the country -- "Analytical Cookies | example.com |
// Canada, Alberta" -- so when several qualify, the COUNTRY is the filter that
// matches how they are organised. A full name would narrow to exactly one and take
// away the choice the branch exists to offer.
check(
  'types the country when several categories qualify',
  canada.plan.steps.find(s => s.id === 's9')?.action.value === 'Canada',
  canada.plan.steps.find(s => s.id === 's9')?.action.value,
)
check(
  'and asks the user to pick within it',
  /pick the one for your part of Canada/i.test(
    canada.plan.steps.find(s => s.id === 's10')?.say ?? '',
  ),
  canada.plan.steps.find(s => s.id === 's10')?.say,
)
// But when only one qualifies there is nothing to choose, so name it exactly.
check(
  'types a full name when the region resolves to one category',
  alberta.plan.steps.find(s => s.id === 's9')?.action.value.includes('Canada, Alberta'),
  alberta.plan.steps.find(s => s.id === 's9')?.action.value,
)
// Never a two-letter code: typed into a substring picker it matches most names.
check(
  'never types something too short to filter',
  RECIPES.filter(r => r.id.startsWith('audit_with')).every(r => {
    const steps = r.steps ?? r.buildSteps({ parameters: { siteUrl: 'gap.com' }, goal: 'for US' })
    return steps.every(st => !st.action?.value || st.action.value.length >= 3)
  }),
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
section('asking for two areas means you asked for both')

// Keywords alone cannot see this. The phrasing a person actually uses names all
// three concepts and not one of them by its product name, so it scored highest on
// whichever area used the most matching words -- and answering with one silently
// drops the rest, which is the bug audit_with_all_standards exists to fix.
const routeOf = goal => matchDeterministic(goal).recipeId

check(
  'a natural sentence covering all three reaches the combined recipe',
  routeOf(
    'Audit gap.com to check our tags still fire, only approved cookies drop before consent, and alert me if either breaks',
  ) === 'audit_with_all_standards',
  routeOf(
    'Audit gap.com to check our tags still fire, only approved cookies drop before consent, and alert me if either breaks',
  ),
)
check(
  'two of three is enough',
  routeOf('audit gap.com for consent compliance and alert me if it breaks') ===
    'audit_with_all_standards',
  routeOf('audit gap.com for consent compliance and alert me if it breaks'),
)

// And the single-area phrasings must NOT be dragged in. The area vocabulary is kept
// separate from the recipes' keywords precisely because audit_with_rules claims
// "set up an audit" -- a phrase that says nothing about rules, and would otherwise
// read the alerts onboarding goal as two areas.
for (const [goal, expected] of [
  ['set up an audit for https://www.example.com that checks my tag rules', 'audit_with_rules'],
  ['audit example.com for GDPR consent compliance', 'audit_with_consent_categories'],
  ['set up an audit and alert me if something breaks', 'audit_with_alerts'],
  ['add alerts to my audit', 'audit_with_alerts'],
  ['alert me when the purchase tag stops firing', 'alert_from_report'],
]) {
  check(`"${goal.slice(0, 44)}…" stays on ${expected}`, routeOf(goal) === expected, routeOf(goal))
}

/* ---------------------------------------------------------------- */
section('a prerequisite beats the thing it feeds')

// "import ours for Utah, THEN audit the site" asks for four things in order. Before
// this, the areas rule fired first and routed straight to the audit -- skipping the
// import, so the audit would then have had nothing to attach.
const otGoal =
  'observepoint.com uses OneTrust — import our consent categories for Utah, then edit My First ' +
  'Audit to check the site against them with tag rules, follow the Timing Value best practice on ' +
  'Google Universal Analytics, and alert me if anything breaks'

// The alert needs an email and nothing before it does, so the chain asks once, up
// front, rather than stalling on step thirty. That IS the designed behaviour.
const otAsk = await createPlan(otGoal, { forceLocal: true })
check(
  'the alert email is asked for before anything starts',
  otAsk.status === 'needs_input' && otAsk.missing?.includes('notifyEmail'),
  `${otAsk.status} ${otAsk.missing?.join(',') ?? ''}`,
)
check(
  'and the question is attributed to the head, so answering re-plans the whole chain',
  otAsk.recipeId === 'import_consent_from_onetrust',
  otAsk.recipeId,
)

const otPlan = answerAndRetry(otAsk, 'jun@observepoint.com', otGoal)

check(
  'the demo sentence starts with the import',
  otPlan.plan?.recipeId === 'import_consent_from_onetrust',
  otPlan.plan?.recipeId ?? otPlan.status,
)
// The demo runs the onboarding walkthrough first, which leaves one audit behind. So the
// last link must EDIT it. Creating instead would type over its name and starting URL and
// leave the account with two audits.
check(
  'and queues the rule, the alert and an EDIT of the existing audit, in dependency order',
  JSON.stringify(otPlan.plans?.map(p => p.recipeId)) ===
    JSON.stringify([
      'import_consent_from_onetrust',
      'create_tag_variable_rule',
      'create_first_alert',
      'edit_audit_add_standards',
    ]),
  JSON.stringify(otPlan.plans?.map(p => p.recipeId)),
)
check('it pulls the site out', otPlan.plan?.parameters.siteUrl === 'https://observepoint.com')
check(
  'and the location, which is capitalised where the rest is not',
  otPlan.plan?.parameters.location === 'Utah',
  otPlan.plan?.parameters.location,
)
check(
  'the location reaches the step the user has to act on',
  otPlan.plan?.steps.some(s => s.say.includes('Utah')),
  otPlan.plan?.steps.map(s => s.say).join(' | '),
)
check(
  'the email reaches the alert walkthrough',
  otPlan.plans?.[2].steps.some(s => s.say.includes('jun@observepoint.com')),
  otPlan.plans?.[2].steps.map(s => s.say).join(' | '),
)

// The audit's name is read out of the sentence by the link that needs it, three recipes
// downstream of the one that matched. Without per-link extraction it addressed "your
// audit" and the step could not name the card to open.
const otEdit = otPlan.plans?.[3]
check(
  'the audit is addressed by name, extracted for the link that cares',
  otEdit?.parameters.auditName === 'My First Audit',
  otEdit?.parameters.auditName,
)
check(
  'and the name is in the step the user acts on',
  otEdit?.steps.some(s => s.say.includes('My First Audit')),
  otEdit?.steps.map(s => s.say).join(' | '),
)
// The audit card's op-selector embeds its id, so a prefix match reaches the FIRST
// audit card and not the named one. On an account with several audits that edits the
// wrong audit, silently. The fix is a step, not a selector: filter the grid by name
// first, so the prefix can only match one card.
check(
  'a named audit gets filtered for before the card is touched',
  otEdit?.steps.some(
    s => s.targetSelector === 'input[aria-label="Search By Data Source"]' && s.actor === 'ai',
  ),
  otEdit?.steps.map(s => s.targetSelector).join(' | '),
)
check(
  'and the search runs before the card menu, or it narrows nothing',
  otEdit.steps.findIndex(s => s.targetSelector.includes('Search By Data Source')) <
    otEdit.steps.findIndex(s => s.targetSelector.includes('open-menu-options-btn')),
)
// With no name there is nothing to search for, and "search for your audit" is not an
// instruction.
const unnamedEdit = buildPlan(
  RECIPES.find(r => r.id === 'edit_audit_add_standards'),
  'add rules and alerts to the audit',
  { siteUrl: 'gap.com' },
)
check(
  'with no audit named, the search step is dropped rather than filled with prose',
  unnamedEdit.plan?.steps.every(s => !s.targetSelector.includes('Search By Data Source')),
  unnamedEdit.plan?.steps.map(s => s.say).join(' | '),
)

// The audit's NAME is never touched: it exists, the user chose it, and overwriting it
// is the failure that made this a separate recipe from audit_with_all_standards.
check(
  'the edit path never types over the audit name',
  otEdit?.steps.every(s => !/audit-editor-header-name-control/.test(s.targetSelector)),
  otEdit?.steps.find(s => /audit-editor-header-name-control/.test(s.targetSelector))?.say,
)
// The starting URL is different: the onboarding tour deliberately leaves it to the user,
// so on the demo path it is EMPTY -- and an audit with no starting URL crawls nothing, so
// the Standards we just attached would have nothing to run against.
check(
  'but it does set the starting URL, which onboarding leaves blank',
  otEdit?.steps.some(s => /audit-setup-starting-urls/.test(s.targetSelector) && s.actor === 'ai'),
  otEdit?.steps.map(s => s.targetSelector).join(' | '),
)
check(
  'and does it before the Standards tab, not after',
  otEdit.steps.findIndex(s => /audit-setup-starting-urls/.test(s.targetSelector)) <
    otEdit.steps.findIndex(s => /audit-tab-standards/.test(s.targetSelector)),
)

// The point of accumulating parameters down the chain: the audit's picker searches
// for the rule and alert the earlier walkthroughs just made, not for whatever ranked
// highest in an account snapshot that predates them.
check(
  'the audit attaches the rule that was just created, by name',
  otEdit?.steps.some(s => s.say.includes(otPlan.plans[1].parameters.ruleName)),
  otPlan.plans?.[1].parameters.ruleName,
)
check(
  'and the alert that was just created, by name',
  otEdit?.steps.some(s => s.say.includes(otPlan.plans[2].parameters.alertName)),
  otPlan.plans?.[2].parameters.alertName,
)

// Nothing said an audit already exists, so this one builds one.
//
// The goal has to be passed through to answerAndRetry, not a placeholder: buildChain
// reads it, so a stub goal produces no chain at all and the check would pass for the
// wrong reason. That is exactly what it did on first writing.
const freshGoal =
  'gap.com uses OneTrust — import our consent categories for Utah, then audit the site against ' +
  'them with tag rules and alert me if anything breaks'
const freshChain = await createPlan(freshGoal, { forceLocal: true })
const freshPlan = answerAndRetry(freshChain, 'jun@observepoint.com', freshGoal)
check(
  'with no existing audit named, the chain creates one instead',
  freshPlan.plans?.at(-1).recipeId === 'audit_with_all_standards',
  freshPlan.plans?.map(p => p.recipeId).join(','),
)

// Asking to import without asking for an audit stops when the import is done.
const otOnly = await createPlan('import our consent categories from OneTrust for gap.com', {
  forceLocal: true,
})
check(
  'a bare import queues one walkthrough, not four',
  otOnly.plans?.length === 1,
  otOnly.plans?.map(p => p.recipeId).join(','),
)

// Both halves are required. Mentioning the CMP is not asking to import from it, and
// re-importing categories someone already has is not a helpful reading.
check(
  'mentioning OneTrust without an import verb does not hijack the audit',
  matchDeterministic('audit gap.com with rules and alerts, we use OneTrust').recipeId ===
    'audit_with_all_standards',
  matchDeterministic('audit gap.com with rules and alerts, we use OneTrust').recipeId,
)
check(
  'and a plain multi-standard audit is untouched',
  matchDeterministic('audit gap.com with rules, consent categories and alerts').recipeId ===
    'audit_with_all_standards',
)

// chain is only present when a recipe declares one -- absent, not null, everywhere else.
check(
  'recipes without a successor carry no chain field',
  RECIPES.filter(r => !r.chain).every(r => {
    const built = buildPlan(
      r,
      'g',
      Object.fromEntries(r.parameters.map(param => [param.name, param.example || 'x'])),
    )
    return built.status !== 'plan' || built.plan.chain === undefined
  }),
)

/* ---------------------------------------------------------------- */
section('creating a first rule, consent category or alert')

for (const [id, params, ends] of [
  ['create_first_rule', { ruleSubject: 'GA4 fires on every page' }, 'rule-setup-save-btn'],
  ['create_first_consent_category', { siteUrl: 'gap.com' }, 'cc-create-without-report'],
  ['create_first_alert', { notifyEmail: 'jun@observepoint.com' }, 'alert-designer-save-btn'],
]) {
  const built = buildPlan(
    RECIPES.find(r => r.id === id),
    'g',
    params,
  )
  check(`${id} builds a valid plan`, built.status === 'plan', built.message)
  check(
    `${id} ends on its own save`,
    built.plan?.steps.at(-1).targetSelector.includes(ends),
    built.plan?.steps.at(-1).targetSelector,
  )
  // Same rule as everywhere else: we name the thing, the user commits it.
  check(`${id} leaves the save to the user`, built.plan?.steps.at(-1).actor === 'user')
}

// The alerts starter is the weakest of the three and should not steal the better
// path: a report widget's bell pre-fills the metric, which the Library cannot.
check(
  'a concrete "alert me when X" still prefers the report-widget path',
  routeOf('notify me if checkout breaks') !== 'create_first_alert',
  routeOf('notify me if checkout breaks'),
)

/* ---------------------------------------------------------------- */
section('rules and alerts plan against the account too')

// Consent categories got this first because CMP groups carry a domain to match on.
// Rules and alerts have no site -- a rule is about a tag, not a domain -- so the
// honest signal is popularity inside the account: the rule other audits already
// check, the alert other people already watch.
const pickerFor = (id, account) =>
  RECIPES.find(r => r.id === id)
    .buildSteps({ account, parameters: { siteUrl: 'gap.com' }, goal: 'g' })
    .slice(8)

for (const [id, key, items, top] of [
  [
    'audit_with_rules',
    'rules',
    [
      { id: 1, name: 'Consent banner present', usageCount: 1 },
      { id: 2, name: 'GA4 fires on every page', usageCount: 4 },
    ],
    'GA4 fires on every page',
  ],
  [
    'audit_with_alerts',
    'alerts',
    [
      { id: 1, name: 'GA4 missing', subscribedCount: 2 },
      { id: 2, name: 'Broken pages above 10', subscribedCount: 5 },
    ],
    'Broken pages above 10',
  ],
]) {
  // Populated: name the most-used one and prefill it.
  const populated = pickerFor(id, { [key]: items })
  check(
    `${id} prefills the most-used ${key.slice(0, -1)}`,
    populated.some(step => step.action?.value === top),
    JSON.stringify(populated.map(step => step.action?.value)),
  )
  check(
    `${id} says how many others there are`,
    populated.some(step => /1 other/.test(step.say)),
    populated.map(step => step.say).join(' | '),
  )

  // Empty: creating one IS the plan, as with consent categories.
  const empty = pickerFor(id, { [key]: [] })
  check(
    `${id} sends an empty library to Create New`,
    empty.some(step => step.targetSelector.includes('create-new-btn')),
    empty.map(step => step.targetSelector).join(' | '),
  )

  // Unreadable is NOT empty. Guessing either way is worse than hedging.
  const blindPicker = pickerFor(id, undefined)
  check(
    `${id} hedges when it cannot read the library`,
    blindPicker.some(step => /^Search your/.test(step.say)) &&
      !blindPicker.some(step => step.targetSelector.includes('create-new-btn')),
    blindPicker.map(step => step.say).join(' | '),
  )
  // And never prefills a name it does not have.
  check(
    `${id} invents no ${key.slice(0, -1)} name when blind`,
    blindPicker.every(step => !step.action),
  )
}

// The combined recipe names all three, not just consent -- it would be odd for the
// breadth recipe to be the least specific one.
const allThree = RECIPES.find(r => r.id === 'audit_with_all_standards').buildSteps({
  account: {
    rules: [{ id: 1, name: 'GA4 fires on every page', usageCount: 4 }],
    alerts: [{ id: 1, name: 'Broken pages above 10', subscribedCount: 5 }],
    consentCategories: [
      {
        id: 1,
        name: 'gap.com | USA, California',
        labels: [],
        cmpDomain: 'gap.com',
        cmpGeo: 'USA, California',
        auditCount: 2,
      },
    ],
  },
  parameters: { siteUrl: 'gap.com' },
  goal: 'g',
})
check(
  'the combined recipe names something in all three legs',
  ['GA4 fires on every page', 'gap.com | USA, California', 'Broken pages above 10'].every(name =>
    allThree.some(step => step.action?.value === name),
  ),
  JSON.stringify(allThree.filter(s => s.action).map(s => s.action.value)),
)

/* ---------------------------------------------------------------- */
section('an audit recipe actually creates the audit')

// Every audit recipe used to end on "attach it", which configures an audit and
// never creates one -- and the editor is a modal, so closing it discards
// everything. The walkthrough reported Complete having produced nothing, which is
// the worst kind of failure because it looks like success.
for (const recipe of RECIPES.filter(r => r.id.startsWith('audit_with'))) {
  const steps = recipe.steps ?? recipe.buildSteps({ parameters: { siteUrl: 'gap.com' } })
  const last = steps.at(-1)

  check(
    `${recipe.id} ends on Save Audit`,
    last.targetSelector.includes('web-audit-create-save'),
    last.targetSelector,
  )
  // The standing rule: the copilot fills fields, the person commits the change. If
  // there is one button never to click on someone's behalf it is this one.
  check(`${recipe.id}: saving is the user's click, not ours`, last.actor === 'user')
  check(
    `${recipe.id}: step ids stay sequential after appending it`,
    steps.every((step, i) => step.id === `s${i + 1}`),
    steps.map(s => s.id).join(),
  )
}

// Not a descend: op-modal-footer-buttons puts op-selector on the <button> itself,
// the same trap that made quick-create-save-button unresolvable.
check(
  'the Save Audit selector does not descend into a child button',
  !allKnownSelectors().some(s => /web-audit-create-save"\] button/.test(s.selector)),
)

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
const opensEditor = auditPath.find(s => s.targetSelector.includes('new-data-option-audit'))
check(
  'opening the editor accepts whichever modal appears',
  opensEditor.completion.targetSelector.includes('op-audit-editor') &&
    opensEditor.completion.targetSelector.includes('audit-setup-modal'),
  opensEditor.completion.targetSelector,
)
// The whole point of moving to the sidebar: a plan started from anywhere no longer
// stops to tell the user to navigate somewhere first.
check(
  'the audit path needs no particular screen to begin',
  auditPath[0].navContext === '*',
  auditPath[0].navContext,
)
check(
  'and starts from the sidebar, which every screen has',
  auditPath[0].targetSelector === '[op-selector="sidebar-create-new"]',
  auditPath[0].targetSelector,
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
// "waits for" rows are the completion selectors, which are swept too -- a completion
// that never resolves stalls a step silently.
const ID_RE = /^[a-z_]+\/s\d+( waits for)?$/
check(
  'labels each with its recipe and step',
  catalogue.every(c => ID_RE.test(c.id)),
  catalogue.find(c => !ID_RE.test(c.id))?.id,
)
check(
  'and sweeps what steps wait on, not just what they point at',
  catalogue.some(c => c.id.endsWith(' waits for')),
)

// The bug this guards: buildSteps({}) returns a recipe's DEGENERATE branch, and that
// is the branch with the fewest selectors in it. A live sweep of the OneTrust flow
// confirmed the location picker and never looked at the search box or the option row,
// because with no location named the recipe emits one step instead of three.
check(
  'the sweep sees the named-location branch, not the "pick yours" one',
  catalogue.some(c => c.selector.startsWith('mat-option.loc-autocomplete >> text=')),
  catalogue
    .filter(c => c.id.startsWith('import_consent'))
    .map(c => c.selector)
    .join(' | '),
)
check(
  'and the whole rule grid, not just the two steps that survive with no variables',
  catalogue.filter(c => c.id.startsWith('create_tag_variable_rule/')).length > 15,
  catalogue.filter(c => c.id.startsWith('create_tag_variable_rule/')).length,
)
check(
  'reaches recipes that build steps dynamically',
  catalogue.some(c => c.id.startsWith('audit_with_consent_categories/')),
)
check(
  'every entry carries a selector',
  catalogue.every(c => c.selector),
)

// Every recipe's RICHEST branch. Asking with no parameters returns the degenerate
// one, which is both the shortest and the best-verified -- so a sweep of it flatters
// the library and a fallback check of it misses most of the steps that ship.
const stepsOf = recipe =>
  recipe.steps ??
  recipe.buildSteps?.({ parameters: representativeParameters(recipe), goal: '' }) ??
  []

// Part 3 is told it can rely on this, and three of six recipes have no swept
// selectors at all, so the fallback is load-bearing rather than decorative.
check(
  'no step anywhere ships without a text fallback',
  (() => {
    for (const recipe of RECIPES) {
      const steps = stepsOf(recipe)
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
    const clean = RECIPES.filter(recipe =>
      stepsOf(recipe)
        .filter(s => !s.optional)
        .every(s => !s.unverified),
    ).map(r => r.id)
    return (
      clean.join() ===
      [
        'audit_with_rules',
        'audit_with_consent_categories',
        'audit_with_alerts',
        // Reuses only selectors the three above already proved.
        'audit_with_all_standards',
        // Swept end to end on a live /sources: the Audits & Journeys link, the Search
        // By Data Source box, the card's overflow trigger, and its Edit item at
        // position 3 of 8. Everything from the Standards tab on is shared with
        // audit_with_all_standards.
        'edit_audit_add_standards',
        // Swept end to end on /rules/library: sidebar link, Create Rule,
        // name field, Next, Save.
        'create_first_rule',
        // Swept end to end across four passes, both halves of the conditions grid.
        // The pass that mattered: `>> last` reported "matched 3 of 3" against three
        // EXPECT rows, and `>> text=is set` reported "matched 9 of 13" reading
        // "is set" -- which is the ninth entry in TagVariableOperators. The selector
        // language discriminates rather than coincidentally agreeing.
        'create_tag_variable_rule',
        // Swept end to end across four screens of the designer. Note Next and Save
        // SWAP: Next is hidden on Preview, Save hidden everywhere else. Three Nexts
        // land on Preview, and only then does a step point at Save.
        'create_first_alert',
        // Swept end to end, eleven steps, over three passes of /consent-categories --
        // the banner only exists while an import is running, so its states could not be
        // caught in one. Those passes also confirmed the ORDER: `>> text=Close` found
        // nothing mid-sync, matched 1 of 1 when it finished, and the importer's own close
        // button was still there afterwards.
        'import_consent_from_onetrust',
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
  // -2, not -1: the last step is Save Audit now.
  unreadLibraryPlan.steps.at(-2).targetSelector.includes('add-all-standards-btn'),
  unreadLibraryPlan.steps.at(-2).targetSelector,
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

/* ---------------------------------------------------------------- */
section('the selector operators')

// Plain CSS has to pass through untouched, or every existing recipe breaks.
check(
  'a selector with no operators is unchanged',
  cssPartOf('[op-selector="cc-name"]') === '[op-selector="cc-name"]',
)
check('and reports no operators', parseTargetSelector('[op-selector="cc-name"]').ops.length === 0)

const parsed = parseTargetSelector('input[formControlName="variable"] >> last')
check(
  'the CSS half is separated cleanly',
  parsed.css === 'input[formControlName="variable"]',
  parsed.css,
)
check('and the operator is named', parsed.ops[0]?.name === 'last', JSON.stringify(parsed.ops))

// A label containing '=' has to survive, because the operator arg is everything
// after the FIRST '=' and product labels are not sanitised.
const eq = parseTargetSelector('mat-option >> text=Greater than or equal to (>=)')
check(
  'a label with an = in it is not truncated',
  eq.ops[0].arg === 'Greater than or equal to (>=)',
  eq.ops[0].arg,
)

// Element stand-ins: applyOperators only ever reads text, which is what makes it
// testable without a browser.
const el = text => ({ text })
const textOf = e => e.text
const options = [el('Greater than or equal to (≥)'), el('Greater than (>)'), el('Less than (<)')]

// The reason operator labels carry their sign. "Greater than" is a PREFIX of
// "Greater than or equal to", so a contains-match alone resolves to whichever comes
// first in the DOM -- and in this menu that is the wrong one.
check(
  'an exact label beats a partial one',
  applyOperators(options, parseTargetSelector('x >> text=Greater than (>)').ops, textOf)[0] ===
    options[1],
)
check(
  'and a partial match still works when nothing is exact',
  applyOperators(options, parseTargetSelector('x >> text=Less than').ops, textOf)[0] === options[2],
)
check(
  'case and whitespace do not matter, because labels wrap',
  applyOperators(
    [el('  Rule\n  Failures ')],
    parseTargetSelector('x >> text=rule failures').ops,
    textOf,
  ).length === 1,
)

const rows = [el('a'), el('b'), el('c')]
check(
  'last picks the row that was just added',
  applyOperators(rows, [{ name: 'last', arg: '' }], textOf)[0] === rows[2],
)
check(
  'nth is 1-based, because recipes are read by people',
  applyOperators(rows, parseTargetSelector('x >> nth=2').ops, textOf)[0] === rows[1],
)
check(
  'an out-of-range nth resolves to nothing rather than the wrong row',
  applyOperators(rows, parseTargetSelector('x >> nth=9').ops, textOf).length === 0,
)
check(
  'operators compose left to right',
  applyOperators(
    [el('keep'), el('keep'), el('drop')],
    parseTargetSelector('x >> text=keep >> last').ops,
    textOf,
  ).length === 1,
)

// A typo must degrade, not abort: pointing at roughly the right thing beats
// killing the walkthrough.
const typo = parseTargetSelector('mat-option >> txet=Utah')
check(
  'an unknown operator is reported, not thrown',
  typo.unknown.length === 1 && typo.ops.length === 0,
  JSON.stringify(typo),
)

/* ---------------------------------------------------------------- */
section('who gets a Continue button')

// The rule, in the user's words: "if any operation is a click, don't display
// continue. Things where it asks user to fill something out, display continue."
// It is derived from the operation rather than restated per step, so the check is
// that no recipe has to carry the field except for the one shape that needs it.
// Defaults applied the way buildPlan applies them, because a recipe asked for its
// steps with no parameters produces its degenerate shape -- create_tag_variable_rule
// with no variables named generates no variable rows at all, so a sweep of that
// would check nothing and pass.
const withDefaults = recipe => {
  const parameters = {}
  for (const param of recipe.parameters) {
    if (param.derive) parameters[param.name] = param.derive(parameters)
    else if (param.default !== undefined) parameters[param.name] = param.default
    else if (param.example) parameters[param.name] = param.example
  }
  return parameters
}

const everyStep = RECIPES.flatMap(recipe => {
  const context = { parameters: withDefaults(recipe), goal: '' }
  const steps = recipe.steps ?? recipe.buildSteps?.(context) ?? []
  return steps.map(step => ({ recipe: recipe.id, step }))
})

check(
  'no ai step declares advance — filling always waits, and saying so twice invites drift',
  everyStep.every(({ step }) => !(step.actor === 'ai' && step.advance)),
  everyStep.find(({ step }) => step.actor === 'ai' && step.advance)?.step.id,
)
check(
  'advance is only ever "continue", never "auto"',
  everyStep.every(({ step }) => step.advance === undefined || step.advance === 'continue'),
)
// The one legitimate use: a step remarking on a value the app already set. Those
// point at a control the user is NOT meant to touch, so nothing is coming.
const remarks = everyStep.filter(({ step }) => step.advance === 'continue')
check('the remark-only steps exist', remarks.length > 0)
check(
  'and every one of them is a user step with no action',
  remarks.every(({ step }) => step.actor === 'user' && !step.action),
)
check(
  'a step that says a value is "already" set never waits for a click',
  everyStep
    .filter(({ step }) => /\balready\b/.test(step.say) && step.actor === 'user')
    .every(({ step }) => step.advance === 'continue'),
  everyStep.find(
    ({ step }) => /\balready\b/.test(step.say) && step.actor === 'user' && !step.advance,
  )?.step.say,
)

/* ---------------------------------------------------------------- */
section('a rule built all the way through the grid')

const ruleRecipe = RECIPES.find(r => r.id === 'create_tag_variable_rule')
const rulePlan = buildPlan(ruleRecipe, 'timing value best practice', {
  tagName: 'Google Universal Analytics',
  expectVariables: 'utt, utc and utv',
})
check('it builds', rulePlan.status === 'plan', rulePlan.message)

const ruleSteps = rulePlan.plan?.steps ?? []
check(
  'the name is the assertion, so the audit can search for it later',
  rulePlan.plan?.parameters.ruleName === 'Google Universal Analytics sets utt, utc and utv',
  rulePlan.plan?.parameters.ruleName,
)
check(
  '"utt, utc and utv" becomes three rows, not one',
  ruleSteps.filter(s => /Setting the variable to "ut/.test(s.say)).length === 3,
  ruleSteps
    .filter(s => /Setting the variable/.test(s.say))
    .map(s => s.say)
    .join(' | '),
)
// Every row is the same input, so the only thing that distinguishes the one just
// added is that it is last. Without this the recipe would need a generated
// op-selector per row index.
check(
  'each new row is targeted as the last one',
  ruleSteps
    .filter(s => /Setting the variable to/.test(s.say))
    .every(s => s.targetSelector.endsWith('>> last')),
)
check(
  'the two grids are addressed separately, or the WHEN row gets filled twice',
  ruleSteps.some(s => s.targetSelector.startsWith('if-condition ')) &&
    ruleSteps.some(s => s.targetSelector.startsWith('then-condition ')),
)
check(
  'the columns are explained once across both grids, not once per grid',
  ruleSteps.filter(s => s.say.includes('REGEX')).length === 1,
  ruleSteps.filter(s => s.say.includes('REGEX')).length,
)
// Every option selector names the panel that owns it. A bare `mat-option` spans every
// open overlay: swept while the tag autocomplete happened to be open, `mat-option >>
// text=Tag` resolved to "Adobe DTMTag Management" -- no option there reads exactly
// "Tag", so it fell through to contains and "DTMTag" contains it.
check(
  'no option selector is left unscoped to its panel',
  everyStep
    .map(({ step }) => step.targetSelector)
    .filter(sel => /(^|\s)mat-option/.test(sel))
    .every(sel => /-panel |-selector |mat-option\./.test(sel)),
  everyStep
    .map(({ step }) => step.targetSelector)
    .find(sel => /(^|\s)mat-option/.test(sel) && !/-panel |-selector |mat-option\./.test(sel)),
)

check('it ends on Save', ruleSteps.at(-1).targetSelector.includes('rule-setup-save-btn'))
check(
  'and the save stays with the user',
  ruleSteps.at(-1).actor === 'user' && !ruleSteps.at(-1).action,
)
check(
  'every unverified step has a text fallback, because none of this is swept',
  ruleSteps.filter(s => s.unverified).every(s => s.targetFallback?.description),
)

// "make me a rule" says nothing about what correct means, so it must NOT reach the
// recipe that fills in a whole conditions grid from defaults.
check(
  '"create a rule" still reaches the starter, not the full builder',
  matchDeterministic('create a rule').recipeId === 'create_first_rule',
  matchDeterministic('create a rule').recipeId,
)

/* ---------------------------------------------------------------- */
section('the alert designer, end to end')

const designerRecipe = RECIPES.find(r => r.id === 'create_first_alert')
const designerPlan = buildPlan(designerRecipe, 'alert me', {
  notifyEmail: 'jun@observepoint.com',
  siteUrl: 'observepoint.com',
})
check('it builds', designerPlan.status === 'plan', designerPlan.message)
const designerSteps = designerPlan.plan?.steps ?? []
check(
  'the metric menu is walked one level at a time',
  ['Audits', 'Tag & Variable Rules', 'Rule Failures'].every(label =>
    designerSteps.some(s => s.targetSelector === `button[mat-menu-item] >> text=${label}`),
  ),
  designerSteps.map(s => s.targetSelector).join(' | '),
)
check(
  'the operator is matched with its sign, since "Greater than" is a prefix of another option',
  designerSteps.some(s => s.targetSelector.endsWith('>> text=Greater than (>)')),
)
check(
  'the two commit-on-Enter fields say so, rather than looking like they worked',
  designerSteps.filter(s => /press Enter/.test(s.say)).length === 2,
  designerSteps
    .filter(s => /press Enter/.test(s.say))
    .map(s => s.say)
    .join(' | '),
)
check(
  'the email is required, so it is asked before anything starts',
  buildPlan(designerRecipe, 'alert me', {}).status === 'needs_input',
)

/* ---------------------------------------------------------------- */
section('the committed fixtures still match the contract')

// Part 2 and Part 3 build against these files rather than running the planner, so a
// fixture that no longer validates is a shape they are coding to that no longer
// ships. This used to be checked by hand and recorded in INTEGRATION.md, which is
// the same thing as not being checked.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const fixtureFiles = readdirSync(FIXTURES).filter(f => f.endsWith('.json'))

check('there are fixtures to check', fixtureFiles.length > 0)

for (const file of fixtureFiles) {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
  // One file is an ordered ARRAY of plans -- the chained demo -- because that is the
  // shape startWalkthrough takes.
  const plans = Array.isArray(parsed) ? parsed : [parsed]
  const errors = plans.flatMap(plan => validatePlan(plan))
  check(`${file} validates`, errors.length === 0, errors.join('; '))
}

const demoChain = JSON.parse(readFileSync(join(FIXTURES, 'plan.demo-chain.json'), 'utf8'))
check('the demo fixture really is a chain', Array.isArray(demoChain) && demoChain.length === 4)
check(
  'and its head names the three that follow, in order',
  JSON.stringify(demoChain[0].chain) === JSON.stringify(demoChain.slice(1).map(p => p.recipeId)),
  JSON.stringify(demoChain[0].chain),
)

/* ---------------------------------------------------------------- */
section('guards, after the integration merge')

// Part 2 polls these for a plan's whole run and prompts when the state breaks. The
// nav guard only applies to steps whose selector is in SIDEBAR_ANCHORS, and three of
// Part 1's four sidebar selectors were absent from that set -- so declaring the guard
// would have been a no-op. Both halves are checked here, because either one alone
// looks fine and does nothing.
const navPlan = await createPlan('create a rule', { forceLocal: true })
const navResumed = answerAndRetry(navPlan, 'GA4 fires on every page', 'create a rule')

check(
  'a sidebar-first plan declares the nav guard',
  JSON.stringify(navResumed.plan?.guards) === JSON.stringify(['nav-available']),
  JSON.stringify(navResumed.plan?.guards),
)
check(
  'and its sidebar step is actually in the set the guard tests against',
  SIDEBAR_ANCHORS.has(navResumed.plan.steps[0].targetSelector),
  navResumed.plan.steps[0].targetSelector,
)
// alert_from_report starts on a report widget, so a nav guard would hold it up over a
// sidebar it never touches.
const widgetPlan = await createPlan('alert me when the purchase tag stops firing', {
  forceLocal: true,
})
const widgetResumed =
  widgetPlan.status === 'needs_input'
    ? answerAndRetry(widgetPlan, 'the purchase tag stops firing', 'x')
    : widgetPlan
check(
  'a plan that never touches the sidebar declares no guards',
  widgetResumed.plan?.guards === undefined,
  JSON.stringify(widgetResumed.plan?.guards),
)

/* ---------------------------------------------------------------- */
section("the onboarding tour's audit, which the demo then edits")

// Part 2's recipe, checked from here because Part 1's demo depends on its output: the
// walkthrough that follows opens the audit BY NAME, so a suggested name is a name the
// second walkthrough cannot address.
const { RECIPES: PART2_RECIPES } = await import('../src/shared/recipes.js')
const firstAudit = PART2_RECIPES.find(r => r.recipeId === 'create-first-audit')

check('the onboarding tour still exists', Boolean(firstAudit))
check(
  'it names the audit itself rather than suggesting a name',
  firstAudit.steps.find(s => s.id === 'name-the-audit')?.actor === 'ai',
)
check(
  'and the name is the one the demo sentence then edits',
  firstAudit.parameters.auditName === 'My First Audit',
  firstAudit.parameters.auditName,
)
// The mirror: nothing downstream depends on the starting URL's value, and which site to
// crawl is the one decision in an orientation tour that is genuinely the user's.
check(
  'the starting URL is left to the user',
  firstAudit.steps.find(s => s.id === 'starting-urls')?.actor === 'user',
)

/* ---------------------------------------------------------------- */
section('the rehearsed request answers from a fixed result')

// One sentence is pinned, and nothing else is. The transcripts below are the shapes a
// speech transcriber actually produces: the domain read out as words, the em dash gone,
// case reassigned, and clauses dropped. All four must produce the SAME four
// walkthroughs, because that is the only claim this file makes.
const TRANSCRIPTS = [
  ['exact', DEMO_GOAL],
  [
    'domain read as words, no punctuation',
    'observe point dot com uses one trust import our consent categories for utah then edit my ' +
      'first audit to check the site against them with tag rules follow the timing value best ' +
      'practice on google universal analytics and alert me if anything breaks',
  ],
  [
    'clauses dropped, case reassigned',
    'OBSERVEPOINT.COM USES ONETRUST, IMPORT OUR CONSENT CATEGORIES FOR UTAH, THEN EDIT MY FIRST ' +
      'AUDIT... TIMING VALUE BEST PRACTICE... ALERTS',
  ],
]

const EXPECTED_CHAIN = [
  'import_consent_from_onetrust',
  'create_tag_variable_rule',
  'create_first_alert',
  'edit_audit_add_standards',
]

for (const [label, transcript] of TRANSCRIPTS) {
  const ask = await createPlan(transcript, { forceLocal: true })
  check(
    `${label}: still asks for the email, and nothing else`,
    ask.status === 'needs_input' && JSON.stringify(ask.missing) === JSON.stringify(['notifyEmail']),
    `${ask.status} ${JSON.stringify(ask.missing)}`,
  )
  const built = answerAndRetry(ask, 'jun@observepoint.com', transcript)
  check(
    `${label}: produces the rehearsed chain`,
    JSON.stringify(built.plans?.map(p => p.recipeId)) === JSON.stringify(EXPECTED_CHAIN),
    JSON.stringify(built.plans?.map(p => p.recipeId)),
  )
  check(
    `${label}: and says it came from the pinned path`,
    built.matchedBy === 'demo',
    built.matchedBy,
  )
}

// The clause-dropping transcript is the one that justifies pinning the chain rather
// than just the parameters: buildChain queues the rule walkthrough because the sentence
// says "tag rules", and that transcript does not.
check(
  'the chain is pinned, not re-derived from the words that survived',
  demoMatch(TRANSCRIPTS[2][1])?.chain?.length === 3,
  JSON.stringify(demoMatch(TRANSCRIPTS[2][1])?.chain),
)

// Parameters are supplied, not parsed — "observe point dot com" defeats URL extraction
// and lowercase defeats the location and audit-name extractors, all three of which the
// normal path depends on.
const spoken = answerAndRetry(
  await createPlan(TRANSCRIPTS[1][1], { forceLocal: true }),
  'jun@observepoint.com',
  TRANSCRIPTS[1][1],
)
check(
  'the site survives a transcriber that spelled it out',
  spoken.plan?.parameters.siteUrl === 'https://observepoint.com',
  spoken.plan?.parameters.siteUrl,
)
check(
  'so does the audit name, from an all-lowercase transcript',
  spoken.plans?.at(-1).parameters.auditName === 'My First Audit',
  spoken.plans?.at(-1).parameters.auditName,
)

// And it must not swallow neighbouring requests. Each of these drops one signal.
for (const near of [
  'import our consent categories from OneTrust for Utah',
  'edit My First Audit to add rules and alert me if anything breaks',
  'import from OneTrust for Utah and alert me about my first audit',
]) {
  check(`"${near.slice(0, 40)}…" is not the rehearsed request`, demoMatch(near) === null)
}

/* ---------------------------------------------------------------- */
section('completions that were already true, and so skipped their step')

// The failure this guards is specific and was hit twice on live runs: a step whose
// completion is "wait for X to be visible" resolves INSTANTLY when X is already on
// screen. The step flashes past, the user never does the thing, and the next step acts
// on the wrong state.
//
//   "Add a variable row" waited for the variable grid to be visible -- true from row two
//   onward -- so utc overwrote utt in row one.
//   "Choose Rule Failures" waited for the Operator field, which the sweep proved is
//   visible before any metric is picked, so the metric was never chosen.
//
// Both are now dom_event/click. The rule below is the general form: if a step's
// completion watches something that is a SIBLING of the thing being clicked rather than
// a consequence of clicking it, it has to be the click.
const addRowSteps = everyStep.filter(({ step }) => /Add a variable row/.test(step.say))
check('the add-row steps exist', addRowSteps.length >= 3, addRowSteps.length)
check(
  'and every one of them waits for the click, not for the grid',
  addRowSteps.every(({ step }) => step.completion.type === 'dom_event'),
  JSON.stringify(addRowSteps.find(({ step }) => step.completion.type !== 'dom_event')?.step),
)

const metricSteps = everyStep.filter(({ step }) =>
  step.targetSelector.startsWith('button[mat-menu-item] >> text='),
)
check('the metric menu steps exist', metricSteps.length === 3, metricSteps.length)
check(
  'and all three wait for their own click, including the last',
  metricSteps.every(({ step }) => step.completion.type === 'dom_event'),
  JSON.stringify(metricSteps.find(({ step }) => step.completion.type !== 'dom_event')?.step),
)

// The OneTrust sync is the opposite case: the click is NOT the end of the step, because
// the import runs behind a banner that says not to leave the page.
const syncStep = everyStep.find(({ step }) => /Import them/.test(step.say))
check(
  'the sync waits for the banner to say it finished',
  syncStep?.step.completion.targetSelector?.includes('Cookies are now synchronized'),
  JSON.stringify(syncStep?.step.completion),
)

/* ---------------------------------------------------------------- */
section('a step whose end is something disappearing')

// The OneTrust sync banner. Its dismiss step listened for a click on the Close button
// and the run did not advance: the snackbar tears itself down as it closes, so whether
// the listener outlives the click is a race — and there are several other ways to
// dismiss it (Escape, the Assign action, its own timeout) that never touch that button.
//
// "The banner is gone" is true for all of them, and no click completion can say it.
const bannerStep = everyStep.find(({ step }) => /close the banner/i.test(step.say))
check('the banner step exists', Boolean(bannerStep), 'not found')
check(
  'and waits for the banner to be gone, not for one particular button',
  bannerStep?.step.completion.condition === 'hidden' &&
    bannerStep?.step.completion.targetSelector === '.bulk-action-progress',
  JSON.stringify(bannerStep?.step.completion),
)
// Its Close button is matched by LABEL. #bulk-action-progress-yes-btn came back "not
// found" on every sweep of this screen, including the pass where the banner plainly read
// "…Cookies are now synchronizedClose": the template has two buttons that can carry that
// label in mutually exclusive branches, and which renders depends on `records`.
check(
  'and points at Close by label rather than by an id that may not render',
  bannerStep?.step.targetSelector === '.bulk-action-progress button >> text=Close',
  bannerStep?.step.targetSelector,
)

// Closing the banner leaves the importer open over the sidebar the next walkthrough
// starts from — the sweep taken after dismissing it still found every field of the modal.
const importerStep = everyStep.find(({ step }) => /Close the importer/.test(step.say))
check('the importer is closed too', Boolean(importerStep), 'not found')
check(
  'and that step waits for the modal to be gone',
  importerStep?.step.completion.condition === 'hidden',
  JSON.stringify(importerStep?.step.completion),
)
check('and is optional for the same reason', importerStep?.step.optional)
// It is the last step of the first link in a four-link chain, so a stall here stops
// everything behind it. Nothing about clearing a banner is worth that.
check('and is optional, so it cannot strand the rest of the chain', bannerStep?.step.optional)

// 'hidden' has to be a real, declared condition rather than a value the runtime happens
// to tolerate, or a plan using it would pass the validator and stall forever.
check(
  'a hidden completion validates',
  validatePlan({
    recipeId: 'r',
    goal: 'g',
    summary: 's',
    executionMode: 'templated',
    steps: [
      {
        id: 's1',
        actor: 'user',
        targetSelector: '.x',
        say: 'go',
        completion: { type: 'dom_mutation', condition: 'hidden', targetSelector: '.y' },
      },
    ],
  }).length === 0,
)

/* ---------------------------------------------------------------- */
section('a Save the next walkthrough depends on')

// Reported from a live run: the rule and the alert created by links 2 and 3 were not in
// the audit editor's Standards picker in link 4.
//
// The cause was advancing on the Save CLICK. The run navigated away while the save was
// still in flight, so the picker read a library that genuinely did not contain them yet.
// Not a selector problem and not a cache problem — a sequencing one, and the same lesson
// as the OneTrust sync banner applied one screen later than it should have been.
//
// The rule: a Save whose result something downstream reads must wait for the save. The
// modal closing is the app's own confirmation, and the only signal available from
// outside.
for (const [id, params] of [
  ['create_tag_variable_rule', { tagName: 'Google Universal Analytics', expectVariables: 'a, b' }],
  ['create_first_alert', { notifyEmail: 'jun@observepoint.com' }],
]) {
  const built = buildPlan(
    RECIPES.find(r => r.id === id),
    'g',
    params,
  )
  const last = built.plan?.steps.at(-1)
  check(`${id} ends on Save`, /Save it/.test(last?.say ?? ''), last?.say)
  check(
    `${id} waits for the modal to close, not for the click`,
    last?.completion.type === 'dom_mutation' && last?.completion.condition === 'hidden',
    JSON.stringify(last?.completion),
  )
  // Witnessed by a selector inside the modal, so its absence means the modal is gone.
  check(
    `${id} witnesses that with something inside the modal`,
    /name-control input$/.test(last?.completion.targetSelector ?? ''),
    last?.completion.targetSelector,
  )
}

// The final Save Audit is deliberately NOT changed: nothing downstream reads its result,
// and it is the last step of the whole chain, so waiting on the editor closing would add
// a way to stall with nothing to gain.
const finalSave = buildPlan(
  RECIPES.find(r => r.id === 'edit_audit_add_standards'),
  'g',
  { auditName: 'My First Audit', siteUrl: 'gap.com' },
).plan?.steps.at(-1)
check(
  'the final Save Audit still advances on the click',
  finalSave?.completion.type === 'dom_event',
  JSON.stringify(finalSave?.completion),
)

/* ---------------------------------------------------------------- */
section('what gets a Continue button, decided without a browser')

// This is in its own module BECAUSE of the bug below, which no DOM test would have
// caught and which ended two walkthroughs without saving anything.
//
// A dom_mutation completion is watchable when it says which way the target is moving:
// 'visible' waits for it to appear, 'hidden' waits for it to go away. Both are a poll for
// a specific element. A dom_mutation with NO condition is the unwatchable one -- it names
// something already present -- and that is the only case that should get a button up
// front.
//
// The check originally read `condition !== 'visible'`, written before 'hidden' existed.
// So when 'hidden' arrived it landed in the 'race' branch, and the two steps using it were
// the Save at the end of the rule builder and the Save at the end of the alert designer.
// Both showed "Continue →" immediately and both were continued past, so both walkthroughs
// finished without saving.
const click = { actor: 'user', completion: { type: 'dom_event', value: 'click' } }
check('a click advances itself', advanceModeFor(click) === 'auto')
check(
  'an ai fill waits for the button',
  advanceModeFor({ actor: 'ai', action: { type: 'fill_text', value: 'x' } }) === 'button',
)
check(
  'a remark waits for the button and nothing else',
  advanceModeFor({ actor: 'user', advance: 'continue' }) === 'button',
)
for (const condition of ['visible', 'hidden']) {
  check(
    `dom_mutation/${condition} is watchable, so no button up front`,
    advanceModeFor({
      actor: 'user',
      completion: { type: 'dom_mutation', condition, targetSelector: '.x' },
    }) === 'auto',
    condition,
  )
}
check(
  'dom_mutation with no condition has nothing to watch, so it races the button',
  advanceModeFor({ actor: 'user', completion: { type: 'dom_mutation', targetSelector: '.x' } }) ===
    'race',
)

// The consequence, stated against the real recipes: nothing that ends a walkthrough by
// committing something may offer a Continue button, because a Continue button is exactly
// how you skip it.
const commitSteps = everyStep.filter(({ step }) => /^Save/.test(step.say))
check('there are Save steps', commitSteps.length >= 3, commitSteps.length)
check(
  'and not one of them offers a Continue button',
  commitSteps.every(({ step }) => advanceModeFor(step) === 'auto'),
  JSON.stringify(commitSteps.find(({ step }) => advanceModeFor(step) !== 'auto')?.step),
)

/* ---------------------------------------------------------------- */
section('the edit path ends by running the audit')

// The create paths end on Save Audit; this one ends on its sibling. The audit already
// exists, it has just had all three Standards attached, and an audit that has never run
// shows nothing -- so the useful ending is the crawl starting.
const ranAudit = buildPlan(
  RECIPES.find(r => r.id === 'edit_audit_add_standards'),
  'g',
  { auditName: 'My First Audit', siteUrl: 'gap.com' },
).plan?.steps.at(-1)
check(
  'edit_audit_add_standards ends on Save Changes & Run Now',
  ranAudit?.targetSelector === '[op-selector="web-audit-create-save-and-run"]',
  ranAudit?.targetSelector,
)
// Starting a crawl on someone's site is a bigger step than saving a configuration, and
// the create paths have just invented the audit rather than finished one.
const createdAudit = buildPlan(
  RECIPES.find(r => r.id === 'audit_with_all_standards'),
  'g',
  { siteUrl: 'gap.com' },
).plan?.steps.at(-1)
check(
  'but the create paths still just save',
  createdAudit?.targetSelector === '[op-selector="web-audit-create-save"]',
  createdAudit?.targetSelector,
)
check(
  'and every Save stays with the user',
  [ranAudit, createdAudit].every(s => s.actor === 'user'),
)

console.log(failures ? `\n${failures} check(s) failed\n` : `\nall checks passed\n`)
process.exit(failures ? 1 : 0)
