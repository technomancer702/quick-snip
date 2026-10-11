const sessions = new Map();
const busy = new Set();

// Runs in the isolated extension world, leaving page scripts untouched.
function cleanOverlay(expectedToken) {
  if (!expectedToken || window.__quickSnipToken === expectedToken) window.__quickSnipCleanup?.();
  return { width: innerWidth, height: innerHeight };
}

function mountOverlay(url, token) {
  const oldFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  const styles = {
    position: 'fixed', inset: '0', width: '100vw', height: '100vh',
    'max-width': 'none', 'max-height': 'none', margin: '0', padding: '0',
    border: '0', background: 'transparent', overflow: 'hidden',
    transform: 'none', opacity: '1', visibility: 'visible',
    'box-sizing': 'border-box', 'z-index': '2147483647'
  };
  for (const [key, value] of Object.entries(styles)) dialog.style.setProperty(key, value, 'important');
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.allow = 'clipboard-write';
  frame.setAttribute('aria-label', 'Select screenshot area');
  for (const [key, value] of Object.entries({ display: 'block', width: '100%', height: '100%', border: '0', margin: '0', padding: '0' })) {
    frame.style.setProperty(key, value, 'important');
  }
  dialog.append(frame);
  window.__quickSnipToken = token;
  window.__quickSnipCleanup = () => {
    dialog.remove();
    window.__quickSnipCleanup = null;
    window.__quickSnipToken = null;
    if (oldFocus?.isConnected) oldFocus.focus({ preventScroll: true });
  };
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    window.__quickSnipCleanup?.();
  });
  (document.fullscreenElement || document.documentElement).append(dialog);
  dialog.showModal();
  frame.addEventListener('load', () => frame.focus());
  frame.focus();
}

async function start(tab) {
  if (!tab?.id || busy.has(tab.id)) return;
  busy.add(tab.id);
  let token;
  try {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: cleanOverlay });
    const active = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active[0]?.id !== tab.id) return;
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const stillActive = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (stillActive[0]?.id !== tab.id) return;
    token = crypto.randomUUID();
    for (const [key, value] of sessions) {
      if (Date.now() - value.created > 60000 || value.tabId === tab.id) sessions.delete(key);
    }
    sessions.set(token, { image, ...result.result, tabId: tab.id, created: Date.now() });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: mountOverlay,
      args: [chrome.runtime.getURL('selector.html') + '#' + token, token]
    });
  } catch (error) {
    if (token) sessions.delete(token);
    console.warn('Quick Snip:', error);
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b42318' }).catch(() => {});
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
    await chrome.action.setTitle({ tabId: tab.id, title: 'Capture unavailable here. Try a normal webpage (browser settings and extension stores are restricted).' }).catch(() => {});
  } finally {
    busy.delete(tab.id);
  }
}

chrome.commands.onCommand.addListener(async command => {
  if (command === 'snip') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await start(tab);
  }
});
chrome.action.onClicked.addListener(start);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.url?.startsWith(chrome.runtime.getURL('selector.html'))) return;
  if (message.type === 'get-snip') {
    const session = sessions.get(message.token);
    if (!session || sender.tab?.id !== session.tabId) {
      respond({ error: 'Capture expired. Press the hotkey again.' });
    } else {
      sessions.delete(message.token);
      respond({ image: session.image, width: session.width, height: session.height });
    }
  } else if (message.type === 'close-snip' && sender.tab?.id) {
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, func: cleanOverlay, args: [message.token] })
      .then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [key, value] of sessions) if (value.tabId === tabId) sessions.delete(key);
});
