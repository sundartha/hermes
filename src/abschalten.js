const TEILFRIST_ANTEIL = 0.8;

function zaehleOffeneAnfragen(httpServer) {
  let offen = 0;
  let wennLeer = null;
  if (typeof httpServer.on === "function") {
    httpServer.on("request", (req, res) => {
      if (res.writableEnded) return;
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
        setTimeout(() => resolve(true), teilfristMs).unref();
        wennLeer = () => resolve(false);
      });
    },
  };
}

const FRIST_ABGELAUFEN = Symbol("frist-abgelaufen");

async function stoppeQueueInnerhalbFrist({ stopQueue, teilfristMs, log, logError }) {
  let uhr;
  const frist = new Promise((resolve) => {
    uhr = setTimeout(() => resolve(FRIST_ABGELAUFEN), teilfristMs);
    uhr.unref();
  });
  try {
    const ergebnis = await Promise.race([stopQueue(), frist]);
    if (ergebnis === FRIST_ABGELAUFEN)
      log("[shutdown] Warteschlange nicht rechtzeitig gestoppt - weiter mit Flush");
    else if (ergebnis) log("[shutdown] Warteschlange gestoppt");
  } catch (err) {
    logError(`[shutdown] Warteschlange-Stopp fehlgeschlagen: ${err.message}`);
  } finally {
    clearTimeout(uhr);
  }
}

export function makeGracefulShutdown({
  httpServer,
  store,
  config,
  releaseLongPolls = () => {},
  stopQueue = async () => false,
  abschaltweiche = { einschalten: () => {} },
  instanzTakt = { stoppen: async () => {}, abmelden: async () => {} },
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
    setTimeout(() => {
      log("[shutdown] Gesamtfrist abgelaufen - Exit 1");
      exit(1);
    }, config.server.shutdownDrainTimeoutMs).unref();
    const teilfristMs = Math.floor(config.server.shutdownDrainTimeoutMs * TEILFRIST_ANTEIL);
    const queueGestoppt = stoppeQueueInnerhalbFrist({ stopQueue, teilfristMs, log, logError });
    abschaltweiche.einschalten();
    releaseLongPolls();
    const teilfristAbgelaufen = await zaehler.warteBis(teilfristMs);
    if (teilfristAbgelaufen)
      log(`[shutdown] Teilfrist abgelaufen - ${zaehler.offen()} offene Anfragen abgebrochen`);
    httpServer.close(() => {});
    if (typeof httpServer.closeIdleConnections === "function") httpServer.closeIdleConnections();
    if (teilfristAbgelaufen) httpServer.closeAllConnections();
    await queueGestoppt;
    await instanzTakt.stoppen();
    let flushError = null;
    try {
      await store.save();
      await store.drainFlushes();
    } catch (err) {
      flushError = err;
    }
    if (flushError) {
      logError(
        `[shutdown] Finaler Store-Flush FEHLGESCHLAGEN - Datenverlust moeglich: ${flushError.message}`,
      );
      exit(1);
      return;
    }
    log("[shutdown] Finaler Store-Flush abgeschlossen");
    await instanzTakt.abmelden();
    exit(0);
  };
}
