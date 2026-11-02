(() => {
  'use strict';
  let creating, pending = 0;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'vtop-captcha-recognize') return;
    if (sender.id !== chrome.runtime.id || !/^https:\/\/vtop\.vit\.ac\.in\/vtop\//.test(sender.url || '') ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(message.image || '') || message.image.length > 2000000 || pending >= 3) {
      reply({ ok: false }); return;
    }
    pending++;
    (async () => {
      try {
        const url = chrome.runtime.getURL('captcha-offscreen.html');
        if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length) {
          if (!creating) creating = chrome.offscreen.createDocument({ url: 'captcha-offscreen.html', reasons: ['WORKERS'], justification: 'Read login CAPTCHA image pixels locally with bundled OCR.' }).finally(() => { creating = null; });
          await creating;
        }
        reply(await chrome.runtime.sendMessage({ target: 'vtop-captcha-offscreen', image: message.image }));
      } catch { reply({ ok: false }); }
      finally {
        pending--;
      }
    })();
    return true;
  });
})();
