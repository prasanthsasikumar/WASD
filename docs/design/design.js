/* ==========================================================================
   The design page's one control.

   Every demonstration tile on the page reads two custom properties: how
   present the panel is (--hud-opacity) and how bright the world behind it is
   (--world-brightness). Both come from the ambient slider, through the same
   optics model the simulator uses, so a rule that fails here at 9 000 lux
   fails in the tool at 9 000 lux.

   Tiles carrying their own data-lux are pinned to that level instead: rule 03
   is an argument about three specific rooms, so it must not move.
   ========================================================================== */
(function () {
  'use strict';

  const NITS = 1000;          // held at the middle of the device's range
  const LUX_MIN = 50;
  const LUX_MAX = 30000;

  const slider   = document.getElementById('amb');
  const readEl   = document.getElementById('amb-read');
  const sceneEl  = document.getElementById('amb-scene');
  const ratioEl  = document.getElementById('amb-ratio');
  if (!slider || !window.WASDOptics) return;

  const O = window.WASDOptics;

  /* A linear slider over 50 to 30 000 lux spends most of its travel in
     daylight, where nothing changes. Log scale puts the interesting collapse
     between 1 000 and 10 000 in the middle of the track, where a thumb can
     actually find it. */
  const luxAt = (v) => LUX_MIN * Math.pow(LUX_MAX / LUX_MIN, v / 100);

  /* The scene does not politely stay dim while the light washing out the
     panel climbs. Brightness is mapped on the same log axis so the backdrop
     and the panel move together. */
  const worldBrightness = (lux) => {
    const t = Math.log(lux / LUX_MIN) / Math.log(LUX_MAX / LUX_MIN);
    return (0.42 + t * 0.95).toFixed(3);
  };

  /* What a wearer would call the light they are standing in. */
  function describe(lux) {
    if (lux < 150)   return 'dim room';
    if (lux < 600)   return 'lit indoors';
    if (lux < 1500)  return 'bright indoors';
    if (lux < 5000)  return 'shade, outdoors';
    if (lux < 12000) return 'overcast, outdoors';
    if (lux < 22000) return 'bright daylight';
    return 'open sun';
  }

  const fmt = (n) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

  /* Rule 03's three tiles are fixed illuminances, so their captions are
     written once from the model rather than tracking the slider. */
  function stampFixedTiles() {
    document.querySelectorAll('.lab-view[data-lux]').forEach(view => {
      const lux = parseInt(view.dataset.lux, 10);
      view.style.setProperty('--hud-opacity', O.hudOpacity(NITS, lux).toFixed(3));
      view.style.setProperty('--world-brightness', worldBrightness(lux));
      const cap = document.getElementById('cap-' + lux);
      if (cap) {
        const r = O.contrastRatio(NITS, lux);
        cap.textContent = r.toFixed(1) + ' : 1, ' + O.contrastVerdict(r);
      }
    });
  }

  /* Poster frames rather than the clips themselves: this page is a reference,
     not a demo reel, and twenty autoplaying videos would cost more than the
     argument is worth. */
  function attachScenes() {
    document.querySelectorAll('.lab-view[data-scene]').forEach(view => {
      view.style.setProperty('--scene', `url("/background/posters/${view.dataset.scene}.jpg")`);
    });
  }

  function update() {
    const lux = luxAt(parseInt(slider.value, 10));
    const ratio = O.contrastRatio(NITS, lux);
    const verdict = O.contrastVerdict(ratio);

    document.documentElement.style.setProperty('--hud-opacity', O.hudOpacity(NITS, lux).toFixed(3));
    document.documentElement.style.setProperty('--world-brightness', worldBrightness(lux));

    readEl.textContent  = fmt(lux) + ' lux';
    sceneEl.textContent = describe(lux);
    ratioEl.textContent = ratio.toFixed(1) + ' : 1 ' + verdict;
    ratioEl.className   = 'amb-ratio' + (verdict === 'usable' ? '' : ' ' + verdict);
    // Screen readers get the consequence, not just the number.
    slider.setAttribute('aria-valuetext', `${fmt(lux)} lux, ${describe(lux)}, contrast ${ratio.toFixed(1)} to 1, ${verdict}`);
  }

  attachScenes();
  stampFixedTiles();
  slider.addEventListener('input', update);
  update();
})();
