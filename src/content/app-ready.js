// Is the ObservePoint app actually up?
//
// Narrow on purpose: this is only the boot gate for our own chrome (onboarding, the
// Settings menu item), not general element resolution — that belongs to the page layer.
//
// It matters because everything inside div#application is gated on @if (user), so the app
// is empty for a beat after load, and on the login and signup routes #application never
// appears at all. We should stay completely quiet there rather than popping onboarding
// over a sign-in form.

import { ANCHOR } from '../shared/selectors.js'

/**
 * Resolve once the app shell exists, or reject on timeout.
 *
 * @returns {Promise<Element>}
 */
export function waitForAppShell({ timeout = 30000 } = {}) {
  const immediate = document.querySelector(ANCHOR.appRoot)
  if (immediate) return Promise.resolve(immediate)

  return new Promise((resolve, reject) => {
    let scheduled = false

    const done = (fn, arg) => {
      observer.disconnect()
      window.clearTimeout(timer)
      fn(arg)
    }

    const check = () => {
      scheduled = false
      const hit = document.querySelector(ANCHOR.appRoot)
      if (hit) done(resolve, hit)
    }

    // Coalesce to one check per frame: Angular fires a lot of mutations per change
    // detection pass, and this observer is on body until the shell shows up.
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(check)
    })

    const timer = window.setTimeout(
      () => done(reject, new Error('app shell did not appear')),
      timeout,
    )

    observer.observe(document.body, { childList: true, subtree: true })
    check()
  })
}
