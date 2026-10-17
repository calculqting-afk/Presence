// Pinned local assets are loaded only when exporting, never during dashboard startup.
export class AttendancePdfAssets {
  constructor({ document = globalThis.document, globals = globalThis, fetch = (...args) => globalThis.fetch(...args) } = {}) {
    Object.assign(this, { document, globals, fetch });
  }
  script(path, name) {
    if (this.globals[name]) return Promise.resolve(this.globals[name]);
    return new Promise((resolve, reject) => {
      const script = this.document.createElement('script');
      const timer = setTimeout(() => finish(new Error('PDF library loading timed out. Retry the export.')), 15000);
      const finish = error => { clearTimeout(timer); script.onload = script.onerror = null; if (error) { script.remove(); reject(error); } else resolve(this.globals[name]); };
      script.src = new URL(path, import.meta.url).href;
      script.onload = () => finish(this.globals[name] ? null : new Error('PDF library failed to initialize.'));
      script.onerror = () => finish(new Error('PDF assets could not be loaded. Refresh or update Presence.'));
      this.document.head.append(script);
    });
  }
  async bytes(path) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetch(new URL(path, import.meta.url).href, { signal: controller.signal });
      if (!response.ok) throw new Error('A local PDF asset is missing. Refresh or update Presence.');
      return new Uint8Array(await response.arrayBuffer());
    } finally { clearTimeout(timer); }
  }
  load() {
    if (!this.loading) this.loading = Promise.all([
      this.script('../../vendor/pdf-lib.min.js', 'PDFLib'), this.script('../../vendor/fontkit.umd.min.js', 'fontkit'),
      this.bytes('../../fonts/NotoSans-Regular.ttf'), this.bytes('../../images/presence-logo.png')
    ]).then(([pdf, fontkit, font, logo]) => ({ pdf, fontkit, font, logo })).catch(error => { this.loading = null; throw error; });
    return this.loading;
  }
}
