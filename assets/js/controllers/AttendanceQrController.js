import { PasswordResetApi } from './PasswordResetApi.js';
import { QrCodeLoader } from './QrCodeLoader.js';
import { AttendanceViews } from './AttendanceViews.js';
import { EventAudiencePolicy } from './EventAudiencePolicy.js';

export class AttendanceQrController {
  constructor({ document = globalThis.document, window = globalThis.window, admin, getEvents, getUser, getProfile, escapeHtml, showToast, api = new PasswordResetApi() }) {
    Object.assign(this, { document, window, admin, getEvents, getUser, getProfile, escapeHtml, showToast, api });
    this.generation = 0;
  }
  initialize() {
    this.button = this.document.querySelector(this.admin ? '#openAttendanceQrScanner' : '#openStudentAttendanceQr');
    this.page = !this.admin && this.document.querySelector('#studentAttendanceQrPanel');
    if (!this.button && !this.page) return this;
    if (this.button) this.button.hidden = false;
    this.onOpen = () => void this.open();
    this.button?.addEventListener('click', this.onOpen);
    this.onVisibility = () => {
      if (this.document.hidden) { this.stopCamera(); this.close(); }
      else if (this.page && this.visible) void this.open();
    };
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.onBack = () => this.close();
    this.window.addEventListener('presence:attendance-qr-back', this.onBack);
    this.onView = event => {
      this.visible = this.page && event.detail.viewName === 'attendance-qr';
      this.close();
      if (this.visible && !this.document.hidden) void this.open();
    };

    this.window.addEventListener('presence:viewchange', this.onView);
    this.onSigningOut = () => {
      this.cachedQr = null;
      try { this.window.sessionStorage?.removeItem('presence.attendanceQr.v1'); } catch {}
      if (!this.admin) this.close(true);
    };
    this.window.addEventListener('presence:device-signing-out', this.onSigningOut);
    return this;
  }
  currentEvents() {
    const now = Date.now();
    return this.getEvents().filter(event => now >= AttendanceViews.time(event, 'openAt') && now < AttendanceViews.time(event, 'checkOutClosesAt')
      && (this.admin || EventAudiencePolicy.canAttend({ ...this.getProfile(), uid: this.getUser()?.uid }, event)));
  }
  async open() {
    if (this.confirming) return;
    this.close();
    const e = this.escapeHtml, events = this.currentEvents();
    this.opener = this.document.activeElement;
    const dialog = this.document.createElement(this.page ? 'article' : 'dialog');
    dialog.className = 'attendance-qr-dialog' + (this.page ? ' attendance-qr-page panel' : '');
    dialog.setAttribute('aria-labelledby', 'attendanceQrTitle');
    dialog.innerHTML = `<header><img src="../assets/images/presence-logo.png" alt="" width="40" height="40">${this.page ? '' : '<button class="outline-button" type="button" data-qr-close aria-label="Close attendance QR">×</button>'}</header>
      <h2 id="attendanceQrTitle">${this.admin ? 'Scan student QR' : 'My Attendance QR'}</h2>
      <p>${this.admin ? 'Choose the session and action. Scan, verify the student in person, then confirm.' : 'Show this QR to an attendance administrator. They choose the event and verify you in person.'}</p>
      ${this.admin ? `<div class="attendance-qr-controls"><label>Event / session<select data-qr-event>${events.length ? events.map(event => `<option value="${e(event.id)}">${e(AttendanceViews.title(event))} · ${e(AttendanceViews.label(event))} · ${e(event.date)}</option>`).join('') : '<option value="">No current eligible sessions</option>'}</select></label>
      <label>Action<select data-qr-action><option value="in">Check-in</option><option value="out">Check-out</option></select></label></div>` : '<p class="attendance-qr-identity" data-qr-identity></p>'}
      <p data-qr-status role="status" aria-live="polite"></p>
      ${this.admin ? '<video data-qr-video autoplay playsinline muted hidden aria-label="QR scanner camera"></video><button class="primary-button" type="button" data-qr-camera>Start camera</button><section data-qr-confirmation hidden></section>' : '<p data-qr-countdown class="attendance-qr-countdown" role="timer" aria-live="off"></p><div class="attendance-qr-code" data-qr-code></div><p>Downloaded codes expire too. Keep your QR private.</p><div class="button-row"><button class="primary-button" type="button" data-qr-download disabled>Download QR</button><button class="outline-button" type="button" data-qr-refresh>Retry</button></div>'}`;
    this.dialog = dialog;
    this.field = selector => dialog.querySelector(selector);
    const closeButton = this.field('[data-qr-close]');
    if (closeButton) closeButton.onclick = () => this.close();
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('close', () => { if (this.dialog === dialog) this.close(); });
    const changed = () => { this.reset(); if (!this.admin) void this.generate(); };
    if (this.admin) {
      this.field('[data-qr-event]').onchange = changed;
      this.field('[data-qr-action]').onchange = changed;
      this.field('[data-qr-camera]').onclick = () => void this.startCamera();
    } else {
      this.field('[data-qr-refresh]').onclick = () => void this.generate();
      this.field('[data-qr-download]').onclick = () => void this.download();
    }
    if (this.page) this.page.replaceChildren(dialog);
    else {
      this.document.body.setAttribute('data-attendance-qr', '');
      this.document.body.append(dialog);
      dialog.showModal();
    }
    if (!this.admin) await this.generate();
    else if (!events.length) this.status('No current eligible attendance session is available.');
  }
  status(message, error = false) {
    if (!this.dialog) return;
    const element = this.field('[data-qr-status]');
    element.textContent = message;
    element.classList.toggle('is-error', error);
  }
  selection() { return { eventId: this.field('[data-qr-event]')?.value, action: this.field('[data-qr-action]')?.value || 'in' }; }
  reset() {
    ++this.generation;
    this.stopCamera();
    this.window.clearInterval(this.expiryTimer);
    this.expiryTimer = undefined;
    this.preview = null; this.downloadData = null;
    if (!this.dialog) return;
    const download = this.field('[data-qr-download]'); if (download) download.disabled = true;
    for (const selector of ['[data-qr-code]', '[data-qr-countdown]', '[data-qr-confirmation]']) {
      const element = this.field(selector); if (element) { element.replaceChildren(); if (selector.includes('confirmation')) element.hidden = true; }
    }
    this.status('');
    const button = this.field(this.admin ? '[data-qr-camera]' : '[data-qr-refresh]');
    button.disabled = false;
  }
  async generate() {
    if (!this.dialog || this.generating) return;
    this.reset();
    const generation = this.generation, dialog = this.dialog, button = this.field('[data-qr-refresh]');
    this.generating = true; button.disabled = true; this.status('Generating your secure QR…');
    try {
      const user = this.getUser(), claims = (await user?.getIdTokenResult?.())?.claims;
      if (this.dialog !== dialog || generation !== this.generation) return;
      const session = claims?.presenceSession ? `${claims.presenceSession}:${claims.presenceAuthTime ?? claims.auth_time}` : null;
      let stored;
      if (session) try { stored = JSON.parse(this.window.sessionStorage?.getItem('presence.attendanceQr.v1') || 'null'); } catch {}
      const candidate = this.cachedQr || stored;
      const cached = candidate?.uid === user?.uid && candidate.session === session
        && Number.isFinite(candidate.deadline) && candidate.deadline > Date.now() && candidate.deadline <= Date.now() + 1800000
        && typeof candidate.result?.token === 'string' && Number.isFinite(candidate.result.expiresAt)
        && candidate.result.expiresAt - candidate.result.serverNow <= 1800000
        && candidate.result.student?.name && candidate.result.student?.studentId ? candidate : null;
      if (!cached && session) try { this.window.sessionStorage?.removeItem('presence.attendanceQr.v1'); } catch {}
      const [result, factory] = await Promise.all([
        cached ? cached.result : this.api.call('/v1/student/attendance-qr', user, {}),
        cached?.factory || new QrCodeLoader({ document: this.document, window: this.window }).load()
      ]);
      if (this.dialog !== dialog || generation !== this.generation) return;
      const code = factory(0, 'M'); code.addData(result.token); code.make();
      this.field('[data-qr-code]').innerHTML = code.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
      this.field('[data-qr-code] svg')?.setAttribute('aria-label', 'Temporary attendance QR');
      const deadline = cached?.deadline ?? Date.now() + result.expiresAt - result.serverNow;
      this.cachedQr = { uid: user?.uid, session, result, factory, deadline };
      if (session) try {
        this.window.sessionStorage?.setItem('presence.attendanceQr.v1', JSON.stringify({ uid: user.uid, session, result, deadline }));
      } catch { /* Restricted storage falls back to the in-memory QR. */ }
      this.downloadData = { code, student: result.student, expiresAt: result.expiresAt, deadline };
      this.field('[data-qr-identity]').textContent = `${result.student.name} · ${result.student.studentId}`;
      this.field('[data-qr-download]').disabled = false;
      this.status('Ready to scan. Keep this QR private.');
      const tick = () => {
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        this.field('[data-qr-countdown]').textContent = `New QR in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        if (!seconds) {
          this.window.clearInterval(this.expiryTimer); this.field('[data-qr-code]').replaceChildren();
          this.field('[data-qr-download]').disabled = true; this.downloadData = null;
          if (!this.document.hidden) void this.generate();
        }
      };
      tick(); this.expiryTimer = this.window.setInterval(tick, 1000);
    } catch (error) { if (this.dialog === dialog && generation === this.generation) this.status(error.message, true); }
    finally { this.generating = false; if (this.dialog === dialog) button.disabled = false;
      if (this.dialog && generation !== this.generation && !this.admin && !this.document.hidden) void this.generate(); }
  }
  async download() {
    const data = this.downloadData;
    if (!data || data.deadline <= Date.now() || this.downloading) {
      if (!this.downloading) this.status('Your QR expired. Wait for the new code.', true);
      return;
    }
    const button = this.field('[data-qr-download]');
    this.downloading = true; button.disabled = true;
    try {
      const canvas = this.document.createElement('canvas'), scale = 8, margin = 4;
      const modules = data.code.getModuleCount(), size = (modules + margin * 2) * scale;
      canvas.width = Math.max(640, size + 64); canvas.height = size + 230;
      const context = canvas.getContext('2d');
      if (!context) throw Error('Image download is unavailable on this device.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#142742'; context.textAlign = 'center'; context.font = 'bold 26px sans-serif';
      context.fillText('Presence · Attendance QR', canvas.width / 2, 42);
      context.font = '22px sans-serif'; context.fillText(data.student.name, canvas.width / 2, 78, canvas.width - 48);
      context.fillText(data.student.studentId, canvas.width / 2, 110);
      const left = Math.floor((canvas.width - size) / 2) + margin * scale, top = 130 + margin * scale;
      context.fillStyle = '#000';
      for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) {
        if (data.code.isDark(row, col)) context.fillRect(left + col * scale, top + row * scale, scale, scale);
      }
      context.font = '18px sans-serif';
      context.fillText('Expires: ' + new Date(data.expiresAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' (PH)', canvas.width / 2, size + 170, canvas.width - 36);
      context.fillText('Keep private. Show to an attendance administrator.', canvas.width / 2, size + 202, canvas.width - 36);
      const filename = 'Presence-QR-' + data.student.studentId.replace(/[^A-Za-z0-9_-]/g, '-') + '.png';
      const image = canvas.toDataURL('image/png');
      if (this.window.PresenceNative?.isNative) {
        if (!this.window.PresenceNative.attendanceQrImage?.save) throw Error('Update the APK to download QR images.');
        const result = await this.window.PresenceNative.attendanceQrImage.save({ base64: image.split(',')[1], filename });
        this.showToast(result.cancelled ? 'Download cancelled' : 'QR saved', result.cancelled ? 'No image was saved.' : result.album === 'Pictures/Presence' ? 'Saved to Photos / Gallery · Pictures/Presence. The QR expires at the time shown.' : 'The downloaded QR expires at the time shown on the image.');
      } else {
        const link = this.document.createElement('a'); link.href = image; link.download = filename;
        this.document.body.append(link); link.click(); link.remove();
        this.showToast('QR download started', 'The downloaded QR expires at the time shown on the image.');
      }
    } catch (error) { this.showToast('QR download unavailable', error.message); }
    finally { this.downloading = false; if (this.downloadData === data && data.deadline > Date.now()) button.disabled = false; }
  }
  async decoder() {
    if (this.window.jsQR) return this.window.jsQR;
    if (!this.decoderPending) this.decoderPending = new Promise((resolve, reject) => {
      const script = this.document.createElement('script'); script.src = new URL('../assets/vendor/jsQR.js', this.window.location.href).href;
      script.onload = () => this.window.jsQR ? resolve(this.window.jsQR) : reject(Error('QR scanner could not initialize.'));
      script.onerror = () => { script.remove(); reject(Error('QR scanner could not load. Check your connection and retry.')); };
      this.document.head.append(script);
    }).catch(error => { this.decoderPending = null; throw error; });
    return this.decoderPending;
  }
  async startCamera() {
    if (!this.dialog || this.starting || this.confirming || !this.selection().eventId) return;
    this.reset(); const generation = this.generation, dialog = this.dialog;
    this.starting = true;
    const button = this.field('[data-qr-camera]'); button.disabled = true;
    this.status('Allow camera access to scan the student’s QR.');
    try {
      if (!this.window.navigator.mediaDevices?.getUserMedia) throw Error('Camera scanning requires HTTPS and camera permission.');
      const decodeQr = await this.decoder();
      if (this.dialog !== dialog || generation !== this.generation) return;
      const stream = await this.window.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } });
      if (this.dialog !== dialog || generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const video = this.field('[data-qr-video]'); video.srcObject = stream; video.hidden = false; await video.play();
      const canvas = this.document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw Error('The scanner could not access camera frames.');
      this.status('Point the camera at the student’s QR.');
      const frame = () => {
        if (this.dialog !== dialog || generation !== this.generation || !this.stream) return;
        try {
          if (video.readyState >= 2 && video.videoWidth) {
            const ratio = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = decodeQr(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) { this.stopCamera(); void this.scan(code.data); return; }
          }
          this.frameTimer = this.window.setTimeout(frame, 200);
        } catch { this.stopCamera(); this.status('Camera scanning stopped. Start the camera to retry.', true); }
      };
      frame();
    } catch (error) {
      if (this.dialog === dialog && generation === this.generation) {
        this.stopCamera(); this.status(error.name === 'NotAllowedError' ? 'Camera access was denied. Enable camera permission for Presence, then retry.' : error.message, true);
      }
    } finally { this.starting = false; if (this.dialog === dialog) button.disabled = false; }
  }
  async scan(token) {
    const generation = this.generation, dialog = this.dialog, selection = this.selection();
    this.status('Verifying student and attendance session…');
    const button = this.field('[data-qr-camera]'); button.disabled = true;
    try {
      const result = await this.api.call('/v1/admin/attendance-qr/preview', this.getUser(), { ...selection, token });
      if (this.dialog !== dialog || generation !== this.generation) return;
      if (result.existing) { this.status(selection.action === 'in' ? 'Already checked in. No attendance was changed.' : 'Already checked out. No attendance was changed.'); return; }
      this.preview = { ...result, ...selection };
      const deadline = Date.now() + result.expiresAt - result.serverNow;
      const e = this.escapeHtml, panel = this.field('[data-qr-confirmation]'); panel.hidden = false;
      panel.innerHTML = `<h3>Is this the student in front of you?</h3><div class="attendance-qr-person"><div data-qr-photo></div><div><strong>${e(result.student.name)}</strong><p>${e(result.student.studentId)}</p><p>${e(result.student.course)} · Section ${e(result.student.section)}</p></div></div><p><strong>${e(result.event.name)}</strong> · ${e(result.event.date)} · ${selection.action === 'in' ? 'Check-in' : 'Check-out'}</p><label class="attendance-qr-verify"><input type="checkbox" data-qr-verified> I verified this student in person.</label><p data-qr-confirm-countdown></p><div class="button-row"><button class="outline-button" type="button" data-qr-cancel>Cancel</button><button class="primary-button" type="button" data-qr-save disabled>Confirm ${selection.action === 'in' ? 'check-in' : 'check-out'}</button></div>`;
      if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(result.student.photo)) {
        const img = this.document.createElement('img'); img.src = result.student.photo; img.alt = 'Student profile photo'; this.field('[data-qr-photo]').append(img);
      } else this.field('[data-qr-photo]').textContent = 'No photo—verify Student ID';
      this.field('[data-qr-verified]').onchange = () => { this.field('[data-qr-save]').disabled = !this.field('[data-qr-verified]').checked || Date.now() >= deadline; };
      this.field('[data-qr-cancel]').onclick = () => this.reset();
      this.field('[data-qr-save]').onclick = () => void this.confirm();
      this.status('Verify the student’s identity before confirming.');
      const tick = () => {
        if (!this.preview) return;
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        this.field('[data-qr-confirm-countdown]').textContent = `Confirmation expires in ${seconds}s`;
        if (!seconds) { this.field('[data-qr-save]').disabled = true; this.status('Confirmation expired. Scan again.', true); this.window.clearInterval(this.expiryTimer); }
      };
      tick(); this.expiryTimer = this.window.setInterval(tick, 1000);
    } catch (error) { if (this.dialog === dialog && generation === this.generation) this.status(error.message, true); }
    finally { if (this.dialog === dialog) button.disabled = false; }
  }
  async confirm() {
    if (this.confirming || !this.preview || !this.field('[data-qr-verified]').checked) return;
    const { eventId, action, confirmation } = this.preview, generation = this.generation, dialog = this.dialog;
    this.confirming = true;
    for (const element of dialog.querySelectorAll('button, select, input')) element.disabled = true;
    this.status('Saving verified attendance…');
    try {
      const result = await this.api.call('/v1/admin/attendance-qr/confirm', this.getUser(), { eventId, action, confirmation });
      if (this.dialog !== dialog || generation !== this.generation) return;
      this.reset();
      const message = result.saved ? `${result.student.name}: ${action === 'in' ? 'check-in' : 'check-out'} recorded.` : 'Attendance was already recorded. No duplicate was created.';
      this.status(message); this.showToast(result.saved ? 'Attendance recorded' : 'Already recorded', message);
    } catch (error) {
      if (this.dialog === dialog && generation === this.generation) {
        this.reset(); this.status(`${error.message} Attendance is not confirmed here. Scan again to check the saved status before retrying.`, true);
      }
    } finally {
      this.confirming = false;
      if (this.dialog === dialog) for (const element of dialog.querySelectorAll('button, select, input')) element.disabled = false;
    }
  }
  stopCamera() {
    this.window.clearTimeout(this.frameTimer);
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    const video = this.dialog?.querySelector('[data-qr-video]');
    if (video) { video.srcObject = null; video.hidden = true; }
  }
  close(force = false) {
    if (this.confirming && !force) { this.status('Please wait while attendance is saved.'); return; }
    this.reset();
    this.window.clearInterval(this.eventTimer); this.eventTimer = undefined;
    const dialog = this.dialog; this.dialog = null;
    if (dialog) { dialog.close?.(); dialog.remove(); }
    this.document.body.removeAttribute('data-attendance-qr');
    if (dialog && !this.page) this.opener?.focus();
  }
  dispose() {
    this.cachedQr = null;
    this.close(true); this.button?.removeEventListener('click', this.onOpen);
    this.document.removeEventListener('visibilitychange', this.onVisibility);
    this.window.removeEventListener('presence:attendance-qr-back', this.onBack);
    this.window.removeEventListener('presence:viewchange', this.onView);
    this.window.removeEventListener('presence:device-signing-out', this.onSigningOut);

  }
}
