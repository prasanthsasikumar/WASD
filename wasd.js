/* ==========================================================================
   Meta Display Glasses: Simulator (logic)
   ========================================================================== */

(function () {
  'use strict';

  /* ── DOM refs ──────────────────────────────────────────────────── */
  const simViewport   = document.getElementById('sim-viewport');
  const scene         = document.getElementById('scene');
  const wrap          = document.getElementById('display-wrap');
  const iframe        = document.getElementById('app-iframe');
  const placeholder   = document.getElementById('wg-placeholder');
  const bgImg         = document.getElementById('bg-img');
  const bgVid         = document.getElementById('bg-vid');
  const urlInput      = document.getElementById('url-input');
  const slNits        = document.getElementById('sl-nits');
  const lblNits       = document.getElementById('lbl-nits');
  const slAmbient     = document.getElementById('sl-ambient');
  const lblAmbient    = document.getElementById('lbl-ambient');
  const lblAngular    = document.getElementById('lbl-angular');
  const lblContrast   = document.getElementById('lbl-contrast');
  const toggleArtifacts = document.getElementById('toggle-artifacts');
  const fitSeg        = document.getElementById('fit-seg');
  const slBgDark      = document.getElementById('sl-bg-darkness');
  const lblBgDark     = document.getElementById('lbl-bg-darkness');
  const slBgBlur      = document.getElementById('sl-bg-blur');
  const lblBgBlur     = document.getElementById('lbl-bg-blur');
  const loadError     = document.getElementById('load-error');
  const fileInput     = document.getElementById('file-input');
  const appChips      = document.getElementById('app-chips');
  const wgStage       = document.getElementById('wg-stage');
  const hmGrid        = document.getElementById('hm-grid');
  const hmTime        = document.getElementById('hm-time');
  const hmDate        = document.getElementById('hm-date');
  const capLine       = document.getElementById('cap-line');
  const capPrev       = document.getElementById('cap-prev');
  const muFill        = document.getElementById('mu-fill');
  const muTime        = document.getElementById('mu-time');
  const muState       = document.getElementById('mu-state');
  const nvArrow       = document.getElementById('nv-arrow');
  const nvDist        = document.getElementById('nv-dist');
  const nvStreet      = document.getElementById('nv-street');
  const tmText        = document.getElementById('tm-text');
  const prScroll      = document.getElementById('pr-scroll');
  const dropZone      = document.getElementById('drop-zone');
  const clipUrlInput  = document.getElementById('clip-url-input');
  const clipAddBtn    = document.getElementById('clip-add-btn');
  const toggleGlow    = document.getElementById('toggle-glow');
  const toggleVignette= document.getElementById('toggle-vignette');
  const playlistEl    = document.getElementById('playlist');
  const clipLabel     = document.getElementById('clip-label');
  const stageEmpty    = document.getElementById('stage-empty');
  const slSize        = document.getElementById('sl-size');
  const lblSize       = document.getElementById('lbl-size');
  const slPosX        = document.getElementById('sl-posx');
  const lblPosX       = document.getElementById('lbl-posx');
  const slPosY        = document.getElementById('sl-posy');
  const lblPosY       = document.getElementById('lbl-posy');
  const exitFsBtn     = document.getElementById('exit-fullscreen-btn');

  /* ── Analytics: no-op stub. Replace with your own analytics provider. ─ */
  function trackEvent(name, data) {
    // Replace with your analytics implementation, e.g.:
    // if (window.plausible) plausible(name, { props: data });
  }

  /* ── Config ────────────────────────────────────────────────────── */
  const HUD_MARGIN = 48;

  /* ── Device profiles ───────────────────────────────────────────────
     Every number that belongs to a particular pair of glasses lives in
     this one object. To add a device: copy the block below, change the
     numbers, open a PR. Nothing else in this file knows the hardware.
     CONTRIBUTING.md walks through it.

       panel      the authored pixel grid apps are drawn on, and therefore
                  the panel's aspect. Apps are written once at this size
                  and scaled to whatever the stage shows.
       fovDeg     horizontal field of view the panel subtends, used for the
                  angular size readout.
       eye        'right' | 'left' | 'both'. Where a monocular image sits
                  in the wearer's view, which the Point of View capture
                  has to match.
       luminance  the display's own output in nits: slider range, starting
                  value, and step.
       recording  the device's built-in screen recorder as an output frame:
                  its aspect, and how much of the frame height the panel
                  fills.
     ───────────────────────────────────────────────────────────────── */
  const DEVICES = {
    'meta-ray-ban-display': {
      name:      'Meta Ray-Ban Display',
      panel:     { w: 600, h: 450 },
      fovDeg:    20,
      eye:       'right',
      luminance: { min: 300, max: 2000, start: 1000, step: 50 },
      recording: { aspect: 1, ratio: 0.70 }, // the device exports ~460×460
    },
  };
  const DEFAULT_DEVICE = 'meta-ray-ban-display';

  // ?device= selects a profile, so a second one is usable the day it lands
  // rather than waiting on a picker in the panel. An unknown key falls back
  // to the default instead of blanking the stage.
  const requestedDevice = new URLSearchParams(location.search).get('device');
  const DEVICE = DEVICES[requestedDevice] || DEVICES[DEFAULT_DEVICE];

  // The stylesheet draws the panel from these, so a profile with a different
  // pixel grid needs no CSS edit. Unitless: CSS multiplies by 1px. Named
  // --device-*, not --panel-*: --panel-w is already the control panel's width.
  document.documentElement.style.setProperty('--device-w', DEVICE.panel.w);
  document.documentElement.style.setProperty('--device-h', DEVICE.panel.h);

  // Where a monocular image sits across the wearer's field of view.
  const EYE_CENTER = { right: 0.75, left: 0.25, both: 0.5 };

  // Two capture formats for screenshots / recordings. Each defines the
  // cropped OUTPUT frame; the live on-screen HUD is unaffected (that's the
  // "Placement" controls). During a capture the HUD is briefly repositioned
  // and the frame cropped to match the active mode.
  //   ratio   → HUD height as a fraction of the frame height (sets the zoom)
  //   aspect  → frame width / height
  //   centerX → HUD center's horizontal position in the frame (0.5 = dead centre)
  //
  // 'pov' (Point of View) mimics looking through the glasses: a 16:9 field of
  // view with the HUD on the side the device drives. ratio 0.45 keeps the HUD
  // a modest panel while still letting the default Medium HUD's frame fit
  // common laptop widths (≳1420px) without black bars: smaller values
  // letterbox sooner.
  //
  // 'native' (Native Recording) reproduces the device's built-in screen
  // recorder, so its shape comes from the profile.
  //
  // User-facing names and descriptions live in the #fmt-popover rows in
  // index.html; the keys here match their data-cap values.
  const CAPTURE_MODES = {
    pov: {
      ratio:   0.45,
      aspect:  16 / 9,
      centerX: EYE_CENTER[DEVICE.eye] || 0.5,
    },
    native: {
      ratio:   DEVICE.recording.ratio,
      aspect:  DEVICE.recording.aspect,
      centerX: 0.5,
    },
  };
  let captureMode = 'pov';
  const capCfg = () => CAPTURE_MODES[captureMode];

  // Self-hosted demos, served from this same origin. Deliberately not
  // third-party URLs: a preset pointing at someone else's deployment puts
  // this tool's traffic on their servers and breaks whenever they move a
  // path. All three are written to the additive rules the tool teaches
  // (black ground, bright marks, no strokes under 2px); Contrast is the
  // exception, showing a failing half on purpose.
  // Add your own with { name, url }.
  const APP_PRESETS = [
    { name: 'Navigation', url: '/demos/nav/' },
    { name: 'Timer',      url: '/demos/timer/' },
    { name: 'Contrast',   url: '/demos/contrast/' },
  ];

  // Dynamically compute how many chips fit on one row, so we don't
  // break when presets or fonts change. Any extra chips are hidden behind
  // the "see more" toggle.
  // Background scenes: first-person footage shot on Ray-Ban Meta glasses,
  // so the framing and camera height match what the wearer actually sees.
  // Native 3:4 portrait: the stage cover-crops to a central band, and the
  // scene can be dragged to re-frame. Each has a poster in posters/ so the
  // tile grid costs 21 small JPEGs instead of 21 video metadata fetches.
  // Ordered brightest-first: the top three are the hard legibility cases.
  const BG_PRESETS = [
    { name: 'City Sidewalk', file: 'background/city-sidewalk.mp4' },
    { name: 'Cooking',       file: 'background/cooking.mp4'       },
    { name: 'Street Walk',   file: 'background/street-walk.mp4'   },
    { name: 'Promenade',     file: 'background/promenade.mp4'     },
    { name: 'Coffee',        file: 'background/coffee.mp4'        },
    { name: 'Rooftop',       file: 'background/rooftop.mp4'       },
    { name: 'Subway',        file: 'background/subway.mp4'        },
    { name: 'Cafe Desk',     file: 'background/cafe-desk.mp4'     },
    { name: 'City Driving',  file: 'background/city-driving.mp4'  },
    { name: 'Highway',       file: 'background/highway.mp4'       },
    { name: 'Library',       file: 'background/library.mp4'       },
    { name: 'Lobby',         file: 'background/lobby.mp4'         },
    { name: 'Studio',        file: 'background/studio.mp4'        },
    { name: 'Trail',         file: 'background/trail.mp4'         },
    { name: 'Harbor',        file: 'background/harbor.mp4'        },
    { name: 'Laundromat',    file: 'background/laundromat.mp4'    },
    { name: 'Workshop',      file: 'background/workshop.mp4'      },
    { name: 'Event',         file: 'background/event.mp4'         },
    { name: 'Commute',       file: 'background/commute.mp4'       },
    { name: 'Corridor',      file: 'background/corridor.mp4'      },
  ];

  // posters/<slug>.jpg, generated from each clip at t=3s.
  const posterFor = (file) =>
    file.replace('background/', 'background/posters/').replace(/\.mp4$/, '.jpg');

  // First N presets are visible without expanding.
  const BG_INITIAL = 3;

  const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogg)$/i;
  const isVideoFile = (file) => VIDEO_EXT_RE.test(file);

  /* ── DOM refs (continued) ─────────────────────────────────────── */
  const shareBtn      = document.getElementById('share-btn');
  const shareToast    = document.getElementById('share-toast');
  const qrBtn          = document.getElementById('qr-btn');
  const qrModal        = document.getElementById('qr-modal');
  const qrClose        = document.getElementById('qr-close');
  const qrOutput       = document.getElementById('qr-output');
  const qrModeSeg      = document.getElementById('qr-mode-seg');
  const qrInstrGlasses = document.getElementById('qr-instr-glasses');
  const qrInstrSim     = document.getElementById('qr-instr-simulator');
  const qrInstrWrap    = document.querySelector('.qr-instr-wrap');
  const bgSeeMore     = document.getElementById('bg-see-more');
  const appSeeMore    = document.getElementById('app-see-more');
  const captureFmt     = document.getElementById('capture-fmt');
  const fmtPopover     = document.getElementById('fmt-popover');
  const fmtPopTitle    = document.getElementById('fmt-pop-title');
  const fmtPopClose    = document.getElementById('fmt-pop-close');
  const screenshotBtn = document.getElementById('screenshot-btn');
  const recordBtn     = document.getElementById('record-btn');
  const recLabel      = recordBtn.querySelector('.rec-label');
  const stopRecBtn    = document.getElementById('stop-recording-btn');
  const captureToast  = document.getElementById('capture-toast');
  const ctIcon        = captureToast.querySelector('.ct-icon');
  const ctTitle       = captureToast.querySelector('.ct-title');
  const ctDetail      = captureToast.querySelector('.ct-detail');

  /* ── State ─────────────────────────────────────────────────────── */
  // The display is the active profile's authored pixels, drawn at `displayPx`
  // wide and positioned as a percentage of the stage. Replaces the old
  // three-anchor model; see the WASD design doc.
  const NATIVE_W = DEVICE.panel.w, NATIVE_H = DEVICE.panel.h;
  let displayPx   = 380;                // rendered width in CSS px
  let scaleRatio  = displayPx / NATIVE_W;
  let dispX       = 68;                 // percent across the stage
  let dispY       = 40;                 // percent down the stage
  let activeClip  = 0;
  let sceneFit    = 'contain'; // 'contain' | 'cover'

  /* Which layout we are in. Must match the mobile @media selector in
     wasd.css, or the JS will size the display for a sheet the CSS has not
     made, or leave a landscape phone with the desktop panel. */
  const MOBILE_MQ  = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';
  const mobileMQL  = window.matchMedia(MOBILE_MQ);
  const isMobile   = () => mobileMQL.matches;
  // Where the display sat before the phone layout took it over, so widening
  // a window back past the breakpoint returns it rather than stranding it.
  let desktopPlacement = null;
  // Set once the user picks Fill or Whole by hand; after that the phone
  // layout stops overriding the choice on every sheet toggle.
  let fitChosenByUser = false;

  /* ── Display geometry ─────────────────────────────────────────── */
  // Split into a pure visual mover and the user-facing setter so the capture
  // path can re-centre the display without disturbing the saved position.
  function applyDisplayPosStyles(xPct, yPct) {
    // Placement goes through the custom properties the stylesheet's calc()
    // reads, not through left/top directly: X has to be measured against the
    // stage box rather than #sim-viewport, which widens when the panel is
    // hidden. Clearing left/top drops any inline pair the capture path left
    // behind and hands placement back to the stylesheet.
    wrap.style.setProperty('--disp-x', xPct);
    wrap.style.setProperty('--disp-y', yPct);
    wrap.style.left      = '';
    wrap.style.top       = '';
    wrap.style.right     = 'auto';
    wrap.style.bottom    = 'auto';
    wrap.style.transform = 'translate(-50%, -50%) translateZ(0)';
  }

  function setDisplayPos(xPct, yPct) {
    dispX = xPct; dispY = yPct;
    applyDisplayPosStyles(dispX, dispY);
    if (slPosX) { slPosX.value = xPct; lblPosX.textContent = xPct + '%'; }
    if (slPosY) { slPosY.value = yPct; lblPosY.textContent = yPct + '%'; }
  }

  function applyScale(px) {
    displayPx  = px;
    scaleRatio = px / NATIVE_W;
    wrap.style.width  = px + 'px';
    wrap.style.height = Math.round(px * (NATIVE_H / NATIVE_W)) + 'px';
    // One transform on the authored 600x450 stage scales every app at once.
    if (wgStage) wgStage.style.transform = `scale(${scaleRatio})`;
    if (slSize) { slSize.value = px; lblSize.textContent = px + 'px'; }
    updateAngularReadout();
  }

  /* How much of the layout viewport the browser's own chrome is covering.
     On iOS the toolbar overlays the bottom of the layout viewport and
     position: fixed keeps anchoring to the larger box, which walks the
     bottom sheet off the screen. Publishing the gap as a custom property
     lets the sheet and the exit button sit on the visible edge instead.
     Everywhere else this is 0 and nothing moves. */
  function syncViewportInset() {
    const vv = window.visualViewport;
    if (!vv) return;
    const layoutH = document.documentElement.clientHeight || window.innerHeight;
    const inset = Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--vv-offset', inset + 'px');
  }

  /* Phones get their own defaults. The scene fills the screen rather than
     letterboxing, because a portrait clip inside a taller portrait viewport
     leaves black bands that the display would otherwise sit on top of, and
     the panel is sized from the viewport instead of a fixed 300px, which was
     three quarters of the width on a small phone. */
  function applyMobileLayout() {
    if (!isMobile()) return;
    if (desktopPlacement === null) {
      desktopPlacement = { x: dispX, y: dispY, px: displayPx, fit: sceneFit };
    }
    // Fill is only the phone default. Once Whole has been picked deliberately
    // the choice has to survive a sheet toggle, which calls this on every tap.
    if (!fitChosenByUser) setSceneFit('cover');

    const vw = window.innerWidth;
    // Measure against what is actually on screen, not the layout viewport:
    // mobile browser chrome can cover a hundred-odd pixels of the bottom, and
    // sizing the display to a strip that is partly behind the toolbar is what
    // leaves the HUD stranded against the top edge.
    const layoutH  = document.documentElement.clientHeight || window.innerHeight;
    const vv       = window.visualViewport;
    const visTop   = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
    const visH     = vv ? Math.min(Math.round(vv.height), layoutH) : layoutH;
    // The bottom sheet covers the lower part of the stage, so the display has
    // to fit the strip above it, not the whole viewport. In presentation mode
    // the sheet is gone and the whole screen is available. The sheet's own
    // max-height already accounts for the chrome inset, so measuring it is
    // enough; clamping it here would under-report and overlap the display.
    const sheet  = document.getElementById('sidebar');
    const sheetH = document.body.classList.contains('fullscreen-sim')
      ? 0 : Math.min(sheet.offsetHeight, visH);
    const avail = Math.max(160, visH - sheetH);
    const byWidth  = vw * 0.72;
    const byHeight = (avail - 28) / (NATIVE_H / NATIVE_W); // keep it inside the strip
    applyScale(Math.max(180, Math.min(360, Math.round(Math.min(byWidth, byHeight)))));
    // top is a percentage of the layout viewport, so the visible strip has to
    // be offset back into that coordinate space.
    setDisplayPos(50, Math.round((visTop + avail / 2) / layoutH * 100));
  }

  // Crossing the breakpoint either way: hand the display to the phone layout,
  // or give it back the position it had before the phone layout claimed it.
  mobileMQL.addEventListener('change', e => {
    if (e.matches) { applyMobileLayout(); return; }
    if (!desktopPlacement) return;
    applyScale(desktopPlacement.px);
    setDisplayPos(desktopPlacement.x, desktopPlacement.y);
    // Fill is imposed by the phone layout, so undo it on the way out unless
    // the fit was picked by hand, in which case the choice outranks both.
    if (!fitChosenByUser) setSceneFit(desktopPlacement.fit);
  });

  // Rotating, the URL bar collapsing, or the software keyboard opening all
  // change the strip the display has to fit. Coalesced, because iOS fires
  // these in bursts mid-scroll.
  let mobileLayoutTimer = null;
  function scheduleMobileLayout() {
    clearTimeout(mobileLayoutTimer);
    mobileLayoutTimer = setTimeout(() => {
      if (!isMobile()) return;
      // A capture owns the display's position and size until it finishes.
      if (recState) return;
      // The keyboard shrinking the viewport is not a layout change: reflowing
      // here would shrink the display out from under whoever is typing a URL.
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      applyMobileLayout();
    }, 120);
  }
  window.addEventListener('resize', scheduleMobileLayout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      syncViewportInset(); scheduleMobileLayout();
    });
    window.visualViewport.addEventListener('scroll', syncViewportInset);
  }

  // Collapsing a group changes the sheet height, and so the strip above it.
  document.querySelectorAll('.side-nav .nav-group').forEach(g =>
    g.addEventListener('toggle', () => {
      if (isMobile()) setTimeout(applyMobileLayout, 60);
    }));

  // Position the display for capture. The output frame (see CAPTURE_MODES) is
  // centred in the stage; the display sits at `centerX` within it, right of
  // centre for POV and dead centre for Native. Centring the crop rather than
  // the display maximises the surrounding scene captured and keeps the crop
  // inside the viewport, avoiding black bars. computeHudCrop reads the real
  // rect, so this only has to put the display in the right spot.
  function applyCaptureHudPosition() {
    const cfg    = capCfg();
    const rectH  = displayPx / cfg.ratio;
    const rectW  = rectH * cfg.aspect;
    const shiftX = rectW * (cfg.centerX - 0.5);
    wrap.style.left      = '50%';
    wrap.style.right     = 'auto';
    wrap.style.top       = '50%';
    wrap.style.bottom    = 'auto';
    wrap.style.transform = `translate(calc(-50% + ${shiftX}px), -50%) translateZ(0)`;
  }

  /* ── Capture format: POV vs Native Recording. Affects screenshots /
        recordings only, never the live HUD; the crop reads captureMode at
        capture time via capCfg(). Chosen from the #fmt-popover that the
        Capture/Record buttons open, and remembered so the R shortcut (which
        can't show a popover: the sidebar is hidden in fullscreen) reuses
        the last pick. The popover itself never shows a pre-selection: every
        open requires picking a row to fire the capture, so marking one as
        "already chosen" would be misleading. See CAPTURE_MODES. ───────── */
  const CAP_MODE_KEY = 'display-glasses-capture-mode';

  function setCaptureMode(mode) {
    captureMode = CAPTURE_MODES[mode] ? mode : 'pov';
  }

  /* ── Format popover. `pendingCaptureAction` is what runs once the user
        picks a row, so the choice is made at the moment of capture and the
        sidebar stays short. ─────────────────────────────────────────── */
  let pendingCaptureAction = null;

  function openFormatPicker(action) {
    if (!fmtPopover) { runCaptureAction(action); return; }
    pendingCaptureAction = action;
    fmtPopTitle.textContent = action === 'record' ? 'Record as…' : 'Capture as…';
    fmtPopover.hidden = false;
  }

  function closeFormatPicker() {
    if (!fmtPopover) return;
    fmtPopover.hidden = true;
    pendingCaptureAction = null;
  }

  // Re-clicking the same trigger (Capture/Record) that opened the popover
  // dismisses it, like a standard dropdown toggle. Clicking the OTHER
  // trigger while it's open just retargets it (handled by openFormatPicker
  // overwriting pendingCaptureAction) rather than closing.
  function toggleFormatPicker(action) {
    if (fmtPopover && !fmtPopover.hidden && pendingCaptureAction === action) {
      closeFormatPicker();
    } else {
      openFormatPicker(action);
    }
  }

  function runCaptureAction(action) {
    if (action === 'record') {
      trackEvent('record-start', { url: urlInput.value || '', mode: captureMode });
      startRecording();
    } else {
      takeScreenshot();
    }
  }

  /* ── Load URL ───────────────────────────────────────────────────── */
  function normalizeURL(raw) {
    let url = (raw || '').trim();
    if (!url) return null;
    // Root-relative paths (the bundled demos under /demos/) resolve against
    // this origin. Without this they would be read as a bare hostname and
    // turn into https://demos/nav/.
    if (url.startsWith('/') && !url.startsWith('//')) {
      try { return new URL(url, location.origin).href; } catch (e) { return null; }
    }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.href;
    } catch (e) {
      return null;
    }
  }

  function loadURL(target, source) {
    let url = normalizeURL(target || urlInput.value);
    if (!url) {
      showLoadError();
      return;
    }
    urlInput.value = url;

    let frameResolved = false;
    let frameTimer;

    function resolveFrame(blocked) {
      if (frameResolved) return;
      frameResolved = true;
      clearTimeout(frameTimer);
      if (blocked) {
        showLoadError();
      } else {
        hideLoadError();
      }
    }

    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (doc && doc.readyState === 'complete') {
          resolveFrame(false);
          tryToExtractTitle(url);
          return;
        }
      } catch (e) {
        resolveFrame(false);
        return;
      }
      resolveFrame(false);
    };

    iframe.onerror = () => resolveFrame(true);

    frameTimer = setTimeout(() => {
      if (!frameResolved) resolveFrame(true);
    }, 15000);

    iframe.src = url;
    placeholder.hidden = true;
    wrap.classList.remove('hidden');
    wrap.classList.remove('show-placeholder');
    hideLoadError();

    openApp('web');
    placeholder.hidden = true;

    checkFraming(url).then(verdict => {
      if (verdict && verdict.blocked && iframe.src === url) {
        showLoadError('This site refuses to be embedded (' + verdict.reason +
                      '). Use QR Code to open it on your glasses instead.');
      }
    });
    trackEvent('load-app', { url: url, source: source || 'manual' });

    // Save to last loaded URL
    try {
      localStorage.setItem('display-glasses-last-url', url);
    } catch (e) {}

    const src = source || 'manual';
    if (src === 'manual' || src === 'history') {
      addHistoryItem(url);
    }
  }

  const LOAD_ERROR_DEFAULT = loadError.textContent;

  function showLoadError(message) {
    loadError.textContent = message || LOAD_ERROR_DEFAULT;
    loadError.style.display = 'block';
    clearTimeout(showLoadError._t);
    showLoadError._t = setTimeout(hideLoadError, 9000);
  }
  function hideLoadError() { loadError.style.display = 'none'; }

  /* ── Framing pre-flight ────────────────────────────────────────────
     A blocked frame is indistinguishable from a working cross-origin one
     from in here: contentDocument is null, contentWindow.location throws,
     and length is 0 in both cases, because blocked frames get an opaque
     origin. Only the response headers tell them apart, and CORS puts those
     out of reach, so the check has to happen server-side.

     Best effort by design: on a static host there is no function to answer,
     so a failure just falls through to framing the URL as before. ── */
  function checkFraming(url) {
    if (!/^https?:/i.test(url)) return Promise.resolve(null);
    if (new URL(url).origin === location.origin) return Promise.resolve(null);
    return fetch('/api/can-frame?url=' + encodeURIComponent(url))
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  document.getElementById('load-btn').addEventListener('click', () => loadURL());
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadURL(); });

  slSize.addEventListener('input', () => applyScale(parseInt(slSize.value, 10)));
  slPosX.addEventListener('input', () => setDisplayPos(parseInt(slPosX.value, 10), dispY));
  slPosY.addEventListener('input', () => setDisplayPos(dispX, parseInt(slPosY.value, 10)));

  // Picking a row sets the format, remembers it, and immediately runs the
  // capture the user originally clicked.
  if (captureFmt) {
    captureFmt.addEventListener('click', e => {
      const btn = e.target.closest('button[data-cap]');
      if (!btn) return;
      e.stopPropagation();
      const action = pendingCaptureAction;
      setCaptureMode(btn.dataset.cap);
      try { localStorage.setItem(CAP_MODE_KEY, captureMode); } catch (err) {}
      trackEvent('capture-mode', { mode: captureMode });
      closeFormatPicker();
      if (action) runCaptureAction(action);
    });
  }

  if (fmtPopClose) {
    fmtPopClose.addEventListener('click', e => { e.stopPropagation(); closeFormatPicker(); });
  }

  // Dismiss on any click outside the popover (the trigger buttons stop
  // propagation, so opening one never immediately closes it).
  document.addEventListener('click', e => {
    if (!fmtPopover || fmtPopover.hidden) return;
    if (!fmtPopover.contains(e.target)) closeFormatPicker();
  });

  /* ── History management ────────────────────────────────────────── */
  const STORAGE_KEY = 'display-glasses-url-history';

  function getHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Migrate legacy string array to object array
      return parsed.map(item => {
        if (typeof item === 'string') {
          return { url: item, name: getDisplayUrl(item) };
        }
        return item;
      });
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      // ignore
    }
  }

  function addHistoryItem(url, name) {
    if (!url) return;
    let history = getHistory();
    // Preserve existing title if already saved and we didn't get a new one
    const existing = history.find(item => item.url === url);
    const displayName = name || (existing ? existing.name : getDisplayUrl(url));

    history = history.filter(item => item.url !== url);
    history.unshift({ url, name: displayName });
    if (history.length > 5) {
      history = history.slice(0, 5);
    }
    saveHistory(history);
    buildAppChips();
    markActiveApp(iframe.src);
  }

  function updateHistoryItemTitle(url, title) {
    if (!url || !title) return;
    let history = getHistory();
    let updated = false;
    history.forEach(item => {
      if (item.url === url) {
        if (item.name !== title) {
          item.name = title;
          updated = true;
        }
      }
    });
    if (updated) {
      saveHistory(history);
      buildAppChips();
      markActiveApp(iframe.src);
    }
  }

  function removeHistoryItem(url) {
    let history = getHistory();
    history = history.filter(item => item.url !== url);
    saveHistory(history);
    buildAppChips();
    markActiveApp(iframe.src);
  }

  function getDisplayUrl(url) {
    return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }

  // Best-effort title extraction: only works for same-origin frames.
  // Cross-origin access is blocked by the browser; the catch below
  // handles that silently. Most real-world URLs will hit this path.
  function tryToExtractTitle(url) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const title = doc.title;
      if (title && title.trim()) {
        updateHistoryItemTitle(url, title.trim());
      }
    } catch (e) {
      // Cross-origin fails silently, which is normal for most external websites
    }
  }

  /* ── App preset chips ──────────────────────────────────────────── */
  /* ── In-lens apps ──────────────────────────────────────────────────
     The display runs a tiny launcher. Five apps are rendered as DOM inside
     the 600x450 stage; the sixth frames an arbitrary URL. Keyboard-first,
     because that is what the product is named after and what the real
     device's input model looks like. ── */
  const APPS = [
    { id: 'captions', name: 'Captions', glyph: 'cc'  },
    { id: 'music',    name: 'Music',    glyph: '\u266A' },
    { id: 'nav',      name: 'Navigate', glyph: '\u2197' },
    { id: 'timer',    name: 'Timer',    glyph: '00'  },
    { id: 'prompter', name: 'Prompter', glyph: '\u00B6' },
    { id: 'web',      name: 'Web App',  glyph: '://' }
  ];
  const GRID_COLS = 3;

  const CAPS = [
    'So this is the overlook everyone told us about.',
    'Honestly the drive up here was half the fun.',
    'Can you see the ridge from where you are?',
    'Wait, is that a bald eagle? It is. No way.',
    'Let us grab coffee before the next stretch.',
    'Two hundred miles to the state line from here.'
  ];
  const NAVSTEPS = [
    { arrow: '\u2197', street: 'Turn right on Canyon Rd' },
    { arrow: '\u2191', street: 'Continue on US-101 N' },
    { arrow: '\u2196', street: 'Turn left on Ocean Ave' },
    { arrow: '\u2191', street: 'Keep straight for 1.2 mi' }
  ];

  let currentApp = 'home';
  let focusIdx   = 0;
  let capIdx     = 0;
  let musicPlaying = true, musicPos = 47;
  let navDist = 400, navStep = 0;
  let timerRun = false, timerMs = 0;

  function buildLauncher() {
    hmGrid.innerHTML = '';
    APPS.forEach((a, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'hm-tile' + (i === focusIdx ? ' focused' : '');
      tile.setAttribute('role', 'menuitem');
      tile.innerHTML = `<span class="glyph">${a.glyph}</span><span class="name">${a.name}</span>`;
      tile.addEventListener('click', () => { focusIdx = i; openApp(a.id); });
      hmGrid.appendChild(tile);
    });
  }

  function markFocus() {
    hmGrid.querySelectorAll('.hm-tile').forEach((t, i) =>
      t.classList.toggle('focused', i === focusIdx));
  }

  function buildAppChips() {
    appChips.innerHTML = '';
    [{ id: 'home', name: 'HOME' }]
      .concat(APPS.map(a => ({ id: a.id, name: a.name.toUpperCase() })))
      .forEach(a => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'app-chip' + (a.id === currentApp ? ' active' : '');
        chip.dataset.appId = a.id;
        chip.textContent = a.name;
        chip.addEventListener('click', () => openApp(a.id));
        appChips.appendChild(chip);
      });
  }

  function markActiveApp() {
    appChips.querySelectorAll('.app-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.appId === currentApp));
  }

  function openApp(id) {
    currentApp = id;
    document.querySelectorAll('.wg-stage .wg-app').forEach(el => {
      el.hidden = el.id !== ('app-' + id);
    });
    const i = APPS.findIndex(a => a.id === id);
    if (i >= 0) { focusIdx = i; markFocus(); }
    markActiveApp();
    // The prompter restarts its scroll each time it is opened, otherwise it
    // resumes mid-sentence from a previous visit.
    if (id === 'prompter' && prScroll) {
      prScroll.style.animation = 'none';
      void prScroll.offsetWidth;
      prScroll.style.animation = '';
    }
  }

  /* One 100ms tick drives every live app, so they stay in step and there is
     a single timer to stop. */
  function tick() {
    const now = new Date();
    hmTime.textContent = String(now.getHours()).padStart(2, '0') + ':' +
                         String(now.getMinutes()).padStart(2, '0');
    hmDate.textContent = now.toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();

    if (currentApp === 'captions') {
      tick.n = (tick.n || 0) + 1;
      if (tick.n % 30 === 0) {
        capIdx++;
        capLine.textContent = CAPS[capIdx % CAPS.length];
        capPrev.textContent = CAPS[(capIdx + CAPS.length - 1) % CAPS.length];
        capLine.style.animation = 'none'; void capLine.offsetWidth; capLine.style.animation = '';
      }
    }
    if (musicPlaying) {
      musicPos = (musicPos + 0.1) % 214;
      muFill.style.width = ((musicPos / 214) * 100).toFixed(1) + '%';
      muTime.textContent = Math.floor(musicPos / 60) + ':' +
                           String(Math.floor(musicPos % 60)).padStart(2, '0');
    }
    if (currentApp === 'nav') {
      navDist -= 2;
      if (navDist <= 0) { navDist = 400; navStep = (navStep + 1) % NAVSTEPS.length; }
      nvDist.textContent = navDist;
      nvArrow.textContent = NAVSTEPS[navStep].arrow;
      nvStreet.textContent = NAVSTEPS[navStep].street;
    }
    if (timerRun) {
      timerMs += 100;
      const m = Math.floor(timerMs / 60000),
            sec = Math.floor((timerMs % 60000) / 1000),
            ds = Math.floor((timerMs % 1000) / 100);
      tmText.textContent = String(m).padStart(2, '0') + ':' +
                           String(sec).padStart(2, '0') + '.' + ds;
    }
  }

  function actOnApp() {
    if (currentApp === 'music') {
      musicPlaying = !musicPlaying;
      muState.textContent = musicPlaying ? '\u25B6 playing' : '\u2016 paused';
    } else if (currentApp === 'timer') {
      timerRun = !timerRun;
    } else if (currentApp === 'nav') {
      navDist = 400;
    }
  }

  /* Keyboard model. WASD and the arrows move focus on the home grid; ENTER
     opens or acts; ESC returns home. R resets the timer while the Timer app
     is open and otherwise keeps its old meaning of starting a recording,
     which is why the panel documents it as Shift+R. */
  function handleAppKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape') { openApp('home'); return true; }

    if (currentApp === 'home') {
      let f = focusIdx;
      if (k === 'a' || k === 'arrowleft')       f = Math.max(0, focusIdx - 1);
      else if (k === 'd' || k === 'arrowright') f = Math.min(APPS.length - 1, focusIdx + 1);
      else if (k === 'w' || k === 'arrowup')    f = Math.max(0, focusIdx - GRID_COLS);
      else if (k === 's' || k === 'arrowdown')  f = Math.min(APPS.length - 1, focusIdx + GRID_COLS);
      else if (k === 'enter') { openApp(APPS[focusIdx].id); return true; }
      if (f !== focusIdx) { focusIdx = f; markFocus(); return true; }
      return false;
    }

    if (k === 'enter') { actOnApp(); return true; }
    if (k === 'r' && currentApp === 'timer' && !e.shiftKey) {
      timerRun = false; timerMs = 0; tmText.textContent = '00:00.0';
      return true;
    }
    return false;
  }

  /* ── Background pan ────────────────────────────────────────────── */
  let bgOffset = { x: 50, y: 50 };

  function applyBgPosition() {
    const pos = `${bgOffset.x}% ${bgOffset.y}%`;
    bgImg.style.objectPosition = pos;
    bgVid.style.objectPosition = pos;
  }

  function resetBgPosition() {
    bgOffset = { x: 50, y: 50 };
    applyBgPosition();
  }

  /* ── Background presets ────────────────────────────────────────── */
  // `name` is the preset label, used for the img alt text. Uploaded files
  // and deep-linked URLs have no label, so they fall back to a generic
  // description rather than leaking a filename.
  // `kind` is 'video' | 'image' when known (an uploaded File tells us its
  // MIME type). Otherwise fall back to the extension, which is only a guess:
  // a blob: URL has no extension at all, which is why an uploaded clip used
  // to be handed to <img> and render as a black rectangle.
  function setBackgroundFromUrl(url, name, kind) {
    scene.style.backgroundColor = '';
    const asVideo = kind ? kind === 'video' : isVideoFile(url);
    if (asVideo) {
      bgVid.src = url;
      bgVid.style.display = 'block';
      bgImg.style.display = 'none';
      bgImg.removeAttribute('src');
      bgVid.play().catch(() => {});
    } else {
      bgImg.src = url;
      bgImg.alt = name
        ? `${name}: background scene behind the simulated glasses display`
        : 'Background scene behind the simulated glasses display';
      bgImg.style.display = 'block';
      bgVid.style.display = 'none';
      bgVid.removeAttribute('src');
    }
    resetBgPosition();
  }

  function setBackgroundColor(color) {
    bgImg.style.display = 'none';
    bgVid.style.display = 'none';
    bgImg.removeAttribute('src');
    bgVid.removeAttribute('src');
    scene.style.backgroundColor = color;
  }

  /* ── Playlist ──────────────────────────────────────────────────────
     The bundled scenes seed the list; dropped files and pasted URLs append
     to it. Presets keep a flag so share links can name them rather than
     serialising a blob: URL that means nothing to the recipient. ── */
  const CLIPS = BG_PRESETS.map(p => ({ name: p.name, src: p.file, kind: 'video', preset: true }));
  const CLIP_INITIAL = 6;

  function buildPlaylist() {
    playlistEl.innerHTML = '';
    CLIPS.forEach((c, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'clip-row' + (i === activeClip ? ' active' : '') +
                      (i >= CLIP_INITIAL ? ' clip-extra' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === activeClip));
      row.title = c.name;

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1).padStart(2, '0');
      const nm = document.createElement('span');
      nm.className = 'name';
      nm.textContent = c.name;
      row.append(num, nm);

      row.addEventListener('click', () => selectClip(i));
      playlistEl.appendChild(row);
    });
    bgSeeMore.hidden = CLIPS.length <= CLIP_INITIAL;
    stageEmpty.hidden = CLIPS.length > 0;
  }

  function selectClip(i) {
    if (!CLIPS[i]) return;
    activeClip = i;
    const c = CLIPS[i];
    setBackgroundFromUrl(c.src, c.name, c.kind);
    clipLabel.textContent = c.name;
    playlistEl.querySelectorAll('.clip-row').forEach((r, n) => {
      r.classList.toggle('active', n === i);
      r.setAttribute('aria-selected', String(n === i));
    });
  }

  function addClips(list) {
    const added = Array.from(list)
      .filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'))
      .map(f => ({
        name: f.name,
        src: URL.createObjectURL(f),
        kind: f.type.startsWith('video/') ? 'video' : 'image',
        preset: false
      }));
    if (!added.length) return;
    const firstNew = CLIPS.length;
    CLIPS.push(...added);
    buildPlaylist();
    selectClip(firstNew);
  }

  bgSeeMore.addEventListener('click', () => {
    const expanded = playlistEl.classList.toggle('expanded');
    bgSeeMore.textContent = expanded ? 'see less' : 'see more';
  });

  function setSceneFit(mode) {
    sceneFit = mode;
    document.body.classList.toggle('scene-contain', mode === 'contain');
    fitSeg.querySelectorAll('button').forEach(b => {
      const on = b.dataset.fit === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  fitSeg.addEventListener('click', e => {
    const b = e.target.closest('button[data-fit]');
    if (!b) return;
    fitChosenByUser = true;   // stop the phone layout resetting it to Fill
    setSceneFit(b.dataset.fit);
  });

  dropZone.addEventListener('click', () => fileInput.click());
  // Hosts that stream through a player rather than serving a file. Their
  // watch URLs are HTML pages, so <video src> can never play them.
  const PLAYER_PAGE_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv)$/i;

  clipAddBtn.addEventListener('click', () => {
    const raw = clipUrlInput.value.trim();
    if (!raw) return;
    const url = normalizeURL(raw);
    if (!url) { showLoadError('That does not look like a URL.'); return; }
    if (PLAYER_PAGE_RE.test(new URL(url).hostname)) {
      showLoadError('That is a video page, not a video file. Paste a direct link ending in .mp4, .webm or .mov, or drop the file in.');
      return;
    }
    CLIPS.push({ name: url.split('/').pop() || url, src: url, preset: false });
    clipUrlInput.value = '';
    buildPlaylist();
    selectClip(CLIPS.length - 1);
  });
  clipUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') clipAddBtn.click(); });

  bgVid.addEventListener('error', () => {
    const c = CLIPS[activeClip];
    showLoadError('That video could not be played' + (c ? ' (' + c.name + ')' : '') +
                  '. It may be an unsupported codec, or a page rather than a file.');
  });
  bgImg.addEventListener('error', () => {
    showLoadError('That image could not be loaded.');
  });

  // Advance the playlist when a non-looping clip finishes.
  bgVid.addEventListener('ended', () => {
    if (CLIPS.length > 1) selectClip((activeClip + 1) % CLIPS.length);
  });

  /* ── Drag-and-drop footage ─────────────────────────────────────── */
  document.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('drag-active');
  });
  document.addEventListener('dragleave', e => {
    if (e.relatedTarget === null) document.body.classList.remove('drag-active');
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('drag-active');
    if (e.dataTransfer.files.length) addClips(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files.length) addClips(e.target.files);
    e.target.value = '';
  });

  /* ── Background drag-to-pan (within sim viewport) ─────────────── */
  let bgDragging = false;
  let bgDragStart = {};

  scene.addEventListener('mousedown', e => {
    if (e.target === bgImg || e.target === bgVid || e.target === scene) {
      bgDragging = true;
      bgDragStart = { mx: e.clientX, my: e.clientY, ox: bgOffset.x, oy: bgOffset.y };
      scene.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', e => {
    if (!bgDragging) return;
    const rect = simViewport.getBoundingClientRect();
    const dx = (bgDragStart.mx - e.clientX) / rect.width  * 100;
    const dy = (bgDragStart.my - e.clientY) / rect.height * 100;
    bgOffset.x = Math.max(0, Math.min(100, bgDragStart.ox + dx));
    bgOffset.y = Math.max(0, Math.min(100, bgDragStart.oy + dy));
    applyBgPosition();
  });

  document.addEventListener('mouseup', () => {
    if (bgDragging) {
      bgDragging = false;
      scene.style.cursor = '';
    }
  });

  /* ── Sliders ───────────────────────────────────────────────────── */
  // Physical display model: perceived HUD opacity is derived from display
  // nits and ambient lux rather than an arbitrary percentage. High ambient
  // light washes out the waveguide image: this models that relationship.
  // Default ambient: 500 lux (office lighting). The nits range and starting
  // point belong to the device, so they come from the active profile rather
  // than the markup.
  slNits.min   = DEVICE.luminance.min;
  slNits.max   = DEVICE.luminance.max;
  slNits.step  = DEVICE.luminance.step;
  slNits.value = DEVICE.luminance.start;

  // Ambient illuminance (lux) falling on a scene becomes luminance (nits)
  // reflected back toward the eye. lux/π is that conversion for a perfect
  // diffuse reflector; the waveguide adds its own light on top, so the
  // contrast the wearer actually perceives is (display + ambient) / ambient.
  function computeContrastRatio(nits, lux) {
    const bgNits = lux / Math.PI;
    return (nits + bgNits) / Math.max(bgNits, 0.01);
  }

  function computeHudOpacity(nits, lux) {
    const contrast = computeContrastRatio(nits, lux);
    return Math.max(0.3, Math.min(1.0, 1.0 - 1.0 / (contrast * 0.5 + 0.5)));
  }

  function updateAngularReadout() {
    const angularW = (DEVICE.fovDeg * scaleRatio).toFixed(1);
    lblAngular.textContent = `~${angularW}°`;
  }

  function applyHudBrightness() {
    const nits = parseInt(slNits.value, 10);
    const lux  = parseInt(slAmbient.value, 10);
    wrap.style.opacity = computeHudOpacity(nits, lux);

    lblNits.textContent = `${nits} nits`;
    lblAmbient.textContent = `${lux} lux`;
    // Screen readers announce the unit, not a bare number.
    slNits.setAttribute('aria-valuetext', `${nits} nits`);
    slAmbient.setAttribute('aria-valuetext', `${lux} lux`);

    const cr = computeContrastRatio(nits, lux);
    lblContrast.textContent = `${cr.toFixed(1)} : 1`;
    // Same bands the pill is coloured by: usable / marginal / washed out.
    lblContrast.classList.toggle('warn', cr < 3 && cr >= 1.5);
    lblContrast.classList.toggle('bad', cr < 1.5);

    updateAngularReadout();
  }

  slNits.addEventListener('input', applyHudBrightness);
  slAmbient.addEventListener('input', applyHudBrightness);

  toggleGlow.addEventListener('change', function () {
    document.body.classList.toggle('glow', this.checked);
  });
  toggleVignette.addEventListener('change', function () {
    document.body.classList.toggle('no-vignette', !this.checked);
  });

  toggleArtifacts.addEventListener('change', function () {
    document.body.classList.toggle('show-artifacts', this.checked);
  });

  function applySceneFilter() {
    const brightness = (100 - slBgDark.value) / 100;
    const blur = parseInt(slBgBlur.value, 10);
    scene.style.filter = blur > 0
      ? `brightness(${brightness}) blur(${blur}px)`
      : `brightness(${brightness})`;
  }

  slBgDark.addEventListener('input', function () {
    applySceneFilter();
    lblBgDark.textContent = this.value + '%';
  });
  slBgBlur.addEventListener('input', function () {
    applySceneFilter();
    lblBgBlur.textContent = this.value + 'px';
  });

  /* ── Fullscreen sim mode (sidebar hidden, HUD focused) ─────────
        Once focus is inside the (likely cross-origin) iframe, the parent
        can't capture key events anymore, so 'H' alone can't reopen the
        sidebar. The floating #exit-fullscreen-btn is the escape hatch.
        It fades out when idle so it stays out of screen recordings, and
        re-appears on any mouse activity in the sim viewport. ──────── */
  let exitBtnHideTimer = null;
  // Reveals the idle-fading floating controls: the exit button (fullscreen)
  // and the stop button (recording). The `show-exit-btn` flag is shared;
  // the CSS scopes each button to its own body state.
  function pingExitBtn() {
    if (!document.body.classList.contains('fullscreen-sim') &&
        !document.body.classList.contains('recording')) return;
    document.body.classList.add('show-exit-btn');
    clearTimeout(exitBtnHideTimer);
    exitBtnHideTimer = setTimeout(() => {
      document.body.classList.remove('show-exit-btn');
    }, 4000);
  }

  function setFullscreenSim(on) {
    document.body.classList.toggle('fullscreen-sim', on);
    if (on) {
      pingExitBtn();
      // Defer one tick: the iframe is briefly inert mid-toggle on some
      // browsers. Focus both the iframe element AND its contentWindow so
      // keyboard events (arrow keys, space, etc.) actually reach the
      // embedded app's window listeners, not just the iframe wrapper.
      setTimeout(() => {
        iframe.focus();
        try { iframe.contentWindow && iframe.contentWindow.focus(); } catch (e) { /* noop */ }
      }, 0);
    } else {
      document.body.classList.remove('show-exit-btn');
      clearTimeout(exitBtnHideTimer);
      iframe.blur();
    }
    // Showing or hiding the sheet changes how much stage is visible, so the
    // phone layout has to be recomputed once the toggle has settled.
    if (isMobile()) {
      setTimeout(applyMobileLayout, 60);
    }
  }

  document.addEventListener('keydown', e => {
    if (document.activeElement === urlInput) return;
    // The QR modal is the topmost layer, so it gets first claim on the
    // keyboard: Escape closes it, everything else is swallowed.
    if (qrModal && !qrModal.hidden) {
      if (e.key === 'Escape') closeQRModal();
      return;
    }
    // While the format popover is up it owns the keyboard: Escape dismisses,
    // everything else is ignored so H/R can't fire behind it.
    if (fmtPopover && !fmtPopover.hidden) {
      if (e.key === 'Escape') closeFormatPicker();
      return;
    }
    // The in-lens apps get first claim, so WASD/ENTER/ESC drive the display.
    if (handleAppKey(e)) { e.preventDefault(); return; }

    if (e.key === 'h' || e.key === 'H') {
      setFullscreenSim(!document.body.classList.contains('fullscreen-sim'));
    } else if ((e.key === 'r' || e.key === 'R') && e.shiftKey) {
      // Toggle screen recording. Note: once focus is inside the (likely
      // cross-origin) iframe, key events stop reaching the parent; same
      // caveat as the H shortcut. Click anywhere outside the HUD to
      // restore parent focus, then press R.
      // Skips the format popover (the sidebar is hidden in fullscreen, where
      // this shortcut is mainly used) and reuses the remembered format.
      if (recState) stopRecording();
      else runCaptureAction('record');
    }
  }, true);

  exitFsBtn.addEventListener('click', (e) => { e.stopPropagation(); setFullscreenSim(false); });
  stopRecBtn.addEventListener('click', (e) => { e.stopPropagation(); stopRecording(); });
  document.getElementById('hide-sidebar-btn').addEventListener('click', () => setFullscreenSim(true));
  // Document-level listener so any mouse movement outside the iframe
  // revives the button: listening on simViewport alone misses movement
  // that bubbles through pointer-events: none and never sees iframe-
  // internal moves anyway.
  document.addEventListener('mousemove', pingExitBtn);
  // Mobile: any touch keeps the exit-button visible for 4 s
  document.addEventListener('touchstart', pingExitBtn, { passive: true });

  // Iframe steals focus on click; reclaim it on outside clicks so "h" still works.
  document.addEventListener('click', e => {
    if (e.target !== iframe) iframe.blur();
  }, true);

  // Mobile: tapping the scene (anywhere outside the sidebar) collapses the bottom sheet
  document.addEventListener('click', (e) => {
    if (!isMobile()) return;
    if (document.body.classList.contains('fullscreen-sim')) return;
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl && !sidebarEl.contains(e.target)) {
      setFullscreenSim(true);
    }
  });

  // Mobile: tapping the HUD placeholder brings the menu back.
  // stopPropagation prevents the tap-to-hide document handler from
  // immediately re-triggering fullscreen after we close it.
  placeholder.addEventListener('click', (e) => {
    if (isMobile() &&
        document.body.classList.contains('fullscreen-sim')) {
      e.stopPropagation();
      setFullscreenSim(false);
    }
  });

  /* ── Share / deep-link ─────────────────────────────────────────── */
  function buildShareURL() {
    const p = new URLSearchParams();
    const appUrl = urlInput.value.trim();
    if (appUrl) p.set('url', appUrl);
    // Only when it is not the default, so ordinary links stay short.
    if (DEVICE !== DEVICES[DEFAULT_DEVICE]) p.set('device', requestedDevice);
    p.set('x', dispX);
    p.set('y', dispY);
    p.set('size',     displayPx);
    if (captureMode !== 'pov') p.set('cap', captureMode);
    p.set('nits',      slNits.value);
    p.set('ambient',   slAmbient.value);
    const ac = CLIPS[activeClip];
    if (ac && ac.preset) p.set('bg', ac.name.toLowerCase());
    if (sceneFit !== 'contain') p.set('fit', sceneFit);
    p.set('bg-dark', slBgDark.value);
    if (parseInt(slBgBlur.value, 10) > 0) p.set('bg-blur', slBgBlur.value);
    return `${location.origin}${location.pathname}?${p.toString()}`;
  }

  function readStateFromURL() {
    const p = new URLSearchParams(location.search);
    // ?device= is read at boot rather than restored here, and on its own it is
    // not shared state: someone trying a second profile should land on the
    // normal page with the controls, not in fullscreen sim.
    p.delete('device');
    if (!p.toString()) return; // nothing to restore

    if (p.has('x') || p.has('y')) {
      const x = p.has('x') ? Math.max(20, Math.min(85, parseInt(p.get('x'), 10))) : dispX;
      const y = p.has('y') ? Math.max(20, Math.min(80, parseInt(p.get('y'), 10))) : dispY;
      setDisplayPos(x, y);
    }
    if (p.has('size')) {
      const px = parseInt(p.get('size'), 10);
      if (px >= 200 && px <= 560) applyScale(px);
    }
    if (p.has('cap')) {
      const cap = p.get('cap');
      if (CAPTURE_MODES[cap]) setCaptureMode(cap);
    }
    const lum = DEVICE.luminance;
    if (p.has('bright')) {
      // Legacy brightness param: 30% is the dimmest the device goes, 100% the
      // brightest, mapped onto whatever range the profile declares.
      const v = Math.max(30, Math.min(100, parseInt(p.get('bright'), 10)));
      slNits.value = Math.round(lum.min + (v - 30) / 70 * (lum.max - lum.min));
    }
    if (p.has('nits')) {
      slNits.value = Math.max(lum.min, Math.min(lum.max, parseInt(p.get('nits'), 10)));
    }
    if (p.has('ambient')) {
      slAmbient.value = Math.max(50, Math.min(30000, parseInt(p.get('ambient'), 10)));
    }
    applyHudBrightness();
    if (p.has('bg')) {
      const key = p.get('bg');
      const idx = CLIPS.findIndex(c => c.name.toLowerCase() === key);
      if (idx >= 0) selectClip(idx);
    }
    if (p.get('fit') === 'cover') setSceneFit('cover');
    if (p.has('bg-dark')) {
      const v = Math.max(0, Math.min(90, parseInt(p.get('bg-dark'), 10)));
      slBgDark.value = v;
      scene.style.filter = `brightness(${(100 - v) / 100})`;
      lblBgDark.textContent = v + '%';
    } else if (p.has('bg-bright')) {
      const bright = Math.max(10, Math.min(100, parseInt(p.get('bg-bright'), 10)));
      const v = 100 - bright;
      slBgDark.value = v;
      scene.style.filter = `brightness(${bright / 100})`;
      lblBgDark.textContent = v + '%';
    }
    if (p.has('bg-blur')) {
      const v = Math.max(0, Math.min(12, parseInt(p.get('bg-blur'), 10)));
      slBgBlur.value = v;
      lblBgBlur.textContent = v + 'px';
      applySceneFilter();
    }
    if (p.has('url')) {
      // Pre-fill the URL bar instead of auto-loading; this prevents drive-by
      // framing of arbitrary URLs from shared links. User must click Load.
      urlInput.value = p.get('url');
      // Don't call loadURL here; the user confirms the framing.
    }

    // Shared links always open in fullscreen sim mode.
    setFullscreenSim(true);
  }

  let shareToastTimer = null;
  function flashToast(text, duration, onHide) {
    shareToast.textContent = text;
    shareToast.classList.add('visible');
    clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(() => {
      shareToast.classList.remove('visible');
      if (onHide) onHide();
    }, duration);
  }

  /* ── Capture result snackbar: used for screenshot/recording outcomes.
        Independent of the sidebar (which is hidden during a capture), so
        the message is visible whether or not the sidebar is showing. ── */
  let captureToastTimer = null;
  function showCaptureToast(title, detail, isError) {
    ctIcon.textContent  = isError ? '!' : '✓';
    ctTitle.textContent = title;
    ctDetail.textContent = detail || '';
    captureToast.classList.toggle('error', !!isError);
    captureToast.classList.add('visible');
    clearTimeout(captureToastTimer);
    captureToastTimer = setTimeout(() => {
      captureToast.classList.remove('visible');
    }, isError ? 3400 : 4400);
  }

  shareBtn.addEventListener('click', () => {
    const url = buildShareURL();
    trackEvent('share', { url: urlInput.value || '' });
    navigator.clipboard.writeText(url).then(() => {
      // Hide toast, then auto-trigger fullscreen so the sender sees the clean sim
      flashToast('Link copied to clipboard!', 1400, () => setFullscreenSim(true));
    });
  });

  /* ── QR Code modal ─────────────────────────────────────────────── */
  let qrMode = 'glasses'; // 'glasses' | 'simulator'

  // Render well above any size we display at, then let CSS scale it down; the
  // code is only ever downscaled (crisp), never upscaled (blurred), so one
  // render serves every viewport.
  const QR_RENDER_PX = 1024;

  function getAppName(appUrl) {
    const activeChip = document.querySelector('#app-chips .app-chip.active');
    if (activeChip) {
      const chipText = activeChip.querySelector('.chip-text');
      return (chipText ? chipText.textContent : activeChip.textContent).trim();
    }
    // Otherwise use the leading hostname label, dropping the domain suffix:
    // Meta's examples pair appName=my-glasses-app with
    // appUrl=https://my-glasses-app.vercel.app, so "stage-app.vercel.app" would
    // be a poor display name. It's only a label: renameable in the Meta AI app.
    try {
      return new URL(appUrl).hostname.replace(/^www\./, '').split('.')[0];
    } catch (e) { return appUrl; }
  }

  function renderQRCode(content) {
    qrOutput.innerHTML = '';
    if (!window.QRCode) {
      qrOutput.innerHTML = '<p class="qr-no-url">QR library not loaded. Check your connection.</p>';
      return;
    }
    new window.QRCode(qrOutput, {
      text: content,
      width: QR_RENDER_PX,
      height: QR_RENDER_PX,
      colorDark: '#1c1e21',
      colorLight: '#ffffff',
      // Lowest error correction, matching Meta's own qr_generator.py default.
      // The failure mode here is camera resolution, not a damaged code: the
      // glasses camera is low-res, and less redundancy means fewer modules,
      // so each one is physically larger and easier to resolve.
      correctLevel: window.QRCode.CorrectLevel.L,
    });
  }

  function applyQRMode(mode) {
    qrMode = mode;
    // Update toggle pill
    qrModeSeg.querySelectorAll('button').forEach(b => {
      const active = b.dataset.mode === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });

    const appUrl = urlInput.value.trim();
    // Both instructions describe scanning a code that isn't there; hide the
    // whole block, or its divider is left floating under the prompt.
    qrInstrWrap.hidden = !appUrl;
    if (!appUrl) {
      qrOutput.innerHTML = '<p class="qr-no-url">No app loaded yet. Paste a URL above to generate a QR code.</p>';
      qrInstrGlasses.hidden = true;
      qrInstrSim.hidden = true;
      return;
    }

    const appName = getAppName(appUrl);
    if (mode === 'glasses') {
      const deepLink = 'fb-viewapp://web_app_deep_link?' +
        'appName=' + encodeURIComponent(appName) +
        '&appUrl=' + encodeURIComponent(appUrl);
      renderQRCode(deepLink);
      qrInstrGlasses.hidden = false;
      qrInstrSim.hidden = true;
    } else {
      renderQRCode(buildShareURL());
      qrInstrGlasses.hidden = true;
      qrInstrSim.hidden = false;
    }
  }

  function openQRModal() {
    const appUrl = urlInput.value.trim();
    qrModal.hidden = false;
    applyQRMode(qrMode); // renders the code, or the no-URL prompt
    if (appUrl) trackEvent('qr-open', { url: appUrl });
  }

  function closeQRModal() {
    qrModal.hidden = true;
  }

  qrModeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (btn) applyQRMode(btn.dataset.mode);
  });
  qrBtn.addEventListener('click', (e) => { e.stopPropagation(); openQRModal(); });
  qrClose.addEventListener('click', (e) => { e.stopPropagation(); closeQRModal(); });
  qrModal.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target === qrModal) closeQRModal();
  });

  /* ── Display-capture constraints + helper. Ask for as much resolution
        and as high a frame rate as the browser will give; then re-apply
        constraints to the track's reported maximum, since some browsers
        ignore initial `ideal` hints from getDisplayMedia. ────────────── */
  const DISPLAY_CONSTRAINTS = {
    video: {
      displaySurface: 'browser',
      frameRate: { ideal: 60, max: 60 },
      width:     { ideal: 3840 },
      height:    { ideal: 2160 },
    },
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    audio: false,
  };

  async function maximizeTrack(track) {
    if (!track.getCapabilities || !track.applyConstraints) return;
    const caps = track.getCapabilities() || {};
    const target = {};
    if (caps.width  && caps.width.max)  target.width     = caps.width.max;
    if (caps.height && caps.height.max) target.height    = caps.height.max;
    if (caps.frameRate && caps.frameRate.max) target.frameRate = Math.min(60, caps.frameRate.max);
    if (!Object.keys(target).length) return;
    try { await track.applyConstraints(target); } catch (e) { /* noop */ }
  }

  /* ── Crop helper: computes the capture region for the active mode
        (see CAPTURE_MODES): a frame of `aspect` where the HUD takes `ratio`
        of the frame height and its center sits at `centerX` of the width
        (POV → center of the right half; Native → dead center). Source coords
        are mapped from CSS to capture-stream px, handling all three
        displaySurface modes (tab/window/monitor). We also intersect with
        #sim-viewport so the sidebar overlay never leaks into the output.
        any portion of the rect outside the viewport is left as black fill. */
  function computeHudCrop(videoW, videoH, displaySurface) {
    const hudRect = wrap.getBoundingClientRect();
    const simRect = simViewport.getBoundingClientRect();

    // Frame height keeps the HUD at `ratio` of it (the zoom); width then
    // follows `aspect`. The HUD's center maps to `centerX` of the width and
    // the vertical midline, so the crop extends leftward (POV) or evenly
    // (Native).
    const cfg = capCfg();
    const cssRectH = hudRect.height / cfg.ratio;
    const cssRectW = cssRectH * cfg.aspect;
    const cssCenterX = hudRect.left + hudRect.width  / 2;
    const cssCenterY = hudRect.top  + hudRect.height / 2;
    const cssCropLeft = cssCenterX - cssRectW * cfg.centerX;
    const cssCropTop  = cssCenterY - cssRectH * 0.5;

    const chromeTop  = Math.max(0, window.outerHeight - window.innerHeight);
    // Any horizontal chrome (e.g. Safari's favorites sidebar) lives on
    // the left of the document area in every browser/OS combo I can
    // find. Without this offset the captured HUD drifts to the right.
    const chromeLeft = Math.max(0, window.outerWidth  - window.innerWidth);
    let baseW, offsetX = 0, offsetY = 0;
    if (!displaySurface || displaySurface === 'browser') {
      baseW = window.innerWidth;
    } else if (displaySurface === 'window') {
      baseW = window.outerWidth;
      offsetX = chromeLeft;
      offsetY = chromeTop;
    } else { // 'monitor' or unknown
      baseW = window.screen.width;
      offsetX = (window.screenX || 0) + chromeLeft;
      offsetY = (window.screenY || 0) + chromeTop;
    }
    // One uniform scale factor (DPR is uniform in practice); using two
    // independent axes would risk distorting the frame's aspect ratio.
    const scale = videoW / baseW;

    // Full rect crop in source-pixel space (unclamped)
    const cropSrcX = (cssCropLeft + offsetX) * scale;
    const cropSrcY = (cssCropTop  + offsetY) * scale;
    const cropSrcW = cssRectW * scale;
    const cropSrcH = cssRectH * scale;

    // Sim-viewport bounds in source pixels (clip mask for the crop)
    const simSrcLeft   = (simRect.left   + offsetX) * scale;
    const simSrcTop    = (simRect.top    + offsetY) * scale;
    const simSrcRight  = (simRect.right  + offsetX) * scale;
    const simSrcBottom = (simRect.bottom + offsetY) * scale;

    // Intersection of crop rect and sim-viewport, further clipped to
    // the captured stream's bounds so drawImage never reads out-of-range.
    const visLeft   = Math.max(cropSrcX,              simSrcLeft,   0);
    const visTop    = Math.max(cropSrcY,              simSrcTop,    0);
    const visRight  = Math.min(cropSrcX + cropSrcW,   simSrcRight,  videoW);
    const visBottom = Math.min(cropSrcY + cropSrcH,   simSrcBottom, videoH);

    // Output canvas = the full frame rect. Derive width from height·aspect
    // so the ratio stays exact, and round both even for h264.
    let outH = Math.max(2, Math.round(cropSrcH));
    if (outH % 2) outH -= 1;
    let outW = Math.max(2, Math.round(outH * cfg.aspect));
    if (outW % 2) outW -= 1;
    const dstScaleX = outW / cropSrcW;
    const dstScaleY = outH / cropSrcH;

    return {
      src: {
        x: visLeft,
        y: visTop,
        w: Math.max(0, visRight  - visLeft),
        h: Math.max(0, visBottom - visTop),
      },
      dst: {
        x: (visLeft - cropSrcX) * dstScaleX,
        y: (visTop  - cropSrcY) * dstScaleY,
        w: Math.max(0, (visRight  - visLeft) * dstScaleX),
        h: Math.max(0, (visBottom - visTop)  * dstScaleY),
      },
      outW,
      outH,
    };
  }

  /* ── Screenshot: captures the sim viewport via getDisplayMedia,
        then crops to the #sim-viewport rect. We need the screen-share
        path (not html2canvas) because the HUD is a cross-origin iframe
        whose pixels JS can't read directly. ─────────────────────────── */
  async function takeScreenshot() {
    if (recState) return; // recording in progress, let user stop it first
    trackEvent('screenshot', { url: urlInput.value || '' });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showCaptureToast('Screenshots not supported', 'This browser cannot capture the tab.', true);
      return;
    }

    // Hide the sidebar for the capture so the 16:9 frame can use the full
    // window width. With it visible, #sim-viewport is narrower than the
    // frame and the output gets black bars on the sides. Screenshots are
    // instant and need no controls, so this is invisible to the user.
    // Restored on every exit path below. (Recording keeps its sidebar so
    // the Stop button stays reachable; its clean path is fullscreen mode.)
    const sidebarEl = document.getElementById('sidebar');
    const savedSidebarDisplay = sidebarEl ? sidebarEl.style.display : '';
    if (sidebarEl) sidebarEl.style.display = 'none';

    // Move the HUD into the capture position BEFORE asking for the
    // capture stream. Otherwise the first frames the stream emits are
    // from the user's approval click, at which point the HUD is still
    // in its original spot, and the latest decoded frame in <video> at
    // drawImage time may pre-date the move. Moving first means every
    // frame the stream ever produces already has the capture layout.
    const savedTransition = wrap.style.transition;
    wrap.style.transition = 'none';
    applyCaptureHudPosition();

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_CONSTRAINTS);
    } catch (err) {
      applyDisplayPosStyles(dispX, dispY);
      wrap.style.transition = savedTransition;
      if (sidebarEl) sidebarEl.style.display = savedSidebarDisplay;
      if (err && err.name !== 'NotAllowedError') console.error(err);
      return;
    }

    screenshotBtn.disabled = true;

    try {
      const track = stream.getVideoTracks()[0];
      await maximizeTrack(track);
      const settings = track.getSettings ? track.getSettings() : {};

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        video.play().catch(reject);
      });

      // Two RAFs so the capture-position layout flushes before sampling a frame.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const crop = computeHudCrop(video.videoWidth, video.videoHeight, settings.displaySurface);

      const canvas = document.createElement('canvas');
      canvas.width  = crop.outW;
      canvas.height = crop.outH;
      const sctx = canvas.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      // Black-pad first so any part of the rect that falls outside the
      // captured viewport (e.g. a large HUD whose frame exceeds the window)
      // is filled rather than left transparent.
      sctx.fillStyle = '#000';
      sctx.fillRect(0, 0, crop.outW, crop.outH);
      if (crop.src.w > 0 && crop.src.h > 0) {
        sctx.drawImage(video,
          crop.src.x, crop.src.y, crop.src.w, crop.src.h,
          crop.dst.x, crop.dst.y, crop.dst.w, crop.dst.h);
      }

      await new Promise(resolve => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(); return; }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `display-simulator-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1500);
          resolve();
        }, 'image/png');
      });

      showCaptureToast('Screenshot saved', 'Stored in your Downloads folder.');
    } catch (err) {
      console.error(err);
      showCaptureToast('Screenshot failed', 'Something went wrong, please try again.', true);
    } finally {
      // Restore HUD to the user's saved anchor before re-enabling the
      // transition, so it snaps back instead of sliding (no visible move).
      applyDisplayPosStyles(dispX, dispY);
      wrap.style.transition = savedTransition;
      if (sidebarEl) sidebarEl.style.display = savedSidebarDisplay;
      stream.getTracks().forEach(t => t.stop());
      screenshotBtn.disabled = false;
    }
  }

  screenshotBtn.addEventListener('click', e => {
    if (recState) return; // recording in progress, let user stop it first
    e.stopPropagation();  // don't let the outside-click handler close the popover
    toggleFormatPicker('screenshot');
  });

  /* ── Screen recording: same getDisplayMedia + crop strategy as the
        screenshot path, but piped through a canvas whose stream feeds
        a MediaRecorder. The draw loop re-measures every frame so the
        crop tracks the sim viewport if the window resizes mid-record. ── */
  let recState = null;

  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    // Order: prefer MP4/H.264 (plays natively on macOS/Windows/iOS/Android)
    // and only fall back to WebM if nothing MP4 is supported. Safari and
    // Chrome ≥130 record MP4 directly; Firefox still only does WebM.
    const candidates = [
      'video/mp4;codecs=avc1.42E01E',         // H.264 Baseline 3.0, broadest decoder support
      'video/mp4;codecs=avc1.4D401E',         // H.264 Main 3.0
      'video/mp4;codecs=avc1',
      'video/mp4;codecs=h264',
      'video/mp4',
      'video/webm;codecs=h264',               // Chrome accepts H.264 inside WebM too
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function formatRecDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      showCaptureToast('Recording not supported', 'This browser cannot capture the tab.', true);
      return;
    }

    // Hide the sidebar for the recording so the 16:9 frame uses the full
    // window width (same reason as the screenshot; with it visible the
    // wider frame gets black bars). The in-app Stop control goes with it,
    // so recording is stopped via the browser's "Stop sharing" bar (wired
    // below) or the R key. Restored in stopRecording and on error paths.
    // Skip if already in fullscreen (CSS hides the sidebar there) so our
    // inline style can't strand it if the user exits fullscreen mid-record.
    const sidebarEl = document.getElementById('sidebar');
    const didHideSidebar = !!sidebarEl && !document.body.classList.contains('fullscreen-sim');
    if (didHideSidebar) sidebarEl.style.display = 'none';

    // Move the HUD into the capture position BEFORE asking for the
    // capture stream so every emitted frame already has the glasses-format
    // layout. See takeScreenshot for the full rationale. Restored in
    // stopRecording.
    const savedTransition = wrap.style.transition;
    wrap.style.transition = 'none';
    applyCaptureHudPosition();

    // Pre-focus the iframe before the share picker opens. The picker
    // captures focus while shown and restores it to whatever had it
    // beforehand on dismiss: so giving the iframe focus first means
    // arrow keys reach the embedded app the instant recording starts,
    // without the user needing to click into it.
    const focusIframe = () => {
      iframe.focus();
      try { iframe.contentWindow && iframe.contentWindow.focus(); } catch (e) { /* noop */ }
    };
    focusIframe();

    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia(DISPLAY_CONSTRAINTS);
    } catch (err) {
      applyDisplayPosStyles(dispX, dispY);
      wrap.style.transition = savedTransition;
      if (didHideSidebar) sidebarEl.style.display = '';
      if (err && err.name !== 'NotAllowedError') console.error(err);
      return;
    }

    const track = display.getVideoTracks()[0];
    await maximizeTrack(track);
    const settings = track.getSettings ? track.getSettings() : {};
    const displaySurface = settings.displaySurface;

    const video = document.createElement('video');
    video.srcObject = display;
    video.muted = true;
    video.playsInline = true;
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        video.play().catch(reject);
      });
    } catch (err) {
      display.getTracks().forEach(t => t.stop());
      applyDisplayPosStyles(dispX, dispY);
      wrap.style.transition = savedTransition;
      if (didHideSidebar) sidebarEl.style.display = '';
      console.error(err);
      showCaptureToast('Recording failed to start', 'Please try again.', true);
      return;
    }

    // Sync layout so the centered HUD's getBoundingClientRect is fresh
    // before we compute the canvas dimensions.
    wrap.getBoundingClientRect();

    const initCrop = computeHudCrop(video.videoWidth, video.videoHeight, displaySurface);
    const canvas = document.createElement('canvas');
    canvas.width  = initCrop.outW;
    canvas.height = initCrop.outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let raf = null;
    function drawFrame() {
      const c = computeHudCrop(video.videoWidth, video.videoHeight, displaySurface);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (c.src.w > 0 && c.src.h > 0) {
        ctx.drawImage(video,
          c.src.x, c.src.y, c.src.w, c.src.h,
          c.dst.x, c.dst.y, c.dst.w, c.dst.h);
      }
      raf = requestAnimationFrame(drawFrame);
    }
    drawFrame();

    const canvasStream = canvas.captureStream(60);
    const mimeType = pickRecorderMime();
    let recorder;
    try {
      // 12 Mbps: comfortably crisp for a Retina-sized HUD crop without
      // ballooning file size for typical demos.
      const opts = { videoBitsPerSecond: 12_000_000 };
      if (mimeType) opts.mimeType = mimeType;
      recorder = new MediaRecorder(canvasStream, opts);
    } catch (err) {
      cancelAnimationFrame(raf);
      display.getTracks().forEach(t => t.stop());
      applyDisplayPosStyles(dispX, dispY);
      wrap.style.transition = savedTransition;
      if (didHideSidebar) sidebarEl.style.display = '';
      console.error(err);
      showCaptureToast('Recorder not supported', 'This browser cannot record video.', true);
      return;
    }

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm';
      const ext = type.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
      if (!chunks.length) { showCaptureToast('Recording was empty', 'Nothing was captured, please try again.', true); return; }
      const blob = new Blob(chunks, { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `display-simulator-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      showCaptureToast('Recording saved', 'Stored in your Downloads folder.');
    };

    // Browser's own "Stop sharing" bar: treat as stop request.
    track.addEventListener('ended', () => stopRecording());

    recorder.start(1000); // emit a chunk every second so memory doesn't grow unbounded

    const startedAt = performance.now();
    const timer = setInterval(() => {
      const secs = Math.floor((performance.now() - startedAt) / 1000);
      recLabel.textContent = `Stop · ${formatRecDuration(secs)}`;
    }, 250);

    recState = { recorder, display, raf, timer, savedTransition, sidebarEl, didHideSidebar };
    recordBtn.classList.add('recording');
    recordBtn.title = 'Click to stop recording';
    recLabel.textContent = 'Stop · 0:00';
    screenshotBtn.disabled = true;
    // Enable the floating Stop control. It stays hidden until the user moves
    // the mouse (pingExitBtn) so the recording's opening stays clean; any
    // pointer activity reveals it, and it idle-fades again afterward.
    document.body.classList.add('recording');

    // Safety re-focus at multiple delays: the share picker's focus
    // restoration timing varies by browser and a single setTimeout(0)
    // sometimes loses the race.
    setTimeout(focusIframe, 0);
    setTimeout(focusIframe, 150);
  }

  function stopRecording() {
    if (!recState) return;
    const { recorder, display, raf, timer, savedTransition, sidebarEl, didHideSidebar } = recState;
    recState = null;
    clearInterval(timer);
    if (raf) cancelAnimationFrame(raf);
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch (e) { /* noop */ }
    }
    display.getTracks().forEach(t => t.stop());
    // Restore HUD to user's saved anchor, then re-enable the transition,
    // and bring the sidebar (with its controls) back.
    applyDisplayPosStyles(dispX, dispY);
    wrap.style.transition = savedTransition || '';
    if (didHideSidebar) sidebarEl.style.display = '';
    document.body.classList.remove('recording', 'show-exit-btn');
    recordBtn.classList.remove('recording');
    recordBtn.title = 'Record the simulator viewport as a video (you\'ll be prompted to share this tab)';
    recLabel.textContent = 'Record';
    screenshotBtn.disabled = false;
  }

  recordBtn.addEventListener('click', e => {
    if (recState) { stopRecording(); return; }
    e.stopPropagation();  // don't let the outside-click handler close the popover
    toggleFormatPicker('record');
  });

  /* ── Init ──────────────────────────────────────────────────────── */
  setSceneFit(sceneFit);
  // Rotating a phone changes which dimension constrains the panel.
  window.addEventListener('orientationchange', () => {
    if (isMobile()) setTimeout(applyMobileLayout, 250);
  });

  buildAppChips();
  buildLauncher();
  buildPlaylist();
  openApp('home');
  applyScale(380);
  applyHudBrightness();
  updateAngularReadout();
  document.body.classList.add('glow');
  setInterval(tick, 100);
  tick();
  // Restore the remembered capture format (a ?cap= deep link overrides it below).
  let storedCapMode = null;
  try { storedCapMode = localStorage.getItem(CAP_MODE_KEY); } catch (e) {}
  setCaptureMode(storedCapMode || 'pov');
  // Mobile has no placement controls, so the display is sized and placed to
  // suit the screen it lands on.
  syncViewportInset();
  if (isMobile()) {
    applyMobileLayout();
  } else {
    setDisplayPos(dispX, dispY);
  }
  selectClip(0);
  // Apply the slider's default darkness on load so the page opens
  // at the configured value, not browser-default 1.0.
  scene.style.filter = `brightness(${(100 - slBgDark.value) / 100})`;
  lblBgDark.textContent = slBgDark.value + '%';
  readStateFromURL(); // restore shared state from URL params if present

  // Prefill last entered URL if nothing was loaded via deep link
  if (!urlInput.value) {
    try {
      const lastUrl = localStorage.getItem('display-glasses-last-url');
      if (lastUrl) {
        urlInput.value = lastUrl;
      }
    } catch (e) {}
  }

})();
