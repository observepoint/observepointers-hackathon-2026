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

/**
 * Alert names show up in notifications, so they have to stand alone.
 *
 * Two sources, because there are two ways in. A stated condition ("broken pages go
 * above 10") is the best name there is and is used verbatim. Otherwise the metric and
 * the site are what we know, and they still beat "Untitled alert" landing in someone's
 * inbox — which is what this returned for the whole library path before.
 */
export function alertNameFrom(parameters) {
  const condition = String(parameters.conditionSummary || '').trim()
  if (condition) {
    const trimmed = condition.length > 48 ? `${condition.slice(0, 45).trimEnd()}…` : condition
    return `Alert: ${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
  }

  const host = hostFrom(parameters.siteUrl)
  return host ? `${host} — Rule failures` : 'Rule failures'
}

/**
 * A rule's name is what shows up in an audit's pass/fail report, so it should
 * read as the thing being asserted rather than as a label. "Google Analytics
 * fires on every page" is a report line; "Rule 1" is not.
 */
export function ruleNameFrom(parameters) {
  const subject = String(parameters.ruleSubject || '').trim()
  if (subject) {
    const trimmed = subject.length > 60 ? `${subject.slice(0, 57).trimEnd()}…` : subject
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
  }

  // The other way in: a tag and a list of variables rather than a sentence. The
  // assertion is "these are set on that", so that is what the name says — and it has
  // to be a real name, because the audit's Standards picker searches for it later.
  const tag = String(parameters.tagName || '').trim()
  const variables = String(parameters.expectVariables || '').trim()
  if (tag && variables) return `${tag} sets ${variables}`
  if (tag) return `${tag} variables set`

  return 'Untitled rule'
}

/**
 * A consent category is the definition of "approved" for one site, so the site
 * is the only thing its name needs to say.
 */
export function consentCategoryNameFrom(parameters) {
  const host = hostFrom(parameters.siteUrl)
  return host ? `${host} — Approved` : 'Approved tags & cookies'
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
