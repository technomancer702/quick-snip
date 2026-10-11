const snapshot = document.getElementById('snapshot');
const selection = document.getElementById('selection');
const hint = document.getElementById('hint');
const errorBox = document.getElementById('error');
let ready = false;
let copying = false;
let startPoint = null;
let rectangle = null;
let png = null;
let originalWidth;
let originalHeight;

const close = () => chrome.runtime.sendMessage({ type: 'close-snip', token: location.hash.slice(1) }).catch(() => {});
const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
function update(event) {
  const end = point(event);
  rectangle = { x: Math.min(startPoint.x, end.x), y: Math.min(startPoint.y, end.y), width: Math.abs(startPoint.x - end.x), height: Math.abs(startPoint.y - end.y) };
  Object.assign(selection.style, { left: rectangle.x + 'px', top: rectangle.y + 'px', width: rectangle.width + 'px', height: rectangle.height + 'px' });
  hint.textContent = `${Math.round(rectangle.width * snapshot.naturalWidth / innerWidth)} × ${Math.round(rectangle.height * snapshot.naturalHeight / innerHeight)} px · Release to copy · Esc to cancel`;
}
function showError(message) {
  document.getElementById('error-text').textContent = message;
  document.getElementById('retry').hidden = !png;
  errorBox.hidden = false;
  hint.textContent = 'Image was not copied';
}
async function copy() {
  if (copying || !png) return;
  copying = true;
  errorBox.hidden = true;
  hint.textContent = 'Copying…';
  try {
    window.focus();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    hint.textContent = '✓ Copied to clipboard';
    setTimeout(close, 450);
  } catch (error) {
    copying = false;
    showError('Clipboard access was blocked. Click “Copy again” to retry, and keep this tab focused. ' + error.message);
  }
}
document.addEventListener('pointerdown', event => {
  if (!ready || copying || !errorBox.hidden || event.button !== 0) return;
  event.preventDefault();
  startPoint = point(event);
  png = null;
  selection.classList.add('active');
  document.body.setPointerCapture(event.pointerId);
  update(event);
});
document.addEventListener('pointermove', event => { if (startPoint) update(event); });
document.addEventListener('pointerup', async event => {
  if (!startPoint || event.button !== 0) return;
  update(event);
  startPoint = null;
  if (document.body.hasPointerCapture(event.pointerId)) document.body.releasePointerCapture(event.pointerId);
  if (rectangle.width < 3 || rectangle.height < 3) {
    selection.classList.remove('active');
    selection.removeAttribute('style');
    hint.textContent = 'Drag to select · Esc to cancel';
    return;
  }
  ready = false;
  try {
    const scaleX = snapshot.naturalWidth / innerWidth;
    const scaleY = snapshot.naturalHeight / innerHeight;
    const left = Math.floor(rectangle.x * scaleX);
    const top = Math.floor(rectangle.y * scaleY);
    const right = Math.min(snapshot.naturalWidth, Math.ceil((rectangle.x + rectangle.width) * scaleX));
    const bottom = Math.min(snapshot.naturalHeight, Math.ceil((rectangle.y + rectangle.height) * scaleY));
    const canvas = document.createElement('canvas');
    canvas.width = right - left;
    canvas.height = bottom - top;
    canvas.getContext('2d').drawImage(snapshot, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    png = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create PNG.')), 'image/png'));
    await copy();
  } catch (error) { showError(error.message); }
});
document.addEventListener('pointercancel', () => { startPoint = null; close(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
document.addEventListener('contextmenu', event => { event.preventDefault(); close(); });
document.getElementById('retry').addEventListener('click', copy);
document.getElementById('cancel').addEventListener('click', close);
window.addEventListener('resize', () => {
  if (originalWidth && (innerWidth !== originalWidth || innerHeight !== originalHeight)) close();
});
(async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'get-snip', token: location.hash.slice(1) });
    if (!result || result.error) throw new Error(result?.error || 'Screenshot unavailable. Press the hotkey again.');
    snapshot.src = result.image;
    await snapshot.decode();
    originalWidth = innerWidth;
    originalHeight = innerHeight;
    ready = true;
    hint.textContent = 'Drag to select · Release to copy · Esc to cancel';
    window.focus();
  } catch (error) { showError(error.message); }
})();
