/**
 * How does a step get past itself?
 *
 * Pure, and in its own file, for the same reason selector-query.js is: this is the part
 * with the judgement in it, the browser is not needed to decide it, and it has already
 * been got wrong once in a way no DOM test would have caught.
 *
 * THE RULE, in the user's words: "if any operation is a click, don't display continue.
 * Things where it asks user to fill something out, display continue."
 *
 * So it is derived from the operation rather than restated on every step:
 *
 *   'auto'    A click the user performs. It announces itself — we listen for it and move
 *             on. Putting a button here is the thing this project exists to fix: being
 *             told to click something and then having to confirm it. The button still
 *             exists but stays hidden until the step has been sitting there long enough
 *             to look stuck; detection is good, not perfect, and a walkthrough with no
 *             way forward is worse than a button nobody needed.
 *   'button'  Either we typed something (the user needs a beat to read what we put in the
 *             field and agree to it), or the step is a remark about a value the app
 *             already set — "Operator is equals by default" — where there is nothing to
 *             detect because nothing is supposed to happen.
 *   'race'    Part 2's recipes, which ask for a manual button because their dom_mutation
 *             completions name a target already on screen and so have nothing watchable.
 *             Detection wins if it works, the button covers it when it doesn't.
 *
 * WHAT IS WATCHABLE, AND THE BUG THAT PUT THIS IN ITS OWN FILE
 *
 * A dom_mutation completion is watchable when it says which way the target is moving:
 * 'visible' waits for it to appear, 'hidden' waits for it to go away. Both are a poll for
 * a specific element and both are reliable. A dom_mutation with NO condition is the
 * unwatchable one — it names something already present, which gives the runtime nothing
 * to test — and that is the only case that should get a button up front.
 *
 * This originally read `condition !== 'visible'`, written before 'hidden' existed. When
 * 'hidden' arrived it therefore landed in the 'race' branch, and the two steps that used
 * it were the Save at the end of the rule builder and the Save at the end of the alert
 * designer. Both showed a "Continue →" button immediately, and both were duly continued
 * past — so the walkthroughs finished without the thing being saved, which is the single
 * worst way for one of these to end.
 */

export const ADVANCE_AUTO = 'auto'
export const ADVANCE_BUTTON = 'button'
export const ADVANCE_RACE = 'race'

/** dom_mutation conditions that name a direction, and so can be polled for. */
const WATCHABLE = new Set(['visible', 'hidden'])

/**
 * @param {object} step
 * @returns {'auto' | 'button' | 'race'}
 */
export function advanceModeFor(step) {
  // `advance` on a step overrides the rule. It is needed for exactly one shape — a step
  // that only REMARKS on a value the app already set, which must not auto-advance — and
  // stays out of every other recipe.
  if (step?.advance === 'auto') return ADVANCE_AUTO
  if (step?.advance === 'continue') return ADVANCE_BUTTON

  if (step?.actor === 'ai') return ADVANCE_BUTTON

  if (step?.completion?.type === 'dom_mutation' && !WATCHABLE.has(step.completion.condition)) {
    return ADVANCE_RACE
  }

  return ADVANCE_AUTO
}
