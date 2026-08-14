/**
 * Default names for the things we create.
 *
 * The bar: a name has to be useful in a list of fifty, six months from now,
 * read by someone who didn't create it. "Copilot audit" fails all three — it
 * says who made it, which is the least interesting fact about it.
 *
 * So names lead with the site and say what is being checked:
 *   gap.com — Consent & privacy
 *   shop.example.com — Tag & variable rules
 *
 * Deliberately no date. These are recurring configurations, not runs; a date in
 * the name is wrong the second time it executes.
 */

/** "https://www.gap.com/checkout?x=1" -> "gap.com" */
export function hostFrom(value) {
  if (!value) return ''
  return String(value)
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // protocol
    .split(/[/?#]/)[0] // path, query, fragment
    .replace(/^www\./i, '')
    .replace(/:\d+$/, '') // port
    .toLowerCase()
}

/**
 * Builds a `derive` function for an audit name. Per-recipe, because the whole
 * point is that the name says which of the three things this audit checks.
 */
export function auditNameFor(purpose) {
  return parameters => {
    const host = hostFrom(parameters.siteUrl)
    return host ? `${host} — ${purpose}` : `${purpose} audit`
  }
}

/** Alert names show up in notifications, so they have to stand alone. */
export function alertNameFrom(parameters) {
  const condition = String(parameters.conditionSummary || '').trim()
  if (!condition) return 'Untitled alert'

  const trimmed = condition.length > 48 ? `${condition.slice(0, 45).trimEnd()}…` : condition
  return `Alert: ${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

/**
 * A starting URL gets typed into a real form, so tidy it: lowercase the host and
 * add a scheme if the user didn't. "Gap.com" is not a URL a crawler should be
 * handed.
 */
export function normalizeSiteUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return raw

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    url.hostname = url.hostname.toLowerCase()
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}
