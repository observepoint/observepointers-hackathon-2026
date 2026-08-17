/**
 * The Plan contract — the handoff between Part 1 (intent → plan) and Part 2
 * (plan → walkthrough runtime).
 *
 * This file is the single source of truth for the shape. If Part 2 needs a
 * change, change it here first so both sides move together.
 *
 * A plan never leaves the planner without passing validatePlan(). Emitting a
 * malformed plan fails inside Part 2's runtime, where it looks like their bug.
 *
 * UNIONED WITH PART 2's shared/schema.js. Both trees grew a contract
 * independently and they were close enough to look mergeable while differing on
 * things that break execution. This is the superset; the differences and why
 * each was resolved the way it was:
 *
 *   optional (step)      THEIRS. Kept. A step whose target is absent — behind a
 *                        permission, a feature flag, or a screen the user didn't
 *                        land on — is skipped rather than failing the run. This
 *                        is what lets one audit path serve both the Quick Audit
 *                        and advanced-editor entry points without predicting
 *                        which one opens.
 *   chain (plan)         THEIRS. Kept. Onboarding is several short walkthroughs,
 *                        so a plan declares its successor.
 *   'click' completion   THEIRS. Kept alongside network_request (mine). A union
 *                        costs a runtime nothing it doesn't already switch on.
 *   dom_mutation.condition  MINE. Kept required. Theirs allows it to be absent,
 *                        which leaves the runtime nothing to test and stalls the
 *                        step silently — the exact failure that hung the sidebar
 *                        step for a whole session.
 *   recipeId, summary    MINE. Kept required. Theirs allows both to be missing;
 *                        a plan with no summary has nothing to render in chat.
 *   actor 'user' + action  MINE. Kept rejected. Otherwise both sides act on the
 *                        same control.
 *   targetFallback       MINE. Kept. With unswept selectors still in the library
 *                        it is the only thing standing between a moved selector
 *                        and a dead pointer.
 */

export const ACTORS = ['user', 'ai']
export const EXECUTION_MODES = ['templated', 'generated', 'ad-hoc']
export const ACTION_TYPES = ['click', 'fill_text', 'select_option']
export const COMPLETION_TYPES = [
  'url_change',
  'dom_event',
  'dom_mutation',
  'network_request',
  'click',
]

const isStr = v => typeof v === 'string' && v.length > 0

function validateCompletion(completion, where, errors, stepTargetSelector) {
  if (!completion || typeof completion !== 'object') {
    errors.push(`${where}: completion is required`)
    return
  }
  if (!COMPLETION_TYPES.includes(completion.type)) {
    errors.push(`${where}.completion.type must be one of ${COMPLETION_TYPES.join(', ')}`)
    return
  }

  // Each completion type carries different fields; a plan that says
  // "url_change" with no value gives the runtime nothing to wait on and the
  // walkthrough silently stalls on that step.
  switch (completion.type) {
    case 'url_change':
    case 'dom_event':
      if (!isStr(completion.value))
        errors.push(`${where}.completion.value is required for ${completion.type}`)
      break
    case 'dom_mutation':
      if (!isStr(completion.targetSelector)) {
        errors.push(`${where}.completion.targetSelector is required for dom_mutation`)
      }
      if (!isStr(completion.condition)) {
        errors.push(`${where}.completion.condition is required for dom_mutation`)
      }
      break
    case 'network_request':
      if (!isStr(completion.endpoint)) errors.push(`${where}.completion.endpoint is required`)
      if (!isStr(completion.method)) errors.push(`${where}.completion.method is required`)
      break
    // Part 2's: wait for a click on a named element. Falls back to the step's own
    // target, since "click the thing I pointed at" is the overwhelmingly common
    // case and repeating the selector twice invites them drifting apart.
    case 'click':
      if (!isStr(completion.targetSelector) && !isStr(stepTargetSelector)) {
        errors.push(`${where}.completion.targetSelector is required for click`)
      }
      break
  }
}

function validateStep(step, index, errors, seenIds) {
  const where = `steps[${index}]`

  if (!isStr(step.id)) errors.push(`${where}.id is required`)
  else if (seenIds.has(step.id)) errors.push(`${where}.id "${step.id}" is duplicated`)
  else seenIds.add(step.id)

  if (!ACTORS.includes(step.actor)) errors.push(`${where}.actor must be "user" or "ai"`)
  if (!isStr(step.targetSelector)) errors.push(`${where}.targetSelector is required`)
  if (!isStr(step.say)) errors.push(`${where}.say is required`)

  // An "ai" step means the extension acts on the user's behalf, so it must say
  // what to do. A "user" step must NOT carry an action, or both sides act.
  if (step.actor === 'ai') {
    if (!step.action || !ACTION_TYPES.includes(step.action.type)) {
      errors.push(`${where}: actor "ai" requires action.type (${ACTION_TYPES.join(', ')})`)
    } else if (step.action.type !== 'click' && !isStr(step.action.value)) {
      errors.push(`${where}.action.value is required for ${step.action.type}`)
    }
  } else if (step.action) {
    errors.push(`${where}: actor "user" must not carry an action — the user performs it`)
  }

  if (step.optional !== undefined && typeof step.optional !== 'boolean') {
    errors.push(`${where}.optional must be a boolean`)
  }

  validateCompletion(step.completion, where, errors, step.targetSelector)
}

/** @returns {string[]} human-readable problems; empty means valid. */
export function validatePlan(plan) {
  const errors = []

  if (!plan || typeof plan !== 'object') return ['plan must be an object']

  if (!isStr(plan.recipeId)) errors.push('recipeId is required')
  if (!isStr(plan.goal)) errors.push('goal is required')
  if (!isStr(plan.summary)) errors.push('summary is required')
  if (!EXECUTION_MODES.includes(plan.executionMode)) {
    errors.push(`executionMode must be one of ${EXECUTION_MODES.join(', ')}`)
  }
  if (plan.parameters && typeof plan.parameters !== 'object') {
    errors.push('parameters must be an object')
  }
  if (plan.chain !== undefined && !isStr(plan.chain)) {
    errors.push('chain must be a recipeId string when present')
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('steps must be a non-empty array')
    return errors
  }

  const seenIds = new Set()
  plan.steps.forEach((step, i) => validateStep(step, i, errors, seenIds))

  // A leftover {{...}} means a parameter never got substituted. The runtime
  // would dutifully type "{{parameters.auditName}}" into the field.
  const unresolved = JSON.stringify(plan.steps).match(/\{\{[^}]+\}\}/g)
  if (unresolved) {
    errors.push(`unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`)
  }

  return errors
}

export function assertValidPlan(plan) {
  const errors = validatePlan(plan)
  if (errors.length) {
    throw new Error(`Invalid plan:\n  - ${errors.join('\n  - ')}`)
  }
  return plan
}
