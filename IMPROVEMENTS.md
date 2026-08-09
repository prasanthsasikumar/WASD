# Display Glasses Simulator: Improvement Notes

Analysis of the code currently in this directory (`index.html` 361 lines, `wasd.css` 1168, `wasd.js` 1518), with prioritized recommendations.

The tool's core idea is sound and the implementation is cleaner than most single-file web apps: real section comments, sensible state handling, `prefers-reduced-motion` support, and a genuinely correct optical choice in `mix-blend-mode: plus-lighter`. Most of what follows is about the gap between "works" and "shippable as your own public project."

---

## 0. Blockers before any public hosting

These are not code quality issues. They will bite you the day the repo goes public.

~~**Third-party attribution was baked into the source.**~~ **Resolved.** Author metadata, structured data and footer credits naming the originating studio have been removed from every page, including the five under `docs/` and `support/` that were missed in the first pass.

~~**Canonical and OG tags pointed at the origin site.**~~ **Resolved.** All canonical, `og:url` and `twitter:url` tags naming the upstream domain are gone; OG images are self-hosted.

~~**Analytics shipped visitor data to someone else's account.**~~ **Resolved.** No analytics script is loaded; add your own if you want metrics.

**Preset apps and background media are not yours to redistribute.**
- ~~Six of seven `APP_PRESETS` pointed at third-party infrastructure.~~ **Resolved.** Replaced with three self-hosted demos under `demos/`, served same-origin. As a side effect the contrast linter can now inspect them directly rather than falling back to static guidance.
- ~~`background/` holds ten stock `.mp4` clips (hiking, airport, piano, cooking…). Stock footage is almost always licensed to a single entity and explicitly non-sublicensable.~~ **Resolved.** Replaced with 21 original Ray-Ban Meta POV clips (3:4, ≤12 s, 34 MB total including poster thumbnails, down from 91 MB). The stock clips were purged from git history, not just deleted.

**Recommended fix:** strip attribution/analytics/canonical, self-host demo apps you write, and replace the video set with CC0 clips (Pexels, Coverr) or a procedural WebGL environment. A synthetic environment with a real luminance value is arguably *better* for the tool's purpose than stock video; see §3.

---

## 1. Security

**The iframe sandbox is effectively disabled.** Line 305:

```
sandbox="allow-scripts allow-same-origin"
```

These two flags together are the documented sandbox escape. When framed content is same-origin with the embedder, it can reach into the parent and remove the `sandbox` attribute entirely. Because the URL bar accepts *any* input, a user (or a crafted share link) can point the frame at the simulator's own origin and self-embed. Drop `allow-same-origin`, or accept that the sandbox is decorative and stop relying on it.

**Permissions are far broader than the tool needs.** The same element grants `camera; microphone; geolocation; clipboard-read; clipboard-write; accelerometer; gyroscope` to arbitrary user-supplied URLs. A HUD preview tool does not need to hand microphone access to whatever someone types. Grant nothing by default and add an opt-in toggle for the rare demo that needs a sensor.

**Deep links auto-load remote content.** The share feature restores state from query params, which means a link someone sends you silently loads a third-party page with the permissions above. At minimum: show the target origin and require a click before framing when the URL came from a query param rather than from typing.

**URL handling is loose.** `loadURL()` prepends `https://` only when the input fails `/^https?:\/\//i`. That accidentally neutralizes `javascript:` and `data:` (they become invalid https URLs), but it's incidental rather than intentional. Parse with `new URL()`, allowlist the `http:`/`https:` protocols explicitly, and reject the rest with a real message.

---

## 2. Correctness bugs

~~**Blocked framing is not detected.**~~ **Resolved, but not the way this note proposed.** The suggested fix cannot work: racing a timer against a `contentWindow` probe does not distinguish the cases. Measured against a blocking site, a working cross-origin site and a real-world case, all three report `contentDocument === null`, `contentWindow.location` throwing `SecurityError`, and `length === 0`, because browsers give blocked frames an opaque origin. Nothing observable from the embedder separates them.

The headers are the only signal and CORS hides them, so the check moved server-side: `api/can-frame.js` reads `X-Frame-Options` and CSP `frame-ancestors` before the frame is attempted, and the panel explains the refusal instead of sitting empty. It degrades to the old behaviour when the function is not deployed.

**Layout constants are hand-measured and fragile.** The comment on `APP_CHIPS_INITIAL` is candid about it: the three visible chips "measure 262px inside the 339px strip," and a fourth "pushes it to 355px and wraps," with a note to re-measure if labels change. This breaks silently on a font fallback, a locale change, or a longer preset name. Replace with a `ResizeObserver` or a CSS-only overflow approach that computes how many fit at runtime.

**`tryToExtractTitle(url)` cannot work cross-origin.** Reading a framed document's title from another origin throws by design. If it's wrapped in a `try`, it's dead code that runs on every load; if not, it throws on every real-world use. Either drop it or fetch metadata server-side.

---

## 3. Physical accuracy: the highest-value area

This is where the tool could become genuinely authoritative rather than merely illustrative.

**`plus-lighter` is the right call.** Additive compositing correctly models a waveguide combiner: emitted light adds to the world, so pure black renders as fully transparent. Most homegrown simulators get this wrong with plain `opacity`. Good instinct, keep it.

**But "brightness" is modeled as opacity, which is not how displays work.** The `sl-opacity` slider runs 30–100% and multiplies panel alpha. Real legibility is a ratio between display luminance (nits) and ambient luminance (lux falling on the scene). Two separate physical quantities are collapsed into one arbitrary percentage, and the background `Dark` slider is a *second*, unrelated knob for what is really the same relationship. Model it properly: one ambient-illuminance control, one display-nits control, and derive contrast from both. Then the numbers mean something a hardware engineer would recognize.

**HUD geometry is in CSS pixels, not degrees.** Size presets are `60`/`90` scale factors on a 360px box. The device that's being simulated has a specific panel resolution and a specific field of view (~20°), and those are what determine whether 14px text is legible. Derive the on-screen size from FOV and assumed viewing distance, then you can report **angular size in arcminutes**, a checkable number that predicts real legibility, rather than a preview that depends on the user's monitor.

**Missing optical artifacts.** Real waveguides show eye-box vignetting, chromatic aberration/rainbow artifacts at the edges, limited color gamut (these panels are nothing like full sRGB), and a visible screen-door structure. Even crude approximations would make previews far less optimistic than they currently are.

**Monocular rivalry is unsimulated.** The device drives the right eye only. `CAPTURE_MODES.pov` nods at this with `centerX: 0.75`, but the live view renders as if both eyes see the panel. Binocular rivalry meaningfully affects perceived brightness and comfort; worth at least a documented caveat.

---

## 4. Accessibility

**Focus is essentially invisible.** One `:focus`-related rule in 1168 lines of CSS, across an interface built almost entirely from custom `<button>` elements. Keyboard users cannot tell where they are. Add a consistent `:focus-visible` ring; this is the highest-impact accessibility fix here and it's about ten lines.

**ARIA roles are misapplied.** `#position-seg`, `#size-seg`, and `#qr-mode-seg` use `role="tablist"` over plain `<button>` children. `tablist` requires `role="tab"` children with `aria-selected` and controlled tabpanels; none of that is present, so screen readers announce a structure that doesn't exist. These are single-select groups, use `role="radiogroup"` with `role="radio"` + `aria-checked`, or drop the roles and use `aria-pressed` on toggle buttons. Active state is currently conveyed by a `.active` class alone, which is invisible to assistive tech.

**The `<h1>` concatenates.** `<h1><span class="side-header-eyebrow">Meta Ray-Ban Display</span>Web Apps Simulator</h1>` is announced as one run-together string. Split the eyebrow out of the heading.

**Autoplaying video has no pause control.** `prefers-reduced-motion` is respected for CSS animations (three separate blocks, nice) but the looping background video ignores it. Honor the same query by pausing video and showing a still frame.

**Other gaps:** no skip link, unlabeled landmarks, and slider values communicated via adjacent `<span>` text rather than `aria-valuetext`.

---

## 5. Performance

- ~~**`og-image.png` is 832KB**: larger than all the code combined.~~ **Resolved.** Re-cut from the simulator itself as `og-image.jpg`, 61 KB, and rebranded to WASD.
- ~~**Ten autoplaying MP4s with no `preload` strategy.**~~ **Partly resolved.** Scene tiles are static JPEG posters (248 KB for all 21) instead of 21 `<video preload="metadata">` elements, the initial clip has a `poster`, and clips are capped at 12 s / ~1.6 MB average. Still worth doing: WebM/AV1 alongside MP4.
- **Google Fonts is render-blocking** despite the `preconnect` hints. Self-host Inter and set `font-display: swap`.
- **Manual cache busting** via `wasd.css?v=11` and `wasd.js?v=10` will drift the moment someone forgets to bump one. Use content hashes from a build step, or set proper immutable cache headers.

---

## 6. Architecture

A 1518-line IIFE with no modules, no build, and no tests is fine for a demo and limiting for a public project.

- **Split by concern:** optics/compositing, capture, state/deep-links, UI wiring. ES modules need no bundler to start.
- **Move config to data.** `APP_PRESETS`, `BG_PRESETS`, and `CAPTURE_MODES` are content, not logic; a JSON file lets people add devices via PR without touching application code.
- **Add tests for the parts that have real logic:** the crop-region math in `computeCropRect`, deep-link serialize/deserialize round-trips, and URL normalization. These are pure functions and cheap to cover.
- **The capture approach is a reasonable forced choice.** `getDisplayMedia` + crop exists because cross-origin iframe content cannot be rasterized to canvas; worth a code comment saying so, since the next maintainer will otherwise "optimize" it into a `html2canvas` call that silently produces blank panels.

---

## 7. Feature ideas worth building

Ordered roughly by value-to-effort.

1. **Additive contrast linter.** Analyze the loaded app and flag elements that will vanish or wash out under additive blending: dark-on-dark, low-alpha overlays, thin light strokes. This is the #1 mistake developers make on these devices, no existing tool catches it, and it's the most defensible reason for the project to exist.
2. **Angular legibility readout.** Given FOV and panel resolution, report text size in arcminutes with a pass/fail against a legibility threshold. Turns subjective preview into a measurement.
3. **Multi-device presets.** Even Realities G1, Xreal One, Rokid, Vuzix Blade, each with a real FOV, resolution, nits, and color capability. Side-by-side comparison of the same app across devices is a genuinely new capability.
4. **Ambient/nits model** as described in §3, replacing the two ad-hoc sliders.
5. **Head-motion simulation.** These HUDs are head-locked; adding subtle drift/jitter reveals readability problems that a perfectly static preview hides.
6. **CI screenshot mode.** A headless entry point that renders a URL to a PNG so teams can diff HUD layouts in pull requests.
7. **Scene quality toggle.** The background clips are currently encoded for fast first paint: `scale=-2:900`, 24 fps, x264 CRF 30, which is ~1.6 MB average and visibly soft on a large monitor. Add a Standard / High control to the Background Scene group that swaps the source directory, keeping Standard as the default so the main workflow stays fast.

   Suggested High encode, roughly 4x the bytes for a genuine jump in sharpness:

   ```bash
   ffmpeg -nostdin -ss <start> -t 12 -i <src>.MOV \
     -vf "scale=-2:1440,fps=30" \
     -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p \
     -profile:v high -level 4.2 -movflags +faststart -an \
     background/hq/<slug>.mp4
   ```

   Implementation notes: write the HQ files to `background/hq/` with identical slugs, derive the path the same way `posterFor()` does, remember the choice in `localStorage`, and swap `#bg-vid.src` on toggle while preserving `currentTime` so the scene does not jump. Keep posters shared between both sets. Budget roughly 130-150 MB for 21 HQ clips, which is the reason this is opt-in rather than default; if that is too heavy for the repo, host the HQ set on a CDN and fall back to Standard when it 404s.

8. **Offline PWA.** The tool is static; it should work on a plane.
9. **Design-token export.** Emit safe color/contrast/type-scale tokens for the selected device so findings flow back into the app being tested.

---

## Suggested order of work

1. §0 blockers: attribution, canonical, analytics, media, presets
2. §1 sandbox and permissions
3. §2 iframe-blocked detection (biggest UX win for the least code)
4. §4 focus ring and ARIA roles
5. §3 physical model rework
6. §7.1 contrast linter as the flagship differentiator
