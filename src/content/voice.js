// Speech capture, moved out of the side panel with the rest of the chat.
//
// THE COST OF THAT MOVE, STATED PLAINLY
//
// SpeechRecognition and getUserMedia are scoped to the ORIGIN of the page that calls
// them. In the side panel that was chrome-extension://, a stable origin the user grants
// once. Here it is the app's own origin, so the grant is per host and the browser may
// refuse it outright on an insecure one.
//
// For this project that is acceptable and worth knowing why: localhost and
// https://app.observepoint*.com are both secure contexts, which is every host the
// manifest matches. The grant is then remembered per host like any other mic permission.
// If it is ever needed somewhere untrusted, the answer is an MV3 offscreen document with
// USER_MEDIA — extension origin, no page involved — not moving the panel back.
//
// WHAT ENDS A SENTENCE
//
// Silence, measured here, not Chrome's idea of it. `continuous = false` ends the session
// at the first pause and submits whatever it has, which cut the demo sentence in half at
// the breath after "…for Utah," and sent the fragment — and the fragment matched a
// different recipe, so it did not look like a voice bug.
//
// So: continuous, a silence timer reset by every scrap of speech, and an `onend` that
// RESTARTS rather than submits, because Chrome ends a continuous session on its own every
// minute or so and that is not the user finishing.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

/** Long enough to think mid-sentence, short enough not to feel ignored. */
const SILENCE_MS = 2500

let recognition = null
let micPrimed = false
let finalText = ''
let silenceTimer = null
let finishing = false
let submitted = false
let callbacks = { onPartial: null, onResult: null, onError: null, onEnd: null }

/**
 * The two errors worth naming, because they look identical from the outside and have
 * completely different fixes.
 *
 * `not-allowed` is a permission: this origin has not been granted the mic, or it was
 * denied. `audio-capture` is the device: nothing is available to record from, which is
 * what a headset switching profiles mid-call looks like — Bluetooth in particular, where
 * another app claiming it in hands-free mode can leave Chrome with no usable input.
 *
 * Everything else keeps its raw code. A made-up explanation is worse than a short one.
 */
const MESSAGES = {
  'not-allowed': 'Microphone blocked for this site. Allow it in the address bar and try again.',
  'service-not-allowed': 'Speech recognition is blocked by browser policy on this profile.',
  'audio-capture':
    'No microphone available — another app may have taken it. Check the input device and try again.',
  network: 'Speech recognition needs the network and could not reach it.',
}

export const voiceSupported = Boolean(SpeechRecognition)

/**
 * Priming before recognition is deliberate: webkitSpeechRecognition tends to fail
 * `not-allowed` on a first use that has not already been granted the mic.
 */
async function primeMicPermission() {
  if (micPrimed) return
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach(track => track.stop()) // we only wanted the grant
  micPrimed = true
}

const clearSilenceTimer = () => {
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = null
}

function armSilenceTimer() {
  clearSilenceTimer()
  silenceTimer = setTimeout(finish, SILENCE_MS)
}

/** End the capture and hand over what was said. Idempotent. */
function finish() {
  if (submitted) return
  submitted = true
  finishing = true
  clearSilenceTimer()
  teardown()

  const text = finalText.trim()
  callbacks.onEnd?.()
  if (text) callbacks.onResult?.(text)
}

function teardown() {
  const active = recognition
  recognition = null
  try {
    active?.stop()
  } catch {
    /* already dead */
  }
}

/** Abandon without submitting — the mic button's second press. */
export function stopListening() {
  if (!recognition && !recording()) return
  submitted = true
  finishing = true
  clearSilenceTimer()
  teardown()
  callbacks.onEnd?.()
}

export function recording() {
  return Boolean(recognition)
}

function listen() {
  const session = new SpeechRecognition()
  recognition = session
  session.lang = navigator.language || 'en-US'
  session.interimResults = true
  session.continuous = true

  session.onresult = event => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript
      if (event.results[i].isFinal) finalText += chunk
      else interim += chunk
    }
    callbacks.onPartial?.((finalText + interim).trim())
    armSilenceTimer()
  }

  session.onerror = event => {
    if (finishing) return
    // Routine mid-sentence once continuous is on. If we already have words the sentence
    // is not over, so let the silence timer stay in charge.
    if (event.error === 'no-speech' || event.error === 'aborted') return

    callbacks.onError?.(MESSAGES[event.error] ?? `Speech error: ${event.error}`)
    stopListening()
  }

  // Not the user finishing — Chrome ends continuous sessions on its own.
  session.onend = () => {
    if (finishing || recognition !== session) return
    try {
      listen()
    } catch {
      finish()
    }
  }

  session.start()
}

/**
 * @param {object} handlers
 * @param {(partial: string) => void} handlers.onPartial   live transcript
 * @param {(text: string) => void}    handlers.onResult    the finished sentence
 * @param {(message: string) => void} handlers.onError
 * @param {() => void}                handlers.onEnd       capture over, either way
 */
export async function startListening(handlers = {}) {
  callbacks = { ...callbacks, ...handlers }

  if (!SpeechRecognition) {
    callbacks.onError?.('Speech recognition is unavailable in this browser.')
    callbacks.onEnd?.()
    return
  }

  try {
    await primeMicPermission()
  } catch {
    callbacks.onError?.('Microphone blocked for this site. Allow it and try again.')
    callbacks.onEnd?.()
    return
  }

  finalText = ''
  finishing = false
  submitted = false
  listen()
}
