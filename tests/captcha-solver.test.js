const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { features, predict, validate, labels } = require('../captcha-solver');
const bundled = require('../captcha-model.json');
function image() {
  const data = new Uint8ClampedArray(32000); data.fill(255);
  for (let position = 0; position < 6; position++) {
    const i = ((8 + 5 * (position % 2)) * 200 + (position + 1) * 25 + 2) * 4;
    data.set([150, 10, 10, 255], i);
  }
  return data;
}
function simpleModel() {
  const model = { labels, weights: Array.from({ length: 528 }, () => Array(32).fill(0)), biases: Array(32).fill(0) };
  model.weights[0][0] = 20; model.biases[1] = 5;
  return model;
}
test('bundled public model has pinned provenance, the correct alphabet and validated dimensions', () => {
  assert.equal(validate(bundled), bundled);
  assert.equal(bundled.source.revision, 'b245a4b5d9ead1ffcc1fd6bafc98ef59815050bc');
  assert.ok(fs.readFileSync(__dirname + '/../licenses/vtop-captcha-solver.txt', 'utf8').includes('Copyright (c) 2025 Yuva Yashvin'));
  assert.throws(() => validate({ ...bundled, labels: 'wrong' }));
  assert.throws(() => validate({ ...bundled, biases: [NaN] }));
});
test('fixed staggered character windows produce the expected 528 saturation features', () => {
  const blocks = features(image());
  assert.equal(blocks.length, 6);
  for (const block of blocks) { assert.equal(block.length, 528); assert.equal(block[0], 1); assert.equal(block.reduce((a, b) => a + b), 1); }
  const transparent = image(); for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0;
  assert.equal(features(transparent), null);
  assert.equal(features(new Uint8ClampedArray(32000)), null);
  assert.throws(() => features(new Uint8ClampedArray(4)));
});
test('the local classifier computes finite, normalized class scores without overflow', () => {
  const model = simpleModel();
  const result = predict(image(), model);
  assert.equal(result.text, 'AAAAAA');
  assert.ok(result.scores.every(score => score > .99 && score <= 1));
  assert.ok(result.margins.every(score => score > .99 && score <= 1));
  model.weights[0][0] = 10000;
  assert.ok(Number.isFinite(predict(image(), model).meanScore));
});
test('model loads only from its packaged extension URL and is cached in memory', async () => {
  let calls = 0;
  const context = { AbortController, setTimeout, clearTimeout, Uint8ClampedArray, Float64Array, chrome: { runtime: { getURL: path => 'chrome-extension://local/' + path } }, fetch: async url => {
    calls++; assert.equal(url, 'chrome-extension://local/captcha-model.json'); return { ok: true, json: async () => simpleModel() };
  } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(__dirname + '/../captcha-solver.js', 'utf8'), context);
  assert.equal(calls, 0);
  assert.equal((await context.VtopCaptchaSolver.read(image())).text, 'AAAAAA');
  await context.VtopCaptchaSolver.read(image()); assert.equal(calls, 1);
});
test('a failed model load can recover on the next image', async () => {
  let calls = 0;
  const context = { AbortController, setTimeout, clearTimeout, chrome: { runtime: { getURL: path => path } }, fetch: async () => ({ ok: ++calls > 1, json: async () => simpleModel() }) };
  vm.createContext(context); vm.runInContext(fs.readFileSync(__dirname + '/../captcha-solver.js', 'utf8'), context);
  await assert.rejects(context.VtopCaptchaSolver.read(image()));
  assert.equal((await context.VtopCaptchaSolver.read(image())).text, 'AAAAAA');
});
test('manifest ships the local model and does not retain OCR workers or additional permissions', () => {
  const manifest = require('../manifest.json');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.ok(!manifest.content_security_policy);
  const scripts = manifest.content_scripts.flatMap(group => group.js);
  assert.ok(scripts.indexOf('captcha-solver.js') < scripts.indexOf('captcha.js'));
  assert.ok(manifest.web_accessible_resources.some(group => group.resources.includes('captcha-model.json')));
  assert.ok(!fs.readFileSync(__dirname + '/../package.json', 'utf8').includes('tesseract'));
});
