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
