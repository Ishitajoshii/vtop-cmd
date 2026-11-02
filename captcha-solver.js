/* VTOP saturation classifier adapted from levyashvin/VTOP-Captcha-Solver.
 * Copyright (c) 2025 Yuva Yashvin. MIT license: licenses/vtop-captcha-solver.txt.
 * Training/logic credited upstream to ViBoot and VITrendz. See captcha-model.json for pinned provenance.
 */
(() => {
  'use strict';
  const LABELS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function validate(model) {
    if (model?.labels !== LABELS || model.biases?.length !== 32 || model.weights?.length !== 528 ||
        !model.biases.every(Number.isFinite) || model.weights.some(row => row.length !== 32 || !row.every(Number.isFinite))) throw Error('Invalid CAPTCHA model');
    return model;
  }
  function features(rgba) {
    if (rgba.length !== 200 * 40 * 4) throw Error('Expected 200×40 pixels');
    const saturation = new Float64Array(8000);
    for (let i = 0; i < saturation.length; i++) {
      const offset = i * 4;
      const max = Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
      const min = Math.min(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
      saturation[i] = max && rgba[offset + 3] >= 128 ? Math.round((max - min) * 255 / max) : 0;
    }
    const blocks = [];
    for (let position = 0; position < 6; position++) {
      const values = [];
      for (let y = 8 + 5 * (position % 2); y < 35 - 5 * ((position + 1) % 2); y++)
        for (let x = (position + 1) * 25 + 2; x < (position + 2) * 25 + 1; x++) values.push(saturation[y * 200 + x]);
      const mean = values.reduce((a, b) => a + b, 0) / 528;
      // Blank/neutral blocks are outside this model's colored-letter format.
      if (Math.max(...values) - Math.min(...values) < 20) return null;
      blocks.push(values.map(value => value > mean ? 1 : 0));
    }
    return blocks;
  }
  function predict(rgba, model) {
    validate(model);
    const blocks = features(rgba);
    if (!blocks) return null;
    const scores = [], margins = []; let text = '';
    for (const block of blocks) {
      const logits = model.biases.slice();
      for (let feature = 0; feature < 528; feature++) if (block[feature])
        for (let label = 0; label < 32; label++) logits[label] += model.weights[feature][label];
      const max = Math.max(...logits);
      const exp = logits.map(value => Math.exp(value - max)); // Stable softmax avoids overflow.
      const sum = exp.reduce((a, b) => a + b, 0);
      const probabilities = exp.map(value => value / sum);
      const ranked = probabilities.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
      text += LABELS[ranked[0].index]; scores.push(ranked[0].value); margins.push(ranked[0].value - ranked[1].value);
    }
    // Scores are model outputs, not calibrated correctness probabilities.
    const meanScore = Math.exp(scores.reduce((sum, value) => sum + Math.log(value), 0) / 6);
    return { text, scores, margins, meanScore };
  }
  let modelPromise;
  async function read(rgba) {
    if (!modelPromise) modelPromise = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(chrome.runtime.getURL('captcha-model.json'), { signal: controller.signal });
        if (!response.ok) throw Error('Model unavailable');
        return validate(await response.json());
      } finally { clearTimeout(timeout); }
    })().catch(error => { modelPromise = null; throw error; });
    return predict(rgba, await modelPromise);
  }
  const api = { validate, features, predict, read, labels: LABELS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.VtopCaptchaSolver = api;
})();
