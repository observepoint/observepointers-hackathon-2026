/**
 * Mid-conversation edits.
 *
 * THE PROBLEM
 *
 *   > Check compliance for gap.com in the United States
 *   < [a nine-step plan]
 *   > Can i do it for Canada instead
 *   < "…which is not covered by any of the available recipes."
 *
 * The second message is obviously a change to the first, and the planner treated
 * it as a brand-new intent. On its own, "Can i do it for Canada instead" IS
 * unmatchable — there is no Canada recipe and never will be. The information
 * that makes it meaningful is in the previous turn.
 *
 * THE RULE
 *
 * A follow-up inherits the previous plan's recipe and parameters, and its own
 * text becomes the goal. So "for Canada instead" re-runs the same consent
 * recipe, keeps gap.com, and the region narrowing sees "Canada" instead of
 * "United States" — replacement, not accumulation. Say "actually make it
 * example.com" and the site changes while the recipe stays.
 *
 * If the follow-up matches a recipe on its own, that wins. "Actually alert me
 * when it breaks" should switch recipes and carry the site over, not stubbornly
 * re-plan consent categories.
 *
 * WHY IT IS GATED
 *
 * Inheriting on every unmatched message would be worse than the bug. Ask "what
 * is the weather in Utah" after a plan and you would get a consent-category
 * walkthrough for Utah, confidently. So an inherit only happens when the text
 * actually looks like an edit — and when it doesn't, the honest "I don't have a
 * walkthrough for that" is still the answer.
 */

import { getRecipe } from './recipes/index.js'
import { extractParameters } from './match.js'

/**
 * Phrases that only make sense as a change to something already said. Kept
 * explicit rather than "short input = amendment", because a short input can be a
 * perfectly good new request ("create a rule").
 */
const MARKERS =
  /\b(instead|actually|rather than|change (it|that|the)|make it|do it for|same but|what about|how about|switch to|not that|use \S+ instead)\b/i

/**
 * A bare value is an edit too. Answering a plan with just "canada" or
 * "example.com" is a correction, and demanding a full sentence for it would be
 * pedantic.
 */
const BARE_VALUE = /^\s*(?:for\s+|in\s+|use\s+)?["“']?[\w .&/:-]{2,40}["”']?\s*[?.!]?\s*$/i

/**
 * @param {string} text        the follow-up
 * @param {object|null} previous  the last plan we produced
 * @returns {boolean}
 */
export function looksLikeAmendment(text, previous) {
  if (!previous?.recipeId || !text?.trim()) return false
  if (MARKERS.test(text)) return true

  // A bare value only counts if it is short AND we can actually place it — a
  // stray sentence fragment that fits no parameter is not an edit.
  const words = text.trim().split(/\s+/).length
  if (words > 5 || !BARE_VALUE.test(text)) return false

  const recipe = getRecipe(previous.recipeId)
  return Boolean(recipe) && Object.keys(extractParameters(text, recipe)).length > 0
}

/**
 * Which of the previous parameters should carry over?
 *
 * Not the derived ones. `auditName` on the old plan reads "gap.com — Consent &
 * privacy"; if the follow-up changes the site to example.com and we carry that
 * value forward, the audit keeps a name that names the wrong host. So a value
 * that still equals what its own `derive` would produce is dropped and left to
 * recompute. A name the user actually typed does not match its derive output, so
 * it survives — which is the behaviour you want in both directions.
 */
export function inheritableParameters(recipe, parameters = {}) {
  const kept = {}

  for (const param of recipe.parameters) {
    const value = parameters[param.name]
    if (value === undefined || value === '') continue
    if (param.derive && value === param.derive(parameters)) continue
    kept[param.name] = value
  }

  return kept
}

/**
 * Build the inputs for a re-plan. Returns null when this isn't an amendment, so
 * the caller falls through to normal intent matching.
 *
 * @returns {{recipeId, parameters, goal}|null}
 */
export function amendmentFor(text, previous, matched = null) {
  if (!looksLikeAmendment(text, previous)) return null

  // A confident match on the follow-up alone means they changed their mind about
  // the goal, not just a value. Honour it, and carry the parameters that still
  // apply to the new recipe.
  const recipeId = matched?.recipeId ?? previous.recipeId
  const recipe = getRecipe(recipeId)
  if (!recipe) return null

  return {
    recipeId,
    parameters: {
      ...inheritableParameters(recipe, previous.parameters),
      ...extractParameters(text, recipe),
      ...(matched?.parameters ?? {}),
    },
    // The follow-up alone, deliberately. Recipes that read the goal for text
    // signals — which region did they name? — must see "Canada" and NOT still
    // see "the United States" from the turn before.
    goal: text,
  }
}
