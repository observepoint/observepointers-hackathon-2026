// The contextual offer toast: "you're looking at X, want a walkthrough?"
//
// Non-blocking and dismissable by design. Auto-starting a tour on someone who is
// mid-task is hostile, so we offer and let them decide.

import { getLayer, clearLayer } from './host.js'

const LAYER = 'offer'

/**
 * Show an offer.
 *
 * @param {object} options { title, body, acceptLabel, onAccept, onDismiss, onNever }
 */
export function showOffer({ title, body, acceptLabel = 'Show me', onAccept, onDismiss, onNever }) {
  const layer = getLayer(LAYER)
  layer.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'op-offer'
  card.setAttribute('role', 'status')

  const titleEl = document.createElement('p')
  titleEl.className = 'op-offer-title'
  titleEl.textContent = title

  const bodyEl = document.createElement('p')
  bodyEl.className = 'op-offer-body'
  bodyEl.textContent = body

  const foot = document.createElement('div')
  foot.className = 'op-offer-foot'

  const accept = document.createElement('button')
  accept.className = 'op-btn op-btn--sm'
  accept.type = 'button'
  accept.textContent = acceptLabel
  accept.onclick = () => {
    hideOffer()
    onAccept?.()
  }

  const never = document.createElement('button')
  never.className = 'op-btn op-btn--ghost op-btn--sm'
  never.type = 'button'
  never.textContent = "Don't show again"
  never.onclick = () => {
    hideOffer()
    onNever?.()
  }

  const dismiss = document.createElement('button')
  dismiss.className = 'op-close op-spacer'
  dismiss.type = 'button'
  dismiss.setAttribute('aria-label', 'Dismiss')
  dismiss.innerHTML = '<span class="op-icon">close</span>'
  dismiss.onclick = () => {
    hideOffer()
    onDismiss?.()
  }

  foot.append(accept, never, dismiss)
  card.append(titleEl, bodyEl, foot)
  layer.appendChild(card)
}

export function hideOffer() {
  clearLayer(LAYER)
}
