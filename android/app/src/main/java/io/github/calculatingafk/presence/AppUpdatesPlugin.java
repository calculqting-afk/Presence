package io.github.calculatingafk.presence;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Exposes only update status and the existing trusted native updater to the login page. */
@CapacitorPlugin(name = "AppUpdates")
public class AppUpdatesPlugin extends Plugin {
    private GithubUpdateController controller() { return ((MainActivity) getActivity()).getUpdates(); }
    private JSObject snapshot() {
        GithubUpdateController updates = controller();
        JSObject result = new JSObject();
        result.put("version", BuildConfig.VERSION_NAME);
        result.put("state", updates.getCheckState());
        result.put("message", BuildConfig.DISTRIBUTION_UPDATES ? updates.getCheckMessage()
            : "This app version does not support direct updates.");
        result.put("retrySeconds", updates.getRetrySeconds());
        result.put("supported", BuildConfig.DISTRIBUTION_UPDATES);
        return result;
    }
    @Override public void load() {
        getActivity().runOnUiThread(() -> controller().setStatusListener(() -> notifyListeners("status", snapshot())));
    }
    @PluginMethod public void getStatus(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(snapshot()));
    }
    @PluginMethod public void check(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            controller().checkManually();
            call.resolve(snapshot());
        });
    }
    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(() -> controller().setStatusListener(null));
    }
}
