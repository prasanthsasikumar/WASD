/* The create page: a conversation on the left, the real simulator on the
   right. Each assistant turn is a complete single-file app; the page holds
   the current file, mirrors it to localStorage, and posts it into the
   embedded simulator. The generator's context is deliberately small: the
   first prompt, the current file, and the newest instruction. */
(function () {
  'use strict';

  const messagesEl = document.getElementById('messages');
  const composer   = document.getElementById('composer');
  const promptEl   = document.getElementById('prompt');
  const sendBtn    = document.getElementById('send');
  const actionsEl  = document.getElementById('actions');
  const byokEl     = document.getElementById('byok');
  const sceneEl    = document.getElementById('scene');
  const ambientEl  = document.getElementById('ambient');
  const ambientLbl = document.getElementById('ambient-lbl');
  const simFrame   = document.getElementById('sim');

  const SESSION_KEY = 'wasd-create-session';
  const BYOK_KEY    = 'wasd-deepseek-key';

  // Mirrors BG_PRESETS in wasd.js; the simulator resolves these by name,
  // case-insensitively, so an unknown entry is simply ignored there.
  const SCENES = ['City Sidewalk', 'Cooking', 'Street Walk', 'Promenade',
    'Coffee', 'Rooftop', 'Subway', 'Cafe Desk', 'City Driving', 'Highway',
    'Library', 'Lobby', 'Studio', 'Trail', 'Harbor', 'Laundromat',
    'Workshop', 'Event', 'Commute', 'Corridor'];

  const state = {
    firstPrompt: null,   // the prompt that started this app
    revisions: [],       // [{html, note}] in order
    current: -1,         // index into revisions shown in the lens
    busy: false,
    simReady: false
  };

  /* ── Rendering ─────────────────────────────────────────────────── */

  function addMessage(cls, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addErrorMessage(text, retryFn) {
    const div = addMessage('system error', text);
    if (retryFn) {
      const btn = document.createElement('button');
      btn.className = 'ghost-btn retry';
      btn.type = 'button';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => { div.remove(); retryFn(); });
      div.appendChild(btn);
    }
  }

  function addRevisionChip(index) {
    const btn = document.createElement('button');
    btn.className = 'rev';
    btn.type = 'button';
    btn.dataset.index = index;
    const kb = Math.max(1, Math.round(state.revisions[index].html.length / 1024));
    btn.innerHTML = 'Version ' + (index + 1) + '<span class="size">' + kb + ' KB</span>';
    btn.addEventListener('click', () => selectRevision(index));
    messagesEl.appendChild(btn);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function markActiveChip() {
    messagesEl.querySelectorAll('.rev').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.index, 10) === state.current);
    });
  }

  /* ── Simulator bridge ──────────────────────────────────────────── */

  function pushToSim() {
    if (!state.simReady || state.current < 0) return;
    simFrame.contentWindow.postMessage(
      { type: 'wasd:load-html', html: state.revisions[state.current].html },
      location.origin);
  }

  function pushSceneState() {
    if (!state.simReady) return;
    simFrame.contentWindow.postMessage(
      { type: 'wasd:set-state',
        bg: sceneEl.value,
        ambient: parseInt(ambientEl.value, 10) },
      location.origin);
  }

  simFrame.addEventListener('load', () => {
    // The embed registers its message listener during boot; one tick of
    // grace covers the gap between the load event and that registration.
    setTimeout(() => {
      state.simReady = true;
      pushSceneState();
      pushToSim();
    }, 300);
  });

  function selectRevision(index) {
    state.current = index;
    markActiveChip();
    pushToSim();
    persist();
  }

  /* ── Persistence: survive a refresh, nothing more ──────────────── */

  function persist() {
    try {
      if (state.current < 0) { localStorage.removeItem(SESSION_KEY); return; }
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        prompt: state.firstPrompt,
        html: state.revisions[state.current].html
      }));
    } catch (e) { /* storage full or blocked; the session just won't survive refresh */ }
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) {}
    if (!saved || !saved.html) return;
    state.firstPrompt = saved.prompt || 'restored app';
    addMessage('user', state.firstPrompt);
    state.revisions.push({ html: saved.html });
    state.current = 0;
    addRevisionChip(0);
    markActiveChip();
    actionsEl.hidden = false;
    promptEl.placeholder = 'Refine it: make the number bigger';
  }

  /* ── Generation ────────────────────────────────────────────────── */

  function extractHTML(text) {
    // DeepSeek sometimes wraps the file in prose and fences despite the
    // system prompt, so slice from the document's real start and end
    // rather than trusting the edges.
    const start = text.search(/<!doctype\s|<html[\s>]/i);
    if (start === -1) return null;
    const endTag = text.toLowerCase().lastIndexOf('</html>');
    const end = endTag === -1 ? text.length : endTag + '</html>'.length;
    return text.slice(start, end).trim();
  }

  function buildRequestMessages(instruction) {
    if (state.current < 0) return [{ role: 'user', content: instruction }];
    return [
      { role: 'user', content: state.firstPrompt },
      { role: 'assistant', content: state.revisions[state.current].html },
      { role: 'user', content: instruction }
    ];
  }

  async function generate(instruction) {
    if (state.busy) return;
    state.busy = true;
    sendBtn.disabled = true;

    const isFirst = state.current < 0;
    if (isFirst) state.firstPrompt = instruction;
    addMessage('user', instruction);

    const progress = addMessage('system', 'Generating…');
    const body = { messages: buildRequestMessages(instruction) };
    const key = localStorage.getItem(BYOK_KEY);
    if (key) body.key = key;

    let text = '';
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        let err = { error: 'Something went wrong. Try again.' };
        try { err = await res.json(); } catch (e) {}
        progress.remove();
        addErrorMessage(err.error, () => generate(instruction));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        progress.textContent = 'Generating… ' + Math.round(text.length / 1024) + ' KB';
      }
    } catch (e) {
      progress.remove();
      addErrorMessage('The connection dropped mid-generation.', () => generate(instruction));
      return;
    } finally {
      state.busy = false;
      sendBtn.disabled = false;
    }

    const html = extractHTML(text);
    if (!html) {
      progress.remove();
      addErrorMessage('The model returned something that is not an app.', () => generate(instruction));
      return;
    }

    progress.remove();
    state.revisions.push({ html: html });
    state.current = state.revisions.length - 1;
    addRevisionChip(state.current);
    markActiveChip();
    pushToSim();
    persist();
    actionsEl.hidden = false;
    promptEl.placeholder = 'Refine it: make the number bigger';
  }

  /* ── Wiring ────────────────────────────────────────────────────── */

  composer.addEventListener('submit', e => {
    e.preventDefault();
    const value = promptEl.value.trim();
    if (!value) return;
    promptEl.value = '';
    generate(value);
  });
  promptEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  document.getElementById('download').addEventListener('click', () => {
    if (state.current < 0) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([state.revisions[state.current].html], { type: 'text/html' }));
    a.download = 'app.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.getElementById('open-sim').addEventListener('click', async () => {
    if (state.current < 0) return;
    const param = await window.WASDCodec.compress(state.revisions[state.current].html);
    const p = new URLSearchParams();
    p.set('app', param);
    p.set('bg', sceneEl.value.toLowerCase());
    p.set('ambient', ambientEl.value);
    window.open('/?' + p.toString(), '_blank');
  });

  document.getElementById('new-app').addEventListener('click', () => {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    location.reload();
  });

  byokEl.addEventListener('change', () => {
    try {
      if (byokEl.value.trim()) localStorage.setItem(BYOK_KEY, byokEl.value.trim());
      else localStorage.removeItem(BYOK_KEY);
    } catch (e) {}
  });

  SCENES.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sceneEl.appendChild(opt);
  });
  sceneEl.addEventListener('change', pushSceneState);
  ambientEl.addEventListener('input', () => {
    ambientLbl.textContent = parseInt(ambientEl.value, 10).toLocaleString('en-US') + ' lux';
    pushSceneState();
  });

  try { byokEl.value = localStorage.getItem(BYOK_KEY) || ''; } catch (e) {}
  restore();
})();
