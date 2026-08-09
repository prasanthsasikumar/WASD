// Reports whether a URL will refuse to be embedded, before we try to frame it.
//
// This has to run server-side. A blocked frame and a working cross-origin
// frame are indistinguishable from the embedding page: in both cases
// contentDocument is null, contentWindow.location throws SecurityError, and
// length is 0, because modern browsers give blocked frames an opaque origin.
// Only the response headers say which it is, and CORS keeps those out of
// reach of client JavaScript.
//
// The request deliberately carries Sec-Fetch-Dest: iframe. Some hosts and
// CDNs only apply a framing policy to real framing requests, so a plain GET
// comes back clean and tells you nothing.

const dns = require('dns').promises;
const net = require('net');

const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 5;

// Blocks SSRF: this endpoint fetches a URL an anonymous caller chose, so it
// must never be usable to reach the platform's own network or metadata.
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  const a = ip.toLowerCase();
  if (a === '::1' || a === '::') return true;
  if (a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd')) return true;
  if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
  return false;
}

async function assertPublicHost(hostname) {
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch (e) {
    const err = new Error('That host could not be resolved.');
    err.code = 'DNS';
    throw err;
  }
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) {
    const err = new Error('That host is not publicly routable.');
    err.code = 'PRIVATE';
    throw err;
  }
}

function parseFrameAncestors(csp) {
  // Only the last frame-ancestors directive in the header applies.
  const parts = String(csp).split(';').map(s => s.trim()).filter(Boolean);
  let found = null;
  for (const part of parts) {
    const [name, ...vals] = part.split(/\s+/);
    if (name && name.toLowerCase() === 'frame-ancestors') found = vals;
  }
  return found;
}

function ancestorsAllow(sources, embedderOrigin) {
  if (!sources || !sources.length) return true;
  const lowered = sources.map(s => s.toLowerCase());
  if (lowered.includes("'none'")) return false;
  if (lowered.includes('*')) return true;
  // 'self' means the framed site's own origin, never a third-party embedder.
  let embedder;
  try { embedder = new URL(embedderOrigin); } catch (e) { return false; }
  return lowered.some(src => {
    if (src === "'self'") return false;
    const candidate = src.includes('://') ? src : 'https://' + src;
    let u;
    try { u = new URL(candidate); } catch (e) { return false; }
    if (u.hostname === '*') return true;
    if (u.hostname.startsWith('*.')) {
      const suffix = u.hostname.slice(1); // ".example.com"
      return embedder.hostname.endsWith(suffix);
    }
    return u.hostname === embedder.hostname;
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  const raw = (req.query && req.query.url) || '';
  let target;
  try {
    target = new URL(raw);
  } catch (e) {
    res.status(400).json({ error: 'A url query parameter is required.' });
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    res.status(400).json({ error: 'Only http and https can be checked.' });
    return;
  }

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const embedderOrigin = `${proto}://${req.headers.host}`;

  try {
    await assertPublicHost(target.hostname);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Redirects are followed by hand so every hop is re-checked against the
    // private-address rules, and so the policy read is the final document's.
    let current = target;
    let response = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Presented as a genuine cross-site framing navigation, because
          // some hosts only send a framing policy when they see one.
          'User-Agent': 'Mozilla/5.0 (compatible; WASD-frame-check/1.0; +https://wasd.tools)',
          'Accept': 'text/html,application/xhtml+xml',
          'Sec-Fetch-Dest': 'iframe',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site'
        }
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') break;
        await assertPublicHost(next.hostname);
        current = next;
        continue;
      }
      break;
    }
    clearTimeout(timer);

    const xfo = (response.headers.get('x-frame-options') || '').trim().toLowerCase();
    const csp = response.headers.get('content-security-policy') || '';
    const ancestors = parseFrameAncestors(csp);

    let blocked = false;
    let reason = null;
    if (xfo === 'deny') {
      blocked = true;
      reason = 'X-Frame-Options: DENY';
    } else if (xfo === 'sameorigin') {
      blocked = true;
      reason = 'X-Frame-Options: SAMEORIGIN';
    } else if (ancestors && !ancestorsAllow(ancestors, embedderOrigin)) {
      blocked = true;
      reason = `Content-Security-Policy: frame-ancestors ${ancestors.join(' ')}`;
    }

    res.status(200).json({
      blocked,
      reason,
      status: response.status,
      finalUrl: current.href,
      checked: target.href
    });
  } catch (e) {
    clearTimeout(timer);
    // Unreachable or timed out. Say so rather than guessing at a verdict:
    // the caller treats an inconclusive result as "go ahead and try".
    res.status(200).json({
      blocked: false,
      inconclusive: true,
      reason: e.name === 'AbortError' ? 'The site did not respond in time.' : 'The site could not be reached.',
      checked: target.href
    });
  }
};
