# Examples as proof: rule demos for WASD

**Date:** 2026-08-08
**Status:** Approved, not yet implemented

## Problem

`docs/develop/` states three design rules for building web apps on an additive
waveguide display, as assertion pairs:

- Paint in light / Not in ink
- Heavier and larger / Not thin and tight
- One idea per screen / Not a dashboard

A reader has to take all of them on faith. `docs/examples/` currently lists the
three demos that were built to unblock publishing (Navigation, Timer, Contrast).
It reads as a second, unrelated list, and it does not prove anything the develop
page claims.

## Goal

Make `docs/examples/` the lab for the rules: every claim in `develop` has a
demo you can load and watch succeed or fail, in the simulator, over real
footage.

Success: a sceptical reader who does not believe pure red washes out can click
one link and watch it happen at 20 000 lux.

## Design

### Demo set

Seven demos under `demos/`. The three existing ones keep their current jobs and
files; four are new.

| Directory | Role | Proves |
| --- | --- | --- |
| `nav/` | Reference app (existing) | What a finished, correct app looks like |
| `timer/` | Second archetype (existing) | A different app shape, also correct |
| `contrast/` | Master rule (existing, static split) | Black emits nothing, so it is transparent |
| `rule-light/` | New, alternating | Paint in light, not in ink |
| `rule-colour/` | New, alternating | Cyan and green carry furthest; deep blue and pure red wash out first |
| `rule-weight/` | New, alternating | Heavier and larger, not thin and tight |
| `rule-density/` | New, alternating | One idea per screen, not a dashboard |

Colour is split out from "paint in light" because `develop` makes a specific,
falsifiable claim about hue that a designer is most likely to disbelieve. It
earns its own proof.

`contrast/` does not overlap with the four: it is a fixed side-by-side of the
master rule, whereas the four alternate a single frame in place.

### Alternation behaviour

Each `rule-*` demo holds two states, A (follows the rule) and B (the common
mistake), and cycles between them.

- **Hard cut, 3000 ms per state.** No crossfade. A fade implies a spectrum
  between the two; the point is that one works and one does not.
- **Identical frame.** Both states occupy the full panel at the same size and
  position. Nothing is scaled down to fit two things at once, so the weight and
  density rules stay honest.
- **State pill.** A small label in a corner names the current state, with a
  filled dot for A and a hollow dot for B, so any screenshot is
  self-describing.
- **No input required.** Cycling is on a timer, so the demo works in a
  screenshot, in a screen recording, and on the glasses, none of which can be
  relied on to deliver clicks into the panel.

**Reduced motion:** when `prefers-reduced-motion: reduce` matches, the timer
never starts. Both states render stacked and labelled, in the manner of
`contrast/`. The lesson survives without animation.

### Demo content

Each `rule-*` demo reuses the same navigation frame (distance, street, arrow,
progress) so that the only variable between demos is the rule under test.

- `rule-light`: A: `#000` ground, bright cyan strokes. B: `#1e1e1e` fill with a
  tonal gradient and dim grey text.
- `rule-colour`: identical layout in both. A: cyan and green. B: deep blue
  (`#1a2fd6`) and pure red (`#e01b1b`).
- `rule-weight`: A: 700 weight, generous letter spacing and line height,
  strokes at 4.5px. B: 200 weight, tight spacing, 1px strokes.
- `rule-density`: A: one distance and one instruction. B: the same screen plus
  five more metrics, a mini map block, and a status row.

### Page structure

`docs/examples/index.html` becomes:

1. Intro: what these are and that they are served same-origin so they always
   load.
2. **Reference applications**: Navigation, Timer.
3. **Proofs**: the four `rule-*` demos plus Contrast. Each card states what it
   proves, names the matching rule, and links back to that rule in `develop`.
4. Source code note.
5. How to read them: load one, raise Ambient, watch the contrast readout.

Every card keeps the existing two links: "Open in WASD"
(`/?url=%2Fdemos%2F<slug>%2F`) and "View standalone" (`/demos/<slug>/`).

### Cross-linking

`docs/develop/` gains a reciprocal link on each of its three rule pairs,
pointing at the demo that proves it. This is what makes examples the lab for
the rules rather than a parallel list. Without it, the two pages stay
disconnected and the rewrite achieves nothing.

### Sidebar presets

`APP_PRESETS` in `wasd.js` becomes seven entries in this order:

```
Navigation, Timer, Contrast, Light, Colour, Weight, Density
```

The first three show by default; the four rule demos sit behind the existing
"see more" toggle. A visitor's first click must land on something that looks
like a working product, not on a deliberately broken teaching example, which
would read as the tool being broken.

## Constraints

- Each demo stays a single self-contained HTML file with no build step and no
  dependencies, matching the existing three.
- Designed for the 600x600 native panel (`--app-native`).
- No stroke under 2px in any A state.
- No external requests; system font stack only, as in the existing demos.

## Out of scope

- Changing the optical model or the contrast formula.
- Restructuring `docs/index.html` or `docs/how-it-works/`.
- Interactive controls inside the panel.

## Verification

- All seven demos return 200 and load in the simulator via their preset chips.
- Each `rule-*` demo alternates: sampling the DOM at 0 ms and 3500 ms yields
  different state labels.
- With `prefers-reduced-motion: reduce` forced, no alternation occurs and both
  states are present in the DOM.
- Every link in `docs/examples/` and every new link in `docs/develop/` resolves.
- No console errors on any demo.
