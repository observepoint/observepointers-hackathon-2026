// The walkthrough contract, expressed as JSON Schema.
//
// Two consumers:
//   1. Gemini's `responseSchema`, which constrains generation so the model cannot
//      return a shape we don't understand.
//   2. validateRecipe(), which checks the hand-authored templates in recipes.js at
//      import time. A typo in a recipe should fail loudly on load, not silently
//      misbehave on step 4 of a live demo.

export const COMPLETION_TYPES = ['url_change', 'dom_mutation', 'dom_event', 'click']
export const ACTORS = ['user', 'ai']
export const EXECUTION_MODES = ['templated', 'ad-hoc']

export const WalkthroughSchema = {
  type: 'object',
  properties: {
    recipeId: { type: 'string' },
    goal: { type: 'string' },
    summary: { type: 'string' },
    executionMode: { type: 'string', enum: EXECUTION_MODES },
    parameters: { type: 'object' },
    // Successor recipe. Onboarding is delivered as several small chained
    // walkthroughs rather than one long one, so each declares what follows it.
    chain: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          actor: { type: 'string', enum: ACTORS },
          // Route the step belongs to: '*' for anywhere, otherwise a path prefix
          // or a regex source string matched against location.pathname.
          navContext: { type: 'string' },
          targetSelector: { type: 'string' },
          say: { type: 'string' },
          // Steps whose target is hidden by permissions or feature flags are
          // skipped rather than failing the whole walkthrough.
          optional: { type: 'boolean' },
          action: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              value: { type: 'string' },
            },
          },
          completion: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: COMPLETION_TYPES },
              value: { type: 'string' },
              targetSelector: { type: 'string' },
            },
          },
        },
        required: ['id', 'actor', 'targetSelector', 'say', 'completion'],
      },
    },
  },
  required: ['goal', 'executionMode', 'steps'],
}

const STEP_REQUIRED = ['id', 'actor', 'targetSelector', 'say', 'completion']

/**
 * Validate a walkthrough plan against the contract above.
 *
 * Hand-rolled rather than pulling in a JSON Schema library: this checks the
 * handful of things that actually break execution, and keeps the extension at
 * zero runtime dependencies.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRecipe(plan) {
  const errors = []
  const at = (i, message) => errors.push(`steps[${i}]: ${message}`)

  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan is not an object'] }

  if (!plan.goal) errors.push('missing required field: goal')

  if (!EXECUTION_MODES.includes(plan.executionMode))
    errors.push(`executionMode must be one of ${EXECUTION_MODES.join(', ')}`)

  if (!Array.isArray(plan.steps) || plan.steps.length === 0)
    return { valid: false, errors: [...errors, 'steps must be a non-empty array'] }

  const seenIds = new Set()

  plan.steps.forEach((step, i) => {
    for (const field of STEP_REQUIRED) if (!step[field]) at(i, `missing required field: ${field}`)

    // Duplicate step ids would make progress logs and resume ambiguous.
    if (step.id && seenIds.has(step.id)) at(i, `duplicate step id: ${step.id}`)
    if (step.id) seenIds.add(step.id)

    if (step.actor && !ACTORS.includes(step.actor))
      at(i, `actor must be one of ${ACTORS.join(', ')}`)

    // An 'ai' step with no action has nothing to perform and would hang.
    if (step.actor === 'ai' && !step.action?.type) at(i, "actor 'ai' requires action.type")

    if (step.completion && !COMPLETION_TYPES.includes(step.completion.type))
      at(i, `completion.type must be one of ${COMPLETION_TYPES.join(', ')}`)

    // These completion types watch a specific element, so they need one named.
    // url_change and dom_mutation can fall back to the step's own target.
    const needsTarget = step.completion?.type === 'click' || step.completion?.type === 'dom_event'
    if (needsTarget && !step.completion.targetSelector && !step.targetSelector)
      at(i, `completion.type '${step.completion.type}' requires a targetSelector`)

    if (step.completion?.type === 'dom_event' && !step.completion.value)
      at(i, "completion.type 'dom_event' requires value (the event name)")
  })

  return { valid: errors.length === 0, errors }
}

/**
 * Throw on an invalid recipe. Called from recipes.js at module scope so a broken
 * template surfaces the moment the content script boots.
 */
export function assertValidRecipe(plan) {
  const { valid, errors } = validateRecipe(plan)

  if (!valid)
    throw new Error(
      `[op-walkthroughs] invalid recipe "${plan?.recipeId ?? '(unnamed)'}":\n  ${errors.join('\n  ')}`,
    )

  return plan
}
