// Injects a "Walkthroughs" item into the app's own Settings dropdown.
//
// The Settings menu is an Angular Material mat-menu. Three consequences:
//
//   1. Its panel is rendered into .cdk-overlay-container (a direct child of <body>)
//      and DESTROYED on every close. So this is observer-driven and re-injects on
//      every open -- there is no one-shot version of this.
//   2. The op-selector="top-nav-settings-menu" attribute sits on the <mat-menu> host
//      in the light DOM, not on the rendered panel, so we can't use it to find the
//      panel. We match on the panel class instead.
//   3. The Help and Account menus share the same .top-nav-menu panel class. Matching
//      on that alone puts our item in all three, so we negative-match theirs.
//
// We clone an existing menu item rather than building one. Material's items carry a
// deep stack of mdc-list-item classes plus Angular's _ngcontent-* attributes, and
// those attributes are exactly what makes the app's emulated-encapsulation CSS apply.
// Cloning inherits all of it for free; cloneNode carries no listeners, so we attach
// our own.

import { ANCHOR, INJECTED_ATTR } from '../shared/selectors.js'

const ITEM_MARKER = 'settings-item'

let observer = null
let onActivate = null

function isSettingsPanel(node) {
  if (!(node instanceof Element)) return false
  if (!node.matches(ANCHOR.menuPanel)) return false

  // Same panel class, different menu. Without this the item lands in Help/Account.
  return !ANCHOR.menuPanelExclude.some(className => node.classList.contains(className))
}

function buildItem(sample) {
  const item = sample.cloneNode(true)
  item.setAttribute(INJECTED_ATTR, ITEM_MARKER)
  item.setAttribute('op-selector', 'top-nav-walkthroughs')

  // Material items may carry state classes from whatever we happened to clone.
  item.classList.remove('mat-mdc-menu-item-highlighted', 'cdk-focused', 'cdk-program-focused')
  item.removeAttribute('disabled')
  item.removeAttribute('aria-disabled')

  // Some items (GitHub Integration) ship a "NEW" badge. Drop it before we look for
  // the label, so it can't survive into our clone.
  for (const badge of item.querySelectorAll('.top-nav-badge')) badge.remove()

  const icon = item.querySelector('mat-icon, .material-icons, .mat-icon')
  if (icon) icon.textContent = 'explore'

  // Material wraps item content in span.mat-mdc-menu-item-text, so the label is the
  // last *leaf* span -- filtering on childless spans skips that wrapper.
  const leafSpans = [...item.querySelectorAll('span')].filter(span => !span.querySelector('*'))
  const label = leafSpans[leafSpans.length - 1]
  if (label) label.textContent = 'Walkthroughs'

  return item
}

/**
 * Close the Settings menu.
 *
 * Our cloned item has no MatMenuItem directive, so it doesn't close the menu the way a
 * real item would. This menu has [hasBackdrop]="false", so there is no backdrop to
 * click either. Material binds (keydown) on the panel element itself, so that is where
 * Escape has to land -- dispatching on document does nothing.
 */
function closeMenu(panel) {
  const escape = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })

  panel.dispatchEvent(escape())

  // Belt and braces: if the panel is still up, the trigger toggles it shut.
  if (!panel.isConnected) return

  window.setTimeout(() => {
    if (panel.isConnected) document.querySelector(ANCHOR.settingsTrigger)?.click()
  }, 0)
}

function inject(panel) {
  // Idempotent: Material can deliver the panel node through more than one mutation
  // record, and onSameUrlNavigation:'reload' re-renders things unprompted.
  if (panel.querySelector(`[${INJECTED_ATTR}="${ITEM_MARKER}"]`)) return

  const content = panel.querySelector(ANCHOR.menuContent) ?? panel
  const sample = content.querySelector(ANCHOR.menuItemSample)

  // No item to clone means the panel isn't populated yet, or the app changed. Bail
  // rather than build a mismatched item -- the next mutation will bring us back.
  if (!sample) return

  const item = buildItem(sample)

  item.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(panel)
    onActivate?.()
  })

  // Sit just under Keyboard Shortcuts, above the first divider, so we land in the
  // same group as the other app-level preferences rather than among the admin links.
  const anchor = content.querySelector(ANCHOR.menuItemAnchor)

  if (anchor?.parentElement === content) anchor.after(item)
  else content.appendChild(item)
}

/**
 * Watch for the Settings menu opening and inject on each open.
 *
 * @param {Function} handler called when the user picks our item
 */
export function startSettingsMenuInjection(handler) {
  onActivate = handler

  if (observer) return

  observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (isSettingsPanel(node)) {
          inject(node)
          continue
        }

        // The panel usually arrives nested inside a .cdk-overlay-pane rather than as
        // the added node itself, so check the subtree too.
        if (!(node instanceof Element)) continue

        for (const nested of node.querySelectorAll?.(ANCHOR.menuPanel) ?? [])
          if (isSettingsPanel(nested)) inject(nested)
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  // The menu may already be open (e.g. we booted mid-session after a reload).
  for (const panel of document.querySelectorAll(ANCHOR.menuPanel))
    if (isSettingsPanel(panel)) inject(panel)
}

export function stopSettingsMenuInjection() {
  observer?.disconnect()
  observer = null
  onActivate = null
}
