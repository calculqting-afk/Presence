import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';

globalThis.PresenceNative = { isNative: Capacitor.isNativePlatform(), geolocation: Geolocation, attendancePdf: registerPlugin('AttendancePdf') };
if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
}
