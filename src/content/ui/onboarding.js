// First-run onboarding: the two questions that decide what we do for this user.
//
// Q1 gates everything. Answering "no thanks" means no initial walkthrough and no
// contextual offers later -- someone who knows the app should never see this again.
//
// Q2 decides which walkthroughs we recommend, and which nav items the orientation tour
// points out -- see shared/orientation.js, which composes itself from these answers.
//
// Onboarding starts exactly ONE walkthrough: the composed orientation. It used to queue a
// chain, so finishing the nav tour dropped you straight into the Audit setup form; that
// read as the extension taking over rather than helping. Anything deeper is suggested when
// orientation ends, and the user chooses.
//
// The orientation tour itself is only for people who said they are new -- someone who
// knows the app does not need Create New pointed out. But everyone needs to know where
// walkthroughs live, since the Settings item is the only way back in. New users get that
// as the first steps of their tour; returning users get the final screen below instead.

import { PURPOSES } from '../../shared/purposes.js'
import { ORIENTATION_RECIPE_ID } from '../../shared/orientation.js'
import { storage, KEYS } from '../../shared/utils.js'
import { openModal } from './modal.js'

const LAYER = 'onboarding'

const GUIDANCE_OPTIONS = [
  {
    id: 'new',
    label: "I'm new to ObservePoint",
    blurb: 'Start me with a tour of the app, and offer help as I explore.',
    wantsGuidance: true,
  },
  {
    id: 'walkthroughs',
    label: "I've used it before, but walkthroughs would help",
    blurb: 'Skip the basics. Offer walkthroughs for the areas I care about.',
    wantsGuidance: true,
  },
  {
    id: 'none',
    label: 'No thanks, I know my way around',
    blurb: 'Turn off walkthrough prompts. You can still start one from Settings.',
    wantsGuidance: false,
  },
]

function selectableCard({ label, blurb, selected, multi, onToggle }) {
  const card = document.createElement('button')
  card.className = 'op-card'
  card.type = 'button'
  card.dataset.selected = String(Boolean(selected))
  if (!multi) card.setAttribute('aria-pressed', String(Boolean(selected)))

  const title = document.createElement('div')
  title.className = 'op-card-title'

  if (multi) {
    const check = document.createElement('span')
    check.className = 'op-check op-icon'
    check.textContent = selected ? 'check' : ''
    title.appendChild(check)
  }

  const name = document.createElement('span')
  name.textContent = label
  title.appendChild(name)

  const blurbEl = document.createElement('p')
  blurbEl.className = 'op-card-blurb'
  blurbEl.textContent = blurb

  card.append(title, blurbEl)
  card.onclick = () => onToggle(card)

  return card
}

/**
 * Run the onboarding flow.
 *
 * @param {object} options { onComplete(profile, chain) }
 */
export async function openOnboarding({ onComplete } = {}) {
  const existing = (await storage.sync.get(KEYS.PROFILE)) ?? {}

  let guidanceId =
    existing.completedOnboarding && existing.wantsGuidance === false
      ? 'none'
      : (existing.guidanceId ?? null)
  const purposes = new Set(existing.purposes ?? [])

  const { body, foot, close } = openModal(LAYER, {
    title: 'Welcome to ObservePoint',
    subtitle: 'Two quick questions so we can point you at the right things.',
    dismissable: true,
  })

  const primary = document.createElement('button')
  primary.className = 'op-btn'
  primary.type = 'button'

  const skip = document.createElement('button')
  skip.className = 'op-btn op-btn--ghost op-btn--sm op-spacer'
  skip.type = 'button'
  skip.textContent = 'Not now'
  skip.onclick = close

  foot.append(skip, primary)

  const save = async () => {
    const option = GUIDANCE_OPTIONS.find(o => o.id === guidanceId)
    const purposeIds = [...purposes]

    const profile = {
      version: 1,
      completedOnboarding: true,
      guidanceId,
      wantsGuidance: option?.wantsGuidance ?? false,
      purposes: purposeIds,
      createdAt: existing.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await storage.sync.set(KEYS.PROFILE, profile)

    // The orientation tour, and nothing else. Someone who has used the app before gets no
    // tour at all -- just the pointer to the Settings menu below, so they can pick what
    // they actually want from the picker.
    const chain = guidanceId === 'new' ? [ORIENTATION_RECIPE_ID] : []

    const finish = () => {
      close()
      onComplete?.(profile, chain)
    }

    // Skipping the nav tour means skipping the two steps that would have shown them the
    // Settings item, so say it here instead.
    if (guidanceId === 'walkthroughs') {
      renderWhereToFind(finish)
      return
    }

    finish()
  }

  // -------------------------------------------------------------- returning users only

  function renderWhereToFind(finish) {
    body.innerHTML = ''
    body.appendChild(sectionLabel('One last thing'))

    const note = document.createElement('p')
    note.className = 'op-modal-sub'
    note.style.margin = '0 0 12px'
    note.textContent =
      'Walkthroughs live in the Settings menu, top right — the same place as Keyboard Shortcuts. Open it whenever you want one; the ones matching what you picked are at the top.'
    body.appendChild(note)

    // Nothing to go back to from here. The spacer that right-aligns the footer lives on
    // `skip`, so it has to move with it.
    skip.style.display = 'none'
    primary.classList.add('op-spacer')

    primary.disabled = false
    primary.textContent = 'Got it'
    primary.onclick = finish
  }

  // ------------------------------------------------------------------ question 2

  function renderPurposes() {
    body.innerHTML = ''
    body.appendChild(sectionLabel('Question 2 of 2'))

    const question = document.createElement('p')
    question.className = 'op-modal-sub'
    question.style.margin = '0 0 12px'
    question.textContent =
      'What is your purpose for using ObservePoint? Pick as many as apply — we will start with these.'
    body.appendChild(question)

    for (const purpose of PURPOSES)
      body.appendChild(
        selectableCard({
          label: purpose.label,
          blurb: purpose.blurb,
          selected: purposes.has(purpose.id),
          multi: true,
          onToggle: card => {
            if (purposes.has(purpose.id)) purposes.delete(purpose.id)
            else purposes.add(purpose.id)

            card.dataset.selected = String(purposes.has(purpose.id))
            const check = card.querySelector('.op-check')
            if (check) check.textContent = purposes.has(purpose.id) ? 'check' : ''
            syncPurposeFooter()
          },
        }),
      )

    skip.textContent = 'Back'
    skip.onclick = renderGuidance
    syncPurposeFooter()
  }

  function syncPurposeFooter() {
    primary.textContent =
      purposes.size > 0 ? `Start with ${purposes.size} selected` : 'Skip for now'
    primary.onclick = save
  }

  // ------------------------------------------------------------------ question 1

  function renderGuidance() {
    body.innerHTML = ''
    body.appendChild(sectionLabel('Question 1 of 2'))

    const question = document.createElement('p')
    question.className = 'op-modal-sub'
    question.style.margin = '0 0 12px'
    question.textContent =
      'Are you a new ObservePoint user, or would you like helpful walkthroughs of the app?'
    body.appendChild(question)

    for (const option of GUIDANCE_OPTIONS)
      body.appendChild(
        selectableCard({
          label: option.label,
          blurb: option.blurb,
          selected: guidanceId === option.id,
          multi: false,
          onToggle: () => {
            guidanceId = option.id
            renderGuidance()
          },
        }),
      )

    skip.textContent = 'Not now'
    skip.onclick = close

    primary.disabled = guidanceId === null
    primary.textContent = 'Continue'
    primary.onclick = () => {
      // Declining guidance means there is nothing to ask about purposes for.
      if (guidanceId === 'none') {
        save()
        return
      }

      primary.disabled = false
      renderPurposes()
    }
  }

  renderGuidance()
}

function sectionLabel(text) {
  const el = document.createElement('div')
  el.className = 'op-section-label'
  el.style.marginTop = '0'
  el.textContent = text
  return el
}
