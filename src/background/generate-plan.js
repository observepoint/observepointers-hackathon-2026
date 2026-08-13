// generatePlan(intent, pageContext?) — the single entry point for turning a user's
// words into a runnable walkthrough.
//
// Two pipelines:
//   A. Templated. Match the intent against our vetted recipes, extract parameters,
//      hydrate. Works today with no model: recipe selection is keyword scoring and
//      parameter extraction is regex. When Gemini is wired up it does both better and
//      this becomes the fallback.
//   B. Ad-hoc. Nothing matched, so generate steps against the live DOM. Scaffolded
//      here; the generation call itself is stubbed in gemini.js.
//
// Lives in the background because it's the only context that should hold an API key
// and make cross-origin calls.

import { getRecipe, recipeSummaries } from '../shared/recipes.js'
import { hydratePlan, extractParameters } from '../shared/hydrate.js'
import { validateRecipe } from '../shared/schema.js'
import { generateRecipeSelection, generateAdHocPlan } from './gemini.js'

/** Words too common to carry signal when scoring an intent against a summary. */
const STOP_WORDS = new Set([
  'a',
  'the',
  'to',
  'how',
  'do',
  'i',
  'me',
  'my',
  'show',
  'help',
  'want',
  'need',
  'can',
  'you',
  'walk',
  'through',
  'with',
  'for',
  'and',
  'of',
  'in',
  'on',
  'is',
  'it',
  'this',
  'that',
  'get',
  'set',
  'up',
  'new',
  'first',
  'please',
])

function tokenize(text = '') {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
}

/**
 * Score how well an intent matches a recipe.
 *
 * Overlap between the intent's words and the recipe's goal + summary. The goal is
 * weighted double: it's the short, deliberate description of what the recipe does,
 * whereas the summary carries incidental vocabulary.
 */
function scoreRecipe(intentTokens, recipe) {
  const goalTokens = new Set(tokenize(recipe.goal))
  const summaryTokens = new Set(tokenize(recipe.summary))

  let score = 0

  for (const token of intentTokens) {
    if (goalTokens.has(token)) score += 2
    else if (summaryTokens.has(token)) score += 1
  }

  return score
}

/** Below this, we treat the intent as unmatched and fall through to ad-hoc. */
const MATCH_THRESHOLD = 3

/**
 * Pick the best recipe for an intent using local scoring only.
 *
 * @returns {{ recipeId: string, score: number } | null}
 */
export function selectRecipeLocally(intent) {
  const tokens = tokenize(intent)
  if (tokens.length === 0) return null

  const ranked = recipeSummaries()
    .map(summary => ({
      recipeId: summary.recipeId,
      score: scoreRecipe(tokens, getRecipe(summary.recipeId)),
    }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  return best && best.score >= MATCH_THRESHOLD ? best : null
}

/**
 * Turn an intent into a runnable, hydrated plan.
 *
 * @param {string} intent
 * @param {object} [pageContext]  { url, elements } — required for the ad-hoc path
 * @returns {Promise<{ plan?: object, source: string, error?: string }>}
 */
export async function generatePlan(intent, pageContext) {
  // --- Pipeline A: templated -------------------------------------------------

  // Ask the model first when it's available: it handles paraphrasing and pulls
  // parameters out far more reliably than keyword scoring.
  const aiSelection = await generateRecipeSelection(intent, recipeSummaries())
  const selection = aiSelection ?? selectRecipeLocally(intent)

  if (selection?.recipeId) {
    const recipe = getRecipe(selection.recipeId)

    if (recipe) {
      const parameters = aiSelection?.parameters ?? extractParameters(intent)

      return {
        plan: hydratePlan(recipe, parameters),
        source: aiSelection ? 'templated:gemini' : 'templated:local',
      }
    }
  }

  // --- Pipeline B: ad-hoc ----------------------------------------------------

  if (!pageContext?.elements?.length)
    return {
      source: 'ad-hoc',
      error: 'No walkthrough matches that yet, and there is no page context to build one from.',
    }

  const generated = await generateAdHocPlan(intent, pageContext)

  if (!generated)
    return {
      source: 'ad-hoc',
      error:
        'Ad-hoc walkthrough generation is not enabled yet. Pick one from Settings > Walkthroughs.',
    }

  // The schema constrains the shape but cannot guarantee the selectors exist, so
  // validate before handing anything to the page layer.
  const { valid, errors } = validateRecipe(generated)

  if (!valid) {
    console.warn('[op-walkthroughs] generated plan failed validation', errors)
    return { source: 'ad-hoc', error: 'The generated walkthrough was not valid.' }
  }

  return { plan: hydratePlan(generated, generated.parameters ?? {}), source: 'ad-hoc:gemini' }
}
