export class AttendanceReportFileService {
  constructor({ document = globalThis.document, native = () => globalThis.PresenceNative } = {}) { Object.assign(this, { document, native }); }
  async deliver(bytes, filename, mode = 'save') {
    if (bytes.length > 10 * 1024 * 1024) throw new Error('PDF exceeds 10 MB. Select fewer students.');
    const native = this.native();
    if (native?.isNative) {
      if (!native.attendancePdf) throw new Error('Update the Presence APK to enable PDF saving and sharing.');
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return native.attendancePdf[mode === 'share' ? 'share' : 'save']({ base64: btoa(binary), filename });
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = this.document.createElement('a'); link.href = url; link.download = filename;
    this.document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { started: true };
  }
}
