importScripts('captcha-background.js');
// Let content scripts keep short-lived page data (assignment deadlines) in memory-only session storage.
const shareSession = () => chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })?.catch(() => {});
shareSession();
chrome.runtime.onStartup.addListener(shareSession);
chrome.runtime.onInstalled.addListener(shareSession);
chrome.action.onClicked.addListener(async tab => {
  if (!Number.isInteger(tab?.id)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'vtop-toggle-command-menu' });
  } catch {
    await chrome.tabs.create({ url: 'https://vtop.vit.ac.in/vtop/content' });
  }
});
