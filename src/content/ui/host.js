// The single mount point for all of our injected UI.
//
// One <div> appended as a DIRECT child of document.body, carrying a shadow root.
// Both details matter:
//   - Direct child of body gives us a clean stacking context. Nesting inside
//     #application would trap us in Angular's, and Angular tears that subtree down
//     on re-navigation (the app sets onSameUrlNavigation: 'reload').
//   - The shadow root keeps moonbeam's global styles off our UI, and ours off the
//     app's. The app itself uses no shadow DOM, so document.querySelector still
//     reaches every element we need to target.

import { INJECTED_ATTR, Z_INDEX } from '../../shared/selectors.js'
import { STYLES } from './styles.js'

let host = null
let root = null
let themeObserver = null

function currentThemeClass() {
  // The app toggles body.dark-theme / body.light-theme (theme.service.ts). Dark is
  // the default when its localStorage key is unset, so absence means dark.
  return document.body.classList.contains('light-theme') ? 'op-light' : 'op-dark'
}

function syncTheme() {
  if (!root) return

  const container = root.querySelector('.op-root')
  if (!container) return

  container.classList.remove('op-dark', 'op-light')
  container.classList.add(currentThemeClass())
}

/**
 * Create the host and shadow root, or return the existing one.
 *
 * Idempotent, and self-healing: if something removed our host from the DOM we
 * rebuild it rather than handing back a detached node.
 */
export function mountHost() {
  if (host?.isConnected && root) return root

  host = document.createElement('div')
  host.setAttribute(INJECTED_ATTR, 'host')
  // Inline, and marked important, because moonbeam ships rules broad enough to
  // reach a bare div on body and we cannot afford to lose the stacking context.
  host.style.cssText = `position:fixed;inset:0;z-index:${Z_INDEX.HOST};pointer-events:none;isolation:isolate;`

  root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = STYLES
  root.appendChild(style)

  const container = document.createElement('div')
  container.className = `op-root ${currentThemeClass()}`
  root.appendChild(container)

  document.body.appendChild(host)

  // Follow the app's theme toggle -- which the user can hit from the very Settings
  // menu we inject into, so this is not a rare case.
  themeObserver?.disconnect()
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })

  return root
}

/** The .op-root element every layer should append into. */
export function getContainer() {
  const shadow = mountHost()
  return shadow.querySelector('.op-root')
}

/**
 * Get (or lazily create) a named layer inside the container.
 *
 * Named so each piece of UI -- picker, onboarding, offer, status bar -- owns
 * exactly one node and re-rendering never leaves duplicates behind.
 */
export function getLayer(name) {
  const container = getContainer()
  let layer = container.querySelector(`[data-layer="${name}"]`)

  if (!layer) {
    layer = document.createElement('div')
    layer.dataset.layer = name
    container.appendChild(layer)
  }

  return layer
}

export function clearLayer(name) {
  getContainer().querySelector(`[data-layer="${name}"]`)?.remove()
}

/** Tear everything down. Used when a walkthrough ends and on hard reset. */
export function unmountHost() {
  themeObserver?.disconnect()
  themeObserver = null
  host?.remove()
  host = null
  root = null
}
