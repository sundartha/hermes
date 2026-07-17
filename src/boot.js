// ---- Boot-Sequenz (Server-Slim P15) ---------------------------------------------
// bootServer(deps) startet den fertig verdrahteten app: store.load, DSGVO-Retention,
// Fail-closed-Boot-Gates, listen+Banner, Audio-Bridge, Provisioning-Reconcile,
// Graceful-Shutdown. REINE Verschiebung aus server.js (byte-identische Reihenfolge,
// Log-Zeilen, exit-Codes). INV-5: rearmActiveCallTimers NACH allen exit1-Gates,
// unmittelbar VOR listen; kein Gate danach ruft process.exit(1). INV-6: die
// "Hermes Gateway laeuft auf ..."-Zeile erst im listen-Callback (nach vollem Boot).
import { assertConfig } from "./config.js";
import { fakeOriginateBootBlocked, meterMappingGaps } from "./boot-guard.js";
import { hasActiveNumber } from "./store/views.js";
import { attachMediaBridge } from "./bridge.js";
import { USAGE_EVENT_KIND } from "./store/defaults.js";
import { STRIPE_METER_EVENT_NAME } from "./billing/stripe.js";

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Retention (DSGVO): alte Transkripte/Notifications beim Start und periodisch loeschen
function runRetention(store, config) {
  const removed = store.pruneOldData();
  if (removed.calls || removed.notifications || removed.actionItems)
    console.log(
      `[retention] geloescht: ${removed.calls} Calls, ${removed.notifications} Notifications, ${removed.actionItems} erledigte Action Items (aelter als ${config.retentionDays} Tage)`,
    );
}

// Alle vier fail-closed Boot-Gates gebuendelt (macht INV-5 "rearm NACH allen
// exit1-Gates" strukturell sichtbar - kein Code danach kann ein Gate vergessen).
function assertBootGates(config, store) {
  const ok = assertConfig();
  // Fail-closed (OT-4): bei ungueltiger Safety-/Pflicht-Konfiguration wird der Dienst
  // GAR NICHT gestartet - kein app.listen, kein /voice, kein /mcp, keine Audio-Bridge.
  // Lieber kein Dienst als ein Dienst mit lautlos abgeschaltetem Budget-/Kosten-Gate
  // (R4 Toll-Fraud). Die actionable Diagnose hat assertConfig() bereits ausgegeben.
  if (!ok) {
    console.error("[boot] Start abgebrochen: Safety-/Pflicht-Konfiguration ungueltig (siehe oben).");
    process.exit(1);
  }

  // Boot-Haertung (OUT-05, F2): FAKE_ORIGINATE nur mit geskippter Signaturpruefung zulaessig ->
  // in Prod (Signatur fail-closed AN, Regel 1) Boot-Refusal statt stillem Nicht-Waehlen.
  if (fakeOriginateBootBlocked(config)) {
    console.error(
      "[boot] Start abgebrochen: FAKE_ORIGINATE=true ist nur mit SKIP_TWILIO_SIGNATURE_CHECK=true " +
        "zulaessig (Test-Seam, in Produktion unzulaessig).",
    );
    process.exit(1);
  }

  // Boot-Guard (Pre-Mortem): jeder Tenant - auch der Bootstrap-Tenant - haelt seine
  // Absendernummer im Store, nicht in der Env. Tenant-agnostisch (P2b): der Dienst ist
  // "telefonbar", sobald IRGENDEIN Tenant eine aktive Nummer hat (kein OWNER/BOOTSTRAP-Pin
  // mehr). Nach lokalem Reset (data/store.json geloescht) oder frischem Postgres ohne Seed
  // waere keine aktive Nummer da -> Outbound + SMS still tot. Fail-closed wie die fruehere
  // TWILIO_NUMBER-Boot-Pflicht: leerer Store -> kein Start. Loggt KEINE Nummer (kein Leak),
  // verweist auf das Bootstrap-CLI.
  if (!hasActiveNumber(store.load())) {
    console.error(
      "[boot] Keine aktive Nummer im Store. Erst seeden: " +
        "npm run bootstrap-tenant -- <e164> <provider>",
    );
    process.exit(1);
  }

  // S1-7: Vollstaendigkeit der Stripe-Meter-Abbildung. Fehlt einer usage_event-Sorte ein
  // event_name, wirft reportMeter erst zur LAUFZEIT (beim ersten Flush dieser Sorte) - der
  // Umsatz dieser Sorte bliebe unbemerkt endlos pending. Boot-Zeit-Assertion statt spaeter
  // Ueberraschung (Muster der drei vorigen Gates).
  const meterGaps = meterMappingGaps(Object.values(USAGE_EVENT_KIND), STRIPE_METER_EVENT_NAME);
  if (meterGaps.length) {
    console.error(
      `[boot] Start abgebrochen: usage_event-Sorten ohne Stripe-Meter-Abbildung: ${meterGaps.join(",")}. ` +
        "STRIPE_METER_EVENT_NAME in src/billing/stripe.js vervollstaendigen.",
    );
    process.exit(1);
  }
}

function logBootBanner(config, port) {
  // TEMP-DIAGNOSE (STT-Live-Abschluss, siehe STATUS.md Abschnitt 2): deployten Commit ausgeben, damit im
  // Render-Log eindeutig sichtbar ist, WELCHE Version laeuft (Render setzt
  // RENDER_GIT_COMMIT). Phase 3: wieder entfernen.
  console.log(`  [boot] deployed commit=${process.env.RENDER_GIT_COMMIT || "unbekannt"}`);
  console.log(`\n  Hermes Gateway laeuft auf http://localhost:${port}`);
  console.log(`  Dashboard:      http://localhost:${port}`);
  console.log(
    `  Voice-Engine:   ${config.voiceEngine}${config.voiceEngine === "realtime" && !config.openaiApiKey ? "  (ACHTUNG: OPENAI_API_KEY fehlt!)" : ""}`,
  );
  console.log(
    `  MCP (HTTP):     ${config.publicUrl || "PUBLIC_URL fehlt!"}/mcp  <- als Custom Connector in Claude eintragen`,
  );
  console.log(`  Twilio-Webhook: ${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/incoming`);
  console.log(`  Status-Callback:${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/status`);
  // Outbound-Freigabe (outbound-p3): keine statische ALLOWED_NUMBERS-Liste mehr - Permit ist
  // die per-Tenant-Verifikation (Abo+KYC, Pfad 2). OUTBOUND_FROZEN zeigt den globalen
  // Kill-Switch-Zustand. Kein PII (Nummern) mehr im Banner.
  console.log(
    `  Outbound:       ${config.outboundFrozen ? "EINGEFROREN (OUTBOUND_FROZEN=true)" : "aktiv (Verifikation per Tenant: Abo+KYC)"}`,
  );
  console.log(
    `  Nummern-Gates:  Land ${config.allowedCountryCodes.join(",")} | max ${config.maxCallsPerHour} Calls/h | Notruf-/Premium-Denylist aktiv`,
  );
}

export async function bootServer({ app, config, store, lifecycle, callFinish, provisioning }) {
  store.load();

  runRetention(store, config);
  setInterval(() => runRetention(store, config), RETENTION_SWEEP_INTERVAL_MS).unref();

  assertBootGates(config, store);

  // F10-ORD (Review-Blocker Runde 1): rearmActiveCallTimers() laeuft ERST HIER, NACH
  // allen Boot-Gates (assertConfig/fakeOriginateBootBlocked/hasActiveNumber), unmittelbar
  // VOR app.listen. Vorher (VOR assertConfig) haette ein Zombie-Call bereits
  // store.setCallEndedAt() + den synchronen Teil von finishCall (Buchung/markBilled)
  // ausgeloest, BEVOR ein scheiterndes assertConfig() im selben Tick process.exit(1)
  // feuert - der async-Rest von finishCall (releaseReserve/store.save/Notification/SMS)
  // liefe dann NIE mehr, der Call bliebe teilgebucht+Reserve-nie-freigegeben auf Platte
  // stehen. Das widerspraeche dem Boot-Gate-Versprechen "GAR NICHT gestartet" (Regel 1/
  // OT-4). Kein Gate danach darf mehr process.exit(1) rufen.
  lifecycle.rearmActiveCallTimers();

  const httpServer = app.listen(config.port, () => {
    // Tatsaechlichen Port verwenden: bei PORT=0 (Tests) vergibt das OS einen freien Port
    const port = httpServer.address().port;
    // Eigene REST-API fuer die MCP-Tools erreichbar machen (auch bei abweichendem PORT)
    process.env.GATEWAY_URL ||= `http://localhost:${port}`;
    logBootBanner(config, port);
    // PROV-01/F5: Crash-verwaiste Provisioning-Jobs beim Boot reconcilen. Fire-and-forget NACH
    // den Boot-Logs - blockiert weder listen noch Healthcheck; der Boot-Guard (hasActiveNumber)
    // lief bereits davor. Gated auf PROVISIONING_ENABLED, Default Observe-Only (maxAge=0).
    void provisioning.reconcileOrphanedProvisioning();
  });

  // Audio-Bridge (nur relevant bei VOICE_ENGINE=realtime)
  attachMediaBridge(httpServer, callFinish.finishCall);

  // F11 (A6): Graceful Shutdown. Ein Deploy/Restart schickt SIGTERM (Render), Ctrl+C SIGINT.
  // OHNE Handler killt Node den Prozess sofort -> ein in-flight /voice/turn stirbt mitten im
  // LLM-await (Agent-Transkript nie persistiert, keine TwiML-Antwort). Der Drain laesst laufende
  // Requests fertig laufen (await close) und flusht ERST DANACH den Store. Das ORDERING ist
  // entscheidend: kein Handler darf NACH dem finalen save() noch eine Mutation anhaengen.
  // Watchdog kappt einen haengenden Drain hart mit exit(0). shuttingDown schuetzt gegen
  // Wiedereintritt (zweites Signal / SIGTERM+SIGINT). Secret-frei (nur Signalname).
  //
  // Review-Blocker Runde 1 (F11):
  // S1-A: closeIdleConnections() MUSS unmittelbar NEBEN dem close(resolve)-Aufruf stehen,
  // NICHT erst nach dessen await. server.close() loest seinen Callback erst auf, wenn die
  // Verbindungszaehlung auf 0 steht - inklusive idler Keep-Alive-Sockets, die Node sonst
  // erst nach keepAliveTimeout von selbst schliesst. Haelt z.B. ein Health-Checker eine
  // staendig erneuerte Keep-Alive-Verbindung offen, wuerde "await close()" NIE von selbst
  // aufloesen, wenn closeIdleConnections() erst danach kaeme (Aufruf ohne Wirkung).
  // S1-B: store.save() haengt beim pg-Backend seinen DB-Write an eine asynchrone
  // flushChain und gibt nur EINE fruehe Referenz zurueck. Ein waehrend des Await feuernder
  // Hintergrund-Timer (Max-Dauer-Cap/Reserve-Release, unabhaengig von HTTP-Verbindungen)
  // kann seinen eigenen Flush HINTER dieser Referenz anhaengen - store.drainFlushes()
  // loopt, bis die Kette nachweislich stabil ist, bevor process.exit(0) faellt.
  let shuttingDown = false;
  async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] Signal ${signal} - draine in-flight Requests, dann finaler Store-Flush`);
    const watchdog = setTimeout(() => process.exit(0), config.shutdownDrainTimeoutMs).unref();
    const closed = new Promise((resolve) => httpServer.close(resolve));
    if (typeof httpServer.closeIdleConnections === "function") httpServer.closeIdleConnections();
    await closed;
    await store.save();
    await store.drainFlushes();
    clearTimeout(watchdog);
    process.exit(0);
  }
  process.once("SIGTERM", gracefulShutdown);
  process.once("SIGINT", gracefulShutdown);
}
