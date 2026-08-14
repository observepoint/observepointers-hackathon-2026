/**
 * PART 1 PUBLIC API — intent → plan.
 *
 *   const result = await createPlan("I want to be alerted when checkout breaks");
 *
 * Returns a discriminated union. Every branch is a thing the chat UI has to
 * render differently, which is why this isn't just `Plan | null`:
 *
 *   { status: 'plan',        plan, recipe, confidence, warnings[] }
 *   { status: 'needs_input', question, recipeId, missing[], draftParameters }
 *   { status: 'no_match',    message, suggestions[] }
 *   { status: 'error',       message }
 *
 * `needs_input` is the interesting one. If someone says "alert me when checkout
 * breaks" we do not know which site they mean, and inventing one is worse than
 * asking — the walkthrough would type a fabricated URL into a real form. So we
 * ask exactly one question and resume with answerAndRetry().
 */

import { getRecipe, RECIPES } from './recipes/index.js'
import { matchDeterministic, matchWithModel } from './match.js'
import { render } from './template.js'
import { validatePlan } from './schema.js'
import { GeminiClient, getStoredApiKey } from './llm.js'

const MIN_CONFIDENCE = 0.35

/**
 * Fill in defaults for anything the user didn't supply.
 *
 * `derive(parameters)` beats a static `default` — that's how audit names get to
 * mention the site ("gap.com — Consent & privacy") instead of being a generic
 * label. Derived values are computed fresh on every call rather than stored,
 * which matters: if we cached one before the user told us the URL, the name
 * would keep the empty-host fallback forever.
 */
function applyDefaults(recipe, parameters) {
  const merged = { ...parameters }
  for (const param of recipe.parameters) {
    const missing = merged[param.name] === undefined || merged[param.name] === ''
    if (missing) {
      if (param.derive) merged[param.name] = param.derive(merged)
      else if (param.default !== undefined) merged[param.name] = param.default
    } else if (param.normalize) {
      // Applies to user-supplied values too: someone typing "Gap.com" should
      // not end up with "Gap.com" pasted into a starting-URL field.
      merged[param.name] = param.normalize(merged[param.name])
    }
  }
  return merged
}

function missingRequired(recipe, parameters) {
  return recipe.parameters
    .filter(p => p.required)
    .filter(p => parameters[p.name] === undefined || parameters[p.name] === '')
    .map(p => p.name)
}

function questionFor(recipe, missing) {
  const param = recipe.parameters.find(p => p.name === missing[0])
  if (!param) return 'Could you give me a bit more detail?'
  const eg = param.example ? ` For example: ${param.example}` : ''
  return `${param.description}?${eg}`
}

/**
 * Turn a matched recipe + parameters into a validated Plan.
 *
 * `context` carries whatever we know about the live account. A recipe may
 * expose buildSteps(context) / buildSummary(context) to plan against it — that
 * is what lets a plan say "attach Gap EU — GDPR" instead of "search for the
 * category that covers this site, or create one if none does". Recipes without
 * those hooks, or a context with no account, fall back to the static template,
 * so nothing breaks when the account can't be read.
 */
export function buildPlan(recipe, goal, rawParameters, context = {}) {
  const parameters = applyDefaults(recipe, rawParameters)

  const missing = missingRequired(recipe, parameters)
  if (missing.length) {
    return {
      status: 'needs_input',
      recipeId: recipe.id,
      missing,
      // Only what the user actually gave us. Persisting the filled-in defaults
      // would freeze a derived name computed before we knew the site.
      draftParameters: rawParameters,
      question: questionFor(recipe, missing),
    }
  }

  const scope = { parameters }
  const planningContext = { ...context, parameters }

  const rawSteps = recipe.buildSteps ? recipe.buildSteps(planningContext) : recipe.steps
  const rawSummary = recipe.buildSummary
    ? recipe.buildSummary(planningContext)
    : recipe.summaryTemplate

  const { value: steps, missing: unresolvedSteps } = render(rawSteps, scope)
  const { value: summary } = render(rawSummary, scope)

  const plan = {
    recipeId: recipe.id,
    goal,
    summary,
    executionMode: 'templated',
    parameters,
    steps,
  }

  const errors = validatePlan(plan)
  if (errors.length) {
    return {
      status: 'error',
      message: `Built an invalid plan for "${recipe.id}":\n  - ${errors.join('\n  - ')}`,
    }
  }

  // Not fatal, but Part 2 and Part 3 both want to know: unverified selectors are
  // where a walkthrough silently fails to find its target.
  const warnings = []
  if (unresolvedSteps.length) {
    warnings.push(`Unfilled placeholders defaulted: ${unresolvedSteps.join(', ')}`)
  }
  const unverified = steps.filter(s => s.unverified).length
  if (unverified) {
    warnings.push(
      `${unverified} of ${steps.length} steps use unverified selectors — the pointer may miss on those.`,
    )
  }

  return { status: 'plan', plan, recipe, warnings }
}

/**
 * @param {string} goal          what the user asked for, in their words
 * @param {object} [options]
 * @param {string} [options.apiKey]      overrides the stored key
 * @param {boolean} [options.forceLocal] skip the model entirely (tests, demos, no quota)
 * @param {object} [options.account]    live account state, e.g. { consentCategories }
 */
export async function createPlan(goal, options = {}) {
  if (!goal || !goal.trim()) {
    return { status: 'no_match', message: 'Tell me what you want to set up.', suggestions: [] }
  }

  let match
  try {
    const apiKey = options.forceLocal ? null : (options.apiKey ?? (await getStoredApiKey()))
    match = apiKey ? await matchWithModel(goal, new GeminiClient(apiKey)) : matchDeterministic(goal)
  } catch (err) {
    // A model failure should degrade, not fail. Keyword matching still produces
    // a usable plan for the common phrasings, which is the difference between a
    // demo that stumbles and a demo that dies.
    match = { ...matchDeterministic(goal), degradedFrom: err.message }
  }

  if (!match.recipeId || match.confidence < MIN_CONFIDENCE) {
    return {
      status: 'no_match',
      message:
        match.reasonIfNoMatch ||
        "I don't have a walkthrough for that yet. Here's what I can walk you through:",
      suggestions: suggestions(),
    }
  }

  const recipe = getRecipe(match.recipeId)

  // The model may have spotted the gap before we did.
  if (
    match.clarifyingQuestion &&
    missingRequired(recipe, applyDefaults(recipe, match.parameters)).length
  ) {
    return {
      status: 'needs_input',
      recipeId: recipe.id,
      missing: missingRequired(recipe, applyDefaults(recipe, match.parameters)),
      draftParameters: match.parameters,
      question: match.clarifyingQuestion,
    }
  }

  const result = buildPlan(recipe, goal, match.parameters, { account: options.account })
  if (result.status === 'plan') {
    result.confidence = match.confidence
    result.matchedBy = match.matchedBy
    if (match.degradedFrom) {
      result.warnings.push(
        `Model unavailable (${match.degradedFrom}); matched on keywords instead.`,
      )
    }
  }
  return result
}

/** Resume after a `needs_input` answer, without re-running intent matching. */
export function answerAndRetry(pending, answer, goal, context = {}) {
  const recipe = getRecipe(pending.recipeId)
  if (!recipe) return { status: 'error', message: `Unknown recipe ${pending.recipeId}` }

  const parameters = { ...pending.draftParameters, [pending.missing[0]]: answer.trim() }
  return buildPlan(recipe, goal, parameters, context)
}

/** What the assistant can actually do — shown when nothing matches. */
export const suggestions = () =>
  RECIPES.map(r => ({
    recipeId: r.id,
    title: r.title,
    example: r.intent.examples[0],
  }))

export { validatePlan } from './schema.js'
