/**
 * Reads the user's actual ObservePoint account, so plans can name real objects
 * instead of hedging.
 *
 * This is what turns
 *   "Find the consent category that matches this site…
 *    …or create one if none matches"
 * into
 *   "Gap EU — GDPR covers gap.com. Attach that one."
 *
 * Every request hops side panel → background → content script, because only the
 * content script sits on the app's origin and can read the bearer token the app
 * stores. See src/content/index.js. The token never comes back across that
 * boundary — this module only ever sees JSON.
 *
 * Consequence worth knowing: this works only while an ObservePoint tab is the
 * active tab. `status()` says so explicitly rather than failing mysteriously.
 */

const API = {
  consentCategories: '/api/v3/consent-categories/library',
}

function send(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, reply => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message })
      } else {
        resolve(reply ?? { ok: false, error: 'no reply from page' })
      }
    })
  })
}

/** Can we read the account right now, and if not, why not? */
export async function status() {
  const reply = await send({ type: 'OP_ACCOUNT_STATUS' })

  if (reply.ok) {
    return { connected: true, environment: reply.environment, hostname: reply.hostname }
  }

  // Distinguish the three reasons, because the fix is different for each and
  // "couldn't read your account" on its own is useless to the user.
  if (reply.onObservePoint === false) {
    return { connected: false, reason: 'not-on-observepoint', hostname: reply.hostname }
  }
  if (reply.signedIn === false) return { connected: false, reason: 'not-signed-in' }
  return { connected: false, reason: reply.error || 'unavailable' }
}

async function get(path) {
  const reply = await send({ type: 'OP_API_GET', path })
  if (!reply.ok) {
    const detail = [reply.status && `HTTP ${reply.status}`, reply.contentType]
      .filter(Boolean)
      .join(', ')
    throw new Error(`${reply.error}${detail ? ` (${detail})` : ''}`)
  }
  return reply.data
}

/**
 * When a lookup fails, one probe beats five rounds of guessing.
 *
 * A 200 that returns HTML means the host served the SPA index for a path its
 * API proxy doesn't match — so the question is always "which path does reach
 * the API from *this* origin". Staging is served from several hostnames
 * (app.observepointstaging.com, plus per-environment ones like
 * ua1.observepointstaging.com), and they don't necessarily all proxy /api the
 * same way. This asks rather than assumes.
 */
export async function probeApi() {
  const candidates = [
    '/api/v3/consent-categories/library',
    '/api/v2/consent-categories/library',
    '/api/v3/consent-categories',
    '/api/v2/users/me',
    '/api/v2/accounts',
  ]

  const results = []
  for (const path of candidates) {
    const reply = await send({ type: 'OP_API_GET', path })

    if (reply.ok) {
      results.push({ path, base: reply.base, ok: true, status: 200, detail: 'application/json' })
      continue
    }

    // One row per host tried, so it's obvious whether the path is wrong or the
    // host is.
    const attempts = reply.attempts?.length ? reply.attempts : [reply]
    for (const attempt of attempts) {
      results.push({
        path,
        base: attempt.base ?? '—',
        ok: false,
        status: attempt.status ?? '—',
        detail: (attempt.contentType || attempt.error || '').split(';')[0],
      })
    }
  }
  return results
}

/**
 * Real accounts contain categories synced from a CMP, and OneTrust names arrive
 * as raw HTML fragments — one live example runs to several hundred characters
 * of <span style="color:black"><strong>… markup. Printing that verbatim is
 * unreadable, so strip the tags and fall back to the CMP group's domain and geo,
 * which is what the name was trying to say anyway.
 */
function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function displayName(row) {
  const cleaned = cleanText(row.name)
  const cmp = row.cmpData

  if ((cleaned.length > 70 || !cleaned) && cmp?.oneTrustCookieGroupDomain) {
    const geo = cleanText(cmp.oneTrustCookieGroupGeo)
    return geo ? `${cmp.oneTrustCookieGroupDomain} — ${geo}` : String(cmp.oneTrustCookieGroupDomain)
  }
  if (!cleaned) return `Consent category ${row.id}`
  return cleaned.length > 70 ? `${cleaned.slice(0, 67)}…` : cleaned
}

/**
 * The library endpoint takes every filter as optional, so no argument lists
 * everything. Shapes vary by endpoint version, hence the defensive unwrap.
 */
export async function listConsentCategories({ name } = {}) {
  const query = name ? `?name=${encodeURIComponent(name)}` : ''
  const data = await get(`${API.consentCategories}${query}`)

  const rows = Array.isArray(data)
    ? data
    : (data?.consentCategories ?? data?.items ?? data?.data ?? [])

  return rows.map(row => ({
    id: row.id,
    name: displayName(row),
    type: row.type,
    // labels are ILabel objects, not strings — joining them raw produced
    // "[object Object]" and quietly broke every label match.
    labels: (row.labels ?? []).map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
    // The strongest signal available: for CMP-synced categories this is
    // literally the domain the group belongs to.
    cmpDomain: row.cmpData?.oneTrustCookieGroupDomain ?? null,
    auditCount: row.auditCount ?? 0,
  }))
}

/**
 * Which categories plausibly cover this site?
 *
 * Deliberately a suggestion, not a filter: it returns everything, flagged, so
 * the caller can say "these two look right, here are the other six" rather than
 * silently hiding a category the user knows is the correct one. Matching on
 * name is a heuristic — a category's real scope is its tag and cookie lists,
 * which is a later refinement.
 */
export function rankForSite(categories, host) {
  if (!host) return categories.map(c => ({ ...c, matches: false, score: 0 }))

  const lowerHost = host.toLowerCase()
  const domain = (lowerHost.split('.').slice(-2, -1)[0] || lowerHost).toLowerCase()

  return categories
    .map(category => {
      const cmp = (category.cmpDomain ?? '').toLowerCase()
      const text = `${category.name} ${category.labels.join(' ')}`.toLowerCase()

      // An exact CMP domain match is evidence; a name containing the word is a
      // guess. Scoring them differently keeps a real match at the top even when
      // a dozen categories happen to mention the brand.
      let score = 0
      if (
        cmp &&
        (cmp === lowerHost || cmp.endsWith(`.${lowerHost}`) || lowerHost.endsWith(`.${cmp}`))
      ) {
        score = 3
      } else if (cmp && cmp.includes(domain)) score = 2
      else if (text.includes(lowerHost)) score = 1
      else if (domain.length > 2 && text.includes(domain)) score = 1

      return { ...category, score, matches: score > 0 }
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}
