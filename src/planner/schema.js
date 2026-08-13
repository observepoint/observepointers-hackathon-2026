/**
 * The Plan contract — the handoff between Part 1 (intent → plan) and Part 2
 * (plan → walkthrough runtime).
 *
 * This file is the single source of truth for the shape. If Part 2 needs a
 * change, change it here first so both sides move together.
 *
 * A plan never leaves the planner without passing validatePlan(). Emitting a
 * malformed plan fails inside Part 2's runtime, where it looks like their bug.
 */

export const ACTORS = ['user', 'ai']
export const EXECUTION_MODES = ['templated', 'generated']
export const ACTION_TYPES = ['click', 'fill_text', 'select_option']
export const COMPLETION_TYPES = ['url_change', 'dom_event', 'dom_mutation', 'network_request']

const isStr = v => typeof v === 'string' && v.length > 0

function validateCompletion(completion, where, errors) {
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

  validateCompletion(step.completion, where, errors)
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
