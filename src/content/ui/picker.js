// The walkthrough picker, opened from the app's Settings > Walkthroughs item.
//
// Recipes the user's stated purposes point at are listed first under "Recommended for
// you", everything else under "All walkthroughs". Already-completed ones stay visible
// but are marked, since re-running a walkthrough is a perfectly reasonable thing to
// want.

import { RECIPES } from '../../shared/recipes.js'
import { PURPOSES, getPurpose } from '../../shared/purposes.js'
import { storage, KEYS } from '../../shared/utils.js'
import { openModal } from './modal.js'

const LAYER = 'picker'

/** Recipe ids the user's purposes recommend, in purpose order. */
function recommendedIds(purposeIds = []) {
  const selected = new Set(purposeIds)
  const ids = []

  for (const purpose of PURPOSES) {
    if (!selected.has(purpose.id)) continue
    for (const id of purpose.recipeIds) if (!ids.includes(id)) ids.push(id)
  }

  return ids
}

/** Which of the user's purposes recommend this recipe -- shown as a hint on the card. */
function purposeLabelsFor(recipeId, purposeIds = []) {
  return purposeIds
    .map(getPurpose)
    .filter(purpose => purpose?.recipeIds.includes(recipeId))
    .map(purpose => purpose.label)
}

function buildCard(recipe, { completed, purposeLabels, onStart }) {
  const card = document.createElement('button')
  card.className = 'op-card'
  card.type = 'button'

  const title = document.createElement('div')
  title.className = 'op-card-title'

  const name = document.createElement('span')
  name.textContent = recipe.goal
  title.appendChild(name)

  if (completed) {
    const done = document.createElement('span')
    done.className = 'op-tag op-tag--done'
    done.textContent = 'Done'
    title.appendChild(done)
  }

  const meta = document.createElement('span')
  meta.className = 'op-card-meta'
  meta.textContent = `${recipe.steps.length} steps`
  title.appendChild(meta)

  const blurb = document.createElement('p')
  blurb.className = 'op-card-blurb'
  blurb.textContent = purposeLabels?.length
    ? `${recipe.summary} · Matches ${purposeLabels.join(', ')}`
    : recipe.summary

  card.append(title, blurb)
  card.onclick = () => onStart(recipe.recipeId)

  return card
}

function section(label) {
  const el = document.createElement('div')
  el.className = 'op-section-label'
  el.textContent = label
  return el
}

/**
 * Open the picker.
 *
 * @param {object} options { onStart(recipeId), onStartOnboarding() }
 */
export async function openPicker({ onStart, onStartOnboarding } = {}) {
  const [profile, progress] = await Promise.all([
    storage.sync.get(KEYS.PROFILE),
    storage.local.get(KEYS.PROGRESS),
  ])

  const purposeIds = profile?.purposes ?? []
  const completedRecipes = progress?.completedRecipes ?? {}

  const { body, foot, close } = openModal(LAYER, {
    title: 'Walkthroughs',
    subtitle: 'Pick a guided walkthrough and we will take you through it step by step.',
  })

  const start = recipeId => {
    close()
    onStart?.(recipeId)
  }

  const recommended = recommendedIds(purposeIds)
  const rest = RECIPES.filter(recipe => !recommended.includes(recipe.recipeId))

  if (recommended.length > 0) {
    body.appendChild(section('Recommended for you'))

    for (const recipeId of recommended) {
      const recipe = RECIPES.find(r => r.recipeId === recipeId)
      if (!recipe) continue

      body.appendChild(
        buildCard(recipe, {
          completed: Boolean(completedRecipes[recipeId]),
          purposeLabels: purposeLabelsFor(recipeId, purposeIds),
          onStart: start,
        }),
      )
    }
  }

  if (rest.length > 0) {
    body.appendChild(
      section(recommended.length > 0 ? 'All walkthroughs' : 'Available walkthroughs'),
    )

    for (const recipe of rest)
      body.appendChild(
        buildCard(recipe, {
          completed: Boolean(completedRecipes[recipe.recipeId]),
          onStart: start,
        }),
      )
  }

  // Re-running onboarding is the way to change your answers, so make it reachable
  // rather than a one-time thing the user can never get back to.
  const redo = document.createElement('button')
  redo.className = 'op-btn op-btn--ghost op-btn--sm'
  redo.type = 'button'
  redo.textContent = purposeIds.length > 0 ? 'Change my preferences' : 'Set up my preferences'
  redo.onclick = () => {
    close()
    onStartOnboarding?.()
  }

  const dismiss = document.createElement('button')
  dismiss.className = 'op-btn op-btn--ghost op-btn--sm op-spacer'
  dismiss.type = 'button'
  dismiss.textContent = 'Close'
  dismiss.onclick = close

  foot.append(redo, dismiss)
}
