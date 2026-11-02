(() => {
  'use strict';
  function accept(result, max = 10) {
    if (!result || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(result.text) || max < 6 ||
        !Array.isArray(result.scores) || result.scores.length !== 6 ||
        !Array.isArray(result.margins) || result.margins.length !== 6 ||
        !result.scores.every(value => Number.isFinite(value) && value >= .5 && value <= 1) ||
        !result.margins.every(value => Number.isFinite(value) && value >= .15 && value <= 1) ||
        !Number.isFinite(result.meanScore) || result.meanScore < .8) return '';
    return result.text;
  }
  function discover(doc) {
    for (const form of doc.querySelectorAll('form')) {
      if (!form.querySelector('input[type="password"],input#password,input[name="password"]')) continue;
      const input = [...form.querySelectorAll('input')].find(el =>
        /^(text|search|tel)$/i.test(el.type) && /captcha/i.test(`${el.id} ${el.name} ${el.placeholder}`) &&
        !/recaptcha/i.test(`${el.id} ${el.name}`) && !el.disabled && !el.hidden);
      const image = form.querySelector('#captchaBlock img') || [...form.querySelectorAll('img')].find(el => /captcha/i.test(`${el.id} ${el.getAttribute('src')} ${el.alt}`));
      if (input && image) return { input, image };
    }
    return null;
  }
  if (typeof module === 'object' && module.exports) { module.exports = { accept, discover }; return; }
  if (globalThis.__vtopCaptcha) return;
  globalThis.__vtopCaptcha = true;
  let enabled = true, ready = false, current = null, sequence = 0, timer;
  const states = new WeakMap();
  function status(state, text) { if (state.status.textContent !== text) state.status.textContent = text; }
  function install(pair) {
    let state = states.get(pair.input);
    if (state && state.image === pair.image) return state;
    const host = document.createElement('span');
    host.dataset.vtopCaptcha = '';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:block;margin:6px 0;font:12px/1.5 system-ui;color:inherit}label{display:flex;gap:6px;align-items:center}input{accent-color:#287dc1}small{display:block}</style><label><input type="checkbox" checked>Prefill image CAPTCHA on this device</label><small role="status" aria-live="polite"></small>`;
    if (state) state.host.remove();
    state = { ...pair, host, status: root.querySelector('small'), checkbox: root.querySelector('input'), revision: 0, tried: -1, owned: '', edited: !!pair.input.value };
    state.checkbox.checked = enabled;
    state.checkbox.addEventListener('change', () => {
      enabled = state.checkbox.checked; sequence++;
      chrome.storage.local.set({ captchaAutofill: enabled });
      if (enabled) state.tried = -1;
      schedule();
    });
    pair.input.addEventListener('input', event => {
      if (!event.isTrusted && state.writing) return;
      state.edited = true; state.owned = ''; sequence++;
      status(state, 'Manual entry.');
    });
    pair.image.addEventListener('load', () => { state.revision++; sequence++; schedule(); });
    pair.image.addEventListener('error', () => { state.revision++; sequence++; schedule(); });
    states.set(pair.input, state);
    pair.input.insertAdjacentElement('afterend', host);
    return state;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 100); }
  async function scan() {
    if (!ready) return;
    const pair = discover(document);
    if (!pair) { if (current) { sequence++; current = null; } return; }
    const state = install(pair);
    if (current !== state) { sequence++; current = state; }
    state.checkbox.checked = enabled;
    if (!enabled) { status(state, 'Prefill off.'); return; }
    if (!pair.input.getClientRects().length || !pair.image.getClientRects().length ||
        !pair.image.complete || !pair.image.naturalWidth) return;
    const source = pair.image.currentSrc || pair.image.src;
    if (state.source !== source) { state.source = source; state.revision++; sequence++; }
    if (state.tried === state.revision) return;
    state.tried = state.revision;
    if (state.owned && pair.input.value === state.owned) { pair.input.value = ''; state.owned = ''; }
    if (state.edited || pair.input.value) { status(state, 'Manual entry.'); return; }
    const generation = ++sequence;
    status(state, 'Reading image CAPTCHA locally…');
    try {
      // Copy the displayed pixels. Never re-fetch a challenge: its endpoint may rotate the server-side answer.
      const width = pair.image.naturalWidth, height = pair.image.naturalHeight;
      if (width * height > 1000000) throw Error('Image too large');
      if (Math.abs(width / height - 5) > .05) throw Error('Unsupported CAPTCHA format');
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 40;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(pair.image, 0, 0, 200, 40);
      const response = await VtopCaptchaSolver.read(context.getImageData(0, 0, 200, 40).data);
      if (generation !== sequence || current !== state || !pair.input.isConnected || !pair.image.isConnected ||
          state.edited || pair.input.value || !enabled) return;
      const text = accept(response, pair.input.maxLength > 0 ? pair.input.maxLength : 10);
      if (!text) { status(state, 'Could not read confidently. Please type the CAPTCHA.'); return; }
      state.owned = text; state.writing = true;
      try {
        pair.input.value = text;
        pair.input.dispatchEvent(new Event('input', { bubbles: true }));
        pair.input.dispatchEvent(new Event('change', { bubbles: true }));
      } finally { state.writing = false; }
      status(state, 'Suggested — check the image before signing in.');
    } catch { if (generation === sequence) status(state, 'Prefill unavailable. Please type the CAPTCHA.'); }
  }
  chrome.storage.local.get({ captchaAutofill: true }).then(value => { enabled = value.captchaAutofill !== false; ready = true; schedule(); }).catch(() => { ready = true; schedule(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.captchaAutofill) { enabled = changes.captchaAutofill.newValue !== false; sequence++; schedule(); }
  });
  new MutationObserver(records => {
    for (const record of records) if (record.target === current?.image) { current.revision++; sequence++; }
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'type', 'hidden'] });
})();
