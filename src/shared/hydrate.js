// Parameter hydration for templated walkthroughs.
//
// Recipes carry {{parameters.auditName}} style placeholders. Hydration replaces them
// with real values and returns a deep copy, so the shared template in recipes.js is
// never mutated -- important because the module is a singleton and a walkthrough can
// be started more than once per page load.
//
// Lives in shared/ because both the background (Pipeline A, after Gemini extracts
// parameters from a user's intent) and the content script (picker, starting a recipe
// directly) need it.

const PLACEHOLDER = /\{\{\s*parameters\.([\w.]+)\s*\}\}/g

function lookup(parameters, path) {
  return path.split('.').reduce((value, key) => value?.[key], parameters)
}

function hydrateString(text, parameters) {
  return text.replace(PLACEHOLDER, (match, path) => {
    const value = lookup(parameters, path)
    // Leave an unresolved placeholder alone rather than printing "undefined" at the
    // user -- a visible {{parameters.x}} makes the authoring bug obvious.
    return value === undefined || value === null ? match : String(value)
  })
}

function hydrateValue(value, parameters) {
  if (typeof value === 'string') return hydrateString(value, parameters)
  if (Array.isArray(value)) return value.map(item => hydrateValue(item, parameters))

  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, inner] of Object.entries(value)) out[key] = hydrateValue(inner, parameters)
    return out
  }

  return value
}

/**
 * Deep-copy a plan with every {{parameters.*}} placeholder substituted.
 *
 * Caller-supplied parameters win over the recipe's own defaults.
 */
export function hydratePlan(plan, parameters = {}) {
  const merged = { ...(plan.parameters ?? {}), ...parameters }
  return { ...hydrateValue(plan, merged), parameters: merged }
}

/**
 * Pull parameters out of a free-text intent.
 *
 * Deliberately crude: this is the no-AI path. Once Gemini is wired up it does the
 * extraction properly and this becomes the fallback for when the call fails.
 */
export function extractParameters(intent = '') {
  const parameters = {}

  // "an audit called Q3 Privacy" / 'named "Q3 Privacy"' / 'titled Q3 Privacy'
  const named = intent.match(/(?:called|named|titled)\s+["']?([^"'\n,.]+)["']?/i)
  if (named) parameters.auditName = named[1].trim()

  // Any quoted span wins, since the user was explicit about the boundaries.
  const quoted = intent.match(/["']([^"']{2,80})["']/)
  if (quoted) parameters.auditName = quoted[1].trim()

  const url = intent.match(/https?:\/\/[^\s"'<>]+/i)
  if (url) parameters.startingUrl = url[0]

  return parameters
}
