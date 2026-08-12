# Quick Create: describe an app, see it in the lens

Date: 2026-08-12
Status: approved for planning

## Problem

Today, testing an idea in WASD means cloning the meta-wearables-webapp template, generating an app with a coding agent, deploying it somewhere, and pasting the URL into the simulator. That loop takes an hour before the first look under real optics. This feature collapses it to: type a prompt, wait for the stream, see the app in the lens.

## Decisions already made

- Playground, not a code generator. The output is a single self-contained HTML file previewed in the simulator, downloadable, and shareable by link. No repos, no hosting step.
- Chat refinement. After the first generation, a conversation continues: each instruction returns a complete revised file.
- Separate page at `create.html`, with the real simulator embedded so every revision is judged under real optics without leaving the page.
- Shared DeepSeek key for a rate-limited free tier, plus bring-your-own-key to lift all limits.

## Architecture

Three moving parts, all in this repo:

1. `create.html` + `create.js` + `create.css`: the authoring page. No build step, no dependencies, matching the rest of the site.
2. An embed mode in the existing simulator (`index.html?embed=1`): control panel hidden, stage kept, listening for `postMessage` from the parent.
3. `api/generate.js`: a Vercel serverless function that holds the shared DeepSeek key, applies the system prompt, rate limits the free tier, and streams the model's output back.

### The create page

Two columns on desktop, stacked on mobile.

- Left: the conversation. Prompt box first, then the chat. Each assistant reply is a revision. Past revisions stay clickable so the user can flip back if a refinement makes things worse.
- Right: an iframe of `index.html?embed=1`. A small strip above it exposes scene and ambient level, forwarded into the iframe, so daylight checks happen in place.

The current revision is held in memory and mirrored to `localStorage` so a refresh does not lose it. Revisions are posted into the iframe via `postMessage`; `wasd.js` gains a listener that loads the HTML into the Web App slot.

### Sandboxing (security requirement, not optional)

Generated and link-shared apps must load in an iframe with `sandbox="allow-scripts"` and without `allow-same-origin`. Blob URLs inherit the creating page's origin; without the sandbox, generated or shared code could read wasd.tools storage. With it, the app is inert toward the host page. This applies both on the create page and when the main simulator restores an `?app=` link.

### Handoff and sharing

"Open in simulator" compresses the HTML with the browser-native `CompressionStream` (gzip), base64url-encodes it, and opens `/?app=<payload>` alongside the existing deep link params. The main simulator learns to restore `?app=`, decompressing into the sandboxed Web App slot. Every generated app is therefore a permanent shareable link with no hosting.

Accepted limitation: QR handoff to real glasses cannot carry these payloads (QR tops out around 2 to 3 KB). For inline apps the QR button explains this and offers the single-file download instead.

## The serverless function

`api/generate.js`, POST only.

Request: the conversation so far. First generation sends the user's prompt; refinement sends the current HTML plus the new instruction. Optional `userKey` field for BYOK.

Response: a stream of the model output. The client strips markdown fences and accepts the result only if it is HTML-shaped, meaning the trimmed text begins with `<!doctype` or `<html`.

- Model: `deepseek-chat`, streamed, because full-file generation is slow enough that progress must be visible.
- Full-file replacement on every turn. No diffs or patches.
- The shared key lives in the `DEEPSEEK_API_KEY` Vercel environment variable, read only server-side, never in the repo, never in client code. Local testing uses a gitignored `.env.local`.
- BYOK: if `userKey` is present, forward it instead of the shared key, skip rate limiting, never log it. The key is stored client-side in `localStorage` only, entered in a settings field on the create page.

### The system prompt is the product

It encodes the seven rules for added light and the device profile: pure black background because black is transparent on a waveguide, no dark-on-light anywhere, large glanceable type, panel aspect and safe sizes from the device profile in `wasd.js`, everything inline (no external fonts, scripts, images, or network calls; the file must work offline as one file), and no hover-dependent interactions. This is what makes output a glasses app rather than a shrunk webpage, and it is the component expected to be tuned most after launch.

### Rate limiting

- Free tier: per-IP daily cap (initially 10 generations per day, tunable) counted in Upstash Redis via its REST API. Two environment variables. This is the site's first backend state dependency; BYOK requests never touch it.
- Fail open: if Upstash is unreachable, serve the request uncounted. A brief outage should not brick the demo; the worst case is a few free generations.
- On cap: the error tells the user exactly how to continue (paste your own DeepSeek key in settings, or return tomorrow).

## Error handling

Three user-visible failures, each surfaced as a plain message in the chat, none failing silently into an empty lens:

1. Rate limit reached: points at BYOK.
2. DeepSeek error or shared key out of credit: apologizes, points at BYOK.
3. Unusable output (not HTML-shaped after fence stripping): offers one-click retry.

## Out of scope for v1

User accounts or saved galleries, multi-file projects, publish-to-a-real-URL hosting, models other than DeepSeek, and cross-device generation history. The shareable link covers most of what a gallery would.

## Testing

No test harness is added; the repo is a static site. Verification is `vercel dev` against the real function plus this manual checklist:

- [ ] First generation streams in and renders in the embedded simulator
- [ ] Refinement returns a revised file; previous revision flip-back works
- [ ] Rate limit path (cap temporarily set to 1) shows the BYOK message
- [ ] BYOK path works and skips the counter
- [ ] Malformed output shows the retry message
- [ ] A deliberately hostile generated app cannot read wasd.tools storage (sandbox holds)
- [ ] `?app=` link pasted into a fresh browser restores the app in the sandboxed slot
- [ ] QR button for an inline app explains the limitation and offers download
- [ ] Mobile stacked layout is usable
- [ ] System prompt spot check: timer, checklist, and notes apps each pass the seven rules in the lens
