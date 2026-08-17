// The Gemini client. STUBBED — this is the single call site for model access.
//
// Everything around it is real and working: the schema, the pipelines, hydration, the
// page-layer handoff. Only the two generate* functions below are inert, so the system is
// demoable end to end without an API key, and wiring the model up later touches only
// this file.
//
// Structured Outputs is the important part of the eventual call. Passing
// WalkthroughSchema as `responseSchema` (with responseMimeType 'application/json')
// constrains generation so the model cannot return a shape the page layer doesn't
// understand — which is far more reliable than parsing prose and validating after.

import { WalkthroughSchema } from '../shared/schema.js'
import { storage } from '../shared/utils.js'

const API_KEY_STORAGE_KEY = 'op_wt_gemini_key'

export const SYSTEM_PROMPT =
  'You are an ObservePoint expert configuring walkthroughs. Map the user request to ' +
  'the provided DOM context. Prefer elements that carry an op-selector attribute or a ' +
  'guide-* id, since those are stable. Output a valid WalkthroughSchema.'

/**
 * Is a model available?
 *
 * Callers use this to decide whether to offer ad-hoc generation at all, rather than
 * letting the user type an intent and then failing.
 */
export async function isAvailable() {
  return Boolean(await getApiKey())
}

/** The key belongs in storage, entered by the user — never committed to this repo. */
export async function getApiKey() {
  return storage.sync.get(API_KEY_STORAGE_KEY)
}

export async function setApiKey(key) {
  return storage.sync.set(API_KEY_STORAGE_KEY, key)
}

/**
 * Pick a recipe and extract parameters from a free-text intent (Pipeline A).
 *
 * @param {string} intent
 * @param {Array}  summaries  [{ recipeId, goal, summary }]
 * @returns {Promise<{ recipeId: string, parameters: object } | null>} null when unavailable
 */
export async function generateRecipeSelection(intent, summaries) {
  const key = await getApiKey()
  if (!key) return null

  // TODO(gemini): npm i @google/genai, then:
  //
  //   import { GoogleGenAI } from '@google/genai'
  //   const ai = new GoogleGenAI({ apiKey: key })
  //   const response = await ai.models.generateContent({
  //     model: <latest Gemini model id>,
  //     contents: [
  //       'Pick the recipe that best matches the user request and extract any ' +
  //         'parameters mentioned (for example an audit name or a starting URL).',
  //       `Available recipes:\n${JSON.stringify(summaries)}`,
  //       `User request: ${intent}`,
  //     ],
  //     config: {
  //       responseMimeType: 'application/json',
  //       responseSchema: SELECTION_SCHEMA,
  //     },
  //   })
  //   return JSON.parse(response.text)
  //
  // SELECTION_SCHEMA is deliberately narrow — recipeId plus a parameters bag — so the
  // model chooses from our vetted templates rather than inventing steps. That is the
  // whole point of the templated pipeline.
  console.debug('[op-walkthroughs] Gemini selection not wired up yet', {
    intent,
    candidates: summaries.length,
  })

  return null
}

/**
 * Generate a walkthrough from scratch against live page context (Pipeline B).
 *
 * @param {string} intent
 * @param {object} pageContext  { url, elements } from the page layer's simplifyDom()
 * @returns {Promise<object | null>} a WalkthroughSchema-shaped plan, or null
 */
export async function generateAdHocPlan(intent, pageContext) {
  const key = await getApiKey()
  if (!key) return null

  // TODO(gemini): same client as above, but this is the call that uses the full
  // WalkthroughSchema as responseSchema:
  //
  //   const response = await ai.models.generateContent({
  //     model: <latest Gemini model id>,
  //     contents: [
  //       SYSTEM_PROMPT,
  //       `User request: ${intent}`,
  //       `Current URL: ${pageContext.url}`,
  //       `Actionable elements:\n${JSON.stringify(pageContext.elements)}`,
  //     ],
  //     config: {
  //       responseMimeType: 'application/json',
  //       responseSchema: WalkthroughSchema,
  //     },
  //   })
  //   return JSON.parse(response.text)
  //
  // Validate the result with validateRecipe() before handing it to the page layer even
  // though the schema constrains the shape: the schema can't guarantee the selectors
  // actually exist on the page.
  console.debug('[op-walkthroughs] Gemini ad-hoc generation not wired up yet', {
    intent,
    url: pageContext?.url,
    elements: pageContext?.elements?.length ?? 0,
    schemaFields: Object.keys(WalkthroughSchema.properties).length,
  })

  return null
}
