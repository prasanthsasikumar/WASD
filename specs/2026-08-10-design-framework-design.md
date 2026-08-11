# Design for added light: a falsifiable framework page

**Date:** 2026-08-10
**Status:** Implemented

## Problem

Section 03 of `docs/` states five design rules for an additive waveguide, drawn
from three months of wearing the hardware. They are correct and they are
unsupported: a reader takes each one on faith, and the section is a component of
the tool's documentation rather than something anyone would cite.

Two published references sharpen the gap:

- Google's [Designing for transparent screens](https://design.google/library/transparent-screens)
  states the same physics with an authority a personal account cannot claim, and
  names three rules WASD did not have: type measured in visual angle with a 0.6
  degree legibility floor, depth built from dark surfaces rather than shadow, and
  motion slow enough to earn attention rather than demand it.
- [A2UI](https://a2ui.org/) is an open protocol for agents to emit declarative UI
  from an approved component catalogue. It is a good answer to a real security
  problem, and every catalogue in circulation assumes an opaque screen. Nothing
  in the protocol can tell an agent that its output will be unreadable on glass.

Neither reference lets a reader test anything. WASD can. That is the opening.

## Goal

A page that states the framework and proves it in place: every rule demonstrated
live, and falsifiable in one drag.

Success: a reader who does not believe saturated red dies outdoors moves one
slider and watches it happen, without leaving the page or trusting the author.

## Design

### The page

Section 03 of `docs/index.html`, at `/docs/#rules`. It was built first as a
separate page at `/docs/design/` on the argument that a framework wants its own
citable URL; that turned out to duplicate the docs page's opening physics, its
contrast explanation and its caveats, so it was folded back in and the standalone
URL became a redirect. One page, one argument.

Seven rules, each carrying its provenance in the open:

| # | Rule | Source |
|---|------|--------|
| 01 | Black is a hole, not a colour | worn |
| 02 | Measure type in degrees, not pixels | Google |
| 03 | Contrast belongs to the room, not to your design | the optics model |
| 04 | Desaturate, or lose the colour entirely | both |
| 05 | Depth comes from dark, not from shadow | Google |
| 06 | Arrive slowly enough to be ignored | Google |
| 07 | One idea per glance | worn |

### The mechanic

One ambient slider, sticky under the top bar so it stays reachable from any rule.
It writes `--hud-opacity` and `--world-brightness` on the root. Every tile reads
both: content composited with `mix-blend-mode: plus-lighter` over a poster frame
shot on the glasses, at the opacity the optics model returns, over a backdrop
brightened on the same axis. Dragging it kills the failing half of the page at
once.

The slider is logarithmic over 50 to 30 000 lux. Linear spends most of its travel
in daylight where nothing changes; the collapse between 1 000 and 10 000 lux
needs to fall under the middle of the track.

Rules that need motion or a real moving scene also carry a deep link into the
simulator at the scene, ambient and size where the rule bites. Six of the seven
have one. These use the existing share-link parameters; no new code.

### Keeping the page and the tool honest

The contrast and opacity model moves out of the `wasd.js` IIFE into `optics.js`,
loaded by both the simulator and this page. A page that computed its own
approximation would drift, and the first time a rule failed here at a lux where
the tool said it passed, the page would be worthless.

`optics.js` exports `contrastRatio`, `hudOpacity`, and `contrastVerdict`. The
last is new: it names the three bands the simulator already colours its readout
by, so the page can label a demonstration with the word the tool uses.

### Rule 03 and the opacity floor

The model floors opacity at 0.3, which it reaches at about 1.9:1. Two daylight
illuminances therefore render identically. Rule 03's three tiles are pinned to
200, 2 200 and 9 000 lux: one per contrast band, usable to marginal to lost,
which is the only choice that shows a progression rather than two identical
frames.

### What the merge removed

The seven rules subsume section 03's five assertion tiles and the avoid strip, so
both go along with the CSS only they used. Section 02 loses the three-ambient
figure and the paragraph explaining the contrast bands: rule 03 now demonstrates
both live, and the bands are stated once beside the slider. The `NOT MODELLED`
caveat is stated once, in section 02. The conversion table becomes a subheading
inside the rules rather than a section of its own.

`/docs/design/` and `/docs/develop/` are redirect stubs pointing at `/docs/#rules`,
matching the stubs already there for the other sections.

### Accessibility

The slider carries an `aria-valuetext` giving lux, the room it corresponds to,
the ratio and the verdict, because the number alone does not carry the
consequence. Rule 06's animations are disabled under `prefers-reduced-motion`,
resolved to their end state.

## A2UI

Not built. The page closes with what the protocol runs into on a waveguide and
states that rendering an A2UI surface additively is the next thing planned. The
renderer gets its own spec.

## Verification

Playwright, against a local server:

- No console errors or failed requests on either page; every poster referenced
  resolves.
- The slider moves opacity down and world brightness up, reports 50 lux at the
  floor and 30 000 at the ceiling, and reaches the `lost` band.
- Rule 03's tiles are pinned, do not follow the slider, and render as three
  visibly distinct steps.
- The page uses the shared optics module rather than its own copy.
- Every deep link carries parameters the simulator accepts, and every `bg` key
  names a real clip.
- Nothing is said twice: no avoid strip, no five-rule panel, one `NOT MODELLED`,
  no three-ambient figure, one rules section, and every nav target resolves.
- `/docs/design/` redirects into the docs page.
- The simulator's own placement, capture, keyboard and mobile behaviour is
  unchanged by the extraction.

## Files

- `optics.js` new, shared
- `docs/index.html` section 03 replaced by the rules, two sections added, section
  02 deduplicated, dead CSS removed
- `docs/docs.js` new, the ambient control
- `docs/design/index.html` redirect stub to `/docs/#rules`
- `docs/develop/index.html` stub retargeted from `#create` to `#rules`
- `wasd.js` optics functions replaced by the shared module
- `index.html` loads `optics.js` before `wasd.js`
- `sitemap.xml` docs entry touched; no new URL, the page is one document
