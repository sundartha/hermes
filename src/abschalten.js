const TEILFRIST_ANTEIL = 0.8;

function zaehleOffeneAnfragen(httpServer) {
  let offen = 0;
  let wennLeer = null;
  if (typeof httpServer.on === "function") {
    httpServer.on("request", (req, res) => {
      offen += 1;
      res.once("close", () => {
        offen -= 1;
        if (offen === 0 && wennLeer) wennLeer();
      });
    });
  }
  return {
    offen: () => offen,
    warteBis: (teilfristMs) => {
      if (offen === 0) return Promise.resolve(false);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(true), teilfristMs).unref();
        wennLeer = () => {
          clearTimeout(timer);
          resolve(false);
        };
      });
    },
  };
}

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
  const zaehler = zaehleOffeneAnfragen(httpServer);
  return async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[shutdown] Signal ${signal} - draine in-flight Requests, dann finaler Store-Flush`);
    let gesamtfristAbgelaufen = false;
    const gesamtfrist = setTimeout(() => {
      gesamtfristAbgelaufen = true;
      log("[shutdown] Gesamtfrist abgelaufen - Exit 1");
      exit(1);
    }, config.server.shutdownDrainTimeoutMs).unref();
    releaseLongPolls();
    httpServer.close(() => {});
    if (typeof httpServer.closeIdleConnections === "function") httpServer.closeIdleConnections();
    const teilfristMs = Math.floor(config.server.shutdownDrainTimeoutMs * TEILFRIST_ANTEIL);
    if (await zaehler.warteBis(teilfristMs)) {
      log(`[shutdown] Teilfrist abgelaufen - ${zaehler.offen()} offene Anfragen abgebrochen`);
      if (typeof httpServer.closeAllConnections === "function") httpServer.closeAllConnections();
    }
    let flushError = null;
    try {
      await store.save();
      await store.drainFlushes();
    } catch (err) {
      flushError = err;
    }
    clearTimeout(gesamtfrist);
    if (gesamtfristAbgelaufen) return;
    if (flushError) {
      logError(
        `[shutdown] Finaler Store-Flush FEHLGESCHLAGEN - Datenverlust moeglich: ${flushError.message}`,
      );
      exit(1);
      return;
    }
    log("[shutdown] Finaler Store-Flush abgeschlossen");
    exit(0);
  };
}
