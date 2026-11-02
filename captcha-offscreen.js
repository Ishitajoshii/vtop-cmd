(() => {
  'use strict';
  async function recognize(image) {
    let worker, expired = false, timeout;
    const run = async () => {
      const img = new Image(); img.src = image; await img.decode();
      if (img.naturalWidth * img.naturalHeight > 1000000) throw Error('Image too large');
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * 3 + 24; canvas.height = img.naturalHeight * 3 + 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 12, 12, img.naturalWidth * 3, img.naturalHeight * 3);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const gray = Math.round(.299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2]);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
      }
      ctx.putImageData(pixels, 0, 0);
      worker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('vendor/ocr/worker.min.js'), workerBlobURL: false,
        corePath: chrome.runtime.getURL('vendor/ocr/tesseract-core-lstm.js'),
        langPath: chrome.runtime.getURL('vendor/ocr'), cacheMethod: 'none',
      });
      if (expired) { await worker.terminate(); throw Error('Timeout'); }
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' });
      const first = (await worker.recognize(canvas)).data;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = pixels.data[i] < 160 ? 0 : 255;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      ctx.putImageData(pixels, 0, 0);
      const second = (await worker.recognize(canvas)).data;
      return { ok: true, first: { text: first.text, confidence: first.confidence }, second: { text: second.text, confidence: second.confidence } };
    };
    try {
      return await Promise.race([run(), new Promise((_, reject) => { timeout = setTimeout(() => { expired = true; worker?.terminate(); reject(Error('Timeout')); }, 20000); })]);
    } catch { return { ok: false }; }
    finally { clearTimeout(timeout); if (worker && !expired) await worker.terminate(); }
  }
  let queue = Promise.resolve(), pending = 0, idle;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'vtop-captcha-offscreen') return;
    pending++; clearTimeout(idle);
    queue = queue.catch(() => {}).then(() => recognize(message.image));
    queue.then(reply, () => reply({ ok: false })).finally(() => {
      pending--;
      if (!pending) idle = setTimeout(() => window.close(), 30000);
    });
    return true;
  });
})();
