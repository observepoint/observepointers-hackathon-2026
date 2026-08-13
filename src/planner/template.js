/**
 * {{parameters.x}} substitution for recipe templates.
 *
 * Deliberately tiny and strict: unknown placeholders are reported rather than
 * silently blanked, because a blank value in a `fill_text` step means the
 * runtime types an empty string into a form and the walkthrough looks broken
 * for a reason nobody can see.
 */

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

function lookup(path, scope) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), scope)
}

/**
 * @param {unknown} node   any JSON value (walked deeply)
 * @param {object} scope   e.g. { parameters: {...} }
 * @returns {{ value: unknown, missing: string[] }}
 */
export function render(node, scope) {
  const missing = new Set()

  const walk = value => {
    if (typeof value === 'string') {
      return value.replace(PLACEHOLDER, (whole, path) => {
        const resolved = lookup(path, scope)
        if (resolved === undefined || resolved === null || resolved === '') {
          missing.add(path)
          return whole // leave it visible; validatePlan will reject it
        }
        return String(resolved)
      })
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    }
    return value
  }

  return { value: walk(node), missing: [...missing] }
}

/** Every {{placeholder}} referenced anywhere in a recipe's steps. */
export function placeholdersIn(node) {
  const found = new Set()
  const json = JSON.stringify(node) || ''
  for (const [, path] of json.matchAll(PLACEHOLDER)) found.add(path)
  return [...found]
}
