import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';

globalThis.PresenceNative = { isNative: Capacitor.isNativePlatform(), geolocation: Geolocation, localNotifications: LocalNotifications, pushNotifications: PushNotifications, attendancePdf: registerPlugin('AttendancePdf'), attendanceSpreadsheet: registerPlugin('AttendanceSpreadsheet') };
if (Capacitor.isNativePlatform()) {
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event('focus'));
  });
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
}
