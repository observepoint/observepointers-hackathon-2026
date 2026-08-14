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

function extractParameters(goal, recipe) {
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

export function matchDeterministic(goal) {
  const wanted = tokens(goal)
  const lower = (goal || '').toLowerCase()
  const scored = []

  for (const meta of recipeCatalogue()) {
    const recipe = getRecipe(meta.recipeId)
    let score = 0

    for (const keyword of recipe.intent.keywords) {
      if (lower.includes(keyword.toLowerCase())) score += keyword.includes(' ') ? 5 : 3
    }

    const haystack = new Set(tokens(`${meta.title} ${meta.description} ${meta.examples.join(' ')}`))
    for (const t of wanted) if (haystack.has(t)) score += 1

    if (score > 0) scored.push({ recipeId: meta.recipeId, score })
  }

  scored.sort((a, b) => b.score - a.score)

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
