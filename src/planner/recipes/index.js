/**
 * The recipe library.
 *
 * A recipe is a walkthrough template: ordered steps with {{parameters.x}} holes
 * in them. The model's job is NOT to invent a plan — it is to pick the right
 * recipe and fill the holes. That constraint is deliberate: an open-ended
 * planner confidently produces ObservePoint configurations that don't exist,
 * because it has no idea whether an alert hangs off an audit, a rule, or a
 * journey. Recipes put that knowledge in our hands, where it belongs.
 *
 * Adding one is the highest-value contribution to this project: coverage IS the
 * product. Whatever isn't authored, the assistant handles badly.
 *
 * To add a recipe:
 *   1. Walk the flow yourself with devtools open; copy the real selectors.
 *   2. Prefer [op-selector="..."] — those are stable and human-named. If the
 *      screen has none, add them to moonbeam; it's a one-line change.
 *   3. Mark `verified: true` only once you've clicked through every step.
 */

import createApiKey from './create-api-key.js'
import alertOnRuleFailure from './alert-on-rule-failure.js'
import addRulesToAudit from './add-rules-to-audit.js'

export const RECIPES = [createApiKey, alertOnRuleFailure, addRulesToAudit]

export const getRecipe = id => RECIPES.find(r => r.id === id) || null

/** Compact catalogue for the model — full step bodies would just burn tokens. */
export const recipeCatalogue = () =>
  RECIPES.map(r => ({
    recipeId: r.id,
    title: r.title,
    description: r.intent.description,
    examples: r.intent.examples,
    parameters: r.parameters.map(p => ({
      name: p.name,
      description: p.description,
      required: Boolean(p.required),
      example: p.example,
    })),
  }))
