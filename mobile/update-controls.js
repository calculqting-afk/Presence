// Native login controls stay independent of authentication and never request account data.
export async function mountUpdateControls({ document, window, updates }) {
  const panel = document.querySelector('#appUpdateControls');
  if (!panel) return;
  const button = panel.querySelector('button'), message = panel.querySelector('[role="status"]');
  let disposed = false, pending = false, subscription, revision = 0;
  const render = status => {
    if (disposed) return;
    panel.hidden = false;
    panel.querySelector('[data-installed-version]').textContent = `Installed version: ${status.version}`;
    button.disabled = status.state === 'checking' || status.supported === false;
    button.textContent = status.state === 'checking' ? 'Checking…' : 'Check for updates';
    message.textContent = status.message + (status.state === 'failed' && status.retrySeconds > 0
      ? ` Try again in about ${status.retrySeconds} seconds.` : '');
  };
  const unavailable = () => {
    if (disposed) return;
    panel.hidden = false;
    message.textContent = 'Update controls are unavailable in this installed app. Download the latest APK from the official Presence release page.';
    button.disabled = true;
  };
  const refresh = async () => {
    const requestRevision = ++revision;
    try {
      const status = await updates.getStatus();
      if (requestRevision === revision) render(status);
    } catch { if (requestRevision === revision) unavailable(); }
  };
  const check = async () => {
    if (pending || disposed || button.disabled) return;
    pending = true; button.disabled = true;
    const requestRevision = ++revision;
    try {
      const status = await updates.check();
      if (requestRevision === revision) render(status);
    }
    catch {
      if (!disposed && requestRevision === revision) {
        message.textContent = 'Couldn’t start the update check. Please try again.';
        button.disabled = false;
      }
    } finally { pending = false; }
  };
  const cleanup = event => {
    if (event?.persisted) return;
    if (disposed) return;
    disposed = true; subscription?.remove();
    button.removeEventListener('click', check);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pagehide', cleanup);
  };
  button.addEventListener('click', check);
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', cleanup);
  try {
    subscription = await updates.addListener('status', status => { revision++; render(status); });
    if (disposed) { subscription.remove(); return; }
    await refresh();
  } catch { unavailable(); }
  return cleanup;
}
