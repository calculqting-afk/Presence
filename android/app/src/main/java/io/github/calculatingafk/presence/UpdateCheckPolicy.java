package io.github.calculatingafk.presence;

/** Uses elapsed time so changing the phone clock cannot bypass a server retry delay. */
final class UpdateCheckPolicy {
    private long nextAutomatic, retryAt;
    boolean failed;

    long remaining(long now, boolean manual) {
        return Math.max(0, (manual ? retryAt : Math.max(nextAutomatic, retryAt)) - now);
    }
    void succeeded(long now) {
        failed = false; retryAt = 0; nextAutomatic = now + 300000;
    }
    void failed(long now, long serverDelay) {
        failed = true;
        long delay = Math.max(60000, serverDelay);
        retryAt = delay > Long.MAX_VALUE - now ? Long.MAX_VALUE : now + delay;
        nextAutomatic = retryAt;
    }
}
