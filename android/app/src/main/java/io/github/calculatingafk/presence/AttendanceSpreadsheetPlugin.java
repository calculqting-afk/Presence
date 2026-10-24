package io.github.calculatingafk.presence;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/** User-directed XLSX save, isolated from the existing PDF save/share plugin. */
@CapacitorPlugin(name = "AttendanceSpreadsheet")
public class AttendanceSpreadsheetPlugin extends Plugin {
    private boolean saving;
    private byte[] workbookBytes(PluginCall call) {
        String encoded = call.getString("base64", "");
        if (encoded.length() > 14 * 1024 * 1024) throw new IllegalArgumentException("Excel file exceeds the allowed size.");
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length < 4 || bytes.length > 10 * 1024 * 1024 || bytes[0] != 80 || bytes[1] != 75 || bytes[2] != 3 || bytes[3] != 4) throw new IllegalArgumentException("Invalid workbook.");
        return bytes;
    }
    @PluginMethod public void save(PluginCall call) {
        if (saving) { call.reject("Another Excel save is in progress."); return; }
        try {
            workbookBytes(call);
            String name = call.getString("filename", "Presence-attendance.xlsx");
            if (!name.matches("[A-Za-z0-9._-]{1,120}\\.xlsx")) throw new IllegalArgumentException("Invalid workbook filename.");
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            intent.putExtra(Intent.EXTRA_TITLE, name);
            saving = true;
            startActivityForResult(call, intent, "saveResult");
        } catch (Exception error) { saving = false; call.reject("Unable to open the Excel save dialog.", error); }
    }
    @ActivityCallback private void saveResult(PluginCall call, ActivityResult result) {
        saving = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject(); response.put("cancelled", true); call.resolve(response); return;
        }
        Uri uri = result.getData().getData();
        execute(() -> {
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (stream == null) throw new IllegalStateException("No output stream.");
                stream.write(workbookBytes(call)); stream.flush();
                JSObject response = new JSObject(); response.put("saved", true); call.resolve(response);
            } catch (Exception error) { call.reject("Excel could not be saved. A partial file may exist; check the selected destination.", error); }
        });
    }
}
