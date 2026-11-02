const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { consensus, discover } = require('../captcha');
const pause = () => new Promise(resolve => setTimeout(resolve, 160));
const answer = { ok: true, first: { text: 'AB7c9\n', confidence: 96 }, second: { text: 'AB7c9', confidence: 95 } };
const html = '<form><input type="password"><img id="captchaImage" src="/vtop/captcha"><input id="captchaStr" maxlength="6"></form>';
test('OCR consensus requires matching case-sensitive alphanumeric output and high confidence', () => {
  assert.equal(consensus(answer.first, answer.second), 'AB7c9');
  assert.equal(consensus(answer.first, { text: 'AB7C9', confidence: 99 }), '');
  assert.equal(consensus(answer.first, { text: 'AB7c9', confidence: 89 }), '');
  assert.equal(consensus(answer.first, answer.second, 4), '');
  assert.equal(consensus({ text: '<html>', confidence: 99 }, { text: '<html>', confidence: 99 }), '');
});
test('discovery excludes other forms and Google CAPTCHA fields', () => {
  const dom = new JSDOM(html);
  assert.equal(discover(dom.window.document).input.id, 'captchaStr');
  dom.window.document.querySelector('#captchaStr').id = 'g-recaptcha-response';
  assert.equal(discover(dom.window.document), null);
  dom.window.document.body.innerHTML = '<form><img id="captcha"><input name="captcha"></form>';
  assert.equal(discover(dom.window.document), null);
  dom.window.close();
});
function setup({ enabled = true, response = async () => answer, initial = '' } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://vtop.vit.ac.in/vtop/login' });
  const w = dom.window, calls = [], writes = [];
  w.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 30 }];
  const image = w.document.querySelector('img'), input = w.document.querySelector('#captchaStr'); input.value = initial;
  Object.defineProperties(image, { complete: { get: () => true }, naturalWidth: { get: () => 150 }, naturalHeight: { get: () => 40 } });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
  w.chrome = { runtime: { sendMessage: async message => { calls.push(message); return response(); } }, storage: {
    local: { get: async () => ({ captchaAutofill: enabled }), set: value => writes.push(value) }, onChanged: { addListener() {} }
  } };
  let submits = 0; w.document.addEventListener('submit', () => submits++);
  w.eval(fs.readFileSync(__dirname + '/../captcha.js', 'utf8'));
  return { dom, w, image, input, calls, writes, submits: () => submits };
}
test('prefill dispatches input/change once without submitting, and handles a new same-URL image', async () => {
  const t = setup(); let changes = 0; t.input.addEventListener('change', () => changes++);
  await pause(); assert.equal(t.input.value, 'AB7c9'); assert.equal(changes, 1); assert.equal(t.submits(), 0);
  await pause(); assert.equal(t.calls.length, 1);
  t.image.dispatchEvent(new t.w.Event('load')); await pause();
  assert.equal(t.calls.length, 2); assert.equal(changes, 2);
  t.dom.window.close();
});
test('manual entry before and during OCR is preserved', async () => {
  const a = setup({ initial: 'mine' }); await pause(); assert.equal(a.calls.length, 0); assert.equal(a.input.value, 'mine'); a.dom.window.close();
  let resolve; const b = setup({ response: () => new Promise(r => { resolve = r; }) }); await pause();
  b.input.value = 'typed'; b.input.dispatchEvent(new b.w.Event('input')); resolve(answer); await pause();
  assert.equal(b.input.value, 'typed'); b.dom.window.close();
});
test('refreshed images invalidate old results and disabled or Google-only challenges never start OCR', async () => {
  const resolvers = []; const a = setup({ response: () => new Promise(r => resolvers.push(r)) }); await pause();
  a.image.src = '/vtop/captcha?fresh=1'; await pause();
  resolvers[0](answer); await pause(); assert.equal(a.input.value, '');
  resolvers[1](answer); await pause(); assert.equal(a.input.value, 'AB7c9'); a.dom.window.close();
  const b = setup({ enabled: false }); await pause(); assert.equal(b.calls.length, 0); b.dom.window.close();
  const c = setup(); c.w.document.querySelector('form').innerHTML = '<input type="password"><textarea name="g-recaptcha-response"></textarea><div class="g-recaptcha"></div>';
  await pause(); assert.equal(c.calls.length, 0); c.dom.window.close();
});
test('low confidence and worker failure retain manual entry', async () => {
  for (const response of [async () => ({ ok: false }), async () => { throw Error('Worker failed'); }]) {
    const t = setup({ response }); await pause(); assert.equal(t.input.value, '');
    assert.match(t.w.document.querySelector('[data-vtop-captcha]').shadowRoot.querySelector('small').textContent, /Please type/);
    t.dom.window.close();
  }
});
test('background rejects external senders and oversized data without creating an offscreen page', () => {
  let listener, opened = 0;
  const chrome = { runtime: { id: 'extension', onMessage: { addListener: fn => { listener = fn; } } }, offscreen: { createDocument: () => opened++ } };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../captcha-background.js', 'utf8'), { chrome });
  for (const [sender, image] of [[{ id: 'other', url: 'https://vtop.vit.ac.in/vtop/login' }, 'data:image/png;base64,AAAA'], [{ id: 'extension', url: 'https://example.com/' }, 'data:image/png;base64,AAAA'], [{ id: 'extension', url: 'https://vtop.vit.ac.in/vtop/login' }, 'https://example.com/image']]) {
    let result; listener({ type: 'vtop-captcha-recognize', image }, sender, value => { result = value; }); assert.equal(result.ok, false);
  }
  assert.equal(opened, 0);
});
test('offscreen OCR uses packaged assets, disables image caching, compares two passes and terminates its worker', async () => {
  let listener, options, terminated = 0, passes = 0;
  class Image { constructor() { this.naturalWidth = 100; this.naturalHeight = 30; } async decode() {} }
  const ctx = { fillRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([20, 50, 100, 255]) }), putImageData() {} };
  const chrome = { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage: { addListener: fn => { listener = fn; } } } };
  const Tesseract = { createWorker: async (lang, mode, config) => {
    options = config; assert.equal(lang, 'eng'); assert.equal(mode, 1);
    return { setParameters: async () => {}, recognize: async () => { passes++; return { data: answer.first }; }, terminate: async () => { terminated++; } };
  } };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../captcha-offscreen.js', 'utf8'), {
    chrome, Tesseract, Image, document: { createElement: () => ({ getContext: () => ctx }) }, window: { close() {} },
    setTimeout: () => 1, clearTimeout() {}, Uint8ClampedArray
  });
  const result = await new Promise(resolve => listener({ target: 'vtop-captcha-offscreen', image: 'data:image/png;base64,AAAA' }, { id: 'extension' }, resolve));
  assert.equal(result.ok, true); assert.equal(passes, 2); assert.equal(terminated, 1);
  assert.equal(options.workerBlobURL, false); assert.equal(options.cacheMethod, 'none');
  for (const path of [options.workerPath, options.corePath, options.langPath]) assert.ok(path.startsWith('chrome-extension://extension/'));
});
