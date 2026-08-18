/**
 * THE INPUT LAYER.
 *
 * Everything about how a question arrives lives here. main.js never learns
 * whether the user typed it, spoke it, or tapped a suggestion chip.
 *
 *   mountInput(root, { onSubmit }) -> { setBusy, setHint, prefill }
 *
 * WHY VOICE LIVES IN THE SIDE PANEL AND NOT A CONTENT SCRIPT
 * SpeechRecognition needs microphone permission scoped to the page's origin.
 * From a content script that is the host app's origin (app.observepoint.com),
 * where the prompt is unreliable and can be blocked outright. The side panel is
 * a chrome-extension:// page with its own stable origin — the user grants the
 * mic once and it sticks.
 *
 * Priming with getUserMedia before starting recognition is deliberate: without
 * it, webkitSpeechRecognition tends to fail `not-allowed` on first use in an
 * extension page.
 *
 * WHAT ENDS A SPOKEN SENTENCE
 *
 * Silence, measured by us — not Chrome. `continuous = false` ends the session at the
 * first pause and `onend` submitted whatever it had, which cut the demo sentence in
 * half at the natural breath after "…for Utah," and sent the fragment. The fragment
 * matched a different recipe, so it did not look like a voice bug.
 *
 * So: `continuous = true`, a 2.5s silence timer reset by every scrap of speech, and an
 * `onend` that RESTARTS rather than submits — Chrome ends a continuous session on its
 * own every minute or so, and that is not the user finishing. The only two things that
 * end a capture are the timer and the mic button.
 */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

export function mountInput(root, { onSubmit }) {
  root.innerHTML = `
    <div class="input-row">
      <button id="mic" title="Click to speak">🎤</button>
      <textarea id="q" rows="1" placeholder="What are you trying to set up?"></textarea>
      <button id="send" class="primary">Ask</button>
    </div>
    <div class="hint" id="hint"></div>
  `

  const micBtn = root.querySelector('#mic')
  const textarea = root.querySelector('#q')
  const sendBtn = root.querySelector('#send')
  const hintEl = root.querySelector('#hint')

  const setHint = (s = '') => (hintEl.textContent = s)
  const setBusy = busy => {
    sendBtn.disabled = busy
    textarea.disabled = busy
    micBtn.disabled = busy
  }
  const prefill = text => {
    textarea.value = text
    textarea.focus()
  }

  /* --------------------------- text ---------------------------------- */

  function submit() {
    const text = textarea.value.trim()
    if (!text) return
    textarea.value = ''
    textarea.style.height = 'auto'
    onSubmit(text)
  }

  sendBtn.addEventListener('click', submit)
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  })
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  })

  /* --------------------------- voice --------------------------------- */

  if (!SpeechRecognition) {
    micBtn.disabled = true
    micBtn.title = 'Speech recognition unavailable in this browser'
  }

  /**
   * How long a pause has to last before we decide the sentence is over.
   *
   * The bug this replaced: `continuous = false` makes Chrome end the session at the
   * FIRST pause, and `onend` submitted whatever it had. The demo sentence has a natural
   * breath in it — "…for Utah, then edit My First Audit…" — so it was being cut in half
   * and sent, and the half that arrived matched a different recipe.
   *
   * 2.5s is long enough to think mid-sentence and short enough that nobody wonders
   * whether it heard them. The mic button remains the explicit way to finish early.
   */
  const SILENCE_MS = 2500

  let recognition = null
  let micPrimed = false
  // Everything below is per-capture, and has to outlive the SpeechRecognition object:
  // Chrome ends a continuous session on its own every minute or so, and we restart into
  // a NEW object while the same sentence is still being spoken.
  let finalText = ''
  let silenceTimer = null
  let finishing = false // the user asked to stop, or silence ran out
  let submitted = false // guards the one path that calls onSubmit

  async function primeMicPermission() {
    if (micPrimed) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop()) // we only wanted the grant
    micPrimed = true
  }

  const clearSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = null
  }

  /** Restart the silence countdown. Called on every scrap of speech. */
  function armSilenceTimer() {
    clearSilenceTimer()
    silenceTimer = setTimeout(finish, SILENCE_MS)
  }

  /** End the capture and send what we heard. Idempotent. */
  function finish() {
    if (submitted) return
    submitted = true
    finishing = true
    clearSilenceTimer()

    const active = recognition
    recognition = null
    try {
      active?.stop()
    } catch {
      /* already dead */
    }

    micBtn.classList.remove('recording')
    setHint('')

    const text = textarea.value.trim()
    if (text) {
      textarea.value = ''
      textarea.style.height = 'auto'
      onSubmit(text) // <- the same door the keyboard uses
    }
  }

  /** Abandon the capture without sending. The mic button's second click. */
  function stopListening() {
    submitted = true // nothing more will be sent from this capture
    finishing = true
    clearSilenceTimer()
    const active = recognition
    recognition = null
    try {
      active?.stop()
    } catch {
      /* already dead */
    }
    micBtn.classList.remove('recording')
    setHint('')
  }

  function listen() {
    const session = new SpeechRecognition()
    recognition = session
    session.lang = navigator.language || 'en-US'
    session.interimResults = true
    // The fix. With `false`, Chrome treats the first pause as the end of the utterance;
    // with `true` it keeps the stream open and we decide when the sentence is over.
    session.continuous = true

    session.onstart = () => {
      micBtn.classList.add('recording')
      setHint("Listening… pause when you're done, or click the mic.")
    }

    session.onresult = event => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += chunk
        else interim += chunk
      }
      textarea.value = (finalText + interim).trim() // live feedback
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
      armSilenceTimer()
    }

    session.onerror = e => {
      // 'no-speech' and 'aborted' are routine mid-sentence with continuous on. If we
      // already have words, the sentence is not over — restart and keep the silence
      // timer as the only thing that ends a capture.
      if (!finishing && (e.error === 'no-speech' || e.error === 'aborted')) return

      if (finishing) return
      setHint(
        e.error === 'no-speech' ? "Didn't catch that — try again." : `Speech error: ${e.error}`,
      )
      stopListening()
    }

    // Chrome ends a continuous session by itself, roughly every minute and also after
    // some pauses. That is not the user finishing, so pick the stream back up and let
    // the silence timer be the only thing that decides.
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

  async function startListening() {
    try {
      await primeMicPermission()
    } catch {
      setHint('Microphone blocked. Allow it for this extension and try again.')
      return
    }

    finalText = ''
    finishing = false
    submitted = false
    listen()
  }

  micBtn.addEventListener('click', () => {
    if (recognition) stopListening()
    else startListening()
  })

  /* --------------------------------------------------------------------
   * TODO, roughly in payoff order:
   *  1. Push-to-talk on a held key — demos better than click-to-start/stop.
   *  2. Wake word: a second `continuous = true` recognizer scanning for
   *     "copilot", handing off to the capture above. The auto-restart loop this
   *     needs already exists below — Chrome drops a continuous session every
   *     ~60s and `onend` picks it back up — so the remaining cost is the mic
   *     indicator staying on for the whole session.
   *  3. Spoken replies via speechSynthesis (main.js dispatches
   *     `copilot:assistant-text` on window for every reply).
   * ------------------------------------------------------------------ */

  return { setBusy, setHint, prefill }
}
