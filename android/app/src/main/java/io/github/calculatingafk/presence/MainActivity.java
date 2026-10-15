package io.github.calculatingafk.presence;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private GithubUpdateController updates;

    @Override public void onResume() {
        super.onResume();
        if (updates == null) updates = new GithubUpdateController(this);
        updates.checkOnResume();
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
