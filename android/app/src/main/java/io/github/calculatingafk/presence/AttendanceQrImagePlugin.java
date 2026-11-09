package io.github.calculatingafk.presence;

import android.app.Activity;
import android.content.Intent;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/** Saves a QR PNG only to a destination explicitly chosen by the user. */
@CapacitorPlugin(name = "AttendanceQrImage")
public class AttendanceQrImagePlugin extends Plugin {
    private boolean saving;
    private byte[] imageBytes(PluginCall call) {
        String encoded = call.getString("base64", "");
        if (encoded.length() > 3 * 1024 * 1024) throw new IllegalArgumentException("QR image is too large.");
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        byte[] signature = {(byte)137, 80, 78, 71, 13, 10, 26, 10};
        if (bytes.length < 24 || bytes.length > 2 * 1024 * 1024) throw new IllegalArgumentException("Invalid QR image.");
        for (int i = 0; i < signature.length; i++) if (bytes[i] != signature[i]) throw new IllegalArgumentException("PNG required.");
        return bytes;
    }
    @PluginMethod public void save(PluginCall call) {
        if (saving) { call.reject("Another QR save is in progress."); return; }
        try {
            imageBytes(call);
            String name = call.getString("filename", "Presence-QR.png");
            if (!name.matches("[A-Za-z0-9._-]{1,120}\\.png")) throw new IllegalArgumentException("Invalid image filename.");
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/png"); intent.putExtra(Intent.EXTRA_TITLE, name);
            saving = true; startActivityForResult(call, intent, "saveResult");
        } catch (Exception error) { saving = false; call.reject("Unable to open the QR save dialog.", error); }
    }
    @ActivityCallback private void saveResult(PluginCall call, ActivityResult result) {
        saving = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject(); response.put("cancelled", true); call.resolve(response); return;
        }
        execute(() -> {
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (stream == null) throw new IllegalStateException("No output stream.");
                stream.write(imageBytes(call)); stream.flush();
                JSObject response = new JSObject(); response.put("saved", true); call.resolve(response);
            } catch (Exception error) { call.reject("QR could not be saved. Check the selected destination.", error); }
        });
    }
}
