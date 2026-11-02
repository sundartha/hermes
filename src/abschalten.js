export function makeGracefulShutdown({
  httpServer,
  store,
  config,
  releaseLongPolls = () => {},
  exit = process.exit,
  log = console.log,
  logError = console.error,
}) {
  let shuttingDown = false;
  return async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[shutdown] Signal ${signal} - draine in-flight Requests, dann finaler Store-Flush`);
    const watchdog = setTimeout(() => exit(0), config.server.shutdownDrainTimeoutMs).unref();
    releaseLongPolls();
    const closed = new Promise((resolve) => httpServer.close(resolve));
    if (typeof httpServer.closeIdleConnections === "function") httpServer.closeIdleConnections();
    await closed;
    let flushError = null;
    try {
      await store.save();
      await store.drainFlushes();
    } catch (err) {
      flushError = err;
    }
    clearTimeout(watchdog);
    if (flushError) {
      logError(
        `[shutdown] Finaler Store-Flush FEHLGESCHLAGEN - Datenverlust moeglich: ${flushError.message}`,
      );
      exit(1);
      return;
    }
    exit(0);
  };
}
