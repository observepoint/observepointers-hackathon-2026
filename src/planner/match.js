/**
 * Intent → recipe + parameters.
 *
 * Two matchers with the same signature. The deterministic one has no API key,
 * no network and no cost, which matters twice over:
 *   - Part 2 and Part 3 can develop against real plans all weekend without
 *     touching a quota.
 *   - The demo survives running out of free-tier tokens ten minutes before
 *     presenting, which is not a hypothetical.
 * The model matcher is strictly better when it's available; the fallback keeps
 * the product alive when it isn't.
 */

import { recipeCatalogue, getRecipe } from './recipes/index.js'
// The area vocabulary lives in its own module so recipes can share it without
// closing an import cycle back through the registry. See areas.js.
import { areasMentioned, editsExistingAudit } from './areas.js'

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'for',
  'of',
  'on',
  'in',
  'is',
  'it',
  'that',
  'this',
  'i',
  'my',
  'me',
  'we',
  'our',
  'want',
  'need',
  'how',
  'do',
  'can',
  'you',
  'please',
  'help',
  'set',
  'up',
  'and',
  'with',
  'when',
  'if',
  'get',
  'make',
  // Question words matter here: recipe descriptions are English prose, so a
  // bare "what" or "does" would otherwise score against every recipe.
  'what',
  'where',
  'which',
  'why',
  'who',
  'does',
  'did',
  'are',
  'was',
  'be',
  'been',
  'will',
  'would',
  'should',
  'am',
  'have',
  'has',
])

/**
 * Below this, a "match" is one incidental word in common with a recipe's prose
 * description — not intent. Real matches clear it on a single multi-word
 * keyword hit (5) or a phrase's worth of overlapping terms.
 */
const MIN_RAW_SCORE = 3

const tokens = s =>
  (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t))

/* ---------------------------------------------------------------------- *
 * Parameter extraction without a model — good enough for the obvious cases
 * ---------------------------------------------------------------------- */

const URL_RE = /\bhttps?:\/\/[^\s'"]+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|dev|ai)(?:\/\S*)?/i
const QUOTED_RE = /["“']([^"”']{2,60})["”']/

/**
 * "for USA, Utah" / "in Canada, Alberta" -> the place.
 *
 * Capitalisation is the signal: place names are written capitalised and the words
 * around them are not, which is what keeps "for gap.com" and the pronoun "us" out of
 * it. One optional comma-separated part, because that is the shape OneTrust uses.
 *
 * TWO THINGS THAT CAUGHT IT OUT, both from the same sentence.
 *
 * "from" is not a location preposition here — it is the CMP's. "import our consent
 * categories FROM OneTrust FOR observepoint.com" pulled out "OneTrust" and the
 * walkthrough went looking for a location row labelled OneTrust. Locations take "for"
 * or "in"; the vendor takes "from", and dropping it removes the collision at its
 * source rather than blocklisting one vendor's name.
 *
 * Every candidate is then checked rather than just the first, because "in" still
 * collides — "our categories in OneTrust for Utah" — and a domain written with a
 * capital ("for Observepoint.com") is a site, not a place.
 */
function extractLocation(goal) {
  const candidates = String(goal ?? '').matchAll(
    /\b(?:for|in)\s+([A-Z][\w.]*(?:,\s*[A-Z][\w.]*)?)/g,
  )

  for (const [, candidate] of candidates) {
    if (/\.(com|org|net|io|co|dev|ai)\b/i.test(candidate)) continue
    if (NOT_PLACES.has(candidate.toLowerCase())) continue
    return candidate
  }
  return null
}

/**
 * Capitalised words this product's own vocabulary uses that are not places.
 *
 * Deliberately short. It is the backstop for the "in OneTrust" shape that dropping
 * "from" does not cover; if it starts growing, the answer is a model call rather than
 * a longer list of proper nouns.
 */
const NOT_PLACES = new Set(['onetrust', 'observepoint', 'gdpr', 'ccpa'])

export function extractParameters(goal, recipe) {
  const found = {}

  for (const param of recipe.parameters) {
    const name = param.name.toLowerCase()

    if (name.includes('url') || name.includes('site') || name.includes('domain')) {
      const m = goal.match(URL_RE)
      if (m) found[param.name] = m[0]
    } else if (name.includes('email')) {
      const m = goal.match(/[\w.+-]+@[\w-]+\.[\w.]+/)
      if (m) found[param.name] = m[0]
    } else if (name.includes('name')) {
      // A quoted phrase is almost always the thing they want it called.
      const m = goal.match(QUOTED_RE)
      if (m) found[param.name] = m[1]
      // Otherwise, for an audit specifically: "edit My First Audit to add…". The name
      // of a thing that already exists is written capitalised and unquoted, and the
      // walkthrough has to match it against a card, so guessing wrong is worse than
      // not guessing. Anchored on the verb rather than on capitalisation alone, which
      // would have swallowed "OneTrust" and every place name in the sentence.
      else if (name === 'auditname') {
        const named = goal.match(
          /\b(?:edit|update|modify|change)\s+((?:[A-Z][\w'-]*)(?:\s+[A-Z][\w'-]*)*)/,
        )
        if (named) found[param.name] = named[1]
      }
    } else if (name.includes('location') || name.includes('region')) {
      const location = extractLocation(goal)
      if (location) found[param.name] = location
    } else if (name.includes('condition') || name.includes('summary')) {
      // "alert me when X" / "notify me if X" -> X
      const m = goal.match(/\b(?:when|if)\b\s+(.{4,120})/i)
      if (m) found[param.name] = m[1].replace(/[.?!]+$/, '').trim()
    }
  }

  return found
}

/* ---------------------------------------------------------------------- *
 * Deterministic matcher
 * ---------------------------------------------------------------------- */

/**
 * Asking for two of the three Standards is asking for a multi-standard audit.
 *
 * Keywords alone cannot see this. "check our tags still fire, only approved cookies
 * drop before consent, and alert me if either breaks" names all three concepts and
 * not one of them by its product name, so it scored highest on whichever area used
 * the most matching words — and answering with one silently drops the other two,
 * which is the bug audit_with_all_standards exists to fix.
 *
 * So the evidence is read across recipes rather than within one: if two or more of
 * the single-standard audits independently clear the floor, the user asked for more
 * than one. That generalises to phrasings nobody enumerated, which a keyword list
 * cannot.
 *
 * Only the three audit recipes count. The starters (create_first_rule and friends)
 * are a different intent — "make me a rule" is not "audit against rules" — and
 * folding them in here would turn "create a rule and an alert" into an audit.
 */
const ALL_STANDARDS = 'audit_with_all_standards'
const ONETRUST_IMPORT = 'import_consent_from_onetrust'
const EDIT_STANDARDS = 'edit_audit_add_standards'

export function matchDeterministic(goal) {
  const wanted = tokens(goal)
  const lower = (goal || '').toLowerCase()
  const scored = []

  for (const meta of recipeCatalogue()) {
    const recipe = getRecipe(meta.recipeId)
    let score = 0

    // Longer keyword, stronger evidence. A flat score for every phrase made the
    // matcher blind to specificity: "create a consent category" matched the
    // starter recipe's four-word keyword and the audit recipe's two-word one for
    // the same 5 points, and the audit recipe won on incidental prose overlap —
    // sending someone with an empty library to a picker with nothing in it.
    for (const keyword of recipe.intent.keywords) {
      if (!lower.includes(keyword.toLowerCase())) continue
      const words = keyword.trim().split(/\s+/).length
      score += words === 1 ? 3 : 2 + 2 * words
    }

    const haystack = new Set(tokens(`${meta.title} ${meta.description} ${meta.examples.join(' ')}`))
    for (const t of wanted) if (haystack.has(t)) score += 1

    if (score > 0) scored.push({ recipeId: meta.recipeId, score })
  }

  scored.sort((a, b) => b.score - a.score)

  // A named CMP plus an import verb is an unambiguous instruction, and it is a
  // PREREQUISITE rather than an alternative: you cannot attach consent categories you
  // have not imported yet. So it beats the audit it feeds, and `chain` carries the
  // audit on afterwards — which is what "import ours for Utah, THEN audit the site"
  // literally asks for.
  //
  // Both halves are required. "audit gap.com, we use OneTrust" mentions the CMP
  // without asking for an import, and re-importing categories someone already has is
  // not a helpful reading of it.
  if (
    /\bone\s?trust\b/i.test(goal) &&
    /\b(import|pull|sync|bring|get)\b/i.test(goal) &&
    getRecipe(ONETRUST_IMPORT)
  ) {
    const recipe = getRecipe(ONETRUST_IMPORT)
    return {
      recipeId: ONETRUST_IMPORT,
      parameters: extractParameters(goal, recipe),
      confidence: 0.7,
      matchedBy: 'keywords',
    }
  }

  // Two areas AND an audit that already exists: edit it, do not build a second one.
  // Checked before the combined-audit rule below, which would otherwise win and create.
  if (areasMentioned(goal).length >= 2 && editsExistingAudit(goal) && getRecipe(EDIT_STANDARDS)) {
    const recipe = getRecipe(EDIT_STANDARDS)
    return {
      recipeId: EDIT_STANDARDS,
      parameters: extractParameters(goal, recipe),
      confidence: 0.7,
      matchedBy: 'keywords',
    }
  }

  // Read across recipes before picking one. See areasMentioned().
  if (areasMentioned(goal).length >= 2 && getRecipe(ALL_STANDARDS)) {
    const combined = scored.find(s => s.recipeId === ALL_STANDARDS)
    const recipe = getRecipe(ALL_STANDARDS)
    return {
      recipeId: ALL_STANDARDS,
      parameters: extractParameters(goal, recipe),
      // Floor it above MIN_CONFIDENCE: the evidence is two independent area hits,
      // which is stronger than either one alone even when the combined recipe's own
      // keyword score is low.
      confidence: Math.max(
        0.6,
        Math.min(0.9, 0.35 + ((combined?.score ?? 0) - MIN_RAW_SCORE) / 20),
      ),
      matchedBy: 'keywords',
    }
  }

  const winner = scored[0]
  if (!winner || winner.score < MIN_RAW_SCORE) {
    return { recipeId: null, parameters: {}, confidence: 0, matchedBy: 'keywords' }
  }

  const recipe = getRecipe(winner.recipeId)

  // Normalise a keyword score into something roughly comparable to the model's
  // self-reported confidence, so downstream thresholds behave the same either way.
  const confidence = Math.min(0.9, 0.35 + (winner.score - MIN_RAW_SCORE) / 20)

  return {
    recipeId: winner.recipeId,
    parameters: extractParameters(goal, recipe),
    confidence,
    matchedBy: 'keywords',
  }
}

/* ---------------------------------------------------------------------- *
 * Model matcher
 * ---------------------------------------------------------------------- */

const MATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    recipeId: {
      type: 'STRING',
      description: 'id of the best matching recipe, or empty if none fit',
    },
    confidence: { type: 'NUMBER', description: '0 to 1' },
    parameters: {
      type: 'OBJECT',
      description: 'extracted values keyed by parameter name',
      properties: {},
    },
    clarifyingQuestion: {
      type: 'STRING',
      description:
        'one short question to ask if a required parameter is genuinely unknowable from the goal',
    },
    reasonIfNoMatch: { type: 'STRING' },
  },
  required: ['recipeId', 'confidence'],
}

function buildPrompt(goal, catalogue) {
  return `A user of ObservePoint (a digital analytics auditing platform) said:

"${goal}"

Pick the ONE recipe below that best achieves what they asked for, and extract any
parameter values their message already contains.

${JSON.stringify(catalogue, null, 2)}

Rules:
- Only return a recipeId from the list. If nothing genuinely fits, return an empty
  recipeId and explain why in reasonIfNoMatch. Do not force a poor match.
- Extract a parameter only if the user actually supplied it. Never invent a URL,
  a name, or an email address — a wrong value is worse than a missing one,
  because the walkthrough will type it into a real form.
- If a REQUIRED parameter is missing and you cannot reasonably guess it, put one
  short question in clarifyingQuestion. Ask for one thing, not several.
- parameters must be a flat object of string values.`
}

export async function matchWithModel(goal, llm) {
  const catalogue = recipeCatalogue()
  const raw = await llm.generateJson(buildPrompt(goal, catalogue), MATCH_SCHEMA)

  const recipeId = raw?.recipeId && getRecipe(raw.recipeId) ? raw.recipeId : null
  const parameters =
    raw?.parameters && typeof raw.parameters === 'object' ? { ...raw.parameters } : {}

  // Backfill anything the model left empty.
  //
  // Observed failure: "check our site for privacy compliance. gap.com" came
  // back with no siteUrl and a clarifying question asking for the URL — which
  // was right there in the sentence. The prompt tells the model never to invent
  // a URL, and it over-applied that to a bare host with no protocol. The regex
  // has no such doubt, so let it fill the gaps. Model values always win where
  // they exist; this only touches blanks.
  const recipe = getRecipe(recipeId)
  if (recipe) {
    for (const [key, value] of Object.entries(extractParameters(goal, recipe))) {
      if (parameters[key] === undefined || parameters[key] === '') parameters[key] = value
    }
  }

  return {
    recipeId,
    parameters,
    confidence: typeof raw?.confidence === 'number' ? raw.confidence : 0,
    clarifyingQuestion: raw?.clarifyingQuestion || null,
    reasonIfNoMatch: raw?.reasonIfNoMatch || null,
    matchedBy: 'model',
  }
}
