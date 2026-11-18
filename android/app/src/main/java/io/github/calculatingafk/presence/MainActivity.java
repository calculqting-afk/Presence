package io.github.calculatingafk.presence;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    private GithubUpdateController updates;
    GithubUpdateController getUpdates() {
        if (updates == null) updates = new GithubUpdateController(this);
        return updates;
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AttendancePdfPlugin.class);
        registerPlugin(AttendanceSpreadsheetPlugin.class);
        registerPlugin(AttendanceQrImagePlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override public void onResume() {
        super.onResume();
        getUpdates().checkOnResume();
    }

    @Override public void onDestroy() {
        if (updates != null) updates.dispose();
        super.onDestroy();
    }

    @Override public void onPause() {
        if (updates != null) updates.onPause();
        super.onPause();
    }
}
