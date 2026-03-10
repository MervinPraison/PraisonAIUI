/**
 * Shared toast notification & confirm dialog system.
 *
 * Usage:
 *   import { showToast, showConfirm } from '../plugins/toast.js';
 *
 *   showToast('Connection test passed!', 'success');
 *   showToast('Upload failed', 'error');
 *
 *   if (await showConfirm('Delete channel?', 'This cannot be undone.')) { ... }
 */

/* ── CSS (injected once) ─────────────────────────────────────────────── */
let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
/* Toast container */
.aiui-toast-wrap{position:fixed;top:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.aiui-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:10px;font-size:13px;line-height:1.4;color:#fff;backdrop-filter:blur(12px);box-shadow:0 4px 24px rgba(0,0,0,.35);animation:aiui-toast-in .3s ease;max-width:380px;word-break:break-word}
.aiui-toast.out{animation:aiui-toast-out .25s ease forwards}
.aiui-toast.success{background:rgba(34,197,94,.92)}
.aiui-toast.error{background:rgba(239,68,68,.92)}
.aiui-toast.info{background:rgba(59,130,246,.92)}
.aiui-toast .icon{font-size:18px;flex-shrink:0}
.aiui-toast .close{margin-left:auto;cursor:pointer;opacity:.7;font-size:16px;flex-shrink:0}
.aiui-toast .close:hover{opacity:1}
@keyframes aiui-toast-in{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}
@keyframes aiui-toast-out{to{opacity:0;transform:translateX(40px)}}

/* Confirm dialog */
.aiui-confirm-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);animation:aiui-fade-in .2s ease}
.aiui-confirm-box{background:var(--db-sidebar-bg,#1e1e2e);border:1px solid var(--db-border,#333);border-radius:12px;padding:24px 28px;width:380px;max-width:92vw;box-shadow:0 8px 40px rgba(0,0,0,.5);animation:aiui-scale-in .2s ease}
.aiui-confirm-box h3{margin:0 0 8px;font-size:16px;color:var(--db-text,#e0e0e0)}
.aiui-confirm-box p{margin:0 0 20px;font-size:13px;color:var(--db-text-dim,#999);line-height:1.5}
.aiui-confirm-btns{display:flex;justify-content:flex-end;gap:10px}
.aiui-confirm-btns button{padding:8px 18px;border-radius:8px;border:none;font-size:13px;cursor:pointer;font-weight:500;transition:background .15s,opacity .15s}
.aiui-confirm-btns .cancel{background:var(--db-card-bg,#2a2a3e);color:var(--db-text,#e0e0e0)}
.aiui-confirm-btns .cancel:hover{opacity:.8}
.aiui-confirm-btns .ok{background:#ef4444;color:#fff}
.aiui-confirm-btns .ok:hover{background:#dc2626}
@keyframes aiui-fade-in{from{opacity:0}to{opacity:1}}
@keyframes aiui-scale-in{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
  `;
  document.head.appendChild(s);
}

/* ── Toast ────────────────────────────────────────────────────────────── */
let _wrap = null;
function _getWrap() {
  if (!_wrap || !_wrap.isConnected) {
    _wrap = document.createElement('div');
    _wrap.className = 'aiui-toast-wrap';
    document.body.appendChild(_wrap);
  }
  return _wrap;
}

const _icons = { success: '✓', error: '✗', info: 'ℹ' };

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} [durationMs=4000]
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  _injectCSS();
  const el = document.createElement('div');
  el.className = `aiui-toast ${type}`;
  el.innerHTML = `<span class="icon">${_icons[type] || 'ℹ'}</span><span>${_esc(message)}</span><span class="close">×</span>`;
  el.querySelector('.close').addEventListener('click', () => _dismiss(el));
  _getWrap().appendChild(el);
  if (durationMs > 0) setTimeout(() => _dismiss(el), durationMs);
}

function _dismiss(el) {
  if (el._dismissed) return;
  el._dismissed = true;
  el.classList.add('out');
  el.addEventListener('animationend', () => el.remove());
}

/* ── Confirm ──────────────────────────────────────────────────────────── */

/**
 * Show a styled confirm dialog.
 * @param {string} title
 * @param {string} [message]
 * @returns {Promise<boolean>}
 */
export function showConfirm(title, message = '') {
  _injectCSS();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'aiui-confirm-overlay';
    overlay.innerHTML = `
      <div class="aiui-confirm-box">
        <h3>${_esc(title)}</h3>
        ${message ? `<p>${_esc(message)}</p>` : ''}
        <div class="aiui-confirm-btns">
          <button class="cancel">Cancel</button>
          <button class="ok">Confirm</button>
        </div>
      </div>`;
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    document.body.appendChild(overlay);
    overlay.querySelector('.ok').focus();
  });
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function _esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
