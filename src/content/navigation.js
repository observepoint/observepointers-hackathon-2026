// SPA route-change detection.
//
// moonbeam uses Angular's PathLocationStrategy -- pushState, no hash routing -- so
// there is no navigation event to listen for. We patch the History API and emit one
// normalised event that the trigger evaluator and the page layer both subscribe to.
//
// The background relays chrome.tabs.onUpdated as a backup (it does fire with
// changeInfo.url for History API changes), but that round-trips through a service
// worker that may be asleep, so in-page detection is primary.
//
// Also relevant: the app sets onSameUrlNavigation: 'reload', so the same URL can
// re-navigate and re-render. We emit on every call rather than deduping by path,
// and let subscribers decide -- a re-render is exactly when injected nodes get torn
// down and need replacing.

export const ROUTE_CHANGE_EVENT = 'op:route-change'

let patched = false

function emit(reason) {
  window.dispatchEvent(
    new CustomEvent(ROUTE_CHANGE_EVENT, {
      detail: { path: window.location.pathname, url: window.location.href, reason },
    }),
  )
}

/** Patch history and start emitting route changes. Idempotent. */
export function startNavigationWatch() {
  if (patched) return
  patched = true

  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method]

    window.history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args)
      // Let Angular's router finish its synchronous work before we announce, so
      // subscribers see the new pathname rather than the old one.
      window.setTimeout(() => emit(method), 0)
      return result
    }
  }

  window.addEventListener('popstate', () => emit('popstate'))
}

/** Subscribe to route changes. Returns an unsubscribe function. */
export function onRouteChange(callback) {
  const listener = event => callback(event.detail)
  window.addEventListener(ROUTE_CHANGE_EVENT, listener)
  return () => window.removeEventListener(ROUTE_CHANGE_EVENT, listener)
}

/** Announce a route change we learned about from the background. */
export function notifyExternalUrlChange() {
  emit('external')
}

/**
 * Does the current path satisfy a step's navContext?
 *
 * '*' (or absent) means anywhere. Otherwise a plain prefix match, which is what the
 * recipes use -- and easier to author correctly than a regex.
 */
export function matchesNavContext(navContext, path = window.location.pathname) {
  if (!navContext || navContext === '*') return true
  return path.startsWith(navContext)
}

/**
 * Match a completion's `value` against the current path.
 *
 * Accepts a RegExp (the ROUTE constants) or a string prefix (what recipes author).
 */
export function matchesRouteValue(value, path = window.location.pathname) {
  if (!value) return true
  if (value instanceof RegExp) return value.test(path)
  return path.startsWith(value)
}
