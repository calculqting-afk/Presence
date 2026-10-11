export class QrCodeLoader {
  constructor({ document = globalThis.document, window = globalThis.window } = {}) {
    Object.assign(this, { document, window });
  }
  load() {
    if (this.window.qrcode) return Promise.resolve(this.window.qrcode);
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve, reject) => {
      const script = this.document.createElement('script');
      script.src = new URL('../assets/vendor/qrcode-generator.js?v=2.0.4', this.window.location.href).href;
      script.async = true;
      script.onload = () => {
        script.onload = script.onerror = null;
        if (this.window.qrcode) resolve(this.window.qrcode);
        else { script.remove(); reject(new Error('QR library unavailable. Use the survey link or retry.')); }
      };
      script.onerror = () => { script.onload = script.onerror = null; script.remove(); reject(new Error('QR library could not load. Use the survey link or retry.')); };
      this.document.head.append(script);
    }).catch(error => { this.pending = null; throw error; });
    return this.pending;
  }
}
