package io.github.calculatingafk.presence;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** User-directed PDF export only. No storage permissions or remote uploads. */
@CapacitorPlugin(name = "AttendancePdf")
public class AttendancePdfPlugin extends Plugin {
    private boolean saving;
    private byte[] pdfBytes(PluginCall call) {
        String encoded = call.getString("base64", "");
        if (encoded.length() > 14 * 1024 * 1024) throw new IllegalArgumentException("PDF exceeds the allowed size.");
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length < 5 || bytes.length > 10 * 1024 * 1024
                || !new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-")) {
            throw new IllegalArgumentException("Invalid PDF document.");
        }
        return bytes;
    }
    private String filename(PluginCall call) {
        String name = call.getString("filename", "Presence-attendance.pdf");
        if (!name.matches("[A-Za-z0-9._-]{1,120}\\.pdf")) throw new IllegalArgumentException("Invalid PDF filename.");
        return name;
    }
    @PluginMethod public void save(PluginCall call) {
        if (saving) { call.reject("Another PDF save is in progress."); return; }
        try {
            pdfBytes(call);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/pdf");
            intent.putExtra(Intent.EXTRA_TITLE, filename(call));
            saving = true;
            startActivityForResult(call, intent, "saveResult");
        } catch (Exception error) { saving = false; call.reject("Unable to open the PDF save dialog.", error); }
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
                stream.write(pdfBytes(call)); stream.flush();
                JSObject response = new JSObject(); response.put("saved", true); call.resolve(response);
            } catch (Exception error) { call.reject("PDF could not be saved. A partial file may exist; check the selected destination.", error); }
        });
    }
    @PluginMethod public void share(PluginCall call) {
        execute(() -> {
            try {
                byte[] bytes = pdfBytes(call);
                File directory = new File(getContext().getCacheDir(), "attendance-reports");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot create report cache.");
                File session = new File(directory, Long.toHexString(System.nanoTime()));
                if (!session.mkdir()) throw new IllegalStateException("Cannot create report session.");
                File file = new File(session, filename(call));
                try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(bytes); }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("application/pdf"); share.putExtra(Intent.EXTRA_STREAM, uri);
                share.setClipData(ClipData.newRawUri("Attendance PDF", uri));
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try { getActivity().startActivity(Intent.createChooser(share, "Share attendance PDF")); JSObject response = new JSObject(); response.put("started", true); call.resolve(response); }
                    catch (Exception error) { call.reject("No compatible app could share this PDF.", error); }
                });
            } catch (Exception error) { call.reject("PDF could not be prepared for sharing.", error); }
        });
    }
}
