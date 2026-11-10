// Reports uncaught errors to the server so staff can see crashes in SuperAdmin → System health.
// Throttled (max 8 distinct reports per page load) and never throws itself.
export function installErrorReporting(api, page) {
  const seen = new Set();
  const IGNORE = /ResizeObserver loop|Script error\.?$|NetworkError when attempting|Failed to fetch|Load failed|AbortError|The user aborted|cancelled|NotAllowedError/i;
  const send = (message, stack = '') => {
    try {
      message = String(message || '').slice(0, 300);
      if (!message || IGNORE.test(message) || seen.has(message) || seen.size >= 8) return;
      seen.add(message);
      Promise.resolve(api.logError?.(page, message, String(stack || '').slice(0, 2000))).catch(() => {});
    } catch { /* ignore */ }
  };
  window.addEventListener('error', e => {
    if (!e.error && !e.message) return; // resource load errors (images etc.) are not app crashes
    send(e.message || String(e.error), e.error?.stack || `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    if (r && /log in again|banned|suspended/i.test(r.message || '')) return; // expected account states, not bugs
    send(r?.message || String(r), r?.stack || '');
  });
  return send;
}
