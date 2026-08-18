/**
 * The rehearsed request, matched by fingerprint and answered from a fixed result.
 *
 * WHY THIS EXISTS, SAID PLAINLY
 *
 * Everything else in the planner is general on purpose, and this is not. It is a demo
 * safety net: one sentence has been rehearsed and its 70-step chain verified step by
 * step on a live page, and on the day it must produce THAT, not something the matcher
 * or the model decided in the moment.
 *
 * Two failure modes it removes:
 *
 *   The model. With a key present, matchWithModel picks the recipe and extracts the
 *   parameters — and it is a different call every time. It has been right in testing,
 *   which is not the same as being right once, in front of people, on a sentence that
 *   routes through four chained recipes.
 *
 *   Voice. The transcript is not the sentence. "observepoint.com" comes back as
 *   "observe point dot com" often enough that URL extraction misses it, the em dash is
 *   gone, and capitalisation is the transcriber's guess — which matters because the
 *   location and audit-name extractors both key on it. So the fingerprint tolerates all
 *   of that, and the parameters are supplied rather than parsed.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not skip the email question. `notifyEmail` is still required, so the chain
 * still stops and asks once before anything starts — that is a deliberate part of the
 * demo, not an obstacle to it, and hardcoding an address would remove the one moment
 * that shows the planner asking rather than inventing.
 *
 * It also does not build the plan. It returns a MATCH — recipe, parameters and chain —
 * in the same shape the other matchers return, so everything downstream runs exactly as
 * it does for any request: parameter accumulation, validation, the summaries, the
 * fourteen steps of the last link. A hardcoded plan would be a second code path to keep
 * in sync, and the first thing to rot.
 */

/**
 * Signals that must ALL be present. Deliberately not a string comparison: the point is
 * to survive a transcriber, and a transcriber changes punctuation, case and spacing.
 *
 * Specific enough that nothing else reaches it — a request has to mention the CMP, an
 * import, the state, the audit by name, the timing practice AND alerting to qualify.
 */
const FINGERPRINT = [
  /\bone\s?trust\b/i,
  /\bimport(ing|ed)?\b/i,
  /\butah\b/i,
  /\b(my\s+)?first\s+audit\b/i,
  /\btiming\b/i,
  /\balert/i,
]

/**
 * Everything the chain needs, so nothing depends on extraction succeeding.
 *
 * `location` is "Utah" rather than "USA, Utah" because that is what the sentence says,
 * and the option row is matched on a contained label — the live sweep resolved
 * `mat-option.loc-autocomplete >> text=…` against "USA, Utah" either way.
 */
const PARAMETERS = {
  siteUrl: 'https://observepoint.com',
  location: 'Utah',
  auditName: 'My First Audit',
  tagName: 'Google Universal Analytics',
  expectVariables: 'utt, utc, utv',
  whenVariable: 't',
  whenValue: 'timing',
}

const RECIPE_ID = 'import_consent_from_onetrust'

/**
 * The chain, pinned rather than derived — and this is not belt-and-braces.
 *
 * buildChain() reads the goal to decide what follows: it queues the rule walkthrough
 * because the sentence says "tag rules", and the alert one because it says "alert me".
 * A transcript that renders the middle of the sentence as "…TIMING VALUE BEST
 * PRACTICE…" and drops the words "tag rules" therefore produces a THREE-link chain, and
 * the audit gets a rule attached that nobody created. That is not hypothetical; it is
 * what the second test transcript did.
 *
 * So for this one request the chain is a fact, not an inference.
 */
const CHAIN = ['create_tag_variable_rule', 'create_first_alert', 'edit_audit_add_standards']

/**
 * @param {string} goal
 * @returns {object|null} a match, or null if this is any other request
 */
export function demoMatch(goal) {
  const said = String(goal ?? '')
  if (!FINGERPRINT.every(signal => signal.test(said))) return null

  return {
    recipeId: RECIPE_ID,
    parameters: { ...PARAMETERS },
    chain: [...CHAIN],
    confidence: 1,
    matchedBy: 'demo',
  }
}

/** Exported for the test, so the fingerprint and the sentence cannot drift apart. */
export const DEMO_GOAL =
  'observepoint.com uses OneTrust — import our consent categories for Utah, then edit My First ' +
  'Audit to check the site against them with tag rules, follow the Timing Value best practice on ' +
  'Google Universal Analytics, and alert me if anything breaks'
