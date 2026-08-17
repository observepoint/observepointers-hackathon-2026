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
import { amendmentFor } from './amend.js'

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
  const planningContext = { ...context, parameters, goal }

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

  // Part 2's runner takes an ordered array of plans, and `chain` is how a recipe
  // names what follows it. buildChain(context) is the state-aware form, for the same
  // reason buildSteps is: what follows "import our consent categories" depends on
  // whether the user also asked for an audit. Only set when there is something to
  // set, so the field stays absent rather than null for everything else.
  const chain = recipe.buildChain ? recipe.buildChain(planningContext) : recipe.chain
  if (chain?.length) plan.chain = chain

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
  // Optional steps are excluded on purpose. An optional step exists precisely
  // because its target may be absent — behind a permission, or on a screen this
  // run didn't pass through — so "unverified and optional" is the designed
  // behaviour rather than a risk. Counting it would put a permanent warning on
  // three fully-swept recipes and teach everyone to ignore the warning line.
  const unverified = steps.filter(s => s.unverified && !s.optional).length
  if (unverified) {
    warnings.push(
      `${unverified} of ${steps.length} steps use unverified selectors — the pointer may miss on those.`,
    )
  }

  const plans = [plan]
  const blocked = expandChain({
    plan,
    chain,
    recipeId: recipe.id,
    parameters,
    rawParameters,
    context,
    plans,
    warnings,
  })
  // A later link needing an answer blocks the whole request, because the question is
  // about the request rather than about link three. See expandChain.
  if (blocked) return blocked

  return { status: 'plan', plan, plans, recipe, warnings }
}

/**
 * Recipes already queued or in progress on this chain.
 *
 * Carried on the context because expandChain builds each successor through
 * buildPlan, which follows ITS chain in turn. Without a shared set, an A→B→A cycle
 * recurses forever: each nested call starts a fresh set and a fresh plans array, so
 * neither the cycle guard nor the length cap ever sees the whole picture.
 */
const chainSeen = context => context.__chainSeen ?? new Set()

/**
 * Depth of chained walkthroughs we're willing to queue.
 *
 * The longest real chain is four — import consent categories, create a rule, create
 * an alert, then the audit that attaches all three — so this is a runaway guard, not
 * a design limit.
 */
const MAX_CHAIN = 6

/**
 * Follow `chain` and build the successor plans, in order.
 *
 * WHY THE WHOLE SEQUENCE IS BUILT UP FRONT
 *
 * Because it is the only way to find out whether it works. A chain built lazily,
 * one plan at a time as the previous finishes, discovers that link three is
 * unbuildable twenty steps into a demo. Building it here means an unsatisfiable
 * link becomes a warning on the summary before anyone clicks anything.
 *
 * PARAMETERS ARE SHARED ACROSS THE CHAIN, NOT FORWARDED FIELD BY FIELD
 *
 * "observepoint.com uses OneTrust — import our consent categories for Utah, then
 * audit the site against them with tag rules and alert me if anything breaks" is ONE
 * request. The site belongs to all four links, the location only to the first, the
 * tag only to the rule. Rather than have each recipe declare what it hands on, every
 * link sees the full parameter set and takes the names it declares — which is what
 * applyDefaults already does. A recipe cannot be surprised by a parameter it never
 * asks for.
 *
 * The names a chain relies on therefore have to agree ACROSS recipes: `siteUrl` is
 * `siteUrl` everywhere. That is a real constraint, and cheaper than the alternative.
 *
 * EACH LINK ALSO SEES WHAT THE EARLIER ONES RESOLVED
 *
 * Not just the head's parameters — the accumulated set. That is what carries the
 * rule's derived name into the audit, so its Standards picker searches for the rule
 * the previous walkthrough just created instead of ranking one out of an account
 * snapshot that predates it. See the `named` branch in standardsPickerSteps.
 *
 * A LINK THAT NEEDS AN ANSWER BLOCKS THE WHOLE REQUEST
 *
 * The alert needs an email address, and nothing before it does. Discovering that on
 * step twelve of forty would be the worst place to ask, so a successor's needs_input
 * is returned as the result of the whole call — but attributed to the HEAD recipe and
 * the head's raw parameters, so answering re-plans the entire chain rather than
 * stranding the answer on link three.
 *
 * A LINK THAT CANNOT BE BUILT AT ALL IS DROPPED
 *
 * An error, as opposed to a question, ends that link and not the request. If the rule
 * recipe breaks, the consent-category import is still worth doing, and the warning
 * says what was dropped. Silently queueing three of four would be the bad version.
 *
 * @returns {object|null} a needs_input result to return instead of the plan, or null
 */
function expandChain({
  plan,
  chain,
  recipeId,
  parameters,
  rawParameters,
  context,
  plans,
  warnings,
}) {
  if (!chain?.length) return null

  const seen = chainSeen(context)
  seen.add(recipeId)

  let carried = { ...parameters }

  for (const nextId of Array.isArray(chain) ? chain : [chain]) {
    if (seen.size >= MAX_CHAIN) {
      warnings.push(`Chain truncated at ${MAX_CHAIN} walkthroughs.`)
      return null
    }
    // A cycle is a recipe bug, but it would present as a hung planner.
    if (seen.has(nextId)) {
      warnings.push(`Chain loops back to "${nextId}" — stopped there.`)
      return null
    }

    const nextRecipe = getRecipe(nextId)
    if (!nextRecipe) {
      warnings.push(`Chained recipe "${nextId}" does not exist — skipped.`)
      continue
    }

    seen.add(nextId)
    const result = buildPlan(nextRecipe, plan.goal, carried, {
      ...context,
      __chainSeen: seen,
    })

    if (result.status === 'needs_input') {
      return {
        status: 'needs_input',
        // The head, so answerAndRetry re-plans the whole chain.
        recipeId,
        missing: result.missing,
        draftParameters: rawParameters,
        question: result.question,
      }
    }

    if (result.status !== 'plan') {
      warnings.push(`Skipped the "${nextRecipe.title}" walkthrough — ${result.message}`)
      continue
    }

    // buildPlan already followed the successor's own chain, so take its whole
    // sequence rather than re-walking it here.
    plans.push(...result.plans)
    warnings.push(...result.warnings)
    // Everything this link resolved is available to the next one.
    carried = { ...carried, ...result.plan.parameters }
  }

  return null
}

/**
 * @param {string} goal          what the user asked for, in their words
 * @param {object} [options]
 * @param {string} [options.apiKey]      overrides the stored key
 * @param {boolean} [options.forceLocal] skip the model entirely (tests, demos, no quota)
 * @param {object} [options.account]    live account state, e.g. { consentCategories }
 * @param {object} [options.previous]   the last plan, so a follow-up can amend it
 *   rather than being read as a fresh, unmatchable request. See amend.js.
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

  // "Can I do it for Canada instead" is unmatchable alone and obvious in
  // context. Checked before the confidence floor, because the whole point is
  // that the follow-up scores badly on its own.
  const confident = match.recipeId && match.confidence >= MIN_CONFIDENCE
  const amendment = amendmentFor(goal, options.previous, confident ? match : null)
  if (amendment) {
    const amendedRecipe = getRecipe(amendment.recipeId)
    const result = buildPlan(amendedRecipe, amendment.goal, amendment.parameters, {
      account: options.account,
    })
    if (result.status === 'plan') {
      result.amended = true
      result.matchedBy = confident ? match.matchedBy : 'amendment'
    }
    return result
  }

  if (!confident) {
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
