# Quick Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Describe an app in a prompt and see it running in the simulated lens seconds later, with chat refinement, shareable links, and no hosting step.

**Architecture:** A new `create.html` page holds a chat column and an iframe of the existing simulator in a new embed mode. A new Vercel function `api/generate.js` proxies DeepSeek with a glasses-specific system prompt, streaming a single self-contained HTML file back. Generated apps load into the existing sandboxed `#app-iframe` via blob URLs, travel between pages via `postMessage`, and travel between people compressed into a `?app=` URL parameter.

**Tech Stack:** Plain HTML/CSS/JS, no build step, no new runtime dependencies. Vercel Node serverless (CommonJS, matching `api/can-frame.js`). DeepSeek chat completions API (OpenAI-compatible). Upstash Redis REST for the free-tier counter. Browser-native `CompressionStream` for the link codec.

**Spec:** `docs/superpowers/specs/2026-08-12-quick-create-design.md`

## Global Constraints

- No build step and no new client dependencies. Everything ships as plain files.
- API functions are CommonJS (`module.exports = async (req, res) => ...`), matching `api/can-frame.js`.
- The shared DeepSeek key exists ONLY in the `DEEPSEEK_API_KEY` environment variable (Vercel dashboard and a gitignored `.env.local`). It must never appear in any committed file. Do not paste it into code, docs, or commit messages.
- The `#app-iframe` sandbox attribute in `index.html:138` (`sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock"`, no `allow-same-origin`) must not be loosened. Generated HTML loads only into that iframe or the create page equivalent with the same sandbox.
- User-visible copy contains no em dashes and no en dashes (site-wide rule).
- Comment style matches the codebase: comments explain physical or browser constraints, not what the next line does.
- The free tier daily limit is 10 generations per IP, overridable via `QC_DAILY_LIMIT`. Rate limiting fails open when Upstash is unreachable or unconfigured.
- The client accepts model output only if, after stripping markdown fences, the trimmed text begins with `<!doctype` or `<html` (case-insensitive).

---

### Task 1: The generator function `api/generate.js`

**Files:**
- Create: `api/generate.js`
- Modify: `.gitignore` (ensure `.env*.local` is ignored; create the file if the repo has none)
- Create: `.env.local` (NOT committed; local testing only)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `POST /api/generate` accepting JSON `{ messages: [{role: 'user'|'assistant', content: string}], key?: string }`. Success: HTTP 200, `Content-Type: text/plain`, body is a stream of raw text deltas (the HTML file as it generates). Failure: JSON `{ error: string, code: 'limit'|'config'|'upstream'|'bad-request' }` with status 400/405/429/502. Task 4's client depends on exactly these shapes.

- [ ] **Step 1: Ensure `.env*.local` is gitignored**

Check for `.gitignore` at the repo root. If absent, create it; either way it must contain the line `.env*.local`. Then create `.env.local` (untracked) containing the shared key, copying the value from the Vercel dashboard or from the project owner (it is intentionally not written in this plan):

```
DEEPSEEK_API_KEY=<the shared DeepSeek key>
```

Run: `git check-ignore .env.local`
Expected: prints `.env.local` (confirmed ignored).

- [ ] **Step 2: Write `api/generate.js`**

```js
// Generates a single-file app for the glasses display and streams it back.
//
// The shared DeepSeek key is read from the environment and used server-side
// only; it never reaches a client. A caller may send their own key instead
// ("key" in the body), which skips the daily counter and is forwarded
// upstream without being stored or logged.
//
// Rate limiting fails open on purpose: the counter lives in Upstash, and a
// counter outage should cost a few free generations, not brick the page.

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DAILY_LIMIT = parseInt(process.env.QC_DAILY_LIMIT || '10', 10);
const MAX_REQUEST_CHARS = 200000;

// The system prompt is the product: it is what turns "make me a timer" into
// an app that survives daylight on a waveguide. Every rule below is the
// prompt-sized form of a rule on the docs page, with the device numbers
// (600x450, 30 px per degree) baked in from the Ray-Ban Display profile.
const SYSTEM_PROMPT = [
  'You build apps for the display of Meta Ray-Ban Display smart glasses.',
  'You return ONE complete self-contained HTML file and nothing else:',
  'no markdown fences, no commentary before or after the file.',
  '',
  'The display is a 600 by 450 pixel panel on a transparent waveguide about',
  'a metre from the wearer\'s eye. It ADDS light to the world and cannot',
  'darken anything. Author for exactly 600 by 450 CSS pixels; the simulator',
  'scales it. Set html and body to width 600px, height 450px, overflow',
  'hidden, margin 0.',
  '',
  'Hard rules, each enforced by the optics, not by taste:',
  '1. The page background is pure black (#000). Black emits nothing and',
  '   renders as clear glass. Never use light backgrounds anywhere, and',
  '   never place dark text on a light surface.',
  '2. Type is measured in degrees: 30 px equals 1 degree on this device.',
  '   18 px is the absolute legibility floor. Body text belongs at 27 px or',
  '   larger; the primary number or headline at 45 px or larger.',
  '3. A container drawn in pure black does not exist for the wearer. If',
  '   content needs a visible seat, use a dark grey that still emits',
  '   (between #1a1a1a and #333) with a brighter 1 to 2 px edge.',
  '4. Use bright, mostly desaturated colours. Cyan, green, and white',
  '   survive daylight; pure red, blue, and violet vanish first. Never make',
  '   red the only carrier of urgency; carry urgency with size, motion, or',
  '   position.',
  '5. No drop shadows and no elevation built on darkness; an additive',
  '   display cannot render them. Depth is a dark seat plus a lit edge.',
  '6. Information the wearer did not cause (notifications, status changes)',
  '   should fade or drift in over about 2 seconds. Reserve instant',
  '   response for direct feedback to the wearer\'s own input.',
  '7. One idea per glance: roughly one number and one label per screen. If',
  '   a second idea must exist, give it a second screen.',
  '',
  'Technical constraints:',
  '- Everything inline in the one file: CSS in <style>, JS in <script>.',
  '- No external requests of any kind: no CDNs, no web fonts (use system',
  '  font stacks), no images (draw with CSS, inline SVG, or emoji), no',
  '  fetch, XHR, or WebSocket.',
  '- Input is a keyboard: W A S D or the arrow keys, Enter to select,',
  '  Escape to go back. No hover-dependent interactions, no scrolling;',
  '  everything visible fits the 600 by 450 frame at once.',
  '- The file runs from a blob URL inside a sandboxed iframe: localStorage,',
  '  sessionStorage, and cookies all throw. Keep state in JS variables.',
  '- Keep the file under about 40 KB.',
  '',
  'When the conversation contains a previous version of the file and an',
  'instruction, return the COMPLETE revised file, never a diff or fragment.'
].join('\n');

function clientIP(req) {
  return (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || 'unknown';
}

// One INCR per generation, keyed by IP and UTC day. The key outlives the
// day by a few hours (90000 s) so a client straddling midnight cannot
// reset itself early; the date in the key does the actual daily rollover.
async function underDailyLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return true;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = encodeURIComponent(`qc:${ip}:${day}`);
    const r = await fetch(`${url}/incr/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return true;
    const data = await r.json();
    if (data.result === 1) {
      fetch(`${url}/expire/${key}/90000`, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    return data.result <= DAILY_LIMIT;
  } catch (e) {
    return true;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.', code: 'bad-request' });
    return;
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length ||
      messages.some(m => !m || typeof m.content !== 'string' ||
                    (m.role !== 'user' && m.role !== 'assistant'))) {
    res.status(400).json({ error: 'A messages array of user and assistant turns is required.', code: 'bad-request' });
    return;
  }
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars > MAX_REQUEST_CHARS) {
    res.status(400).json({ error: 'The conversation is too large. Start a fresh app.', code: 'bad-request' });
    return;
  }

  const userKey = (typeof body.key === 'string' && body.key.trim()) ? body.key.trim() : null;
  const apiKey = userKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(502).json({ error: 'The generator is not configured on this deployment.', code: 'config' });
    return;
  }

  if (!userKey && !(await underDailyLimit(clientIP(req)))) {
    res.status(429).json({
      error: `The free tier is used up for today (${DAILY_LIMIT} generations per day). Paste your own DeepSeek key in Settings to keep going, or come back tomorrow.`,
      code: 'limit'
    });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: true,
        max_tokens: 8000,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }].concat(
          messages.map(m => ({ role: m.role, content: m.content }))
        )
      })
    });
  } catch (e) {
    res.status(502).json({ error: 'DeepSeek could not be reached. Try again in a moment.', code: 'upstream' });
    return;
  }

  if (!upstream.ok) {
    const friendly =
      upstream.status === 401 ? (userKey
        ? 'DeepSeek rejected that API key. Check it in Settings.'
        : 'The shared key was rejected. Paste your own DeepSeek key in Settings.') :
      upstream.status === 402 ? 'The shared key is out of credit. Paste your own DeepSeek key in Settings to keep going.' :
      upstream.status === 429 ? 'DeepSeek is rate limiting. Wait a few seconds and try again.' :
      'DeepSeek returned an error. Try again in a moment.';
    res.status(502).json({ error: friendly, code: 'upstream' });
    return;
  }

  // The upstream SSE frames are unwrapped here so the client reads a plain
  // stream of text deltas and never needs an SSE parser.
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no'
  });

  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // An SSE event boundary is a blank line; anything after the last one
      // may be a partial frame and waits for the next chunk.
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const evt of events) {
        for (const line of evt.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const delta = JSON.parse(payload).choices[0].delta.content;
            if (delta) res.write(delta);
          } catch (e) { /* malformed frame, skip */ }
        }
      }
    }
  } catch (e) {
    // Mid-stream upstream failure: the client sees a truncated file, fails
    // the HTML-shape check, and offers a retry. Nothing more to send here.
  }
  res.end();
};

module.exports.config = { supportsResponseStreaming: true };
```

- [ ] **Step 3: Exercise the function locally**

Run (from the repo root, two terminals):

```bash
vercel dev --listen 8000
```

```bash
curl -sN -X POST http://localhost:8000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"A countdown timer for 5 minutes with a start and reset. Keyboard only."}]}'
```

Expected: HTML streams to the terminal progressively (visible typing effect, not one blob at the end), beginning with `<!doctype html>` or `<html`, containing no markdown fences, with black background styling.

Also verify the error paths:

```bash
curl -s -X POST http://localhost:8000/api/generate -H 'Content-Type: application/json' -d '{}'
curl -s http://localhost:8000/api/generate
curl -sN -X POST http://localhost:8000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"key":"sk-invalid","messages":[{"role":"user","content":"hi"}]}'
```

Expected, in order: 400 with `code: "bad-request"`; 405; 502 with the "DeepSeek rejected that API key" message.

- [ ] **Step 4: Commit**

```bash
git add api/generate.js .gitignore
git commit -m "Generate: a serverless path from prompt to glasses app"
```

Confirm with `git show --stat HEAD` that `.env.local` is NOT in the commit.

---

### Task 2: The codec, inline app loading, and embed mode

**Files:**
- Create: `codec.js`
- Modify: `wasd.js` (state near line 12; `loadURL` at 482; new `loadGeneratedHTML`; message listener and embed init near the boot tail at line 1999)
- Modify: `index.html` (add the `codec.js` script include beside the existing vendor include at line 32)
- Modify: `wasd.css` (embed-mode rules)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `window.WASDCodec.compress(text: string): Promise<string>` and `window.WASDCodec.decompress(param: string): Promise<string>` (gzip + base64url), loaded on any page that includes `/codec.js`.
  - `loadGeneratedHTML(html: string, source: string): void` inside `wasd.js`, plus module state `generatedAppHTML: string|null` and `generatedAppParam: string|null` (the pre-compressed share payload).
  - The simulator accepts `postMessage` from its own origin: `{type: 'wasd:load-html', html: string}` and `{type: 'wasd:set-state', ambient?: number, bg?: string}` (bg is a clip name, case-insensitive).
  - `index.html?embed=1` opens with the sidebar hidden, no exit button, ready for messages. Task 4 depends on all of this.

- [ ] **Step 1: Write `codec.js`**

```js
/* Shared by the simulator and the create page: a generated app travels as
   gzip in a URL parameter, so both ends need the same codec. The browser's
   own CompressionStream keeps the site dependency-free. base64url rather
   than base64 because the payload lives in a query string. */
(function () {
  'use strict';

  function toBase64Url(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function compress(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return toBase64Url(await new Response(stream).arrayBuffer());
  }

  async function decompress(param) {
    const stream = new Blob([fromBase64Url(param)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  window.WASDCodec = { compress: compress, decompress: decompress };
})();
```

- [ ] **Step 2: Include it in `index.html`**

Next to the existing vendor include (`index.html:32`), before the `wasd.js` include so the codec is defined when `wasd.js` boots:

```html
<script defer src="/codec.js"></script>
```

(Defer scripts execute in document order, so placing it above the `wasd.js` tag is sufficient.)

- [ ] **Step 3: Add generated-app state and `loadGeneratedHTML` to `wasd.js`**

Near the element lookups at the top (around line 12), add:

```js
  // A generated app has no URL: the file itself is the state. Kept here so
  // share, QR, and download know what is currently in the lens.
  let generatedAppHTML = null;
  let generatedAppParam = null;   // pre-compressed for the share URL
  let generatedBlobURL = null;
```

Below `loadURL` (after line 551), add:

```js
  /* ── Generated apps ────────────────────────────────────────────────
     Inline HTML from the create page or an ?app= link. Loaded via a blob
     URL rather than loadURL: there is no origin to normalize, no framing
     policy to pre-flight, and it must not enter the URL history. The
     iframe's sandbox (no allow-same-origin) keeps the code inert toward
     wasd.tools even though the blob was minted here. ── */
  function loadGeneratedHTML(html, source) {
    generatedAppHTML = html;
    generatedAppParam = null;
    if (window.WASDCodec) {
      window.WASDCodec.compress(html).then(s => { generatedAppParam = s; });
    }
    if (generatedBlobURL) URL.revokeObjectURL(generatedBlobURL);
    generatedBlobURL = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    iframe.src = generatedBlobURL;
    urlInput.value = '';
    placeholder.hidden = true;
    wrap.classList.remove('hidden');
    wrap.classList.remove('show-placeholder');
    hideLoadError();
    openApp('web');
    trackEvent('load-generated', { source: source || 'unknown', bytes: html.length });
  }

  function downloadGeneratedApp() {
    if (!generatedAppHTML) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([generatedAppHTML], { type: 'text/html' }));
    a.download = 'app.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
```

In `loadURL` (wasd.js:482), right after the `urlInput.value = url;` line (488), clear the generated state so a URL load takes over cleanly:

```js
    generatedAppHTML = null;
    generatedAppParam = null;
```

- [ ] **Step 4: Add the message listener and embed mode**

Just above the `readStateFromURL();` call in the boot tail (wasd.js:1999), add:

```js
  /* ── Embed mode and the create-page bridge ─────────────────────────
     ?embed=1 is the simulator as a component: sidebar hidden, exit button
     suppressed, driven by postMessage from a same-origin parent (the
     create page). Same-origin only: the message carries HTML that will
     execute (sandboxed) in the lens. ── */
  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    const msg = e.data || {};
    if (msg.type === 'wasd:load-html' && typeof msg.html === 'string') {
      loadGeneratedHTML(msg.html, 'create');
    } else if (msg.type === 'wasd:set-state') {
      if (typeof msg.ambient === 'number' && isFinite(msg.ambient)) {
        slAmbient.value = Math.max(50, Math.min(30000, Math.round(msg.ambient)));
        applyHudBrightness();
      }
      if (typeof msg.bg === 'string') {
        const idx = CLIPS.findIndex(c => c.name.toLowerCase() === msg.bg.toLowerCase());
        if (idx >= 0) selectClip(idx);
      }
    }
  });

  const EMBED = new URLSearchParams(location.search).has('embed');
  if (EMBED) {
    document.body.classList.add('embed');
    setFullscreenSim(true);
  }
```

- [ ] **Step 5: Embed CSS**

In `wasd.css`, with the other fullscreen-sim rules:

```css
/* Embedded in the create page: the parent owns all chrome, so the exit
   button that would restore the sidebar must never appear. */
body.embed #exit-fullscreen-btn { display: none !important; }
```

- [ ] **Step 6: Verify by hand**

Run: `python3 -m http.server 8000` and open `http://localhost:8000/?embed=1`.
Expected: simulator opens with no sidebar and no exit button floating in.

Then in the browser console on that page:

```js
window.postMessage({ type: 'wasd:load-html', html: '<!doctype html><html><body style="background:#000;color:#63e6a8;font-size:48px;margin:0;display:grid;place-items:center;height:450px;width:600px">HELLO</body></html>' }, location.origin);
window.postMessage({ type: 'wasd:set-state', ambient: 20000, bg: 'promenade' }, location.origin);
```

Expected: HELLO appears in the lens; the scene switches to Promenade and the app washes out at 20000 lux. Also confirm in the console that `document.getElementById('app-iframe').src` starts with `blob:` and that `localStorage` access from inside the generated app would throw (the sandbox has no `allow-same-origin`; spot-check by loading an app whose script does `try { localStorage } catch (e) { document.body.textContent = 'SANDBOXED' }`).

- [ ] **Step 7: Commit**

```bash
git add codec.js wasd.js index.html wasd.css
git commit -m "Sim: load generated apps inline, and an embed mode to drive it"
```

---

### Task 3: The `?app=` deep link, share, and QR fallback

**Files:**
- Modify: `wasd.js` (`buildShareURL` at 1282, `readStateFromURL` at 1302, `applyQRMode` at 1451)

**Interfaces:**
- Consumes: `WASDCodec`, `loadGeneratedHTML`, `generatedAppHTML`, `generatedAppParam`, `downloadGeneratedApp` from Task 2.
- Produces: `/?app=<gzip base64url>` restores a generated app on page load (composing with the existing `bg`, `ambient`, `nits` params). `buildShareURL()` emits `app` instead of `url` when a generated app is active. Task 4's "Open in simulator" builds exactly this URL shape.

- [ ] **Step 1: Emit `app` in `buildShareURL`**

Replace the two lines at wasd.js:1284-1285:

```js
    const appUrl = urlInput.value.trim();
    if (appUrl) p.set('url', appUrl);
```

with:

```js
    const appUrl = urlInput.value.trim();
    if (generatedAppHTML && generatedAppParam) {
      // The app itself travels in the link; no hosting ever existed.
      p.set('app', generatedAppParam);
    } else if (appUrl) {
      p.set('url', appUrl);
    }
```

(`generatedAppParam` is computed asynchronously moments after load; a share clicked within those few milliseconds falls back to a stateless link, which is acceptable.)

- [ ] **Step 2: Restore `app` in `readStateFromURL`**

Next to the `p.has('url')` branch at wasd.js:1361, add:

```js
    if (p.has('app')) {
      // Unlike ?url=, this auto-loads: the payload is inline and runs only
      // inside the sandboxed iframe, so there is no drive-by framing of a
      // third-party site to guard against.
      window.WASDCodec.decompress(p.get('app'))
        .then(html => loadGeneratedHTML(html, 'link'))
        .catch(() => showLoadError('The app in this link could not be decoded.'));
    }
```

- [ ] **Step 3: QR fallback for inline apps**

In `applyQRMode` (wasd.js:1451), immediately after the toggle-pill update loop (after line 1458) and before `const appUrl = urlInput.value.trim();`, add:

```js
    if (generatedAppHTML) {
      // A generated app has no hosted URL for the glasses to open, and the
      // share payload usually exceeds what a camera-readable QR carries
      // (about 2 KB at low error correction).
      qrInstrGlasses.hidden = true;
      qrInstrSim.hidden = true;
      qrInstrWrap.hidden = true;
      const shareUrl = generatedAppParam ? buildShareURL() : null;
      if (mode === 'simulator' && shareUrl && shareUrl.length <= 2000) {
        renderQRCode(shareUrl);
        qrInstrSim.hidden = false;
        qrInstrWrap.hidden = false;
      } else {
        qrOutput.innerHTML =
          '<p class="qr-no-url">A generated app lives in this browser, not at a URL, ' +
          'so a QR code cannot carry it to the glasses. Download the file, host it ' +
          'anywhere, and load that URL here instead.</p>' +
          '<button id="qr-download-app" class="pill-btn" type="button">Download app.html</button>';
        document.getElementById('qr-download-app')
          .addEventListener('click', downloadGeneratedApp);
      }
      return;
    }
```

- [ ] **Step 4: Verify the round trip**

With `python3 -m http.server 8000` running, open `http://localhost:8000/`, then in the console:

```js
window.postMessage({ type: 'wasd:load-html', html: '<!doctype html><html><body style="background:#000;color:#0ff;font-size:48px;margin:0;display:grid;place-items:center;height:450px;width:600px">ROUND TRIP</body></html>' }, location.origin);
```

Wait a second, click the Share button, and paste the copied URL into a private window (same localhost origin).
Expected: the private window opens in fullscreen sim with ROUND TRIP in the lens, no clicks needed. Then open the QR modal in the original window: the glasses mode shows the explanation and a working Download app.html button; the downloaded file opens standalone in a browser tab.

- [ ] **Step 5: Commit**

```bash
git add wasd.js
git commit -m "Share: a generated app travels whole inside its own link"
```

---

### Task 4: The create page

**Files:**
- Create: `create.html`
- Create: `create.css`
- Create: `create.js`

**Interfaces:**
- Consumes: `POST /api/generate` (Task 1's request and response shapes), `WASDCodec` (Task 2), the embed-mode messages `wasd:load-html` and `wasd:set-state` (Task 2), and the `/?app=` link shape (Task 3).
- Produces: the user-facing page at `/create`. localStorage keys: `wasd-create-session` (JSON `{prompt, html}`: the first prompt and the current file) and `wasd-deepseek-key` (the BYOK key, this browser only).

- [ ] **Step 1: Write `create.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Create - WASD</title>
<meta name="description" content="Describe an app and see it on the glasses display seconds later. No repo, no deploy.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/create.css">
<script defer src="/codec.js"></script>
<script defer src="/create.js"></script>
</head>
<body>

<header id="top">
  <a class="brand" href="/">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="#63e6a8" aria-hidden="true"><g transform="translate(2.692 1.499) scale(0.8462)"><path fill-rule="evenodd" d="
    M1.9 6.9h20.2c1 0 1.9.8 1.9 1.9v2.6c0 3.2-2.4 5.8-5.6 6.2l-2.5.3c-2.1.2-3.7-.9-4.3-2.8l-.4-1.3c-.1-.3-.2-.5-.4-.5s-.3.2-.4.5l-.4 1.3c-.6 1.9-2.2 3-4.3 2.8l-2.5-.3C.4 17.2-2 14.6-2 11.4V8.8c0-1 .8-1.9 1.9-1.9z
    M2.3 9c-.3 0-.6.3-.6.6v1.6c0 2.1 1.6 3.8 3.7 4.1l2.3.3c1 .1 1.7-.3 2-1.3l.6-2.1c.1-.4.2-.9.2-1.3 0-1-.8-1.8-1.8-1.8zm11.6 0c-1 0-1.8.8-1.8 1.8 0 .5.1.9.2 1.3l.6 2.1c.3 1 1 1.4 2 1.3l2.3-.3c2.1-.3 3.7-2 3.7-4.1V9.6c0-.3-.3-.6-.6-.6z
    M3.5 10.3h4.3v2.4H3.5z"/></g></svg>
    <span><strong>WASD</strong> CREATE</span>
  </a>
  <span class="tagline">Describe an app. See it in the lens.</span>
</header>

<main>
  <section id="chat-col" aria-label="Conversation">
    <div id="messages" aria-live="polite"></div>

    <form id="composer">
      <textarea id="prompt" rows="3" spellcheck="false"
        placeholder="A pomodoro timer I can glance at while cooking"></textarea>
      <button id="send" class="pill-btn" type="submit">Generate</button>
    </form>

    <div id="actions" hidden>
      <button id="download" class="ghost-btn" type="button">Download HTML</button>
      <button id="open-sim" class="ghost-btn" type="button">Open in simulator</button>
      <button id="new-app" class="ghost-btn" type="button">New app</button>
    </div>

    <details id="settings">
      <summary>Settings</summary>
      <label for="byok">Your DeepSeek API key (optional)</label>
      <input id="byok" type="password" autocomplete="off" spellcheck="false"
             placeholder="sk-...">
      <p class="hint">Stays in this browser only, and lifts the daily free
      limit. Get one at platform.deepseek.com.</p>
    </details>
  </section>

  <section id="preview-col" aria-label="Preview">
    <div id="preview-strip">
      <select id="scene" aria-label="Scene"></select>
      <input type="range" id="ambient" min="50" max="30000" value="1000" step="50"
             aria-label="Ambient illuminance">
      <span id="ambient-lbl">1000 lux</span>
    </div>
    <iframe id="sim" src="/?embed=1" title="Simulator preview"></iframe>
    <p class="hint">Click the preview, then use W A S D, Enter, and Escape
    inside your app. Raise the slider to see it in daylight.</p>
  </section>
</main>

</body>
</html>
```

- [ ] **Step 2: Write `create.css`**

Token values are copied from the site palette so the page reads as WASD without importing the simulator stylesheet (whose layout rules assume the stage).

```css
:root {
  --bg: #0b0d10;
  --panel: #14171c;
  --line: #262b33;
  --text-1: #e8ebef;
  --text-2: #9aa3ae;
  --accent: #63e6a8;
  --danger: #ff7a7a;
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text-1);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
}

#top {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 8px; color: var(--text-1); text-decoration: none; letter-spacing: .04em; }
.brand strong { color: var(--accent); }
.tagline { color: var(--text-2); font-size: 13px; }

main {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(320px, 420px) 1fr;
  min-height: 0;
}

#chat-col {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  padding: 14px;
  gap: 12px;
  min-height: 0;
}

#messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.msg { padding: 10px 12px; border-radius: 10px; max-width: 92%; white-space: pre-wrap; }
.msg.user { background: var(--panel); align-self: flex-end; }
.msg.system { color: var(--text-2); font-size: 13.5px; align-self: stretch; }
.msg.error { color: var(--danger); }
.msg .retry { margin-left: 8px; }

.rev {
  align-self: flex-start;
  background: none;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text-1);
  padding: 8px 12px;
  cursor: pointer;
  font: inherit;
}
.rev.active { border-color: var(--accent); color: var(--accent); }
.rev .size { color: var(--text-2); font-size: 12.5px; margin-left: 8px; }

#composer { display: flex; gap: 8px; align-items: flex-end; }
#prompt {
  flex: 1;
  resize: none;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text-1);
  padding: 10px 12px;
  font: inherit;
}
#prompt:focus { outline: none; border-color: var(--accent); }

.pill-btn {
  background: var(--accent);
  color: #06281a;
  border: none;
  border-radius: 999px;
  padding: 10px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.pill-btn:disabled { opacity: .45; cursor: default; }

#actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ghost-btn {
  background: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--text-1);
  padding: 7px 14px;
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}
.ghost-btn:hover { border-color: var(--accent); color: var(--accent); }

#settings { border-top: 1px solid var(--line); padding-top: 10px; color: var(--text-2); }
#settings summary { cursor: pointer; }
#settings label { display: block; margin: 10px 0 4px; font-size: 13.5px; }
#byok {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text-1);
  padding: 8px 10px;
  font: inherit;
}
.hint { color: var(--text-2); font-size: 12.5px; margin: 6px 0 0; }

#preview-col { display: flex; flex-direction: column; min-height: 0; padding: 14px; gap: 10px; }
#preview-strip { display: flex; align-items: center; gap: 10px; }
#scene {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text-1);
  padding: 7px 10px;
  font: inherit;
}
#ambient { flex: 1; accent-color: var(--accent); }
#ambient-lbl { color: var(--text-2); font-size: 13px; min-width: 76px; text-align: right; }
#sim { flex: 1; width: 100%; border: 1px solid var(--line); border-radius: 12px; background: #000; }
#preview-col .hint { text-align: center; }

@media (max-width: 860px) {
  main { grid-template-columns: 1fr; grid-template-rows: minmax(300px, 45vh) 1fr; }
  #preview-col { order: -1; border-bottom: 1px solid var(--line); }
  #chat-col { border-right: none; }
}
```

- [ ] **Step 3: Write `create.js`**

```js
/* The create page: a conversation on the left, the real simulator on the
   right. Each assistant turn is a complete single-file app; the page holds
   the current file, mirrors it to localStorage, and posts it into the
   embedded simulator. The generator's context is deliberately small: the
   first prompt, the current file, and the newest instruction. */
(function () {
  'use strict';

  const messagesEl = document.getElementById('messages');
  const composer   = document.getElementById('composer');
  const promptEl   = document.getElementById('prompt');
  const sendBtn    = document.getElementById('send');
  const actionsEl  = document.getElementById('actions');
  const byokEl     = document.getElementById('byok');
  const sceneEl    = document.getElementById('scene');
  const ambientEl  = document.getElementById('ambient');
  const ambientLbl = document.getElementById('ambient-lbl');
  const simFrame   = document.getElementById('sim');

  const SESSION_KEY = 'wasd-create-session';
  const BYOK_KEY    = 'wasd-deepseek-key';

  // Mirrors BG_PRESETS in wasd.js; the simulator resolves these by name,
  // case-insensitively, so an unknown entry is simply ignored there.
  const SCENES = ['City Sidewalk', 'Cooking', 'Street Walk', 'Promenade',
    'Coffee', 'Rooftop', 'Subway', 'Cafe Desk', 'City Driving', 'Highway',
    'Library', 'Lobby', 'Studio', 'Trail', 'Harbor', 'Laundromat',
    'Workshop', 'Event', 'Commute', 'Corridor'];

  const state = {
    firstPrompt: null,   // the prompt that started this app
    revisions: [],       // [{html, note}] in order
    current: -1,         // index into revisions shown in the lens
    busy: false,
    simReady: false
  };

  /* ── Rendering ─────────────────────────────────────────────────── */

  function addMessage(cls, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addErrorMessage(text, retryFn) {
    const div = addMessage('system error', text);
    if (retryFn) {
      const btn = document.createElement('button');
      btn.className = 'ghost-btn retry';
      btn.type = 'button';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => { div.remove(); retryFn(); });
      div.appendChild(btn);
    }
  }

  function addRevisionChip(index) {
    const btn = document.createElement('button');
    btn.className = 'rev';
    btn.type = 'button';
    btn.dataset.index = index;
    const kb = Math.max(1, Math.round(state.revisions[index].html.length / 1024));
    btn.innerHTML = 'Version ' + (index + 1) + '<span class="size">' + kb + ' KB</span>';
    btn.addEventListener('click', () => selectRevision(index));
    messagesEl.appendChild(btn);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function markActiveChip() {
    messagesEl.querySelectorAll('.rev').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.index, 10) === state.current);
    });
  }

  /* ── Simulator bridge ──────────────────────────────────────────── */

  function pushToSim() {
    if (!state.simReady || state.current < 0) return;
    simFrame.contentWindow.postMessage(
      { type: 'wasd:load-html', html: state.revisions[state.current].html },
      location.origin);
  }

  function pushSceneState() {
    if (!state.simReady) return;
    simFrame.contentWindow.postMessage(
      { type: 'wasd:set-state',
        bg: sceneEl.value,
        ambient: parseInt(ambientEl.value, 10) },
      location.origin);
  }

  simFrame.addEventListener('load', () => {
    // The embed registers its message listener during boot; one tick of
    // grace covers the gap between the load event and that registration.
    setTimeout(() => {
      state.simReady = true;
      pushSceneState();
      pushToSim();
    }, 300);
  });

  function selectRevision(index) {
    state.current = index;
    markActiveChip();
    pushToSim();
    persist();
  }

  /* ── Persistence: survive a refresh, nothing more ──────────────── */

  function persist() {
    try {
      if (state.current < 0) { localStorage.removeItem(SESSION_KEY); return; }
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        prompt: state.firstPrompt,
        html: state.revisions[state.current].html
      }));
    } catch (e) { /* storage full or blocked; the session just won't survive refresh */ }
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) {}
    if (!saved || !saved.html) return;
    state.firstPrompt = saved.prompt || 'restored app';
    addMessage('user', state.firstPrompt);
    state.revisions.push({ html: saved.html });
    state.current = 0;
    addRevisionChip(0);
    markActiveChip();
    actionsEl.hidden = false;
    promptEl.placeholder = 'Refine it: make the number bigger';
  }

  /* ── Generation ────────────────────────────────────────────────── */

  function stripFences(text) {
    return text.replace(/^\s*```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }

  function buildRequestMessages(instruction) {
    if (state.current < 0) return [{ role: 'user', content: instruction }];
    return [
      { role: 'user', content: state.firstPrompt },
      { role: 'assistant', content: state.revisions[state.current].html },
      { role: 'user', content: instruction }
    ];
  }

  async function generate(instruction) {
    if (state.busy) return;
    state.busy = true;
    sendBtn.disabled = true;

    const isFirst = state.current < 0;
    if (isFirst) state.firstPrompt = instruction;
    addMessage('user', instruction);

    const progress = addMessage('system', 'Generating…');
    const body = { messages: buildRequestMessages(instruction) };
    const key = localStorage.getItem(BYOK_KEY);
    if (key) body.key = key;

    let text = '';
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        let err = { error: 'Something went wrong. Try again.' };
        try { err = await res.json(); } catch (e) {}
        progress.remove();
        addErrorMessage(err.error, () => generate(instruction));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        progress.textContent = 'Generating… ' + Math.round(text.length / 1024) + ' KB';
      }
    } catch (e) {
      progress.remove();
      addErrorMessage('The connection dropped mid-generation.', () => generate(instruction));
      return;
    } finally {
      state.busy = false;
      sendBtn.disabled = false;
    }

    const html = stripFences(text);
    if (!/^(<!doctype|<html)/i.test(html)) {
      progress.remove();
      addErrorMessage('The model returned something that is not an app.', () => generate(instruction));
      return;
    }

    progress.remove();
    state.revisions.push({ html: html });
    state.current = state.revisions.length - 1;
    addRevisionChip(state.current);
    markActiveChip();
    pushToSim();
    persist();
    actionsEl.hidden = false;
    promptEl.placeholder = 'Refine it: make the number bigger';
  }

  /* ── Wiring ────────────────────────────────────────────────────── */

  composer.addEventListener('submit', e => {
    e.preventDefault();
    const value = promptEl.value.trim();
    if (!value) return;
    promptEl.value = '';
    generate(value);
  });
  promptEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  document.getElementById('download').addEventListener('click', () => {
    if (state.current < 0) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([state.revisions[state.current].html], { type: 'text/html' }));
    a.download = 'app.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.getElementById('open-sim').addEventListener('click', async () => {
    if (state.current < 0) return;
    const param = await window.WASDCodec.compress(state.revisions[state.current].html);
    const p = new URLSearchParams();
    p.set('app', param);
    p.set('bg', sceneEl.value.toLowerCase());
    p.set('ambient', ambientEl.value);
    window.open('/?' + p.toString(), '_blank');
  });

  document.getElementById('new-app').addEventListener('click', () => {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    location.reload();
  });

  byokEl.addEventListener('change', () => {
    try {
      if (byokEl.value.trim()) localStorage.setItem(BYOK_KEY, byokEl.value.trim());
      else localStorage.removeItem(BYOK_KEY);
    } catch (e) {}
  });

  SCENES.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sceneEl.appendChild(opt);
  });
  sceneEl.addEventListener('change', pushSceneState);
  ambientEl.addEventListener('input', () => {
    ambientLbl.textContent = parseInt(ambientEl.value, 10).toLocaleString('en-US') + ' lux';
    pushSceneState();
  });

  try { byokEl.value = localStorage.getItem(BYOK_KEY) || ''; } catch (e) {}
  restore();
})();
```

- [ ] **Step 4: Verify the whole loop**

Run: `vercel dev --listen 8000` and open `http://localhost:8000/create` (cleanUrls serves `create.html`).

Expected, in order:
1. The page loads with the embedded simulator (no sidebar) on the right.
2. Prompt "a pomodoro timer I can glance at while cooking", Generate: the progress counter climbs, then Version 1 appears and the timer shows in the lens on black.
3. Change the scene to Promenade and drag ambient to 20000: the app washes out in place.
4. Refine with "make the remaining time twice as large": Version 2 appears and the lens updates. Clicking Version 1 flips back.
5. Download HTML produces a file that opens standalone.
6. Open in simulator opens a new tab, fullscreen sim, app running, scene and ambient carried over.
7. Refresh /create: the conversation collapses to the restored prompt and current version, still in the lens.
8. Paste a wrong key in Settings and generate: the DeepSeek key rejection message appears with Retry; clear the key and Retry works.

- [ ] **Step 5: Commit**

```bash
git add create.html create.css create.js
git commit -m "Create: describe an app, see it in the lens seconds later"
```

---

### Task 5: Entry points, README, and deployment

**Files:**
- Modify: `index.html` (a link into /create in the Apps group, around line 208)
- Modify: `README.md` (Features list and Layout block)
- Modify: `sitemap.xml` (add /create)
- Deployment: Vercel environment variables

**Interfaces:**
- Consumes: the finished /create page.
- Produces: discoverability and a configured production deployment.

- [ ] **Step 1: Link from the simulator panel**

In `index.html`, inside the Apps `nav-group-body` (after the `#app-see-more` button at line 208), add:

```html
        <a id="create-link" class="link-btn" href="/create">Create an app with AI &#8599;</a>
```

If `link-btn` styles do not apply cleanly to an anchor (it is used on buttons today), add to `wasd.css` next to the existing `.link-btn` rules:

```css
a.link-btn { display: inline-block; text-decoration: none; }
```

- [ ] **Step 2: README**

Add one bullet to the Features list, after the "Any URL" bullet:

```markdown
- **Create in place.** Describe an app at [wasd.tools/create](https://wasd.tools/create) and it is generated straight into the lens: single file, tuned for additive optics, refinable by chat, shareable as a link that carries the whole app. Free tier included, or bring your own DeepSeek key.
```

And extend the Layout block with the new files:

```
create.html   Describe an app, see it in the lens, refine by chat
create.js     Generation client, revisions, simulator bridge
codec.js      gzip + base64url codec for apps that travel inside links
api/          Serverless: framing pre-flight, DeepSeek generator
```

(Replace the existing `api/` line rather than duplicating it.)

- [ ] **Step 3: sitemap.xml**

Add a `<url>` entry for `https://wasd.tools/create/` alongside the existing entries, matching their format.

- [ ] **Step 4: Configure production**

In the Vercel project settings:
1. Add `DEEPSEEK_API_KEY` (the key the owner provided; enter it in the dashboard or via `vercel env add DEEPSEEK_API_KEY production`, pasting when prompted; never commit it).
2. Add the Upstash integration from the Vercel Marketplace (Storage, Upstash Redis, free tier), which injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` automatically. If the integration is unavailable, create a database at console.upstash.com and add the two variables by hand.
3. Deploy and re-run the Task 4 verification against the production URL.
4. Verify the free-tier cap end to end: set `QC_DAILY_LIMIT=1` in a preview environment, generate twice, confirm the second returns the limit message, then remove the override.

- [ ] **Step 5: Full manual checklist (from the spec)**

- [ ] First generation streams in and renders in the embedded simulator
- [ ] Refinement returns a revised file; previous revision flip-back works
- [ ] Rate limit path (cap temporarily set to 1) shows the BYOK message
- [ ] BYOK path works and skips the counter
- [ ] Malformed output shows the retry message
- [ ] A deliberately hostile generated app cannot read wasd.tools storage: generate with the prompt "an app that tries to read localStorage and cookies and displays what it finds", confirm it displays a security error or nothing rather than site data
- [ ] `?app=` link pasted into a fresh browser restores the app in the sandboxed slot
- [ ] QR button for an inline app explains the limitation and offers download
- [ ] Mobile stacked layout is usable (preview on top, chat below)
- [ ] System prompt spot check: a timer, a checklist, and a notes app each land light-on-black, large type, readable at 1000 lux in the lens

- [ ] **Step 6: Commit**

```bash
git add index.html wasd.css README.md sitemap.xml
git commit -m "Create: link it from the panel, the README, and the sitemap"
```
