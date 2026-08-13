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

  let recognition = null
  let micPrimed = false

  async function primeMicPermission() {
    if (micPrimed) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop()) // we only wanted the grant
    micPrimed = true
  }

  function stopListening() {
    recognition?.stop()
    recognition = null
    micBtn.classList.remove('recording')
  }

  async function startListening() {
    try {
      await primeMicPermission()
    } catch {
      setHint('Microphone blocked. Allow it for this extension and try again.')
      return
    }

    recognition = new SpeechRecognition()
    recognition.lang = navigator.language || 'en-US'
    recognition.interimResults = true
    recognition.continuous = false

    let finalText = ''

    recognition.onstart = () => {
      micBtn.classList.add('recording')
      setHint('Listening…')
    }

    recognition.onresult = event => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += chunk
        else interim += chunk
      }
      textarea.value = (finalText + interim).trim() // live feedback
    }

    recognition.onerror = e => {
      setHint(
        e.error === 'no-speech' ? "Didn't catch that — try again." : `Speech error: ${e.error}`,
      )
      stopListening()
    }

    // Sends on silence. The user never presses Enter after speaking.
    recognition.onend = () => {
      micBtn.classList.remove('recording')
      recognition = null
      const text = textarea.value.trim()
      setHint('')
      if (text) {
        textarea.value = ''
        onSubmit(text) // <- the same door the keyboard uses
      }
    }

    recognition.start()
  }

  micBtn.addEventListener('click', () => {
    if (recognition) stopListening()
    else startListening()
  })

  /* --------------------------------------------------------------------
   * TODO, roughly in payoff order:
   *  1. Push-to-talk on a held key — demos better than click-to-start/stop.
   *  2. Wake word: a second `continuous = true` recogniser scanning for
   *     "copilot", handing off to the capture above. Budget time — continuous
   *     recognition drops out every ~60s in Chrome and needs an auto-restart
   *     loop, and it holds the mic indicator on for the whole session.
   *  3. Spoken replies via speechSynthesis (main.js dispatches
   *     `copilot:assistant-text` on window for every reply).
   * ------------------------------------------------------------------ */

  return { setBusy, setHint, prefill }
}
