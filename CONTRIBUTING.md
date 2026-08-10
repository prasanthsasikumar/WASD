# Contributing

The most useful thing you can send is **a profile for a device I do not own**.

WASD simulates Meta Ray-Ban Display because that is the pair I wear. Nothing about
the tool is specific to it apart from one object and some footage, and both are
described below.

## Adding a device profile

Every number that belongs to a particular pair of glasses lives in the `DEVICES`
object near the top of [`wasd.js`](wasd.js). Copy the existing entry, change the
numbers, and open a pull request:

```js
'your-device-key': {
  name:      'Your Device',
  panel:     { w: 600, h: 450 },
  fovDeg:    20,
  eye:       'right',
  luminance: { min: 300, max: 2000, start: 1000, step: 50 },
  recording: { aspect: 1, ratio: 0.70 },
},
```

Then load `?device=your-device-key` and the whole simulation follows: panel
geometry, the stage apps are authored on, the angular size readout, the luminance
slider, and where the panel sits in a Point of View capture. No CSS to edit.

### What each field is, and where to find it

**`panel`** is the authored pixel grid, which also fixes the panel's aspect. Use the
resolution the device's SDK gives you to draw on. If the vendor only publishes a
physical size, any grid with the right aspect works, since everything is scaled.

**`fovDeg`** is the horizontal field of view the panel subtends, in degrees. Vendors
usually publish this. It drives the angular size readout and nothing else, so an
approximation is fine and better than a wrong panel size.

**`eye`** is `'right'`, `'left'` or `'both'`. Monocular devices put the image in front
of one eye, and a Point of View capture has to place it there. Binocular devices use
`'both'`, which centres it.

**`luminance`** is the display's own output in nits: the range the brightness control
spans, where it starts, and the slider step. This is the number vendors are least
consistent about publishing. If you only have a peak figure, use it as `max` and pick
something plausible for `min`, then say so in the PR.

**`recording`** describes the device's built-in screen recorder as an output frame.
`aspect` is width over height, so a square recorder is `1` and a widescreen one is
`16 / 9`. `ratio` is how much of the frame height the panel fills, which is a matter
of taste more than measurement.

### Three things the profile does not cover

1. **Footage.** The 20 background clips were shot on Ray-Ban Display, so they carry
   that device's eye height and its 3:4 capture aspect. Clips shot on your own
   hardware are worth more than the numbers are. See below.
2. **The capture format labels** in `index.html` (search `fmt-sub`). They currently
   describe Ray-Ban Display's behaviour in words: "HUD to the right", "like the
   glasses' own screen recorder". A profile with a different `eye` or a
   non-square recorder makes those strings wrong. Flag it in the PR and we will
   make them read from the profile.
3. **The bundled demo apps** in `demos/` are authored for a 600x450 grid. They scale
   to any panel, but a very different aspect will letterbox or stretch them. That is
   expected and is not a reason to hold up a profile.

## Contributing footage

Clips shot through your own device are the part nobody else can supply.

- Shoot at the device's native capture aspect and at your own eye height. That
  framing is the whole point, and it is what a phone clip cannot fake.
- 10 to 30 seconds, looping cleanly if you can manage it.
- Keep the file small enough to sit in a static repo. The existing clips are a
  reasonable size to match.
- Scenes worth having that are missing: night driving, heavy rain, snow, bright
  snow glare, a lit stage, a supermarket aisle.
- Please avoid clips where members of the public are clearly identifiable, and do
  not submit anything you do not have the right to publish under MIT.

## Anything else

Bugs, corrections to the optics model, and scenes are all welcome. The optics are an
approximation rather than a photometric model, and if you can show that a particular
number is wrong against real hardware, that is one of the more valuable things you
could open an issue about.

No build step, no dependencies, no test suite. Serve the folder and reload:

```bash
python3 -m http.server 8000
```

Match the surrounding code: comments explain why a thing is the way it is, not what
the line does.
