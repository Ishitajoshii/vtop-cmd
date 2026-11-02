const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { accept, discover } = require('../captcha');
const pause = () => new Promise(resolve => setTimeout(resolve, 160));
const answer = { text: 'B7XVK9', scores: Array(6).fill(.95), margins: Array(6).fill(.8), meanScore: .95 };
const html = '<form><input type="password"><img id="captchaImage" src="/vtop/captcha"><input id="captchaStr" maxlength="6"></form>';
test('classifier acceptance requires six supported characters, clear class margins and adequate overall score', () => {
  assert.equal(accept(answer), 'B7XVK9');
  assert.equal(accept({ ...answer, text: 'B7XvK9' }), '');
  assert.equal(accept({ ...answer, scores: [.49, .95, .95, .95, .95, .95] }), '');
  assert.equal(accept({ ...answer, margins: [.1, .8, .8, .8, .8, .8] }), '');
  assert.equal(accept({ ...answer, meanScore: .79 }), '');
  assert.equal(accept(answer, 5), '');
  assert.equal(accept({ ...answer, text: '<html>' }), '');
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
  Object.defineProperties(image, { complete: { get: () => true }, naturalWidth: { get: () => 200 }, naturalHeight: { get: () => 40 } });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(32000) }) });
  w.VtopCaptchaSolver = { read: async pixels => { calls.push(pixels.length); return response(); } };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
  w.chrome = { storage: {
    local: { get: async () => ({ captchaAutofill: enabled }), set: value => writes.push(value) }, onChanged: { addListener() {} }
  } };
  let submits = 0; w.document.addEventListener('submit', () => submits++);
  w.eval(fs.readFileSync(__dirname + '/../captcha.js', 'utf8'));
  return { dom, w, image, input, calls, writes, submits: () => submits };
}
test('prefill dispatches input/change once without submitting, and handles a new same-URL image', async () => {
  const t = setup(); let changes = 0; t.input.addEventListener('change', () => changes++);
  await pause(); assert.equal(t.input.value, 'B7XVK9'); assert.equal(changes, 1); assert.equal(t.submits(), 0);
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
  resolvers[1](answer); await pause(); assert.equal(a.input.value, 'B7XVK9'); a.dom.window.close();
  const b = setup({ enabled: false }); await pause(); assert.equal(b.calls.length, 0); b.dom.window.close();
  const c = setup(); c.w.document.querySelector('form').innerHTML = '<input type="password"><textarea name="g-recaptcha-response"></textarea><div class="g-recaptcha"></div>';
  await pause(); assert.equal(c.calls.length, 0); c.dom.window.close();
});
test('uncertain predictions and model failure retain manual entry', async () => {
  for (const response of [async () => ({ ok: false }), async () => { throw Error('Worker failed'); }]) {
    const t = setup({ response }); await pause(); assert.equal(t.input.value, '');
    assert.match(t.w.document.querySelector('[data-vtop-captcha]').shadowRoot.querySelector('small').textContent, /Please type/);
    t.dom.window.close();
  }
});
test('live VTOP login markup: unlabelled embedded image in captchaBlock and revealed password', () => {
  const dom = new JSDOM('<form id="vtopLoginForm"><img id="logo" src="logo.png"><input id="username"><input id="password" name="password" type="text"><div id="captchaBlock"><img src="data:image/png;base64,AAAA"><button type="button">Refresh</button></div><input id="captchaStr" name="captchaStr" placeholder="Enter CAPTCHA shown above"></form>');
  const pair = discover(dom.window.document);
  assert.equal(pair.input.id, 'captchaStr');
  assert.equal(pair.image.parentElement.id, 'captchaBlock');
  dom.window.close();
});
