import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { mountUpdateControls } from './update-controls.js';

globalThis.PresenceNative = { isNative: Capacitor.isNativePlatform(), geolocation: Geolocation, localNotifications: LocalNotifications, pushNotifications: PushNotifications, attendancePdf: registerPlugin('AttendancePdf'), attendanceSpreadsheet: registerPlugin('AttendanceSpreadsheet'), attendanceQrImage: registerPlugin('AttendanceQrImage') };
if (Capacitor.isNativePlatform()) {
  const mountUpdates = () => void mountUpdateControls({ document, window, updates: registerPlugin('AppUpdates') });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountUpdates, { once: true });
  else mountUpdates();
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event('focus'));
  });
  App.addListener('backButton', ({ canGoBack }) => {
    if (document.body?.hasAttribute('data-attendance-qr')) {
      window.dispatchEvent(new Event('presence:attendance-qr-back'));
      return;
    }
    if (document.body?.hasAttribute('data-device-transfer')) {
      window.dispatchEvent(new Event('presence:device-transfer-back'));
      return;
    }
    if (document.body?.hasAttribute('data-attendance-readiness')) {
      window.dispatchEvent(new Event('presence:readiness-back'));
      return;
    }
    if (document.body?.hasAttribute('data-policy-required')) {
      window.dispatchEvent(new Event('presence:policy-back'));
      return;
    }
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
}
