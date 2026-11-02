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
  function install(pair) {
    let state = states.get(pair.input);
    if (state && state.image === pair.image) return state;
    state = { ...pair, revision: 0, tried: -1, owned: '', edited: !!pair.input.value };
    pair.input.addEventListener('input', event => {
      if (!event.isTrusted && state.writing) return;
      state.edited = true; state.owned = ''; sequence++;
    });
    pair.image.addEventListener('load', () => { state.revision++; sequence++; schedule(); });
    pair.image.addEventListener('error', () => { state.revision++; sequence++; schedule(); });
    states.set(pair.input, state);
    return state;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 100); }
  async function scan() {
    if (!ready) return;
    const pair = discover(document);
    if (!pair) { if (current) { sequence++; current = null; } return; }
    const state = install(pair);
    if (current !== state) { sequence++; current = state; }
    if (!enabled) return;
    if (!pair.input.getClientRects().length || !pair.image.getClientRects().length ||
        !pair.image.complete || !pair.image.naturalWidth) return;
    const source = pair.image.currentSrc || pair.image.src;
    if (state.source !== source) { state.source = source; state.revision++; sequence++; }
    if (state.tried === state.revision) return;
    state.tried = state.revision;
    if (state.owned && pair.input.value === state.owned) { pair.input.value = ''; state.owned = ''; }
    if (state.edited || pair.input.value) return;
    const generation = ++sequence;
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
      if (!text) return;
      state.owned = text; state.writing = true;
      try {
        pair.input.value = text;
        pair.input.dispatchEvent(new Event('input', { bubbles: true }));
        pair.input.dispatchEvent(new Event('change', { bubbles: true }));
      } finally { state.writing = false; }
    } catch { /* Leave the field available for manual entry. */ }
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
