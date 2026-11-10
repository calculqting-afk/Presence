package io.github.calculatingafk.presence;

import android.Manifest;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.io.File;
import java.util.UUID;

/** Adds only the requested QR PNG to the public Presence photo album. */
@CapacitorPlugin(name = "AttendanceQrImage", permissions = {
    @Permission(alias = "legacyGallery", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
})
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
            saving = true;
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("legacyGallery") != PermissionState.GRANTED) {
                requestPermissionForAlias("legacyGallery", call, "galleryPermission");
            } else saveGallery(call);
        } catch (Exception error) { saving = false; call.reject("Unable to save QR to Photos / Gallery.", error); }
    }
    @PermissionCallback private void galleryPermission(PluginCall call) {
        if (getPermissionState("legacyGallery") == PermissionState.GRANTED) saveGallery(call);
        else { saving = false; call.reject("Allow storage permission to save your QR to Photos / Gallery."); }
    }
    private void saveGallery(PluginCall call) {
        execute(() -> {
            Uri image = null;
            var resolver = getContext().getContentResolver();
            try {
                byte[] bytes = imageBytes(call);
                String original = call.getString("filename", "Presence-QR.png");
                String filename = original.substring(0, original.length() - 4) + "-" + UUID.randomUUID() + ".png";
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Presence");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                } else {
                    File album = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Presence");
                    if (!album.isDirectory() && !album.mkdirs()) throw new IllegalStateException("Pictures folder unavailable.");
                    values.put(MediaStore.Images.Media.DATA, new File(album, filename).getAbsolutePath());
                }
                image = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (image == null) throw new IllegalStateException("Gallery unavailable.");
                try (OutputStream stream = resolver.openOutputStream(image, "w")) {
                    if (stream == null) throw new IllegalStateException("No output stream.");
                    stream.write(bytes); stream.flush();
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues published = new ContentValues(); published.put(MediaStore.Images.Media.IS_PENDING, 0);
                    if (resolver.update(image, published, null, null) != 1) throw new IllegalStateException("Gallery could not publish the image.");
                }
                JSObject response = new JSObject(); response.put("saved", true); response.put("album", "Pictures/Presence"); call.resolve(response);
            } catch (Exception error) {
                if (image != null) try { resolver.delete(image, null, null); } catch (Exception ignored) {}
                call.reject("QR could not be saved to Photos / Gallery. Check available storage and retry.", error);
            } finally { saving = false; }
        });
    }
}
