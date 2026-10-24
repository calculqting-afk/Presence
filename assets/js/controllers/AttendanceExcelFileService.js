export class AttendanceExcelFileService {
  constructor({ document = globalThis.document, native = () => globalThis.PresenceNative } = {}) { Object.assign(this, { document, native }); }
  async deliver(bytes, filename) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 10 * 1024 * 1024 || !/^[A-Za-z0-9._-]{1,120}\.xlsx$/.test(filename)) throw new Error('Invalid Excel export or file exceeds 10 MB.');
    const native = this.native();
    if (native?.isNative) {
      if (!native.attendanceSpreadsheet) throw new Error('Update the Presence APK to a version with Excel export support.');
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return native.attendanceSpreadsheet.save({ base64: btoa(binary), filename });
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = this.document.createElement('a'); link.href = url; link.download = filename;
    this.document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { started: true };
  }
}
