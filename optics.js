/* ==========================================================================
   WASD optics: the additive display model.

   Ambient illuminance (lux) falling on a scene becomes luminance (nits)
   reflected back toward the eye. lux/PI is that conversion for a perfect
   diffuse reflector; the waveguide adds its own light on top, so the
   contrast the wearer actually perceives is (display + ambient) / ambient.

   This lives in its own file because two things depend on it and they must
   never disagree: the simulator's optics panel, and the demonstrations on
   the design page under docs/. A rule that fails on the docs page at a
   given lux has to fail in the tool at the same lux, or the page is lying.

   No module system: both consumers are plain scripts loaded with defer, so
   this attaches to window and is loaded first.
   ========================================================================== */
(function (root) {
  'use strict';

  /* The ratio the wearer perceives. Above roughly 3:1 the panel is winning,
     below 1.5:1 it has lost. Clamped so a pitch black room cannot divide by
     zero and report infinity. */
  function contrastRatio(nits, lux) {
    const bgNits = lux / Math.PI;
    return (nits + bgNits) / Math.max(bgNits, 0.01);
  }

  /* How present the panel looks, as an alpha. Not a physical quantity: it is
     the perceptual consequence of the ratio above, floored at 0.3 because
     even a washed out panel never disappears completely. */
  function hudOpacity(nits, lux) {
    const contrast = contrastRatio(nits, lux);
    return Math.max(0.3, Math.min(1.0, 1.0 - 1.0 / (contrast * 0.5 + 0.5)));
  }

  /* The three bands the simulator colours its readout by, named once here so
     the docs page can label a demonstration with the same word the tool uses. */
  function contrastVerdict(ratio) {
    if (ratio < 1.5) return 'lost';
    if (ratio < 3)   return 'marginal';
    return 'usable';
  }

  root.WASDOptics = { contrastRatio, hudOpacity, contrastVerdict };
})(typeof window !== 'undefined' ? window : this);
