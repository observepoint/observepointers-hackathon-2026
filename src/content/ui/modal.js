// Shared modal shell for the picker and the onboarding overlay.
//
// Both need the same things: a blocking scrim, Escape to dismiss, a focus trap so
// tabbing doesn't wander into the app behind, and focus restored on close.

import { getLayer, clearLayer } from './host.js'

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Open a modal in a named layer.
 *
 * @param {string} layerName    one layer per modal kind, so opening twice replaces
 * @param {object} options      { title, subtitle, dismissable, onClose }
 * @returns {{ body: Element, foot: Element, close: Function }}
 */
export function openModal(layerName, { title, subtitle, dismissable = true, onClose } = {}) {
  const layer = getLayer(layerName)
  layer.innerHTML = ''

  const restoreFocus = document.activeElement

  const scrim = document.createElement('div')
  scrim.className = 'op-scrim'

  const modal = document.createElement('div')
  modal.className = 'op-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')

  const head = document.createElement('div')
  head.className = 'op-modal-head'

  const heading = document.createElement('div')
  const titleEl = document.createElement('h2')
  titleEl.className = 'op-modal-title'
  titleEl.textContent = title ?? ''
  heading.appendChild(titleEl)

  if (subtitle) {
    const sub = document.createElement('p')
    sub.className = 'op-modal-sub'
    sub.textContent = subtitle
    heading.appendChild(sub)
  }

  head.appendChild(heading)

  const body = document.createElement('div')
  body.className = 'op-modal-body'

  const foot = document.createElement('div')
  foot.className = 'op-modal-foot'

  modal.append(head, body, foot)
  scrim.appendChild(modal)
  layer.appendChild(scrim)

  const close = () => {
    document.removeEventListener('keydown', onKeyDown, true)
    clearLayer(layerName)
    restoreFocus?.focus?.()
    onClose?.()
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && dismissable) {
      event.stopPropagation()
      close()
      return
    }

    if (event.key !== 'Tab') return

    // Keep focus inside the modal. Without this, Tab walks into the app behind the
    // scrim, which is both confusing and a way to trigger app actions by accident.
    const focusable = [...modal.querySelectorAll(FOCUSABLE)]
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = modal.contains(document.activeElement) ? document.activeElement : null

    if (event.shiftKey && (active === first || !active)) {
      event.preventDefault()
      last.focus()
      return
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Capture phase: Angular Material also listens for Escape, and we don't want our
  // dismissal to also close one of the app's own overlays.
  document.addEventListener('keydown', onKeyDown, true)

  if (dismissable) {
    const closeBtn = document.createElement('button')
    closeBtn.className = 'op-close'
    // Addressable from a recipe, via findVisible's own-shadow-root fallback. The
    // orientation tour needs to point at this: it highlights the Walkthroughs menu item,
    // people click highlighted things, and the panel then covers the rest of the tour.
    closeBtn.setAttribute('op-selector', 'walkthroughs-panel-close')
    closeBtn.type = 'button'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.innerHTML = '<span class="op-icon">close</span>'
    closeBtn.onclick = close
    head.appendChild(closeBtn)

    scrim.addEventListener('click', event => {
      if (event.target === scrim) close()
    })
  }

  // Defer so the node is laid out before we move focus into it.
  window.requestAnimationFrame(() => modal.querySelector(FOCUSABLE)?.focus())

  return { scrim, modal, body, foot, close }
}
