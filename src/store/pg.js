// Postgres-Store-Backend hinter STORE_BACKEND=pg. Haelt einen synchron
// gespiegelten In-Memory-Zustand (gleicher Shape wie das json-Backend), der bei
// init() einmal aus der DB hydriert wird; jede Mutation laeuft synchron gegen den
// Spiegel (state-ops.js, geteilte Fachlogik) und stoesst danach einen DB-Flush an.
//
// WARUM der Spiegel: die Store-Signaturen sind synchron und werden von den
// Callern teils ohne await aufgerufen (Bridge-Event-Handler, store.save()). pg ist
// async. Der Spiegel ist die kleinste Aenderung, die Contract-Parity zum
// json-Backend erreicht, ohne eine der Signaturen oder einen Caller zu
// veraendern. save() ist deshalb KEIN No-Op: die mutate-then-save()-Stellen
// (call.twilioSid/summary/objectiveAchieved) wirken auf eine Spiegel-Referenz aus
// getCall(); save() flusht den Spiegel zurueck in die DB.
//
// AKZEPTIERTES RESTRISIKO (P3b, single-tenant/ein-Prozess): bei mehreren
// Prozessen kann der Spiegel von der DB driften - gleichwertig zur heutigen
// json-Annahme (ein Prozess haelt den Zustand). Multi-Prozess-Korrektheit ist
// spaeterer Scope, nicht P3b.
import { config } from "../config.js";
import * as ops from "./state-ops.js";
import { tenantLanguage as tenantLanguageOf } from "./views.js";
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_PROVIDER,
  CENTS_PER_EUR,
  isBookableCents,
  USAGE_CORRUPT_REASON,
  emptyPlatformTtsUsage,
  emptyCostCrossCheck,
} from "./defaults.js";
import { migrate } from "../db/migrate.js";
import { backfillGreetingNotices } from "./greeting-notice-migration.js";

// Owner-Tenant zentral in defaults.js; hier re-exportiert, weil Tests + pg-helpers
// die Konstante historisch von store/pg.js importieren (Import-Stabilitaet).
export { BOOTSTRAP_TENANT_ID };

// makePgStore(runner) -> Objekt mit den Store-Funktionen (Namensliste in store.js).
// runner-Vertrag:
//   withClient(fn) : ruft fn(client) auf EINER Verbindung; client.query(text,
//                    params)->{rows} und client.exec(sqlScript) (Mehrfach-DDL).
// KEINE DB-Verbindung hier konstruiert (DIP): Pool/Adapter wird injiziert. init()
// muss vor dem ersten Zugriff erwartet werden (Migration + Hydrierung).

// KS-P1b: die zwei Suchachsen des Re-Attach als vollstaendige, parametrisierte Queries -
// EINE Scan-Implementierung (attachActiveCallRow) bedient beide (G5). Bewusst zwei fertige
// Statements statt eines interpolierten WHERE-Fragments: so gibt es keinen Pfad, auf dem je
// ein Aufrufer-Wert in den SQL-Text geraten koennte.
const ACTIVE_CALL_BY_ID_SQL = `SELECT * FROM call WHERE id = $1 AND status = $2`;
const ACTIVE_CALL_BY_CONTROL_ID_SQL = `SELECT * FROM call WHERE call_control_id = $1 AND status = $2`;

export function makePgStore(runner) {
  let state = null;
  // Serialisiert die DB-Flushes: Mutationen rufen save() synchron, der DB-Write
  // wird an diese Kette gehaengt, damit Flushes nicht ineinander laufen.
  let flushChain = Promise.resolve();
  // S1-2: Fehlerzustand des ZULETZT abgeschlossenen Flush. save() setzt ihn im Fehlerarm,
  // loescht ihn im Erfolgsarm (Voll-Upsert-Semantik: nur der letzte Flush zaehlt).
  // drainFlushes() wirft ihn -> gracefulShutdown kann fail-closed exit(1) statt lautlos exit(0).
  let lastFlushError = null;

  function requireState() {
    if (!state) throw new Error("pg-Store nicht initialisiert - erst await store.init() aufrufen");
    return state;
  }

  // Migriert + hydriert den Spiegel einmalig aus der DB. Schema/Seeding/Hydrierung
  // laufen auf EINER Verbindung (withClient), damit die RLS-GUC waehrend der
  // tenant-scoped Reads/Inserts gesetzt bleibt (auf einem Pool waere sonst jede
  // Anweisung eine andere Session). Die GUC wird VOR dem Seeding gesetzt, sonst
  // wuerde die RLS-WITH-CHECK die Owner-Inserts unter einer nicht-privilegierten
  // DB-Rolle blocken.
  async function init() {
    await runner.withClient(async (client) => {
      await setTenant(client, BOOTSTRAP_TENANT_ID);
      await migrate(client, BOOTSTRAP_TENANT_ID);
      state = await hydrate(client);
      // Bootstrap-Zeile gezielt flushen (flushTenants ist RLS-frei -> unter der init-GUC
      // zulaessig). EINE Quelle fuer beide Boot-Seeds (idp_subject + kyc_level), G5.
      const flushBootstrap = () =>
        flushTenants(
          client,
          state.tenants.filter((t) => t.id === BOOTSTRAP_TENANT_ID),
        );
      // AM6: Owner-OAuth-Identitaet (OWNER_IDP_SUBJECT) idempotent an den Bootstrap-Tenant
      // binden. Nur bei echter Mutation (set-if-absent) wird die bootstrap-Zeile geflusht;
      // danach ist idp_subject persistent -> Folge-Boots sind No-Op/byte-identisch. P2b bleibt
      // sonst: kein config-derived Daten-Seed (Erst-Setup ueber scripts/bootstrap-tenant.js).
      if (ops.seedBootstrapIdpSubject(state, config.auth.ownerIdpSubject, BOOTSTRAP_TENANT_ID))
        await flushBootstrap();
      // Phase outbound-p1: Owner-Tenant idempotent auf id_verified heilen (set-if-absent),
      // damit er den fail-closed kycReached-Flip ueberlebt. kyc_level round-trippt bereits
      // (rowToTenant/flushTenants). LIVE ist pg -> heilt den realen Prod-Owner beim naechsten
      // Boot ohne Shell (Free-Tier hat kein preDeploy).
      if (ops.seedBootstrapKyc(state, BOOTSTRAP_TENANT_ID)) await flushBootstrap();
      // O7-Migration (GAP-14) auf DEMSELBEN init-Client (kein zweiter Pool-Client):
      // settings steht unter FORCE-RLS -> je Tenant die GUC setzen, sonst traefe der
      // Upsert lautlos 0 Zeilen. Muster wie flushTenantScope. Idempotent: Folge-Boots
      // aendern nichts und flushen nichts.
      for (const tenantId of backfillGreetingNotices(state)) {
        await setTenant(client, tenantId);
        await flushSettings(client, tenantId, ops.settingsFor(state, tenantId));
      }
      await setTenant(client, BOOTSTRAP_TENANT_ID); // GUC wieder auf den Init-Scope
    });
    return state;
  }

  // Flusht den kompletten Spiegel in die DB (eine Transaktion auf einer
  // Verbindung, RLS-GUC gesetzt). Full-Upsert + Delete-Missing spiegelt das
  // heutige json-Verhalten (kompletter Datei-Rewrite pro save) und macht jeden
  // mutate-then-save()-Pfad korrekt. save() wird synchron gerufen; der DB-Write
  // haengt an flushChain, damit Flushes nicht ineinander laufen.
  // preFlush (optional): eine zusaetzliche Aktion auf DEMSELBEN Client, INNERHALB
  // derselben Transaktion wie der Flush (P16/G26: aktuell nur eraseTenantData -
  // Hard-Delete der erfassten Call-Zeilen, siehe dort). Ein Rollback des Flush
  // (z.B. transienter DB-Fehler) rollt damit auch den preFlush zurueck - keine
  // teilweise DSGVO-Loeschung. Ohne Argument identisch zum bisherigen save().
  function save(preFlush) {
    const snapshot = requireState();
    flushChain = flushChain
      .then(() => runner.withClient((client) => flush(client, snapshot, preFlush)))
      .then(
        () => {
          // Erfolgreicher Flush loescht einen zuvor gemerkten Fehler (nur der letzte Flush
          // zaehlt - kein maskierter Verlust, Voll-Upsert-Semantik).
          lastFlushError = null;
        },
        (err) => {
          // Fehler ueberlebt als lastFlushError (drainFlushes liest ihn); die Kette bleibt
          // trotzdem RESOLVED -> Aufrufer-Verhalten (createCall etc., gracefulShutdown) unveraendert.
          lastFlushError = err;
          console.error("[pg] Flush fehlgeschlagen:", err.message);
        },
      );
    return flushChain;
  }

  // F11 (Review-Blocker Runde 1, S1-B): save() gibt genau EINE flushChain-Referenz
  // zurueck. Feuert waehrend eines await auf diese Referenz ein unabhaengiger
  // Hintergrund-Timer (Max-Dauer-Cap/Reserve-Release, server.js) und ruft selbst
  // save() auf, haengt sich dessen Flush HINTER der bereits zurueckgegebenen
  // Referenz ein - wer nur diese fruehe Referenz awaitet, sieht den spaeteren
  // Flush nie fertig. drainFlushes() loopt stattdessen: erst die aktuelle Kette
  // abwarten, dann pruefen, ob waehrenddessen eine NEUERE Kette angehaengt wurde
  // (weiterer save()-Aufruf) - und falls ja, auch diese abwarten. Stabil erst,
  // wenn sich flushChain zwischen await und Pruefung nicht mehr veraendert hat.
  // Fuer den finalen Shutdown-Flush (Regel 1: keine gekillte Transaktion mitten
  // in Budget/Billing) ist das die einzige korrekte Garantie.
  async function drainFlushes() {
    let ref = flushChain;
    for (;;) {
      await ref;
      if (flushChain === ref) break;
      ref = flushChain;
    }
    // S1-2: Ein fehlgeschlagener (letzter) Flush ueberlebt hier -> werfen, damit der finale
    // Shutdown-Flush nicht lautlos in exit(0) muendet. Ein nachfolgender erfolgreicher save()
    // hat lastFlushError bereits geleert (Clear-on-Success).
    if (lastFlushError) throw lastFlushError;
  }

  // KS-P1b: der EINE Re-Attach-Scan, parametrisiert ueber das fertige Statement (G5).
  // Vorher stand er inline in attachActiveCall; die ccid-Variante haette ihn sonst
  // wortgleich ein zweites Mal gebraucht (S2). Verhalten der id-Variante unveraendert.
  // Die Folge-Queries und der RACE-GUARD haengen an rows[0].id, NICHT am Suchwert -
  // nur so traegt derselbe Scan auch eine Suche ueber die call_control_id.
  async function attachActiveCallRow(sql, lookupValue) {
    try {
      const state = requireState();
      return await runner.withClient(async (client) => {
        for (const tenant of state.tenants) {
          await setTenant(client, tenant.id);
          const rows = (await client.query(sql, [lookupValue, CALL_STATUS_ACTIVE])).rows;
          if (rows.length === 0) continue;
          const callId = rows[0].id;
          const segRows = (
            await client.query(`SELECT * FROM transcript_segment WHERE call_id = $1 ORDER BY id ASC`, [
              callId,
            ])
          ).rows;
          const itemRows = (
            await client.query(`SELECT * FROM action_item WHERE call_id = $1 ORDER BY seq DESC`, [
              callId,
            ])
          ).rows;
          const call = rowToCall(rows[0], groupTranscripts(segRows), groupActionItemIds(itemRows));
          const raced = ops.getCall(state, callId);
          if (raced) return raced;
          state.calls.push(call);
          return call;
        }
        return null;
      });
    } catch (e) {
      console.error("[pg] attachActiveCall fehlgeschlagen:", e.message);
      return null;
    }
  }

  return {
    init,
    load: () => requireState(),
    save,
    drainFlushes,
    newId: ops.newId,

    createCall(input) {
      const call = ops.createCall(requireState(), input);
      save();
      return call;
    },
    getCall: (id) => ops.getCall(requireState(), id),
    // Brain-Shim-Korrelation (E1): Spiegel-Scan wie getCall (D-A), kein RLS/withClient-
    // Sonderpfad. Deploy-Grenze identisch zu getCall (Spiegel ist nach hydrate() warm).
    getCallByControlId: (ccid) => ops.getCallByControlId(requireState(), ccid),
    // F12 (A6): einen dem Spiegel unbekannten, aber in der DB aktiven Call RLS-sauber
    // nachladen. Ein Deploy-/Instanzwechsel legt eine aktive Zeile NACH unserer init()-
    // Hydrierung an -> getCall() findet sie nicht -> der /voice-Webhook legte sonst fail-
    // closed auf (Testanruf call_mr3lg2g7t9zg, 2026-07-02). Iteriert die hydrierten
    // state.tenants, setzt pro Tenant die RLS-GUC (setTenant) und sucht die aktive Zeile -
    // KEIN RLS-Bypass (Alt 6 verworfen), kein Cross-Tenant-Leck. Erster Treffer: Call
    // (+ Transkript + ActionItem-IDs derselben Zeile) ueber rowToCall bauen und idempotent
    // in den Spiegel pushen; RACE-GUARD (Muster ensureTenant): SYNCHRON unmittelbar vor dem
    // push erneut ops.getCall pruefen (kein await dazwischen), damit ein paralleler
    // Re-Attach-/Webhook-Pfad den Call nicht doppelt einlegt. Kein Treffer -> null.
    // FAIL-SAFE wie ensureTenant: ein DB-Schluckauf wird secret-frei geloggt und als null
    // behandelt -> der Handler legt fail-closed auf, NIE eine Rejection.
    attachActiveCall: (callId) => attachActiveCallRow(ACTIVE_CALL_BY_ID_SQL, callId),
    // KS-P1b: dieselbe RLS-saubere Nachladung ueber die Telnyx-eigene call_control_id -
    // der Assistant-Shim korreliert ausschliesslich darueber (E1, Anti-Spoofing), er kennt
    // keine callId. Leere/fehlende ccid -> null OHNE DB-Roundtrip. Das ist eine
    // Abkuerzung, KEIN eigenes Sicherheitsnetz: `WHERE call_control_id = NULL` trifft in
    // SQL ohnehin nie eine Zeile, und "" matcht nur eine gleichlautende. Der Riegel spart
    // den Tenant-Loop-Scan und haelt die Form von getCallByControlId (gleiche Antwort auf
    // dieselbe leere Eingabe) - gemessen: ohne ihn bleibt das Verhalten identisch.
    attachActiveCallByControlId: (ccid) =>
      ccid ? attachActiveCallRow(ACTIVE_CALL_BY_CONTROL_ID_SQL, ccid) : Promise.resolve(null),
    addTranscript(callId, role, text) {
      if (ops.addTranscript(requireState(), callId, role, text)) save();
    },
    // GQ-H1-a: verworfene Antwort aus dem Transkript nehmen. Muster identisch zu
    // addTranscript (changed -> save); flushTranscript raeumt die DB-Zeile mit ab.
    // LIEFERT den Befund zurueck (Muster json.js, NICHT addTranscript): der Shim verzweigt
    // darauf, nur eine tatsaechliche Entfernung erzeugt die discarded_answer-Zeile.
    dropLastAgentTranscript(callId) {
      const entfernt = ops.dropLastAgentTranscript(requireState(), callId);
      if (entfernt) save();
      return entfernt;
    },
    purgeTranscript(callId) {
      if (ops.purgeTranscript(requireState(), callId)) save();
    },
    markAnswered(callId) {
      const { call, changed } = ops.markAnswered(requireState(), callId);
      if (changed) save();
      return call;
    },
    // KS-EL1: der Anker nachziehen - Wrapper-Paritaet zu json.js. changed ist bei
    // ops.trueUpAnsweredAt unbedingt true (genau ein Schreiber, genau einmal je Call).
    trueUpAnsweredAt(callId, answeredAtIso) {
      const { call, changed } = ops.trueUpAnsweredAt(requireState(), callId, answeredAtIso);
      if (changed) save();
      return call;
    },
    // KS-EL1: der Grund, wenn der Anker nicht ermittelbar war - Wrapper-Paritaet zu
    // json.js (Muster recordElevenlabsConversationId).
    recordAnsweredUnclearReason(callId, reason) {
      const { call, changed } = ops.recordAnsweredUnclearReason(requireState(), callId, reason);
      if (changed) save();
      return call;
    },
    // ST3 (O3): Zaehlfeld der Stimmen-Detektoren - Wrapper-Paritaet zu json.js. Saved aus
    // demselben Grund wie die Handles darueber: es gibt eine Spalte (el_detector_counts),
    // und der Flush schreibt sie aus dem Spiegel.
    recordElDetectorCounts(callId, zaehlung) {
      const { call, changed } = ops.recordElDetectorCounts(requireState(), callId, zaehlung);
      if (changed) save();
      return call;
    },
    endCallRecord(callId, status = "completed") {
      const { call, changed } = ops.endCallRecord(requireState(), callId, status);
      if (changed) save();
      return call;
    },
    // F9 (A6): Terminalisierung mit explizitem Anker (F10/F12-Seam). Wrapper-Parity zu json.js.
    setCallEndedAt(callId, status, endedAtIso) {
      const { call, changed } = ops.setCallEndedAt(requireState(), callId, status, endedAtIso);
      if (changed) save();
      return call;
    },
    // Persistierter Summary-SMS-Dedup-Marker (F2 P9): Wrapper-Parity zu json.js. Der
    // Flush schreibt summary_sms_sent_at am call-Record -> ueberlebt den Restart (M2).
    markSummarySmsSent(callId) {
      const { call, changed } = ops.markSummarySmsSent(requireState(), callId);
      if (changed) save();
      return call;
    },
    // F2-Mail: persistierter Dedup-Marker fuer die Call-Summary-Mail - Wrapper-Parity zu
    // json.js. Der Flush schreibt summary_mail_sent_at am call-Record (Muster
    // markSummarySmsSent).
    markSummaryMailSent(callId) {
      const { call, changed } = ops.markSummaryMailSent(requireState(), callId);
      if (changed) save();
      return call;
    },
    // F9 (A6): persistierter Bucht-Marker - Flush schreibt billed_at (INSERT + ON CONFLICT).
    markBilled(callId) {
      const { call, changed } = ops.markBilled(requireState(), callId);
      if (changed) save();
      return call;
    },
    // INBOX-P1: Qualifikations-Marker - Wrapper-Parity zu json.js.
    markInboxEntry(callId, qualifies) {
      const { call, changed } = ops.markInboxEntry(requireState(), callId, qualifies);
      if (changed) save(); return call;
    },
    // INBOX-P2 (R-3): Wrapper-Parity zu json.js. save() flusht den KOMPLETTEN Spiegel
    // ALLER Tenants in die serialisierte flushChain - ein unbedingtes save() haengte
    // jeden Anruf-Schreibpfad hinter Leer-Polls, die nichts geaendert haben. Der Flush
    // schreibt inbox_seen_at (steht seit INBOX-P1 im ON CONFLICT DO UPDATE SET).
    takeInboxEntries(tenantId, options) {
      const result = ops.takeInboxEntries(requireState(), tenantId, options);
      if (result.marked) save();
      return result;
    },
    // LCT P2: gebuchter Schaetzbetrag - Flush schreibt estimated_cost_cents
    // (INSERT + ON CONFLICT DO UPDATE SET). KS-P5: input = { costCents, chargeAnchors },
    // die zwei Anker-Spalten stehen ebenfalls im ON CONFLICT DO UPDATE SET.
    recordCallEstimatedCostCents(callId, input) {
      const { call, changed } = ops.recordCallEstimatedCostCents(requireState(), callId, input);
      if (changed) save();
      return call;
    },
    // LCT P3: Abgleich-Ergebnis - Flush schreibt actual_cost_micro_cents/cost_trued_at/
    // cost_trued_source/cost_truing_attempts (P2 hat ALLE FUENF im ON CONFLICT DO UPDATE
    // SET - ohne das fiele der Wert beim naechsten Flush auf den Create-Zustand zurueck).
    recordCallCostTruingResult(callId, outcome) {
      const { call, changed } = ops.recordCallCostTruingResult(requireState(), callId, outcome);
      if (changed) save();
      return call;
    },
    // KV2-7: die zwei Schliessregel-Mutatoren als Spread-Fabrik statt zweier ausgeschriebener
    // Methoden IN makePgStore - haelt dessen gepinnte Zeilengrenze (eslint-legacy-exceptions.json),
    // Muster absenderWahrheitMutatoren (OUTBOUND-E5, unten in dieser Datei).
    ...kostenAbschlussMutatoren({ requireState, save }),
    // CDF1 (Report #2 5.4): persistierter Fehlergrund - Wrapper-Parity zu json.js. Der
    // Flush schreibt failure_reason am call-Record (INSERT + ON CONFLICT DO UPDATE).
    recordFailureReason(callId, reason) {
      const { call, changed } = ops.recordFailureReason(requireState(), callId, reason);
      if (changed) save();
      return call;
    },
    // AL-P1: Conversation-UUID + Anrufer-Turn-Zaehler - Wrapper-Paritaet zu json.js.
    // BEIDE saven (anders als countNoSpeechTurn): es gibt Spalten, und der Flush schreibt
    // sie aus dem Spiegel.
    recordTelnyxConversationId(callId, conversationId) {
      const { call, changed } = ops.recordTelnyxConversationId(requireState(), callId, conversationId);
      if (changed) save();
      return call;
    },
    // EL-BL1: das ElevenLabs-Handle - Wrapper-Paritaet zu json.js. Saved aus demselben
    // Grund: es gibt eine Spalte, und der Flush schreibt sie aus dem Spiegel.
    recordElevenlabsConversationId(callId, conversationId) {
      const { call, changed } = ops.recordElevenlabsConversationId(
        requireState(),
        callId,
        conversationId,
      );
      if (changed) save();
      return call;
    },
    // Phase-6-Voraussetzung: der Join-Schluessel zur Telefonie-Rechnung -
    // Wrapper-Paritaet zu json.js. Saved aus demselben Grund wie die Handles darueber: es
    // gibt eine Spalte, und der Flush schreibt sie aus dem Spiegel.
    recordSipCallId(callId, sipCallId) {
      const { call, changed } = ops.recordSipCallId(requireState(), callId, sipCallId);
      if (changed) save();
      return call;
    },
    // KV2-2: Wrapper-Paritaet zu json.js. Saved aus demselben Grund wie recordSipCallId.
    recordCostProfile(callId, profil) {
      const { call, changed } = ops.recordCostProfile(requireState(), callId, profil);
      if (changed) save();
      return call;
    },
    // KV2-3: Kosten-Buch. Wrapper-Paritaet zu json.js - saved nur bei changed (der
    // terminale No-Op schreibt nichts).
    recordCallCostEvidence(eingabe) {
      const { evidence, changed } = ops.recordCallCostEvidence(requireState(), eingabe);
      if (changed) save();
      return evidence;
    },
    callCostEvidence(callId) {
      return ops.callCostEvidence(requireState(), callId);
    },
    // OUTBOUND-E5: Absender-Wahrheits-Mutatoren als Spread (haelt den Zeilen-Pin, s.o.).
    ...absenderWahrheitMutatoren({ requireState, save }),
    // EL-Anrufstart: Zusammenfassung + Befund aus einer Anbieter-Antwort -
    // Wrapper-Paritaet zu json.js. Saved aus demselben Grund wie die Handles darueber: es
    // gibt Spalten (summary/objective_achieved), und der Flush schreibt sie aus dem Spiegel.
    recordProviderCallResult(callId, result) {
      const { call, changed } = ops.recordProviderCallResult(requireState(), callId, result);
      if (changed) save();
      return call;
    },
    // ABNAHME-D1 (TEIL 2): die vier strukturiert gesammelten Angaben - Wrapper-Paritaet zu
    // json.js. Saved aus demselben Grund wie recordProviderCallResult: es gibt Spalten
    // (appointment_date/appointment_time/amount/currency), und der Flush schreibt sie aus
    // dem Spiegel.
    recordProviderCollectedFields(callId, fields) {
      const { call, changed } = ops.recordProviderCollectedFields(requireState(), callId, fields);
      if (changed) save();
      return call;
    },
    // ABNAHME-D1 (TEIL 3): die bestaetigte Zeitzone des Angerufenen - Wrapper-Paritaet zu
    // json.js. Saved aus demselben Grund: es gibt Spalten (callee_confirmed_timezone +
    // Herkunft + Zeitstempel), und der Flush schreibt sie aus dem Spiegel.
    recordCalleeConfirmedTimezone(callId, confirmed) {
      const { call, changed } = ops.recordCalleeConfirmedTimezone(requireState(), callId, confirmed);
      if (changed) save();
      return call;
    },
    countCallerTurn(callId) {
      const { call, changed } = ops.countCallerTurn(requireState(), callId);
      if (changed) save();
      return call ? call.callerTurns : 0;
    },
    // AL-P13: Consult-Kette. emit/answer/expire saven (es gibt eine Spalte, der Flush
    // schreibt sie aus dem Spiegel); pendingConsult ist ein reiner Leser (kein save).
    emitConsult(callId, questions) {
      const { call, changed } = ops.emitConsult(requireState(), callId, questions);
      if (changed) save();
      return call;
    },
    answerConsult(callId, input) {
      const result = ops.answerConsult(requireState(), callId, input);
      if (result.changed) save();
      return result;
    },
    // GQ-P7: saved wie answerConsult - deliveredAt liegt in derselben consults-Spalte und
    // muss einen Instanzwechsel ueberleben (sonst oeffnet dieselbe Antwort ein zweites
    // Zustellfenster).
    markConsultAnswerDelivered(callId) {
      const result = ops.markConsultAnswerDelivered(requireState(), callId);
      if (result.changed) save();
      return result;
    },
    expireOpenConsults(callId) {
      const { call, changed } = ops.expireOpenConsults(requireState(), callId);
      if (changed) save();
      return call;
    },
    pendingConsult: (callId, afterEventId) =>
      ops.pendingConsult(requireState(), callId, afterEventId),
    // AL-P14: Zustandsschritt der Wartezeit - saved wie answerConsult (der Status liegt in
    // der consults-Spalte). noteConsultPoll saved NICHT: ephemer, es gibt keine Spalte
    // (Muster countNoSpeechTurn / releaseOutboundReserve).
    advanceInCallConsult(callId, input) {
      const { changed, wait } = ops.advanceInCallConsult(requireState(), callId, input);
      if (changed) save();
      return wait;
    },
    noteConsultPoll: (callId) => ops.noteConsultPoll(requireState(), callId),
    // AL-P10b: Suchtreffer im Kontext - saved wie answerConsult (context steht seit
    // AL-P13 im UPDATE-SET). countCallLookup saved NICHT: ephemer, keine Spalte.
    addLookupFacts(callId, facts) {
      const { changed, added } = ops.addLookupFacts(requireState(), callId, facts);
      if (changed) save();
      return added;
    },
    countCallLookup: (callId) => ops.countCallLookup(requireState(), callId),
    // Thema B (2026-08-19): Recherche-Protokoll des EL-Wegs - beide saven (Spalte
    // lookup_log, im UPDATE-SET; der Deckel zaehlt die Eintraege restart-fest).
    recordCallLookup(callId, query) {
      const { changed, seq } = ops.recordCallLookup(requireState(), callId, query);
      if (changed) save();
      return seq;
    },
    finishCallLookup(callId, seq, outcome) {
      const { changed } = ops.finishCallLookup(requireState(), callId, { seq, ...outcome });
      if (changed) save();
      return changed;
    },
    // P3.2: ephemerer No-Speech-Streak - Wrapper-Paritaet zu json.js. KEIN save(): es gibt
    // keine Spalte (Muster releaseOutboundReserve), der Flush-Spaltenblock bleibt unberuehrt.
    countNoSpeechTurn: (callId) => ops.countNoSpeechTurn(requireState(), callId),
    clearNoSpeechStreak: (callId) => ops.clearNoSpeechStreak(requireState(), callId),
    countOutboundCallsSince: (sinceIso, filters = {}) =>
      ops.countOutboundCallsSince(requireState(), sinceIso, filters),
    // AL-P12: reiner Leser auf dem Spiegel (Wrapper-Paritaet zu json.js).
    counterpartyMemory: (tenantId, e164) => ops.counterpartyMemory(requireState(), tenantId, e164),
    findTenantByNumber: (e164) => ops.findTenantByNumber(requireState(), e164),
    // Schwester-Query + Sprach-Aufloesung (F1 Phase 4). Reine Leser auf dem Spiegel.
    numberRecordByE164: (e164) => ops.numberRecordByE164(requireState(), e164),
    resolveCallLanguage: (args) => ops.resolveCallLanguage(requireState(), args),
    // Wrapper-Paritaet zu json.js (P15/T2): reiner Leser auf dem Spiegel.
    tenantLanguage: (tenantId) => tenantLanguageOf(requireState(), tenantId),

    addActionItem(callId, text, type = "todo") {
      const result = ops.addActionItem(requireState(), callId, text, type);
      // GQ-P4: eine Dublette hat NICHTS geaendert - kein Flush (Muster wie oben).
      if (!result.duplicate) save();
      return result;
    },
    // GQ-P10: reiner Leser - kein save (Muster pendingConsult).
    callActionItems: (callId) => ops.callActionItems(requireState(), callId),
    toggleActionItem(id) {
      const item = ops.toggleActionItem(requireState(), id);
      if (item) save();
      return item;
    },

    getCalendar: (tenantId) => ops.getCalendar(requireState(), tenantId),
    // event = { tenantId, title, startIso, endIso } - Wrapper-Parity zu json.js: die vier
    // Felder reisen zusammen und werden als EIN Objekt durchgereicht.
    addCalendarEvent(event) {
      const ev = ops.addCalendarEvent(requireState(), event);
      save();
      return ev;
    },
    findConflict: (tenantId, startIso, endIso) =>
      ops.findConflict(requireState(), tenantId, startIso, endIso),

    // Tenant-Kontext-Seam (I0): liest den hydrierten Spiegel (kein DB-Roundtrip).
    // Owner-Identitaet nicht mehr config-derived (P2b): leerer ownerName-Fallback ""
    // (Wrapper-Parity zu json.js); der Owner-Tenant traegt ownerName im Store.
    tenantContext: (tenantId) => ops.tenantContext(requireState(), "", tenantId),

    // nowIso wird HIER erzeugt (IO-Grenze) und an die zeit-freie ops-Funktion durchgereicht
    // (P4, Muster setSuspendedAtIfAbsent) - die Fassaden-Signatur bleibt unveraendert.
    trackUsage(tenantId, tokens, cfg) {
      const usage = ops.trackUsage(requireState(), tenantId, tokens, cfg, new Date().toISOString());
      save();
      return usage;
    },
    // nowIso wird HIER erzeugt (IO-Grenze) und an die zeit-freie ops-Funktion durchgereicht
    // (P7, Muster trackUsage): die Fassaden-Signatur bleibt unveraendert.
    budgetExceeded: (tenantId, cfg) =>
      ops.budgetExceeded(requireState(), tenantId, cfg, new Date().toISOString()),
    // KS-P2: Live-Variante von budgetExceeded (Mid-Call-Pruefung). Wrapper-Parity zu json.js.
    liveBudgetExceeded: (tenantId, liveCents, cfg) =>
      ops.liveBudgetExceeded(requireState(), tenantId, liveCents, cfg, new Date().toISOString()),
    // KS-P2/KV-P2: Basis des Live-Terms. Spiegel-Scan wie getCall, kein RLS/withClient-Sonderpfad.
    // GRENZE (dieselbe wie getCallByControlId): ein Leg, das eine ANDERE Instanz nach unserer
    // hydrate() angelegt hat, fehlt im Spiegel und faellt aus der Summe - der Live-Term
    // unterzaehlt dann, er ueberzaehlt nie.
    activeCallsFor: (tenantId) => ops.activeCallsFor(requireState(), tenantId),
    // Vorab-Reservierung (outbound-p1c): reine Query, kein save (wie budgetExceeded).
    reserveExceedsBudget: (tenantId, reserveCents, cfg) =>
      ops.reserveExceedsBudget(requireState(), tenantId, reserveCents, cfg, new Date().toISOString()),
    // Diagnose-Snapshot der Tenant-Achse (P5a): reine Query, kein save (wie
    // budgetExceeded). KS-P4: nowIso an der IO-Grenze. Wrapper-Parity zu json.js.
    tenantBudgetSnapshot: (tenantId, cfg) =>
      ops.tenantBudgetSnapshot(requireState(), tenantId, cfg, new Date().toISOString()),
    // Reconcile (outbound-p1c): Mutation -> save (wie trackUsage). flushUsage persistiert
    // den costCents-Bucket des Tenants (als cost_eur-Spalte). nowIso s. trackUsage (P4).
    addVoiceUsageCostCents(tenantId, costCents) {
      const usage = ops.addVoiceUsageCostCents(requireState(), tenantId, costCents, new Date().toISOString());
      save();
      return usage;
    },
    // AL-P10: Suchgebuehr (Wrapper-Paritaet zu json.js). flushUsage persistiert den
    // costCents-Bucket (als cost_eur-Spalte) - keine neue Spalte noetig.
    addResearchFeeCostCents(tenantId, costCents) {
      const usage = ops.addResearchFeeCostCents(requireState(), tenantId, costCents, new Date().toISOString());
      save();
      return usage;
    },
    // LCT P4: Korrekturbuchung (Wrapper-Parity zu json.js) - save NUR bei booked. flushUsage
    // persistiert cost_correction_micro_cents_rem - ohne den Spalten-Eintrag im ON CONFLICT
    // DO UPDATE SET fiele der Rest beim naechsten Flush auf 0 zurueck, und der Uebertrag
    // waere genau das, was er nie sein darf: verworfen.
    applyCostCorrectionCents(tenantId, input) {
      const result = ops.applyCostCorrectionCents(requireState(), tenantId, input, new Date().toISOString());
      if (result.booked) save();
      return result;
    },
    // Lese-Zugriff auf den Usage-Bucket eines Tenants (I5): liest den Spiegel
    // (kein DB-Roundtrip), Wrapper-Parity zu json.js. Reine Query, kein save.
    usageOf: (tenantId) => ops.usageOf(requireState(), tenantId),

    // ---- Reserve-Ledger (OUT-05): Wrapper-Parity zu json.js ----
    // Reine In-Memory-Mutation auf dem Spiegel (kein save/Flush): reservations wird von
    // flush() NIE geschrieben (keine Spalte) -> strukturell ephemer, wie im json-Backend.
    // reservationOf ist reine Query (analog usageOf).
    tryReserveOutboundBudget: (tenantId, reserveCents, cfg) =>
      ops.tryReserveOutboundBudget(requireState(), tenantId, reserveCents, cfg, new Date().toISOString()),
    releaseOutboundReserve: (call) => ops.releaseOutboundReserve(requireState(), call),
    reservationOf: (tenantId) => ops.reservationFor(requireState(), tenantId),
    // Plattform-Fruehwarnung (Budget-Achsen P6): Wrapper-Parity zu json.js. Reine
    // In-Memory-Mutation auf dem Spiegel (kein save/Flush): platformSpendWarnedMonth wird
    // von flush() NIE geschrieben (keine Spalte) -> strukturell ephemer, wie reservations.
    claimPlatformSpendWarning: (cfg, nowIso) =>
      ops.claimPlatformSpendWarning(requireState(), cfg, nowIso),

    // ---- ElevenLabs-Kontingent-Zaehler (LCT P7): Wrapper-Parity zu json.js ----
    // ANDERS als claimPlatformSpendWarning darueber: platformTtsUsage PERSISTIERT (eigene
    // Tabelle, flushPlatformTtsUsage) -> save() NUR bei changed (Muster
    // recordCallCostTruingResult). cfg = config.billing (dieselbe Instanz wie im json-Backend).
    recordTtsCharacters(chars, nowIso) {
      const r = ops.recordTtsCharacters(requireState(), chars, config.billing, nowIso);
      if (r.changed) save();
      return r.warning;
    },
    platformTtsUsageView: (nowIso) => ops.platformTtsUsageView(requireState(), config.billing, nowIso),

    // ElevenLabs-Zeichen pro Tenant (KE-P6): Wrapper-Parity zu json.js. flushUsage
    // persistiert tts_characters - ohne den Spalten-Eintrag im ON CONFLICT DO UPDATE SET
    // fiele der Zaehler beim naechsten Flush auf 0 zurueck.
    recordTenantTtsCharacters(tenantId, chars) {
      const r = ops.recordTenantTtsCharacters(requireState(), tenantId, chars);
      if (r.changed) save();
      return r;
    },

    // KV-P7 (Massnahme 3): Telnyx-Relay-Verbrauch. Wrapper-Parity zu json.js - save()
    // flusht den KOMPLETTEN Spiegel (Voll-Upsert, s. save() oben) und deckt damit BEIDE
    // betroffenen Tabellen (flushUsage/tts_characters UND flushPlatformTtsUsage) in einem
    // Aufruf, wie recordTtsCharacters daneben.
    recordRelayTtsCharacters(tenantId, chars, nowIso) {
      const r = ops.recordRelayTtsCharacters(requireState(), { tenantId, chars, cfg: config.billing, nowIso });
      if (r.changed) save();
      return r.warning;
    },

    // KV-M4: Riegel der monatlichen Gegenprobe. Wrapper-Parity zu json.js - save() NUR bei
    // tatsaechlicher Aenderung (Muster recordTenantTtsCharacters).
    markCostCrossCheckAttempted(monthKey) {
      const s = requireState();
      const before = s.costCrossCheck.lastCheckedMonthKey;
      ops.markCrossCheckAttempted(s, monthKey);
      if (s.costCrossCheck.lastCheckedMonthKey !== before) save();
    },

    // ---- Per-Tenant-Budget + Metering (P6b3): Wrapper-Parity zu json.js ----
    setTenantBudget(tenantId, amounts) {
      const row = ops.setTenantBudget(requireState(), tenantId, amounts);
      save();
      return row;
    },
    recordUsageEvent(input) {
      const event = ops.recordUsageEvent(requireState(), input);
      save();
      return event;
    },
    // Tages-Cap-Zaehler der gesendeten Summary-SMS (F2 P8): liest den Spiegel
    // (kein DB-Roundtrip), Wrapper-Parity zu json.js. Reine Query, kein save.
    dailySmsCount: (tenantId, sinceIso) => ops.dailySmsCount(requireState(), tenantId, sinceIso),
    // Minuten-Kontingent-Gate-Praedikat (B1b): liest den hydrierten usage_event-Spiegel
    // (kein DB-Roundtrip, KEINE neue SQL), Wrapper-Parity zu json.js. Reine Query, kein save.
    planMinutesExceeded: (tenantId, opts) => ops.planMinutesExceeded(requireState(), tenantId, opts),
    pendingMeterEvents: () => ops.pendingMeterEvents(requireState()),
    markMeterEventsSent(eventIds) {
      const n = ops.markMeterEventsSent(requireState(), eventIds);
      if (n) save();
      return n;
    },

    // ---- KYC (P6b4): Wrapper-Parity zu json.js ----
    setKycLevel(tenantId, level) {
      const tenant = ops.setKycLevel(requireState(), tenantId, level);
      save();
      return tenant;
    },
    kycReached: (tenantId, minLevel) => ops.kycReached(requireState(), tenantId, minLevel),

    // ---- Abo-gekoppeltes Outbound-Allowlist-Gate (W5): Wrapper-Parity zu json.js ----
    tenantActiveSubscriber: (tenantId, minLevel) =>
      ops.tenantActiveSubscriber(requireState(), tenantId, minLevel),
    tenantInactive: (tenantId) => ops.tenantInactive(requireState(), tenantId),

    // ---- suspended_at Grace-Anker (tenant-prolif-c): Wrapper-Parity zu json.js ----
    // now an der IO-Grenze erzeugt (ops bleibt zeit-injiziert + rein/testbar). Save nur bei
    // changed (Muster markBilled) - kein needless Flush bei bereits gesetztem/fehlendem Anker.
    setSuspendedAtIfAbsent(tenantId) {
      const { changed } = ops.setSuspendedAtIfAbsent(requireState(), tenantId, new Date().toISOString());
      if (changed) save();
    },
    clearSuspendedAt(tenantId) {
      const { changed } = ops.clearSuspendedAt(requireState(), tenantId);
      if (changed) save();
    },

    // Perioden-Fenster des Budget-Gates (GAP-01): Wrapper-Parity zu json.js. Liefert den
    // Boolean nach aussen (der Aufrufer auditiert, OB ein neues Fenster begonnen hat).
    stampBudgetPeriod(tenantId, periodStartIso) {
      const { changed } = ops.stampBudgetPeriod(requireState(), tenantId, periodStartIso);
      if (changed) save();
      return changed;
    },
    tenantSuspendedAt: (tenantId) => ops.tenantSuspendedAt(requireState(), tenantId),

    // ---- Stripe-Customer/Karte pro Tenant (Pay1): Wrapper-Parity zu json.js ----
    setTenantStripe(tenantId, patch) {
      const tenant = ops.setTenantStripe(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    tenantStripe: (tenantId) => ops.tenantStripe(requireState(), tenantId),

    // ---- Abo-Referenzen pro Tenant (W4): Wrapper-Parity zu json.js ----
    // LCT P6: deriveTenantBudgetFromPlan laeuft NACH setTenantSubscription, im selben
    // save()-Fenster - tenant.stripePlanSlug ist dann bereits der EFFEKTIVE Slug.
    setTenantSubscription(tenantId, patch) {
      const tenant = ops.setTenantSubscription(requireState(), tenantId, patch);
      ops.deriveTenantBudgetFromPlan(requireState(), tenantId, config.billing);
      save();
      return tenant;
    },
    tenantSubscription: (tenantId) => ops.tenantSubscription(requireState(), tenantId),
    findTenantBySubscription: (subscriptionId) =>
      ops.findTenantBySubscription(requireState(), subscriptionId),

    // ---- Billing-Hold (GAP-03, O2): Wrapper-Parity zu json.js ----
    findTenantByCustomer: (customerId) => ops.findTenantByCustomer(requireState(), customerId),
    setBillingHold(tenantId, patch) {
      ops.setBillingHold(requireState(), tenantId, patch);
      save();
    },
    clearBillingHold(tenantId) {
      ops.clearBillingHold(requireState(), tenantId);
      save();
    },
    billingHoldActive: (tenantId) =>
      ops.billingHoldActive(requireState(), tenantId, new Date().toISOString()),

    // ---- 312k-Phase 4: Vertragsende-Aufraeumarbeiten (Wrapper-Parity zu json.js) ----
    setContractEndCleanupPending(tenantId, patch) {
      const tenant = ops.setContractEndCleanupPending(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    contractEndCleanupPending: (tenantId) =>
      ops.contractEndCleanupPending(requireState(), tenantId),
    tenantsPendingContractEndCleanup: () =>
      ops.tenantsPendingContractEndCleanup(requireState()),
    tenantIdpSubject: (tenantId) => ops.tenantIdpSubject(requireState(), tenantId),

    // ---- 312k-Phase 5: Kuendigungsbestaetigung per E-Mail (Wrapper-Parity zu json.js) ----
    setCancellationMailPending(tenantId, patch) {
      const tenant = ops.setCancellationMailPending(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    cancellationMailPending: (tenantId) =>
      ops.cancellationMailPending(requireState(), tenantId),
    tenantsPendingCancellationMail: () =>
      ops.tenantsPendingCancellationMail(requireState()),

    // ---- Private Summary-Nummer pro Tenant (F2): Wrapper-Parity zu json.js ----
    setPrivateNumber(tenantId, raw) {
      const tenant = ops.setPrivateNumber(requireState(), tenantId, raw);
      save();
      return tenant;
    },
    tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(requireState(), tenantId),

    // ---- Geo-Location pro Tenant (F1): Wrapper-Parity zu json.js ----
    setTenantGeo(tenantId, patch) {
      const tenant = ops.setTenantGeo(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    // Leser der Geo-Felder (F1): liest den hydrierten Spiegel, Wrapper-Parity zu json.js.
    tenantGeo: (tenantId) => ops.tenantGeo(requireState(), tenantId),
    // Leser der Tenant-Zeitzone (P8, nur Anzeige): Wrapper-Parity zu json.js.
    tenantTimezone: (tenantId) => ops.tenantTimezone(requireState(), tenantId),

    // ---- Newsletter-Einwilligung pro Tenant (Opt-in, DSGVO Art. 7 Abs. 1): Wrapper-Parity
    // zu json.js ----
    setNewsletterConsent(tenantId, consent) {
      const tenant = ops.setNewsletterConsent(requireState(), tenantId, consent);
      save();
      return tenant;
    },
    tenantNewsletterConsent: (tenantId) => ops.tenantNewsletterConsent(requireState(), tenantId),

    // ---- Newsletter-Zusatzempfaenger (Double-Opt-in): Wrapper-Parity zu json.js ----
    tenantNewsletterRecipients: (tenantId) => ops.tenantNewsletterRecipients(requireState(), tenantId),
    confirmedNewsletterRecipients: (tenantId) =>
      ops.confirmedNewsletterRecipients(requireState(), tenantId),
    dailyNewsletterConfirmMailCount: (tenantId, sinceIso) =>
      ops.dailyNewsletterConfirmMailCount(requireState(), tenantId, sinceIso),
    addNewsletterRecipient(tenantId, recipientInput) {
      const recipient = ops.addNewsletterRecipient(requireState(), tenantId, recipientInput);
      save();
      return recipient;
    },
    removeNewsletterRecipient(tenantId, email) {
      const changed = ops.removeNewsletterRecipient(requireState(), tenantId, email);
      if (changed) save();
      return changed;
    },
    confirmNewsletterRecipientByToken(tokenHash, nowIso) {
      const result = ops.confirmNewsletterRecipientByToken(requireState(), tokenHash, nowIso);
      if (result) save();
      return result;
    },
    unsubscribeNewsletterRecipientByToken(token) {
      const result = ops.unsubscribeNewsletterRecipientByToken(requireState(), token);
      if (result) save();
      return result;
    },

    addNotification(title, body, callId) {
      ops.addNotification(requireState(), title, body, callId);
      save();
    },

    // Owner-/Bestandsnummer direkt 'active' eintragen (CLI scripts/seed-owner-number.js):
    // die EINE legitime Ausnahme zur Transition-Kette (idempotent ueber normNum). Der
    // neue Spiegel-Eintrag wird vom save()->flushTenantScope->flushNumbers persistiert.
    seedBootstrapNumber(e164, tenantId, provider) {
      ops.seedBootstrapNumber(requireState(), e164, tenantId, provider);
      return save();
    },

    // Bootstrap-Tenant (CLI scripts/bootstrap-tenant.js, P2b): Tenant-Record + aktive
    // Bestandsnummer in EINER Mutation. save() flusht beides (flushTenants + flushNumbers).
    bootstrapTenant(e164, tenantId, provider) {
      ops.bootstrapTenant(requireState(), e164, tenantId, provider);
      return save();
    },

    // Default = config.privacy.retentionDays, identisch zum json-Backend: der einzige
    // Produktiv-Caller (server.js) ruft no-arg. Ohne diesen Default waere die
    // DSGVO-Retention unter STORE_BACKEND=pg still abgeschaltet (Absolute Regel).
    // P2b: zweite, strengere Frist fuer Diagnose-Transkripte (diagnosticDays).
    // AL-P11: dritte, kuerzeste Frist (evidenceDays).
    pruneOldData(
      days = config.privacy.retentionDays,
      diagnosticDays = config.privacy.diagnosticRetentionDays,
      evidenceDays = config.privacy.evidenceRetentionDays,
    ) {
      const removed = ops.pruneOldData(requireState(), {
        retentionDays: days,
        diagnosticRetentionDays: diagnosticDays,
        evidenceRetentionDays: evidenceDays,
      });
      if (ops.hasPrunedSomething(removed)) save();
      return removed;
    },

    // Per-Tenant-DSGVO-Loeschung (Art. 17): mutiert den Spiegel (call-verknuepfte
    // Daten des Tenants raus). actionItems/notifications reconciled der normale Flush
    // weiterhin ueber deleteMissing mit leerer keep-Liste (DELETE WHERE tenant_id) - die
    // beiden Tabellen sind vom F8-Reconcile-Schutz nicht betroffen. Die call-Zeilen
    // selbst NICHT mehr: deleteMissingCallsKeepActive (F8/A6) schuetzt seit F8 jede
    // status=active-Zeile bei leerer keep-Liste - das schuetzte sonst faelschlich den
    // EIGENEN aktiven Call des Tenants vor der Loeschung (Recht auf Loeschung MUSS
    // diesen Schutz durchbrechen; der Schutz gilt nur FREMDEN/unbekannten Zeilen eines
    // Overlap-Prozesses). Deshalb: die betroffenen Call-IDs VOR der Mutation sichern
    // (dieselbe Scope-Quelle wie exportTenantData, ops.tenantCallScope - kein zweiter
    // Filter mit derselben Regel) und per preFlush unconditional hart loeschen - INNERHALB
    // derselben Transaktion wie der normale Flush (P16/G26), direkt nach BEGIN. Ein
    // Rollback des Flush rollt damit auch den Hard-Delete zurueck statt eine teilweise
    // DSGVO-Loeschung zu hinterlassen (transcript_segment faellt per ON DELETE CASCADE mit).
    eraseTenantData(tenantId) {
      const state = requireState();
      const eraseCallIds = ops.tenantCallScope(state, tenantId).calls.map((c) => c.id);
      const removed = ops.eraseTenantData(state, tenantId);
      // F2 P10: auch eine geloeschte privateNumber (PII) muss persistieren - sonst kaeme sie
      // bei einem Tenant ganz ohne Calls nach dem Restart zurueck (flushTenants schreibt NULL).
      if (removed.calls || removed.actionItems || removed.notifications || removed.privateNumber)
        save((client) => hardDeleteCalls(client, tenantId, eraseCallIds));
      return removed;
    },
    exportTenantData: (tenantId) => ops.exportTenantData(requireState(), tenantId),

    updateSettings(tenantId, patch) {
      const result = ops.updateSettings(requireState(), tenantId, patch);
      save();
      return result;
    },

    resolveProfile: (tenantId) => ops.resolveProfile(requireState(), tenantId),
    // Tenant-Aufloesung (I4): liest den hydrierten Spiegel (Wrapper-Parity zu json.js).
    resolveTenant: (idpSubject) => ops.resolveTenant(requireState(), idpSubject),
    // tenant-prolif-b: Nach-Boot-Bindung eines sub in den In-Memory-Merge-Index (reine
    // Spiegel-Mutation, KEIN save/DB-Write: account persistiert der Web-Login-Pfad, der Index
    // wird jeden Boot aus account neu gebaut). mintSession ruft das nach dem Account-Upsert,
    // damit ein frisch (Phase A) gemergter Zweit-sub OHNE Neustart aufloest (Landmine "idp_subject
    // eingefroren"). ops.bindSubToTenant kann post-init nicht werfen -> kein try/catch noetig.
    bindSubToTenant: (sub, tenantId) => ops.bindSubToTenant(requireState(), sub, tenantId),

    // Nach-Boot-Spiegel-Nachzug eines einzelnen Tenants (Signup-Hydrierung). Der OIDC-
    // Web-Login (accounts.upsertOnFirstLogin) legt die tenant-Zeile NACH dem Boot in der
    // DB an; der Spiegel wird sonst nur bei init() hydriert -> ein frisch registrierter
    // Tenant fehlt in s.tenants, bis jede WRITE-Store-Op (setTenantStripe/setKycLevel/
    // setTenantSubscription/...) ueber findTenant fail-closed wirft. ensureTenant zieht
    // GENAU diesen Tenant idempotent + FAIL-SAFE nach. KRITISCH (Regel 1): es uebernimmt
    // NUR den REALEN DB-status (nie ein hartcodiertes ACTIVE) - drei Gates lesen den
    // Spiegel-status (requestNumber/tenantInactive/tenantActiveSubscriber); ein faelschlich
    // aktiver Spiegel machte einen suspendierten Tenant outbound-faehig. Eigene Methode
    // (kein ops-Wrapper): braucht runner (DB-Read) UND Spiegel zugleich.
    async ensureTenant(tenantId) {
      try {
        const state = requireState();
        return await runner.withClient(async (client) => {
          // Billiger Existenz-/Status-Read: der haeufige Fall (Tenant schon im Spiegel -
          // jeder Provision-Trigger, jeder Folge-Login) braucht nur den accounts-owned
          // status, nicht alle Spalten. KEINE Zeile -> Tenant existiert nicht in der DB
          // -> false (NIE einen Tenant aus dem Nichts erfinden).
          const statusRows = (
            await client.query(`SELECT status FROM tenant WHERE id = $1`, [tenantId])
          ).rows;
          if (statusRows.length === 0) return false;
          const present = ops.findTenant(state, tenantId);
          if (present) {
            // NUR den status nachziehen - das einzige accounts-owned, nie geflushte Feld.
            // Spiegel-eigene Felder (kyc/stripe/sub/identitaet/private_number) bleiben
            // unberuehrt, sonst clobberte der Nachzug ungeflushte Writes.
            present.status = statusRows[0].status;
            return true;
          }
          // Abwesend (frischer Web-Login nach Boot): vollen Tenant-Row holen, dann SYNCHRON
          // unmittelbar vor dem push erneut pruefen (KEIN await dazwischen): zwei parallele
          // erste Logins desselben Tenants duerfen ihn nicht doppelt in den Spiegel legen.
          const full = (
            await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant WHERE id = $1`, [tenantId])
          ).rows[0];
          const raced = ops.findTenant(state, tenantId);
          if (raced) {
            raced.status = full.status;
            return true;
          }
          state.tenants.push(rowToTenant(full));
          // hydrateTenant-Helfer (G5/G27): setzt die RLS-GUC VOR dem tenant-scoped Read
          // (settings/calls/...). Reihenfolge strukturell erzwungen, siehe Helfer-Kommentar.
          await hydrateTenant(client, state, tenantId);
          return true;
        });
      } catch (e) {
        // FAIL-SAFE: ein DB-Schluckauf darf den Login-/Provision-Pfad nie mit einer
        // Rejection treffen. Kein Secret im Log (nur die Meldung). Der Spiegel bleibt
        // unveraendert -> die Setter werfen weiter fail-CLOSED (kein Gate geht auf).
        console.error("[pg] ensureTenant fehlgeschlagen:", e.message);
        return false;
      }
    },
    listProfiles: () => ops.listProfiles(requireState()),
    setProfile(tenantId, patch) {
      const result = ops.setProfile(requireState(), tenantId, patch);
      save();
      return result;
    },
    deleteProfile(tenantId) {
      const ok = ops.deleteProfile(requireState(), tenantId);
      if (ok) save();
      return ok;
    },
  };
}

// Setzt die RLS-GUC fuer die laufende Verbindung (session-weit). flush setzt sie
// zusaetzlich transaktionslokal.
async function setTenant(client, tenantId) {
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

// Buendelt setTenant + hydrateTenantInto zu EINER Stelle (G5/G27). G31 temporale
// Kopplung: setTenant MUSS vor hydrateTenantInto laufen - sonst filtert FORCE RLS
// unter der stale/fremden GUC einer wiederverwendeten Pool-Verbindung die Reads LEER,
// der leere Spiegel liesse den naechsten Flush reale Zeilen loeschen (stiller
// Datenverlust). Als eine Funktion statt zweier Call-Sites mit derselben Reihenfolge
// ist eine kuenftige dritte Call-Site strukturell sicher statt caller-discipline-
// abhaengig.
async function hydrateTenant(client, state, tenantId) {
  await setTenant(client, tenantId);
  await hydrateTenantInto(client, state, tenantId);
}

// ---- Hydrierung: DB-Zeilen -> verschachtelter Spiegel-Shape (multi-tenant, I8) ----
// Laeuft auf einer Verbindung. Liest zuerst die tenant-Tabelle (state.tenants), dann
// pro Tenant unter dessen RLS-GUC die tenant-scoped Zeilen in die Buckets/Listen.
// makeDefaultState() EINMAL (Owner-Buckets vorbelegt); pro Tenant werden Buckets
// gefuellt (settings/calendar/usage) bzw. Listen angehaengt (calls/actionItems/
// notifications/numbers). profiles sind global keyed-by-tenantId (Phase S; vormals email)
// und werden in EINEM tenant-unabhaengigen Schritt nach der Tenant-Schleife geladen.
async function hydrate(client) {
  const state = ops.makeDefaultState();
  state.tenants = await hydrateTenants(client);
  for (const tenant of state.tenants) {
    await hydrateTenant(client, state, tenant.id);
  }
  // Profiles global (Owner-Removal P5): an KEINEN Tenant gebunden. Die profile-Tabelle
  // haengt nicht mehr an app.current_tenant (Policy profile_global, USING(true)) - die
  // gesetzte GUC ist fuer diesen Read irrelevant. EIN Read, nicht pro Tenant.
  state.profiles = await hydrateProfiles(client);
  state.platformTtsUsage = await hydratePlatformTtsUsage(client); // LCT P7: global, wie profiles
  state.costCrossCheck = await hydrateCostCrossCheck(client); // KV-M4: global, wie platformTtsUsage
  state.platformNumberUse = await hydratePlatformNumberUse(client); // OUTBOUND-E1: global
  state.outageAlerts = await hydrateOutageAlerts(client); // OUTBOUND-E3b: global, wie platformNumberUse
  await hydrateSubIndex(client, state); // tenant-prolif-b: Merge-Overlay aus account
  return state;
}

// Liest die globale profile-Tabelle (tenant_id-PK, Phase S) in die flache {tenantId: data}-
// Map des Spiegels. Tenant-unabhaengig (global, kein RLS-Filter).
async function hydrateProfiles(client) {
  const rows = (await client.query(`SELECT tenant_id, data FROM profile`)).rows;
  return Object.fromEntries(rows.map((r) => [r.tenant_id, r.data]));
}

// Liest die globale Singleton-Zeile (id=1) der platform_tts_usage-Tabelle (LCT P7, Muster
// hydrateProfiles - kein RLS-Tenant-Filter). Keine Zeile (frische DB, kein Seed) ->
// ops.emptyPlatformTtsUsage(). characters ist BIGINT -> der Treiber liefert es als String,
// Number() normalisiert (Backend-Paritaet zu json.js; Wertebereich weit unter 2^53).
async function hydratePlatformTtsUsage(client) {
  const rows = (
    await client.query(`SELECT cycle_key, characters, warned_cycle FROM platform_tts_usage WHERE id = 1`)
  ).rows;
  if (rows.length === 0) return emptyPlatformTtsUsage();
  const r = rows[0];
  return { cycleKey: r.cycle_key, characters: Number(r.characters), warnedCycle: r.warned_cycle };
}

// Liest die globale Singleton-Zeile (id=1) der cost_cross_check-Tabelle (KV-M4, Muster
// hydratePlatformTtsUsage - kein RLS-Tenant-Filter). Keine Zeile (frische DB, kein Seed) ->
// ops.emptyCostCrossCheck().
async function hydrateCostCrossCheck(client) {
  const rows = (
    await client.query(`SELECT last_checked_month_key FROM cost_cross_check WHERE id = 1`)
  ).rows;
  if (rows.length === 0) return emptyCostCrossCheck();
  return { lastCheckedMonthKey: rows[0].last_checked_month_key };
}

// Liest die globale platform_number_use-Tabelle (OUTBOUND-E1, Muster hydrateProfiles -
// kein RLS-Tenant-Filter). TIMESTAMPTZ -> ISO-String, damit der Spiegel backend-identisch
// zu json.js ist (dort schreibt new Date().toISOString()).
async function hydratePlatformNumberUse(client) {
  const rows = (
    await client.query(
      `SELECT id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note
         FROM platform_number_use ORDER BY bound_at`,
    )
  ).rows;
  // Bewusst "row" statt des im Rest der Datei ueblichen einbuchstabigen "r" (G16/N1,
  // eslint id-length): eine Bestandsdatei mit bereits gepinnter Altlast darf durch neuen
  // Code NICHT weiter wachsen (Altlast-Ratsche, test/check-staged-suppressions.test.js) -
  // der Pin ist ohne Owner-Freigabe unantastbar, also bleibt neuer Code darunter.
  return rows.map((row) => ({
    id: row.id, e164: row.e164, purpose: row.purpose, provider: row.provider,
    tenantId: row.tenant_id, providerNumberId: row.provider_number_id,
    boundAt: row.bound_at instanceof Date ? row.bound_at.toISOString() : row.bound_at,
    releasedAt: row.released_at instanceof Date ? row.released_at.toISOString() : (row.released_at ?? null),
    note: row.note,
  }));
}

// Liest die globale outage_alert-Tabelle (OUTBOUND-E3b, Muster hydratePlatformNumberUse -
// kein RLS-Tenant-Filter). TIMESTAMPTZ -> ISO-String, damit der Spiegel backend-identisch
// zu json.js ist.
async function hydrateOutageAlerts(client) {
  const rows = (
    await client.query(
      `SELECT id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at,
              delivered_channels, closed_at
         FROM outage_alert ORDER BY first_seen_at`,
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    firstSeenAt: row.first_seen_at instanceof Date ? row.first_seen_at.toISOString() : row.first_seen_at,
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at,
    lastAttemptAt: row.last_attempt_at instanceof Date ? row.last_attempt_at.toISOString() : (row.last_attempt_at ?? null),
    reportedAt: row.reported_at instanceof Date ? row.reported_at.toISOString() : (row.reported_at ?? null),
    deliveredChannels: row.delivered_channels,
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : (row.closed_at ?? null),
  }));
}

// tenant-prolif-b: den sub->tenantId-Resolver-Index aus der account-Tabelle fuellen. account
// ist RLS-EXEMPT (Resolver-Pfad laeuft VOR app.current_tenant) -> EIN globaler Read ohne
// GUC/Tenant-Filter (Muster hydrateProfiles). Jede Zeile - auch die per Email-Merge auf einen
// fremden Tenant gebundenen Zweit-subs - ueber die EINE Index-Mutation (bindSubToTenant, G5).
async function hydrateSubIndex(client, state) {
  const rows = (await client.query(`SELECT sub, tenant_id FROM account`)).rows;
  for (const r of rows) ops.bindSubToTenant(state, r.sub, r.tenant_id);
}

// Spalten der tenant-Tabelle, geteilt von hydrateTenants (Boot-Hydrierung) UND
// ensureTenant (Nach-Boot-Spiegel-Nachzug eines einzelnen Tenants): EINE Quelle, damit
// SELECT-Liste und rowToTenant nie auseinanderdriften (G5). KEINE GUC noetig - die
// tenant-Tabelle hat keine RLS.
const TENANT_COLUMNS =
  "id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, " +
  "stripe_payment_method_id, stripe_subscription_id, stripe_plan_slug, " +
  "stripe_current_period_end, stripe_current_period_start, stripe_number_setup_fee_exempt, " +
  "country, default_language, timezone, private_number, number_provision_skip_reason, number_provision_skip_at, " +
  "suspended_at, stripe_activation_pending, stripe_billing_hold, stripe_billing_hold_due_at, " +
  "stripe_period_credit_revoked, stripe_cancel_at_period_end, " +
  "number_release_pending, workos_delete_pending, " +
  "cancellation_mail_pending, cancellation_mail_received_at, " +
  "newsletter_consent, newsletter_consent_at, " +
  "newsletter_recipients, newsletter_confirm_mail_log";

// Eine tenant-Zeile -> Tenant-Record. Alle optionalen Felder NUR-nicht-null hydrieren:
// owner_name/idp_subject/first_name sonst -> leeres Feld, das den leeren tenantContext-
// Fallback "" bzw. die firstName-Ableitung verdeckte (G1); kyc_level/stripe_*/geo/
// private_number analog -> Owner/Bestand ohne Wert behaelt KEIN leeres Feld, der jeweilige
// Code-Fallback greift (kein json<->pg-Drift, R6/R7). KRITISCH (I8-Lehre): die
// stripe_subscription_* MUESSEN hier UND in flushTenants stehen, sonst loescht der naechste
// Flush das Abo (Datenverlust). Tenants kommen ueber bootstrap-tenant/Onboarding/Web-Login
// (P2b: kein config-Seed). Geteilt von hydrateTenants UND ensureTenant (G5).
function rowToTenant(r) {
  const tenant = { id: r.id, status: r.status };
  if (r.owner_name != null) tenant.ownerName = r.owner_name;
  if (r.first_name != null) tenant.firstName = r.first_name;
  if (r.idp_subject != null) tenant.idpSubject = r.idp_subject;
  if (r.kyc_level != null) tenant.kycLevel = r.kyc_level;
  if (r.stripe_customer_id != null) tenant.stripeCustomerId = r.stripe_customer_id;
  if (r.stripe_payment_method_id != null) tenant.stripePaymentMethodId = r.stripe_payment_method_id;
  if (r.stripe_subscription_id != null) tenant.stripeSubscriptionId = r.stripe_subscription_id;
  if (r.stripe_plan_slug != null) tenant.stripePlanSlug = r.stripe_plan_slug;
  // BIGINT kommt als String aus pg -> zurueck zur Zahl (Unix-Sekunden, kein Float-Geld).
  if (r.stripe_current_period_end != null)
    tenant.stripeCurrentPeriodEnd = Number(r.stripe_current_period_end);
  if (r.stripe_current_period_start != null)
    tenant.stripeCurrentPeriodStart = Number(r.stripe_current_period_start);
  if (r.stripe_number_setup_fee_exempt != null)
    tenant.stripeNumberSetupFeeExempt = r.stripe_number_setup_fee_exempt;
  if (r.country != null) tenant.country = r.country;
  if (r.default_language != null) tenant.defaultLanguage = r.default_language;
  if (r.timezone != null) tenant.timezone = r.timezone;
  if (r.private_number != null) tenant.privateNumber = r.private_number;
  if (r.number_provision_skip_reason != null)
    tenant.numberProvisionSkipReason = r.number_provision_skip_reason;
  if (r.number_provision_skip_at != null) tenant.numberProvisionSkipAt = r.number_provision_skip_at;
  if (r.suspended_at != null) tenant.suspendedAt = r.suspended_at;
  // GAP-04-Wartezustand + GAP-03-Billing-Hold/Periodenguthaben (P4): Muster wie
  // stripe_number_setup_fee_exempt/suspended_at (ALTER-only, nullable, kein Backfill).
  if (r.stripe_activation_pending != null) tenant.stripeActivationPending = r.stripe_activation_pending;
  if (r.stripe_billing_hold != null) tenant.billingHold = r.stripe_billing_hold;
  if (r.stripe_billing_hold_due_at != null) tenant.billingHoldDueAt = r.stripe_billing_hold_due_at;
  if (r.stripe_period_credit_revoked != null)
    tenant.stripePeriodCreditRevoked = r.stripe_period_credit_revoked;
  // 312k-P1 (Teil B): Muster stripe_period_credit_revoked (ALTER-only, nullable, kein
  // Backfill - Bestand ohne Wert -> tenantSubscription() faellt fail-closed auf false zurueck).
  if (r.stripe_cancel_at_period_end != null)
    tenant.stripeCancelAtPeriodEnd = r.stripe_cancel_at_period_end;
  // 312k-Phase 4: Vertragsende-Aufraeumarbeiten (ALTER-only, nullable, kein Backfill -
  // Bestand ohne Wert -> contractEndCleanupPending() faellt fail-closed auf false zurueck).
  if (r.number_release_pending != null) tenant.numberReleasePending = r.number_release_pending;
  if (r.workos_delete_pending != null) tenant.workosDeletePending = r.workos_delete_pending;
  // 312k-Phase 5: Kuendigungsbestaetigung per E-Mail (ALTER-only, nullable, kein Backfill -
  // Bestand ohne Wert -> cancellationMailPending() faellt fail-closed auf false zurueck).
  if (r.cancellation_mail_pending != null) tenant.cancellationMailPending = r.cancellation_mail_pending;
  if (r.cancellation_mail_received_at != null)
    tenant.cancellationMailReceivedAt = r.cancellation_mail_received_at;
  // Newsletter-Einwilligung (Opt-in, DSGVO Art. 7 Abs. 1): Muster stripe_cancel_at_period_end
  // (ALTER-only, nullable, kein Backfill) - Bestand ohne Wert -> tenantNewsletterConsent()
  // faellt fail-closed auf "nicht eingewilligt" zurueck.
  if (r.newsletter_consent != null) tenant.newsletterConsent = r.newsletter_consent;
  if (r.newsletter_consent_at != null) tenant.newsletterConsentAt = r.newsletter_consent_at;
  // Newsletter-Zusatzempfaenger (Double-Opt-in): JSONB kommt vom Treiber bereits geparst
  // (Muster consults auf call). NULL -> Feld bleibt weg, die state-ops-Leser fallen ueber
  // ?? [] fail-closed auf eine leere Liste zurueck (kein Backfill noetig).
  if (r.newsletter_recipients != null) tenant.newsletterRecipients = r.newsletter_recipients;
  if (r.newsletter_confirm_mail_log != null)
    tenant.newsletterConfirmMailLog = r.newsletter_confirm_mail_log;
  return tenant;
}

// tenant-Tabelle -> Tenant-Records (Boot-Hydrierung). Reine Projektion ueber rowToTenant
// (byte-identisch zur frueheren Inline-Map).
async function hydrateTenants(client) {
  const rows = (await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant`)).rows;
  return rows.map(rowToTenant);
}

// call_cost_evidence-Hydrierung (KV2-3): tenant-scoped, laeuft unter der RLS-GUC des
// Tenants. BIGINT kommt als String vom Treiber -> Number, NULL bleibt null ("0 statt
// unbekannt" waere eine erfundene Messung, Muster cost_micro_cents). detail ist JSONB und
// kommt bereits geparst (Muster call.context/result).
async function hydrateCallCostEvidence(client, tenantId) {
  const rows = (
    await client.query(
      `SELECT id, tenant_id, call_id, traeger, reife, betrag_mikro_cents, waehrung, quelle,
              beleg_ref, versuche, gemessen_at, abstand_zum_gespraechsende_s, detail,
              nachreifbar
         FROM call_cost_evidence WHERE tenant_id = $1 ORDER BY id ASC`,
      [tenantId],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    callId: row.call_id,
    traeger: row.traeger,
    reife: row.reife,
    betragMikroCents:
      row.betrag_mikro_cents === null || row.betrag_mikro_cents === undefined
        ? null
        : Number(row.betrag_mikro_cents),
    waehrung: row.waehrung ?? null,
    quelle: row.quelle ?? null,
    belegRef: row.beleg_ref ?? null,
    versuche: Number(row.versuche),
    gemessenAt: row.gemessen_at ?? null,
    abstandZumGespraechsendeS: row.abstand_zum_gespraechsende_s ?? null,
    detail: row.detail ?? null,
    // NOT NULL in der DB -> immer ein Boolean, nie null (kein ?? -Fallback noetig).
    nachreifbar: row.nachreifbar,
  }));
}

// Liest die tenant-scoped Zeilen EINES Tenants (RLS-GUC ist gesetzt) und fuellt sie
// in den Spiegel: settings/calendar/usage in den Map-Bucket dieses Tenants, calls/
// actionItems/notifications/numbers an die globalen Listen ANGEHAENGT (nicht
// ueberschrieben - sonst verloeren frueher hydrierte Tenants ihre Daten). profiles
// sind NICHT tenant-scoped (Owner-Removal P5) -> eigener Schritt in hydrate().
async function hydrateTenantInto(client, state, tenantId) {
  const settingsRows = (
    await client.query(`SELECT * FROM settings WHERE tenant_id = $1`, [tenantId])
  ).rows;
  const callRows = (
    await client.query(`SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC`, [tenantId])
  ).rows;
  const segRows = (
    await client.query(`SELECT * FROM transcript_segment WHERE tenant_id = $1 ORDER BY id ASC`, [
      tenantId,
    ])
  ).rows;
  const itemRows = (
    await client.query(`SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const calRows = (
    await client.query(`SELECT * FROM calendar_event WHERE tenant_id = $1 ORDER BY seq ASC`, [
      tenantId,
    ])
  ).rows;
  const usageRows = (await client.query(`SELECT * FROM usage WHERE tenant_id = $1`, [tenantId]))
    .rows;
  const notifRows = (
    await client.query(`SELECT * FROM notification WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const numberRows = (
    await client.query(
      `SELECT id, e164, tenant_id, provider, status, provider_number_id, payment_intent_id, country, language, monthly_cost_cents, provider_agent_phone_number_id FROM number WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const jobRows = (
    await client.query(
      `SELECT id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at
       FROM provisioning_job WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const budgetRows = (
    await client.query(
      `SELECT tenant_id, budget_cents, hard_cap_cents FROM tenant_budget WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const ueRows = (
    await client.query(
      `SELECT id, tenant_id, call_id, number_id, kind, quantity, cost_cents, cost_micro_cents, occurred_at, stripe_meter_sent
       FROM usage_event WHERE tenant_id = $1 ORDER BY id ASC`,
      [tenantId],
    )
  ).rows;

  const segmentsByCall = groupTranscripts(segRows);
  const itemIdsByCall = groupActionItemIds(itemRows);

  if (settingsRows.length) state.settings[tenantId] = rowToSettings(settingsRows[0]);
  if (usageRows.length) state.usage[tenantId] = rowToUsage(usageRows[0]);
  state.calendar[tenantId] = calRows.map(rowToCalendarEvent);
  state.calls.push(...callRows.map((r) => rowToCall(r, segmentsByCall, itemIdsByCall)));
  state.actionItems.push(...itemRows.map(rowToActionItem));
  state.notifications.push(...notifRows.map(rowToNotification));
  state.numbers.push(...numberRows.map(rowToNumber));
  state.provisioningJobs.push(
    ...jobRows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      numberId: r.number_id,
      kind: r.kind,
      status: r.status,
      idempotencyKey: r.idempotency_key,
      attempts: r.attempts,
      lastError: r.last_error ?? null,
      // TIMESTAMPTZ -> ISO-String (Parity zum json-Backend, das ISO haelt).
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    })),
  );
  state.tenantBudgets.push(
    ...budgetRows.map((r) => ({
      tenantId: r.tenant_id,
      budgetCents: Number(r.budget_cents),
      hardCapCents: Number(r.hard_cap_cents),
    })),
  );
  state.usageEvents.push(
    ...ueRows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      callId: r.call_id,
      // P5/GAP-06: NULL -> null (kein undefined-Drift, Muster call_id).
      numberId: r.number_id ?? null,
      kind: r.kind,
      quantity: Number(r.quantity),
      costCents: Number(r.cost_cents),
      // KV-P6: BIGINT kommt als String vom Treiber; NULL bleibt null (Muster numberId) -
      // kein "0 statt unbekannt".
      costMicroCents:
        r.cost_micro_cents === null || r.cost_micro_cents === undefined
          ? null
          : Number(r.cost_micro_cents),
      occurredAt: r.occurred_at,
      stripeMeterSent: r.stripe_meter_sent,
    })),
  );
  state.callCostEvidence.push(...(await hydrateCallCostEvidence(client, tenantId)));
}

function groupTranscripts(segRows) {
  const byCall = new Map();
  for (const r of segRows) {
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push({ role: r.role, text: r.text, at: r.at });
  }
  return byCall;
}

// action_item ist nach seq DESC sortiert (neueste zuerst, wie unshift). Die
// actionItemIds eines Calls in chronologischer Reihenfolge (aeltester push zuerst)
// -> beim Gruppieren von hinten nach vorne anfuegen.
function groupActionItemIds(itemRows) {
  const byCall = new Map();
  for (let i = itemRows.length - 1; i >= 0; i--) {
    const r = itemRows[i];
    if (r.call_id == null) continue;
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push(r.id);
  }
  return byCall;
}

function rowToSettings(r) {
  return {
    agentName: r.agent_name,
    greeting: r.greeting,
    allowCalendar: r.allow_calendar,
    allowBooking: r.allow_booking,
    allowSummaries: r.allow_summaries,
    // F2 P7: Opt-Out fuer die Summary-SMS. ?? true = Bestands-Zeilen vor dem Migrate
    // (Spalte fehlte) fallen auf Opt-In zurueck -> kein stiller SMS-Verlust (M1).
    smsSummaryOptIn: r.sms_summary_opt_in ?? true,
    allowPersonalData: r.allow_personal_data,
    allowBankData: r.allow_bank_data,
    // AL-P10: Per-Tenant-Freigabe der Vorab-Web-Recherche. ?? false = Bestands-Zeilen
    // vor dem Migrate (Spalte fehlte) fallen auf "aus" zurueck - kein stiller Egress
    // von Auftragsmaterial (Muster sms_summary_opt_in, umgekehrte Fallback-Richtung).
    allowResearch: r.allow_research ?? false,
    // AL-P12: ?? false = Bestands-Zeilen vor dem Migrate (Spalte fehlte) fallen auf "aus"
    // zurueck - kein stilles Scharfschalten eines neuen Verarbeitungszwecks ueber
    // Drittdaten (Muster allow_research).
    allowCallMemory: r.allow_call_memory ?? false,
    // F1 Phase 4: optionales Override, Spalte NULLABLE. NULL -> null (nicht gesetzt);
    // die Praezedenz (resolveCallLanguage) faellt dann auf number/tenant/'de' durch.
    language: r.language ?? null,
    // P2: stehender Tenant-Stil, Spalte NULLABLE. NULL/fehlend (Bestands-Zeile vor dem
    // Migrate) -> null = neutral (Siezen) -> agentStyle=null byte-identisch (Muster language).
    agentStyle: r.agent_style ?? null,
  };
}

// LCT P2: BIGINT liefert der Treiber als STRING (Praezedenz rowToUsage:
// spend_month_cost_cents). Ein roher String im Geld-Feld waere in P4 eine
// String-Konkatenation statt einer Summe. NULL bleibt null ("nie abgeglichen") und wird
// NIEMALS zu 0 ("gemessen: kostenlos") - das ist genau die Unterscheidung, die P1 im
// Ergebnis-Typ erzwingt und die diese Kante nicht wieder einebnen darf.
function hydratedMicroCents(raw) {
  return raw === null || raw === undefined ? null : Number(raw);
}

// OUTBOUND-E5: die drei Absender-Wahrheits-Felder als EIN benanntes Konzept. Modul-Ebene und
// als Spread eingesetzt, damit die gepinnte Komplexitaet von rowToCall/callRowValues (je 36,
// eslint-legacy-exceptions.json) NICHT steigt - jedes ?? direkt in jenen Funktionen waere +1.
function absenderWahrheitFelder(r) {
  return {
    fromActualE164: r.from_actual_e164 ?? null,
    fromSource: r.from_source ?? null,
    fromRegistrationSource: r.from_registration_source ?? null,
  };
}
function absenderWahrheitWerte(call) {
  return [call.fromActualE164 ?? null, call.fromSource ?? null, call.fromRegistrationSource ?? null];
}

// ST3 (O3): Zaehlfeld der Stimmen-Detektoren als EIN JSONB (Muster lookup_log). Spread-
// Helfer statt direktem ?? in rowToCall/callRowValues haelt deren gepinnte Komplexitaet
// flach (Muster absenderWahrheitFelder darueber). JSONB kommt vom Treiber bereits
// geparst; NULL -> null (json-Parity zu createCall, das das Feld nicht setzt).
function elDetektorFelder(zeile) {
  return { elDetectorCounts: zeile.el_detector_counts ?? null };
}
function elDetektorWerte(call) {
  return [call.elDetectorCounts ? JSON.stringify(call.elDetectorCounts) : null];
}

// OUTBOUND-E5: die zwei Schreibweg-Mutatoren als Spread-Fabrik statt zweier ausgeschriebener
// Methoden IN makePgStore - haelt dessen gepinnte Zeilengrenze (eslint-legacy-exceptions.json),
// aus demselben Grund wie absenderWahrheitFelder/-Werte oben. requireState/save reisen herein
// (Closure-Zustand des jeweiligen makePgStore-Aufrufs, kein Modul-Singleton).
function absenderWahrheitMutatoren({ requireState, save }) {
  return {
    recordFromRegistrationSource(callId, quelle) {
      const { call, changed } = ops.recordFromRegistrationSource(requireState(), callId, quelle);
      if (changed) save();
      return call;
    },
    recordActualSender(callId, herkunft) {
      const { call, changed } = ops.recordActualSender(requireState(), callId, herkunft);
      if (changed) save();
      return call;
    },
  };
}

// KV2-7: dieselbe Spread-Fabrik-Technik (s. absenderWahrheitMutatoren oben) fuer die zwei
// Schliessregel-Mutatoren - haelt makePgStores gepinnte Zeilengrenze.
function kostenAbschlussMutatoren({ requireState, save }) {
  return {
    schliesseKostenAbgleich(callId, eingabe) {
      const { call, changed } = ops.schliesseKostenAbgleich(requireState(), callId, eingabe);
      if (changed) save();
      return call;
    },
    oeffneKostenAbgleichErneut(callId) {
      const { call, changed } = ops.oeffneKostenAbgleichErneut(requireState(), callId);
      if (changed) save();
      return call;
    },
  };
}

function rowToCall(r, segmentsByCall, itemIdsByCall) {
  return {
    id: r.id,
    // tenantId hydrieren (I8): der Flush partitioniert state.calls per call.tenantId
    // (flushTenantScope/ops.tenantCallScope). Ohne dieses Feld faende der Owner-Filter nach der
    // Re-Hydrierung keinen einzigen Call (undefined !== "owner") und loeschte beim
    // naechsten Flush alle Calls des Tenants. createCall setzt tenantId bereits im
    // Spiegel (json-Parity) - hier wird es aus der DB-Spalte rekonstruiert.
    tenantId: r.tenant_id,
    streamToken: r.stream_token,
    twilioSid: r.twilio_sid,
    direction: r.direction,
    from: r.from_e164,
    to: r.to_e164,
    goal: r.goal,
    // Thema A: Eroeffnungszeile + Annahme-Hash mit-hydrieren. Ohne diese Zeilen ginge
    // beides beim Restart verloren UND der naechste Flush schriebe NULL zurueck (Lehre
    // i8-design-decisions) - der Boot-Re-Arm eines aktiven EL-Calls spraeche dann den
    // Rueckfall statt der festgelegten Zeile. NULL -> null (json-Parity).
    openingLine: r.opening_line ?? null,
    openingLineSha256: r.opening_line_sha256 ?? null,
    briefing: r.briefing,
    constraints: r.constraints,
    // P3: Per-Call-Kontext mit-hydrieren. Ohne diese Zeile ginge context beim Restart
    // verloren UND der naechste Flush wuerde ihn ueberschreiben (JSONB auto-geparst zu
    // Objekt|null, Muster summary_sms_sent_at/I8). NULL -> null (json-Parity).
    context: r.context ?? null,
    // P6: Mandat mit-hydrieren. Ohne diese Zeile ginge es beim Restart verloren UND der
    // naechste Flush wuerde es ueberschreiben (Lehre I8). NULL -> null (json-Parity).
    mandate: r.mandate ?? null,
    callerName: r.caller_name,
    language: r.language,
    maxDurationS: r.max_duration_s,
    requestedBy: r.requested_by,
    provider: r.provider,
    status: r.status,
    startedAt: r.started_at,
    answeredAt: r.answered_at,
    // KS-EL1: der Grund, wenn answeredAt nicht ermittelbar war, mit-hydrieren. Ohne diese
    // Zeile ginge er beim Restart verloren UND der naechste Flush schriebe NULL zurueck
    // (Lehre i8-design-decisions). NULL -> null (json-Parity).
    answeredUnclearReason: r.answered_unclear_reason ?? null,
    // ABNAHME-D1 (TEIL 2): die vier strukturiert gesammelten Angaben mit-hydrieren. Ohne
    // diese Zeilen gingen sie beim Restart verloren UND der naechste Flush schriebe sie
    // auf NULL zurueck (Lehre i8-design-decisions). NULL -> null (json-Parity).
    appointmentDate: r.appointment_date ?? null,
    appointmentTime: r.appointment_time ?? null,
    amount: r.amount ?? null,
    currency: r.currency ?? null,
    // ABNAHME-D1 (TEIL 3): die bestaetigte Zeitzone des Angerufenen mit-hydrieren, aus
    // demselben Grund wie die vier Zeilen darueber.
    calleeConfirmedTimezone: r.callee_confirmed_timezone ?? null,
    calleeConfirmedTimezoneOrigin: r.callee_confirmed_timezone_origin ?? null,
    calleeConfirmedTimezoneAt: r.callee_confirmed_timezone_at ?? null,
    endedAt: r.ended_at,
    transcript: segmentsByCall.get(r.id) || [],
    summary: r.summary,
    objectiveAchieved: deserializeObjective(r.objective_achieved),
    // F2 P9 (M2): persistierten Summary-SMS-Dedup-Marker hydrieren. Ohne dieses Feld
    // ginge der Marker beim Prozess-Restart verloren (Spalte da, aber nie gelesen) und
    // ein spaeter /voice/status-Retry sendete eine zweite Summary-SMS. NULL -> null
    // (kein Marker, byte-identisch zur createCall-Initialisierung + json-Hydrierung).
    summarySmsSentAt: r.summary_sms_sent_at ?? null,
    // F2-Mail: persistierten Summary-Mail-Dedup-Marker hydrieren (Muster summary_sms_sent_at).
    // NULL -> null (kein Marker, byte-identisch zur createCall-Initialisierung).
    summaryMailSentAt: r.summary_mail_sent_at ?? null,
    // CDF1: persistierten Fehlergrund hydrieren (NULL -> null, json-Parity). Ohne diese Zeile
    // ginge er beim Restart verloren UND der naechste Flush wuerde ihn ueberschreiben.
    failureReason: r.failure_reason ?? null,
    // F9 (A6): persistierten Bucht-Marker hydrieren (NULL -> null, json-Parity). Ohne diese Zeile
    // ginge er beim Restart verloren -> Doppelbuchung; UND der naechste Flush ueberschriebe ihn.
    billedAt: r.billed_at ?? null,
    // P5 (C-Telnyx): Call-Control-Handles hydrieren. Ohne diese Zeilen ginge die
    // Zuordnung beim Restart verloren UND der naechste Flush ueberschriebe sie mit NULL
    // (Lehre i8-design-decisions). NULL -> null (json-Parity).
    callControlId: r.call_control_id ?? null,
    assistantId: r.assistant_id ?? null,
    // P2b: Diagnose-Markierung hydrieren. Ohne diese Zeile ginge sie beim Restart
    // verloren UND der naechste Flush schriebe sie auf FALSE zurueck (Lehre
    // i8-design-decisions). Explizites === true statt Truthiness: der Boolean-Wert
    // kommt aus dem Treiber, und ein NULL aus einer alt-migrierten Zeile muss auf
    // false fallen, nie auf true (fail-closed, bekannte pg-Boolean-Drift).
    diagnostic: r.diagnostic === true,
    // OC-P1: Owner-Ziel-Markierung hydrieren. Ohne diese Zeile ginge sie beim Restart
    // verloren UND der naechste Flush schriebe sie auf FALSE zurueck (Lehre
    // i8-design-decisions). Explizites === true statt Truthiness: der Boolean kommt aus
    // dem Treiber, und ein NULL aus einer alt-migrierten Zeile muss auf false fallen, nie
    // auf true (fail-closed - false heisst Offenlegung).
    calleeIsOwner: r.callee_is_owner === true,
    // INBOX-P1: beide Inbox-Marker hydrieren. NULL -> null (json-Parity).
    inboxEntryAt: r.inbox_entry_at ?? null,
    inboxSeenAt: r.inbox_seen_at ?? null,
    // LCT P2: Kosten-Achse hydrieren. Ohne diese Zeilen ginge sie beim Restart verloren UND
    // der naechste Flush schriebe sie auf NULL zurueck (Lehre i8-design-decisions - dieselbe
    // Klasse, die schon tenantId einmal gekostet hat). Bestandszeile ohne Wert -> null
    // (bzw. 0 fuer den Zaehler), json-Parity zu createCall.
    estimatedCostCents: r.estimated_cost_cents ?? null,
    // KS-P5: Belastungs-Anker hydrieren. Ohne diese Zeilen gingen sie beim Restart verloren
    // UND der naechste Flush schriebe NULL zurueck (Lehre i8-design-decisions) - die
    // Gutschrift fiele danach still auf "nur Lebenszeit" zurueck.
    estimatedCostSpendMonthKey: r.estimated_cost_spend_month_key ?? null,
    estimatedCostPeriodKey: r.estimated_cost_period_key ?? null,
    actualCostMicroCents: hydratedMicroCents(r.actual_cost_micro_cents),
    costTruedAt: r.cost_trued_at ?? null,
    costTruedSource: r.cost_trued_source ?? null,
    costTruingAttempts: r.cost_truing_attempts ?? 0,
    // AL-P1: beide Felder hydrieren. Ohne diese Zeilen gingen sie beim Restart verloren
    // UND der naechste Flush schriebe sie auf NULL/0 zurueck (Lehre i8-design-decisions).
    // Bestandszeile ohne Wert -> null bzw. 0 (json-Parity zu createCall).
    telnyxConversationId: r.telnyx_conversation_id ?? null,
    // EL-BL1: das ElevenLabs-Handle mit-hydrieren. Ohne diese Zeile ginge die Bindung
    // beim Restart verloren UND der naechste Flush schriebe NULL zurueck (Lehre
    // i8-design-decisions) - der Rueckfrage-Webhook fiele danach dauerhaft auf 404.
    elevenlabsConversationId: r.elevenlabs_conversation_id ?? null,
    // Phase-6-Voraussetzung: den Join-Schluessel mit-hydrieren. Ohne diese Zeile ginge er
    // beim Restart verloren UND der naechste Flush schriebe NULL zurueck (Lehre
    // i8-design-decisions) - die Telefonie-Kosten waeren dem Anruf danach dauerhaft nicht
    // mehr zuzuordnen, weil der Anbieter-Beleg, aus dem er stammt, geloescht ist.
    sipCallId: r.sip_call_id ?? null,
    // KV2-2: Kostenprofil mit-hydrieren. Ohne diese Zeile ginge es beim Restart verloren
    // UND der naechste Flush schriebe NULL zurueck (Lehre i8-design-decisions).
    costProfile: r.cost_profile ?? null,
    callerTurns: r.caller_turns ?? 0,
    // AL-P11: Ergebnis-Karte mit-hydrieren. Ohne diese Zeile ginge sie beim Restart
    // verloren UND der naechste Flush schriebe NULL zurueck (Lehre i8-design-decisions).
    // JSONB kommt vom Treiber bereits geparst (Muster context/mandate). NULL -> null.
    result: r.result ?? null,
    // AL-P13: Consult-Kette mit-hydrieren. Ohne diese Zeile ginge sie beim Restart
    // verloren UND der naechste Flush schriebe NULL zurueck (Lehre i8-design-decisions).
    // JSONB kommt vom Treiber bereits geparst (Muster context/mandate/result). NULL -> null.
    consults: r.consults ?? null,
    // Thema B: Recherche-Protokoll mit-hydrieren (JSONB auto-geparst). Ohne diese
    // Zeile ginge es beim Restart verloren UND der naechste Flush schriebe NULL
    // zurueck (Lehre i8-design-decisions) - und der Deckel zaehlte von vorn.
    lookupLog: r.lookup_log ?? null,
    actionItemIds: itemIdsByCall.get(r.id) || [],
    ...absenderWahrheitFelder(r),
    // ST3: Detektor-Zaehlfeld mit-hydrieren - ohne diese Zeile ginge es beim Restart
    // verloren UND der naechste Flush schriebe NULL zurueck (Lehre i8-design-decisions).
    ...elDetektorFelder(r),
  };
}

function rowToActionItem(r) {
  return {
    id: r.id,
    callId: r.call_id,
    text: r.text,
    type: r.type,
    done: r.done,
    createdAt: r.created_at,
  };
}

function rowToCalendarEvent(r) {
  return { id: r.id, title: r.title, start: r.starts_at, end: r.ends_at };
}

// Hydriert cost_eur zu GANZZAHL Cents. Postgres NUMERIC ist exakt dezimal -> verlustfreie
// Cent-Ableitung (P1, keine Schema-Migration). HEILKANTE (D7): NUMERIC haelt auch den Wert
// 'NaN'; ohne diese Normalisierung ist ein einmal vergifteter Bestand nach JEDEM Boot
// wieder da und macht beide Geld-Gates blind - sie ist die einzige der vier Kanten, die
// heilt statt nur zu verhindern. Unbuchbar -> 0, aber NIE still: der Betrag ist damit real
// verloren, und genau das muss der Operator sehen. Log secret-frei.
function hydratedCostCents(costEur) {
  const cents = Math.round(Number(costEur) * CENTS_PER_EUR);
  if (isBookableCents(cents)) return cents;
  console.error(`[pg] grund=${USAGE_CORRUPT_REASON} cost_eur=${costEur} -> costCents=0`);
  return 0;
}

function rowToUsage(r) {
  return {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costCents: hydratedCostCents(r.cost_eur),
    costMicroCentsRem: 0, // ephemer, nicht persistiert (wie reservations); Boot startet bei 0
    calls: Number(r.calls),
    // Spend-Monat-Achse (P4). Bestandszeile ohne Wert -> null/0 (die Spalte kommt per
    // ADD COLUMN IF NOT EXISTS mit DEFAULT 0 dazu). BIGINT liefert der Treiber als String
    // -> Number, wie input_tokens/calls. BEWUSST OHNE isBookableCents-Heilkante: BIGINT
    // kann - anders als das NUMERIC in cost_eur - den Wert 'NaN' gar nicht darstellen;
    // eine Heilkante ohne moegliche Vergiftung waere toter Code (G9).
    spendMonthKey: r.spend_month_key ?? null,
    spendMonthCostCents: Number(r.spend_month_cost_cents ?? 0),
    // LCT P4: PERSISTIERT (im Gegensatz zur Zeile darueber). BIGINT liefert der Treiber
    // als String -> Number, wie spend_month_cost_cents. Keine isBookableCents-Heilkante:
    // BIGINT kann - anders als das NUMERIC in cost_eur - kein 'NaN' darstellen; der
    // Bereichs-Riegel sitzt in convertProviderMicroToBucketCents (EINE Stelle).
    costCorrectionMicroCentsRem: Number(r.cost_correction_micro_cents_rem ?? 0),
    // KE-P6: Bestandszeile ohne Wert -> 0 (die Spalte kommt per ADD COLUMN IF NOT EXISTS mit
    // DEFAULT 0 dazu). BIGINT liefert der Treiber als String -> Number, wie calls.
    ttsCharacters: Number(r.tts_characters ?? 0),
    // GAP-01: Perioden-Fenster des Budget-Gates. Bestandszeile ohne Wert -> null/0 (die
    // Spalten kommen per ADD COLUMN IF NOT EXISTS dazu; NULL ist gueltig = nie gestempelt).
    // BIGINT liefert der Treiber als String -> Number, wie spend_month_cost_cents; keine
    // isBookableCents-Heilkante (BIGINT kann kein 'NaN' darstellen, waere toter Code).
    budgetPeriodKey: r.budget_period_key ?? null,
    budgetPeriodBaselineCents: Number(r.budget_period_baseline_cents ?? 0),
  };
}

function rowToNotification(r) {
  return { id: r.id, title: r.title, body: r.body, callId: r.call_id, at: r.at };
}

// ---- Flush: Spiegel -> DB (multi-tenant, I8). Eine Transaktion ueber den ganzen
// Spiegel. preFlush (optional, siehe save()) laeuft ALS ERSTES nach BEGIN, damit ein
// Rollback des restlichen Flush ihn mit zurueckrollt (P16/G26 - Atomaritaet: sonst
// bliebe ein Hard-Delete bestehen, obwohl der Flush selbst fehlschlug). Danach wird
// die tenant-Tabelle geschrieben (kein RLS, kein GUC noetig; die FK-Ziele muessen vor
// den tenant-scoped Inserts existieren), dann pro Tenant die RLS-GUC setzen und NUR
// dessen Scheibe flushen - exakt das owner-pinned Verhalten von frueher, nur N-fach.
// Bei genau einem Tenant und ohne preFlush identisch zu vorher.
// client = die von withClient gebundene Verbindung.
async function flush(client, state, preFlush) {
  await client.query("BEGIN");
  try {
    if (preFlush) await preFlush(client);
    await flushTenants(client, state.tenants);
    // OUTBOUND-E1: platform_number_use ist global (wie profile), wird aber - ANDERS als
    // profile/platform_tts_usage/cost_cross_check - VOR der Tenant-Schleife geflusht.
    // Grund: der number-Trigger (Ebene C) liest platform_number_use IN DERSELBEN
    // Transaktion. Wird eine Bindung geloest und die Nummer im selben save() freigegeben
    // (die legitime Kuendigung, release-reconcile.js), muss das Loesen fuer den Trigger
    // schon sichtbar sein - sonst wuerfe er, obwohl der Code alles richtig gemacht hat.
    // Die umgekehrte Richtung (erst binden, dann im selben save() freigeben) wirft - und
    // das ist die fail-closed-Richtung, die wir wollen.
    await flushPlatformNumberUse(client, state.platformNumberUse);
    // OUTBOUND-E3b: outage_alert ist global wie platform_number_use, hat aber KEINE
    // Trigger-Abhaengigkeit zur Tenant-Schleife - sie steht trotzdem HIER (Muster-Treue,
    // dieselbe Ebene wie die uebrige Plattform-Buchhaltung), nicht danach.
    await flushOutageAlerts(client, state.outageAlerts);
    for (const tenant of state.tenants) {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
      await flushTenantScope(client, tenant.id, state);
    }
    // Profiles sind global (Owner-Removal P5): EIN Flush pro Transaktion, an KEINEN
    // Tenant gebunden (Policy profile_global, kein app.current_tenant). Liegt bewusst
    // AUSSERHALB der per-Tenant-Schleife - sonst N-fach gegen dieselben Zeilen.
    await flushProfiles(client, state.profiles);
    // LCT P7: platform_tts_usage ist global wie profile - EIN Flush, ausserhalb der
    // Tenant-Schleife (kein app.current_tenant, keine Tenant-Dimension).
    await flushPlatformTtsUsage(client, state.platformTtsUsage);
    // KV-M4: cost_cross_check ist global wie platform_tts_usage - EIN Flush, ausserhalb
    // der Tenant-Schleife (kein app.current_tenant, keine Tenant-Dimension).
    await flushCostCrossCheck(client, state.costCrossCheck);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// Flusht die tenant-scoped Scheibe EINES Tenants (RLS-GUC ist gesetzt). Die
// call-verknuepften Entitaeten (calls + ihre actionItems/notifications) werden ueber
// ops.tenantCallScope partitioniert - dieselbe Quelle wie eraseTenantData/
// exportTenantData (EIN Filter mit derselben Regel, G5) - sonst blockte die
// RLS-WITH-CHECK den Insert einer Call-Zeile mit fremder tenant_id unter dieser GUC.
// settings/calendar/usage/numbers ueber die bestehenden pro-Tenant-Accessoren bzw.
// den numbers-Filter. profiles sind NICHT tenant-scoped (Owner-Removal P5) -> eigener
// globaler Flush in flush().
async function flushTenantScope(client, tenantId, state) {
  const { calls, callIds } = ops.tenantCallScope(state, tenantId);
  await flushCalls(client, tenantId, calls);
  await flushActionItems(
    client,
    tenantId,
    state.actionItems.filter((a) => callIds.has(a.callId)),
  );
  await flushCalendar(client, tenantId, ops.calendarFor(state, tenantId));
  await flushNotifications(client, tenantId, notificationsForTenant(state, tenantId, callIds));
  await flushSettings(client, tenantId, ops.settingsFor(state, tenantId));
  await flushUsage(client, tenantId, ops.usageFor(state, tenantId));
  await flushNumbers(client, tenantId, state.numbers);
  await flushProvisioningJobs(client, tenantId, state.provisioningJobs);
  await flushTenantBudgets(client, tenantId, state.tenantBudgets);
  await flushUsageEvents(client, tenantId, state.usageEvents);
  await flushCallCostEvidence(client, tenantId, state.callCostEvidence);
}

// tenant-Tabelle round-trippen (I8): id/status/owner_name/idp_subject upsert. KEINE
// RLS auf der tenant-Tabelle -> keine GUC noetig (anders als die 10 Daten-Tabellen).
// owner_name/idp_subject sind NULLABLE; ein Owner ohne eigenen Namen schreibt NULL
// (Owner-Fallback bleibt). Lebt VOR den tenant-scoped Inserts, weil diese per FK
// auf tenant(id) verweisen.
// p6-funnel: Der Lebenszyklus-status gehoert der accounts-Schicht (upsertOnFirstLogin
// = suspended bei Anlage, setStatus = Admin/Aktivierung/Webhook, seedDefaults = Owner).
// Beim INSERT setzt der Flush status (neuer Mirror-only-Tenant: Operator-Onboard/Owner);
// per ON CONFLICT wird status NICHT ueberschrieben - sonst degradiert/reaktiviert der
// Mirror einen bestehenden Tenant (Clobber des suspended frischer Web-Logins).
async function flushTenants(client, tenants) {
  for (const t of tenants) {
    await client.query(
      `INSERT INTO tenant (id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, stripe_payment_method_id, stripe_subscription_id, stripe_plan_slug, stripe_current_period_end, stripe_current_period_start, stripe_number_setup_fee_exempt, country, default_language, timezone, private_number, number_provision_skip_reason, number_provision_skip_at, suspended_at, stripe_activation_pending, stripe_billing_hold, stripe_billing_hold_due_at, stripe_period_credit_revoked, stripe_cancel_at_period_end, number_release_pending, workos_delete_pending, cancellation_mail_pending, cancellation_mail_received_at, newsletter_consent, newsletter_consent_at, newsletter_recipients, newsletter_confirm_mail_log)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
       ON CONFLICT (id) DO UPDATE SET
         owner_name=EXCLUDED.owner_name,
         first_name=EXCLUDED.first_name,
         idp_subject=EXCLUDED.idp_subject, kyc_level=EXCLUDED.kyc_level,
         stripe_customer_id=EXCLUDED.stripe_customer_id,
         stripe_payment_method_id=EXCLUDED.stripe_payment_method_id,
         stripe_subscription_id=EXCLUDED.stripe_subscription_id,
         stripe_plan_slug=EXCLUDED.stripe_plan_slug,
         stripe_current_period_end=EXCLUDED.stripe_current_period_end,
         stripe_current_period_start=EXCLUDED.stripe_current_period_start,
         stripe_number_setup_fee_exempt=EXCLUDED.stripe_number_setup_fee_exempt,
         country=EXCLUDED.country, default_language=EXCLUDED.default_language,
         timezone=EXCLUDED.timezone,
         private_number=EXCLUDED.private_number,
         number_provision_skip_reason=EXCLUDED.number_provision_skip_reason,
         number_provision_skip_at=EXCLUDED.number_provision_skip_at,
         suspended_at=EXCLUDED.suspended_at,
         stripe_activation_pending=EXCLUDED.stripe_activation_pending,
         stripe_billing_hold=EXCLUDED.stripe_billing_hold,
         stripe_billing_hold_due_at=EXCLUDED.stripe_billing_hold_due_at,
         stripe_period_credit_revoked=EXCLUDED.stripe_period_credit_revoked,
         stripe_cancel_at_period_end=EXCLUDED.stripe_cancel_at_period_end,
         number_release_pending=EXCLUDED.number_release_pending,
         workos_delete_pending=EXCLUDED.workos_delete_pending,
         cancellation_mail_pending=EXCLUDED.cancellation_mail_pending,
         cancellation_mail_received_at=EXCLUDED.cancellation_mail_received_at,
         newsletter_consent=EXCLUDED.newsletter_consent,
         newsletter_consent_at=EXCLUDED.newsletter_consent_at,
         newsletter_recipients=EXCLUDED.newsletter_recipients,
         newsletter_confirm_mail_log=EXCLUDED.newsletter_confirm_mail_log`,
      [
        t.id,
        t.status,
        t.ownerName ?? null,
        t.firstName ?? null,
        t.idpSubject ?? null,
        t.kycLevel ?? null,
        t.stripeCustomerId ?? null,
        t.stripePaymentMethodId ?? null,
        t.stripeSubscriptionId ?? null,
        t.stripePlanSlug ?? null,
        t.stripeCurrentPeriodEnd ?? null,
        t.stripeCurrentPeriodStart ?? null,
        t.stripeNumberSetupFeeExempt ?? null,
        t.country ?? null,
        t.defaultLanguage ?? null,
        t.timezone ?? null,
        t.privateNumber ?? null,
        t.numberProvisionSkipReason ?? null,
        t.numberProvisionSkipAt ?? null,
        t.suspendedAt ?? null,
        t.stripeActivationPending ?? null,
        t.billingHold ?? null,
        t.billingHoldDueAt ?? null,
        t.stripePeriodCreditRevoked ?? null,
        t.stripeCancelAtPeriodEnd ?? null,
        t.numberReleasePending ?? null,
        t.workosDeletePending ?? null,
        t.cancellationMailPending ?? null,
        t.cancellationMailReceivedAt ?? null,
        t.newsletterConsent ?? null,
        t.newsletterConsentAt ?? null,
        // Newsletter-Zusatzempfaenger ($32-$33): explizites JSON.stringify fuer den
        // outbound JSONB-Parameter (der Treiber serialisiert Schreib-Parameter NICHT
        // automatisch, Muster consults auf call). null bleibt null (leere Liste = kein
        // Eintrag, kein leeres "[]" am Bestandstenant).
        t.newsletterRecipients ? JSON.stringify(t.newsletterRecipients) : null,
        t.newsletterConfirmMailLog ? JSON.stringify(t.newsletterConfirmMailLog) : null,
      ],
    );
  }
}

// Notifications eines Tenants: call-verknuepfte ueber callIds; manuelle (callId=null)
// sind keinem Call/Tenant zuordbar -> sie gehoeren dem Owner (dokumentierte
// Entscheidung, I8). So flusht jede manuelle Notification GENAU einmal (unter Owner)
// und keine Notification faellt zwischen die Tenants.
function notificationsForTenant(state, tenantId, callIds) {
  return state.notifications.filter(
    (n) => callIds.has(n.callId) || (n.callId == null && tenantId === BOOTSTRAP_TENANT_ID),
  );
}

// settings/usage haben tenant_id als PK und genau eine Zeile pro Tenant. Upsert
// (INSERT ON CONFLICT) statt blossem UPDATE (I8): der Owner hat seine Zeile aus
// seedDefaults -> ON CONFLICT DO UPDATE wirkt byte-identisch zum frueheren UPDATE;
// ein neuer Tenant (kein Seed) bekommt seine Zeile erst hier angelegt. Gleiches
// Upsert-Muster wie flushCalls/flushCalendar/flushNumbers (G5).
async function flushSettings(client, tenantId, settings) {
  await client.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language,
        agent_style, allow_research, allow_call_memory)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id) DO UPDATE SET
       agent_name=EXCLUDED.agent_name, greeting=EXCLUDED.greeting,
       allow_calendar=EXCLUDED.allow_calendar, allow_booking=EXCLUDED.allow_booking,
       allow_summaries=EXCLUDED.allow_summaries, allow_personal_data=EXCLUDED.allow_personal_data,
       allow_bank_data=EXCLUDED.allow_bank_data, sms_summary_opt_in=EXCLUDED.sms_summary_opt_in,
       language=EXCLUDED.language, agent_style=EXCLUDED.agent_style,
       allow_research=EXCLUDED.allow_research, allow_call_memory=EXCLUDED.allow_call_memory`,
    [
      tenantId,
      settings.agentName,
      settings.greeting,
      settings.allowCalendar,
      settings.allowBooking,
      settings.allowSummaries,
      settings.allowPersonalData,
      settings.allowBankData,
      settings.smsSummaryOptIn,
      settings.language,
      settings.agentStyle ?? null,
      settings.allowResearch ?? false,
      settings.allowCallMemory ?? false,
    ],
  );
}

async function flushUsage(client, tenantId, usage) {
  await client.query(
    `INSERT INTO usage (tenant_id, input_tokens, output_tokens, cost_eur, calls,
                        spend_month_key, spend_month_cost_cents, cost_correction_micro_cents_rem,
                        tts_characters, budget_period_key, budget_period_baseline_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id) DO UPDATE SET
       input_tokens=EXCLUDED.input_tokens, output_tokens=EXCLUDED.output_tokens,
       cost_eur=EXCLUDED.cost_eur, calls=EXCLUDED.calls,
       spend_month_key=EXCLUDED.spend_month_key,
       spend_month_cost_cents=EXCLUDED.spend_month_cost_cents,
       cost_correction_micro_cents_rem=EXCLUDED.cost_correction_micro_cents_rem,
       tts_characters=EXCLUDED.tts_characters,
       budget_period_key=EXCLUDED.budget_period_key,
       budget_period_baseline_cents=EXCLUDED.budget_period_baseline_cents`,
    // costCents ist autoritativ (P1); die Spalte bleibt cost_eur (keine Schema-Migration) ->
    // hier die EINE Ableitungsstelle zur Persistenz (Schwester zu rowToUsage).
    // spend_month_cost_cents geht als GANZZAHL Cents raus (keine EUR-Ableitung, G26).
    // usage.spendMonthCostCents bewusst OHNE ?? 0 (wie usage.costCents oben): emptyUsage()
    // und rowToUsage sind die beiden einzigen Bucket-Quellen und garantieren das Feld - ein
    // '??' wuerde einen echten Shape-Defekt maskieren statt ihn an der NOT-NULL-Spalte laut
    // werden zu lassen. cost_correction_micro_cents_rem (LCT P4) und tts_characters (KE-P6)
    // ebenfalls OHNE ?? 0 - derselbe Garantie-Grund, und er gilt genauso fuer
    // budget_period_baseline_cents (GAP-01). budgetPeriodKey traegt - wie spendMonthKey -
    // ein ?? null, weil NULL dort die gueltige "nie gestempelt"-Auspraegung IST.
    [
      tenantId,
      usage.inputTokens,
      usage.outputTokens,
      usage.costCents / CENTS_PER_EUR,
      usage.calls,
      usage.spendMonthKey ?? null,
      usage.spendMonthCostCents,
      usage.costCorrectionMicroCentsRem,
      usage.ttsCharacters,
      usage.budgetPeriodKey ?? null,
      usage.budgetPeriodBaselineCents,
    ],
  );
}

// Die Werte EINER call-Zeile in der Reihenfolge der Platzhalter des INSERT oben
// ($1..$50). Aus flushCalls herausgezogen (G30: "welche Zeilen muessen weg und wie
// wird geschrieben" ist eine andere Aufgabe als "welcher Wert steht an welchem
// Platzhalter"). Der Auszug ist zugleich der Kopfraum, den die Funktion braucht: sie
// stand bei genau 100 Zeilen, und JEDE weitere additive Spalte haette die Laengengrenze
// gerissen - additive Spalten sind an dieser Stelle der Normalfall, nicht die Ausnahme.
function callRowValues(call, tenantId) {
  return [
    call.id,
    tenantId,
    call.streamToken,
    call.twilioSid,
    call.direction,
    call.from,
    call.to,
    call.goal,
    call.briefing,
    call.constraints,
    call.callerName,
    call.language,
    call.maxDurationS,
    call.requestedBy,
    call.status,
    call.startedAt,
    call.answeredAt,
    call.endedAt,
    call.summary,
    serializeObjective(call.objectiveAchieved),
    call.provider || DEFAULT_PROVIDER,
    call.summarySmsSentAt ?? null,
    // P3: Per-Call-Kontext als JSONB (Muster profile.data: Objekt -> JSON.stringify,
    // sonst NULL). SEIT AL-P13 IM ON CONFLICT DO UPDATE SET: der Kontext ist NICHT
    // mehr nach dem Create unveraenderlich - answerConsult merged die Antwort einer
    // Rueckfrage in context.key_facts. Ohne den UPDATE-Eintrag faellt jede beantwortete
    // Rueckfrage beim naechsten Flush lautlos auf den Create-Zustand zurueck.
    call.context ? JSON.stringify(call.context) : null,
    // CDF1: Fehlergrund-Token ($24). IM ON CONFLICT DO UPDATE SET (anders als context),
    // weil er NACH dem Create im /voice/status-Callback gesetzt wird.
    call.failureReason ?? null,
    // F9 (A6): Bucht-Marker ($25). IM ON CONFLICT DO UPDATE SET (Muster failure_reason),
    // weil er NACH dem Create in finishCall gesetzt wird.
    call.billedAt ?? null,
    // P5 (C-Telnyx): Call-Control-Handles ($26-$27). IM ON CONFLICT DO UPDATE SET
    // (Muster twilio_sid) - sie werden NACH dem Create bei erfolgreicher Call-Control-
    // Origination gesetzt, nicht beim initialen createCall.
    call.callControlId ?? null,
    call.assistantId ?? null,
    // P2b: Diagnose-Markierung. Wie context NICHT im ON CONFLICT DO UPDATE SET -
    // sie wird bei createCall gesetzt und danach nie mehr geaendert.
    call.diagnostic === true,
    // P6: Vorab-Mandat als JSONB ($29, ans Ende angehaengt -> keine Umnummerierung).
    // Wie context NICHT im ON CONFLICT DO UPDATE SET: bei createCall gesetzt, danach
    // unveraendert.
    call.mandate ? JSON.stringify(call.mandate) : null,
    // LCT P2 ($30-$34): ALLE FUENF im ON CONFLICT DO UPDATE SET - anders als
    // context/mandate/diagnostic (bei createCall gesetzt, danach unveraenderlich)
    // mutieren sie NACH dem Create: estimated_cost_cents in reconcileVoiceBudget,
    // die vier uebrigen im Kosten-Abgleich (P3). Fehlte auch nur eine im UPDATE-SET,
    // fiele der Wert beim naechsten Flush auf den Create-Zustand zurueck, der Call
    // saehe dauerhaft "nie abgeglichen" aus und P3 fragte ihn endlos erneut ab.
    call.estimatedCostCents ?? null,
    call.actualCostMicroCents ?? null,
    call.costTruedAt ?? null,
    call.costTruedSource ?? null,
    call.costTruingAttempts ?? 0,
    // AL-P1 ($35-$36): BEIDE im ON CONFLICT DO UPDATE SET - anders als context/mandate/
    // diagnostic mutieren sie NACH dem Create (Conversation-Webhook bzw. jeder
    // Anrufer-Turn). Fehlten sie im UPDATE-SET, fiele der Wert beim naechsten Flush auf
    // den Create-Zustand zurueck und die ganze Achse maesse dauerhaft 0.
    call.telnyxConversationId ?? null,
    call.callerTurns ?? 0,
    // AL-P11 ($37): JSONB (Muster context/mandate: Objekt -> JSON.stringify, sonst NULL).
    // ANDERS als context/mandate IM ON CONFLICT DO UPDATE SET: die Karte entsteht erst
    // in summarizeCall, also NACH dem Create. Fehlte sie im UPDATE-SET, faellt sie beim
    // naechsten Flush auf NULL zurueck und der Evidence-Purge haette nie etwas zu tun.
    call.result ? JSON.stringify(call.result) : null,
    // AL-P13 ($38): JSONB (Muster result). IM ON CONFLICT DO UPDATE SET - die
    // Kette entsteht/mutiert NACH dem Create (emit beim Waehlen, answer beim
    // Poll). Fehlte sie im UPDATE-SET, faellt sie beim naechsten Flush auf NULL
    // zurueck und jede beantwortete Rueckfrage waere nach dem Flush weg.
    call.consults ? JSON.stringify(call.consults) : null,
    // KS-P5 ($39-$40): BEIDE im ON CONFLICT DO UPDATE SET - sie entstehen zusammen mit
    // estimated_cost_cents NACH dem Create (reconcileVoiceBudget), also aus
    // genau dem Grund, aus dem estimated_cost_cents dort schon steht. Fehlten sie im
    // UPDATE-SET, faellt der Anker beim naechsten Flush auf NULL zurueck und jede
    // spaetere Gutschrift wirkte nur noch auf der Lebenszeit-Achse.
    call.estimatedCostSpendMonthKey ?? null,
    call.estimatedCostPeriodKey ?? null,
    // EL-BL1 ($41, ans Ende angehaengt -> keine Umnummerierung): IM ON CONFLICT DO
    // UPDATE SET (Muster telnyx_conversation_id) - die Kennung entsteht NACH dem
    // Create, sobald das Laufwerk das Gespraech eroeffnet hat. Fehlte sie im
    // UPDATE-SET, fiele die Bindung beim naechsten Flush auf NULL zurueck und der
    // Rueckfrage-Webhook faende den laufenden Anruf nicht mehr.
    call.elevenlabsConversationId ?? null,
    // KS-EL1 ($42, ans Ende angehaengt -> keine Umnummerierung): IM ON CONFLICT DO
    // UPDATE SET (Muster elevenlabs_conversation_id) - der Grund entsteht NACH dem
    // Create, am Gespraechsende (finishFromConversation). Fehlte er im UPDATE-SET,
    // fiele er beim naechsten Flush auf NULL zurueck.
    call.answeredUnclearReason ?? null,
    // ABNAHME-D1 ($43-$46, ans Ende angehaengt -> keine Umnummerierung): die vier
    // strukturiert gesammelten Angaben. IM ON CONFLICT DO UPDATE SET (Muster
    // answered_unclear_reason) - sie entstehen NACH dem Create, am Gespraechsende
    // (persistProviderResult). Fehlten sie im UPDATE-SET, fielen sie beim naechsten
    // Flush auf NULL zurueck.
    call.appointmentDate ?? null,
    call.appointmentTime ?? null,
    call.amount ?? null,
    call.currency ?? null,
    // ABNAHME-D1 ($47-$49): die bestaetigte Zeitzone des Angerufenen, aus demselben
    // Grund IM ON CONFLICT DO UPDATE SET wie die vier Werte darueber - und
    // UEBERSCHREIBBAR (Eigentuemer-Auflage), ein spaeterer Flush darf einen frischer
    // bestaetigten Wert deshalb bewusst ersetzen.
    call.calleeConfirmedTimezone ?? null,
    call.calleeConfirmedTimezoneOrigin ?? null,
    call.calleeConfirmedTimezoneAt ?? null,
    // Phase-6-Join-Schluessel ($50, angehaengt -> keine Umnummerierung). IM ON CONFLICT
    // DO UPDATE SET, Muster+Grund identisch zu elevenlabs_conversation_id oben.
    call.sipCallId ?? null,
    // Thema A ($51-$52, angehaengt -> keine Umnummerierung): Eroeffnungszeile + Hash.
    // BEWUSST NICHT im ON CONFLICT DO UPDATE SET (Muster goal/briefing): beide werden
    // bei createCall gesetzt und danach nie mutiert - genau diese Unveraenderlichkeit
    // prueft der Anrufstart (opening-line.js#verifiedOpeningLine).
    call.openingLine ?? null,
    call.openingLineSha256 ?? null,
    // Thema B ($53): Recherche-Protokoll (JSONB, Muster consults). IM ON CONFLICT DO
    // UPDATE SET - die Eintraege entstehen NACH dem Create (je Webhook-Aufruf). Fehlte
    // die Spalte im UPDATE-SET, fiele das Protokoll beim naechsten Flush auf NULL
    // zurueck und der Deckel zaehlte wieder von vorn.
    call.lookupLog ? JSON.stringify(call.lookupLog) : null,
    // F2-Mail ($54): IM ON CONFLICT DO UPDATE SET (Muster summary_sms_sent_at) - der
    // Marker entsteht NACH dem Create in finishCall (Mail-Versand).
    call.summaryMailSentAt ?? null,
    // OC-P1 ($55, ans Ende angehaengt -> keine Umnummerierung): Owner-Ziel-Markierung.
    // Wie diagnostic BEWUSST NICHT im ON CONFLICT DO UPDATE SET - sie wird bei createCall
    // gesetzt und danach nie mehr geaendert (set-once). Ein UPDATE-Eintrag waere hier ein
    // Defekt: er machte eine spaetere, zweite Auswertung nachtraeglich wirksam.
    call.calleeIsOwner === true,
    // INBOX-P1 ($56-$57): beide IM ON CONFLICT DO UPDATE SET.
    call.inboxEntryAt ?? null,
    call.inboxSeenAt ?? null,
    // OUTBOUND-E5 ($58-$60, angehaengt -> keine Umnummerierung): die drei Absender-
    // Wahrheits-Felder, alle IM ON CONFLICT DO UPDATE SET - sie entstehen NACH dem
    // Create (Anrufstart bzw. Ergebnisabruf).
    ...absenderWahrheitWerte(call),
    // KV2-2 ($61, angehaengt): Kostenprofil. IM ON CONFLICT DO UPDATE SET - es entsteht
    // NACH dem Create (an der Engine-Weiche), der set-once-Riegel liegt in state-ops,
    // nicht in SQL (Muster sip_call_id, NICHT callee_is_owner).
    call.costProfile ?? null,
    // ST3 ($62, angehaengt): Detektor-Zaehlfeld als JSONB (Muster lookup_log). IM ON
    // CONFLICT DO UPDATE SET - es entsteht NACH dem Create am Gespraechsende
    // (persistProviderResult); ohne UPDATE-SET faelle es beim naechsten Flush auf NULL
    // zurueck (Muster answered_unclear_reason).
    ...elDetektorWerte(call),
  ];
}

async function flushCalls(client, tenantId, calls) {
  await deleteMissingCallsKeepActive(
    client,
    tenantId,
    calls.map((c) => c.id),
  );
  for (const c of calls) {
    await client.query(
      `INSERT INTO call
         (id, tenant_id, stream_token, twilio_sid, direction, from_e164, to_e164, goal,
          briefing, constraints, caller_name, language, max_duration_s, requested_by,
          status, started_at, answered_at, ended_at, summary, objective_achieved, provider,
          summary_sms_sent_at, context, failure_reason, billed_at,
          call_control_id, assistant_id, diagnostic, mandate,
          estimated_cost_cents, actual_cost_micro_cents, cost_trued_at,
          cost_trued_source, cost_truing_attempts, telnyx_conversation_id, caller_turns, result,
          consults, estimated_cost_spend_month_key, estimated_cost_period_key,
          elevenlabs_conversation_id, answered_unclear_reason,
          appointment_date, appointment_time, amount, currency,
          callee_confirmed_timezone, callee_confirmed_timezone_origin,
          callee_confirmed_timezone_at, sip_call_id, opening_line, opening_line_sha256,
          lookup_log, summary_mail_sent_at, callee_is_owner, inbox_entry_at, inbox_seen_at,
          from_actual_e164, from_source, from_registration_source, cost_profile,
          el_detector_counts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62)
       ON CONFLICT (id) DO UPDATE SET
         twilio_sid=EXCLUDED.twilio_sid, status=EXCLUDED.status, answered_at=EXCLUDED.answered_at,
         ended_at=EXCLUDED.ended_at, summary=EXCLUDED.summary,
         objective_achieved=EXCLUDED.objective_achieved, provider=EXCLUDED.provider,
         summary_sms_sent_at=EXCLUDED.summary_sms_sent_at, failure_reason=EXCLUDED.failure_reason,
         billed_at=EXCLUDED.billed_at,
         call_control_id=EXCLUDED.call_control_id, assistant_id=EXCLUDED.assistant_id,
         estimated_cost_cents=EXCLUDED.estimated_cost_cents,
         actual_cost_micro_cents=EXCLUDED.actual_cost_micro_cents,
         cost_trued_at=EXCLUDED.cost_trued_at, cost_trued_source=EXCLUDED.cost_trued_source,
         cost_truing_attempts=EXCLUDED.cost_truing_attempts,
         telnyx_conversation_id=EXCLUDED.telnyx_conversation_id,
         caller_turns=EXCLUDED.caller_turns, result=EXCLUDED.result,
         consults=EXCLUDED.consults, context=EXCLUDED.context,
         estimated_cost_spend_month_key=EXCLUDED.estimated_cost_spend_month_key,
         estimated_cost_period_key=EXCLUDED.estimated_cost_period_key,
         elevenlabs_conversation_id=EXCLUDED.elevenlabs_conversation_id,
         answered_unclear_reason=EXCLUDED.answered_unclear_reason,
         appointment_date=EXCLUDED.appointment_date, appointment_time=EXCLUDED.appointment_time,
         amount=EXCLUDED.amount, currency=EXCLUDED.currency,
         callee_confirmed_timezone=EXCLUDED.callee_confirmed_timezone,
         callee_confirmed_timezone_origin=EXCLUDED.callee_confirmed_timezone_origin,
         callee_confirmed_timezone_at=EXCLUDED.callee_confirmed_timezone_at,
         sip_call_id=EXCLUDED.sip_call_id, lookup_log=EXCLUDED.lookup_log,
         summary_mail_sent_at=EXCLUDED.summary_mail_sent_at,
         inbox_entry_at=EXCLUDED.inbox_entry_at, inbox_seen_at=EXCLUDED.inbox_seen_at,
         from_actual_e164=EXCLUDED.from_actual_e164, from_source=EXCLUDED.from_source,
         from_registration_source=EXCLUDED.from_registration_source,
         cost_profile=EXCLUDED.cost_profile,
         el_detector_counts=EXCLUDED.el_detector_counts`,
      callRowValues(c, tenantId),
    );
    await flushTranscript(client, tenantId, c);
  }
}

// Transkript-Segmente sind append-only: nur fehlende anhaengen. EINZIGE Ausnahme:
// ein geleertes Spiegel-Transkript (Roh-Transkript-Purge nach Summary, #7) wird
// auf die DB reconciled -> die persistierten Segmente DIESES Calls werden geloescht.
// Tenant-Schutz doppelt verankert wie bei deleteMissingByText: expliziter
// tenant_id-Filter im Statement PLUS RLS-GUC (FORCE-RLS, set_config in flush) als
// zweite Linie. Trifft NUR diesen Call dieses Tenants; andere bleiben unberuehrt.
async function flushTranscript(client, tenantId, call) {
  if (call.transcript.length === 0) {
    await client.query(`DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2`, [
      tenantId,
      call.id,
    ]);
    return;
  }
  // GQ-H1-a: seit dropLastAgentTranscript kann das Transkript auch SCHRUMPFEN - vorher
  // wuchs es nur, und ein blosser ZEILENZAEHLER genuegte, um die fehlenden anzuhaengen.
  // Er genuegt nicht mehr: schrumpft der Spiegel und waechst danach wieder, BEVOR ein
  // Flush laeuft, stimmt die Zahl zufaellig wieder, waehrend Zeile i und Segment i
  // auseinanderlaufen - die verworfene Antwort bliebe stehen und die echte landete an
  // ihrer Stelle. Deshalb wird ueber den INHALT abgeglichen: bis zur ersten Abweichung
  // ist die DB gueltig, ab dort wird sie neu geschrieben. Das heilt auch Altbestand.
  const persisted = (
    await client.query(
      `SELECT id, role, text FROM transcript_segment WHERE call_id=$1 ORDER BY id ASC`,
      [call.id],
    )
  ).rows;
  let gemeinsam = 0;
  while (
    gemeinsam < persisted.length &&
    gemeinsam < call.transcript.length &&
    persisted[gemeinsam].role === call.transcript[gemeinsam].role &&
    persisted[gemeinsam].text === call.transcript[gemeinsam].text
  )
    gemeinsam += 1;
  // Tenant-Schutz doppelt verankert wie oben (expliziter Filter + RLS-GUC als zweite Linie).
  if (gemeinsam < persisted.length)
    await client.query(
      `DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2 AND id = ANY($3)`,
      [tenantId, call.id, persisted.slice(gemeinsam).map((r) => r.id)],
    );
  for (let i = gemeinsam; i < call.transcript.length; i++) {
    const seg = call.transcript[i];
    await client.query(
      `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`,
      [call.id, tenantId, seg.role, seg.text, seg.at],
    );
  }
}

async function flushActionItems(client, tenantId, items) {
  await deleteMissing(
    client,
    "action_item",
    tenantId,
    items.map((i) => i.id),
  );
  // Aelteste zuerst einfuegen, damit seq die unshift-Reihenfolge widerspiegelt.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    await client.query(
      `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET done=EXCLUDED.done`,
      [it.id, tenantId, it.callId, it.text, it.type, it.done, it.createdAt],
    );
  }
}

async function flushCalendar(client, tenantId, events) {
  await deleteMissing(
    client,
    "calendar_event",
    tenantId,
    events.map((e) => e.id),
  );
  for (const ev of events) {
    await client.query(
      `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at`,
      [ev.id, tenantId, ev.title, ev.start, ev.end],
    );
  }
}

async function flushNotifications(client, tenantId, notifications) {
  await deleteMissing(
    client,
    "notification",
    tenantId,
    notifications.map((n) => n.id),
  );
  // Aelteste zuerst, damit seq die unshift-Reihenfolge (neueste zuerst) ergibt.
  for (let i = notifications.length - 1; i >= 0; i--) {
    const n = notifications[i];
    await client.query(
      `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [n.id, tenantId, n.title, n.body, n.callId, n.at],
    );
  }
}

// Profile-Flush (global, an KEINEN Tenant gebunden): profile.tenant_id ist PK allein
// (schema.sql, Phase S - die Spalte haelt tenantIds); deleteMissingProfiles raeumt entfernte
// Profile ab, ohne RLS-Tenant-Filter. Policy profile_global schuetzt die Tabelle (kein
// Tenant-Filter, global lesbar/schreibbar - die Zugriffskontrolle liegt eine Schicht hoeher).
async function flushProfiles(client, profiles) {
  const tenantIds = Object.keys(profiles);
  await deleteMissingProfiles(client, tenantIds);
  for (const [tenantId, data] of Object.entries(profiles)) {
    await client.query(
      `INSERT INTO profile (tenant_id, data) VALUES ($1,$2)
       ON CONFLICT (tenant_id) DO UPDATE SET data=EXCLUDED.data`,
      [tenantId, JSON.stringify(data)],
    );
  }
}

// TTS-Kontingent-Flush (LCT P7, global, Singleton id=1, Muster flushProfiles). Voll-Upsert
// der EINEN Zeile - kein deleteMissing noetig (keine Sammlung, kein tenant_id-Schluessel).
async function flushPlatformTtsUsage(client, row) {
  await client.query(
    `INSERT INTO platform_tts_usage (id, cycle_key, characters, warned_cycle) VALUES (1,$1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET cycle_key=EXCLUDED.cycle_key, characters=EXCLUDED.characters,
       warned_cycle=EXCLUDED.warned_cycle`,
    [row.cycleKey, row.characters, row.warnedCycle],
  );
}

// Riegel-Flush der monatlichen Gegenprobe (KV-M4, global, Singleton id=1, Muster
// flushPlatformTtsUsage). Voll-Upsert der EINEN Zeile.
async function flushCostCrossCheck(client, row) {
  await client.query(
    `INSERT INTO cost_cross_check (id, last_checked_month_key) VALUES (1,$1)
     ON CONFLICT (id) DO UPDATE SET last_checked_month_key=EXCLUDED.last_checked_month_key`,
    [row.lastCheckedMonthKey],
  );
}

// platform_number_use-Flush (OUTBOUND-E1, global, an KEINEN Tenant gebunden; Muster
// flushProfiles). id-PK-Upsert + Prune ueber die globale keep-Liste. KEIN
// flushOwnScoped/deleteMissing: die Tabelle hat keine tenant_id-Scoping-Semantik
// (tenant_id ist hier eine Eigenschafts-Spalte, kein Scope).
async function flushPlatformNumberUse(client, bindings) {
  // "binding" statt "b" (s.o., Altlast-Ratsche): der Pin dieser Datei darf nicht wachsen.
  await deleteMissingPlatformNumberUse(client, bindings.map((binding) => binding.id));
  for (const binding of bindings) {
    await client.query(
      `INSERT INTO platform_number_use
         (id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         e164=EXCLUDED.e164, purpose=EXCLUDED.purpose, provider=EXCLUDED.provider,
         tenant_id=EXCLUDED.tenant_id, provider_number_id=EXCLUDED.provider_number_id,
         released_at=EXCLUDED.released_at, note=EXCLUDED.note`,
      [binding.id, binding.e164, binding.purpose, binding.provider, binding.tenantId ?? null,
       binding.providerNumberId ?? null, binding.boundAt, binding.releasedAt ?? null, binding.note ?? null],
    );
  }
}

// Prune der globalen Bindungs-Tabelle (Muster deleteMissingProfiles). Leere keep-Liste ->
// alle Bindungen weg (Parity zu deleteMissing).
async function deleteMissingPlatformNumberUse(client, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM platform_number_use`);
    return;
  }
  await client.query(`DELETE FROM platform_number_use WHERE id <> ALL($1::text[])`, [keepIds]);
}

// outage_alert-Flush (OUTBOUND-E3b, global, an KEINEN Tenant gebunden; Muster
// flushPlatformNumberUse). id-PK-Upsert + Prune ueber die globale keep-Liste.
async function flushOutageAlerts(client, alerts) {
  await deleteMissingOutageAlerts(client, alerts.map((alert) => alert.id));
  for (const alert of alerts) {
    await client.query(
      `INSERT INTO outage_alert
         (id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at,
          delivered_channels, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         last_seen_at=EXCLUDED.last_seen_at, last_attempt_at=EXCLUDED.last_attempt_at,
         reported_at=EXCLUDED.reported_at, delivered_channels=EXCLUDED.delivered_channels,
         closed_at=EXCLUDED.closed_at`,
      [alert.id, alert.code, alert.firstSeenAt, alert.lastSeenAt, alert.lastAttemptAt ?? null,
       alert.reportedAt ?? null, alert.deliveredChannels ?? null, alert.closedAt ?? null],
    );
  }
}

// Prune der globalen Marker-Tabelle (Muster deleteMissingPlatformNumberUse). Leere
// keep-Liste -> alle Marker weg (Parity zu deleteMissing).
async function deleteMissingOutageAlerts(client, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM outage_alert`);
    return;
  }
  await client.query(`DELETE FROM outage_alert WHERE id <> ALL($1::text[])`, [keepIds]);
}

// Loescht Profile-Zeilen, deren tenant_id nicht mehr im Spiegel steht (global, kein
// RLS-Tenant-Filter). Leere keep-Liste -> alle Profile weg (Parity zu deleteMissing).
async function deleteMissingProfiles(client, keepTenantIds) {
  if (keepTenantIds.length === 0) {
    await client.query(`DELETE FROM profile`);
    return;
  }
  await client.query(`DELETE FROM profile WHERE tenant_id <> ALL($1::text[])`, [keepTenantIds]);
}

// Buendelt das dreifach identische own-Filter + deleteMissing + Insert-Loop-Idiom der
// tenant-scoped id-PK-Tabellen (number/provisioning_job/usage_event) an EINER Stelle
// (G5, Template Method). Der own-Filter haelt jeden Flush-Aufruf auf die Zeilen DIESES
// Tenants - eine zweite Verteidigungslinie ZUSAETZLICH zur per-Tenant-RLS-GUC
// (Defense-in-Depth, dokumentierte Absicht: der INSERT schreibt tenant_id=<tenantId>,
// nicht row.tenantId). deleteMissing prunt Zeilen, die nicht mehr im Spiegel stehen,
// VOR dem Insert-Loop (Retention/Erase). insertRow upsert't eine einzelne Zeile
// (tabellenspezifisch, closure ueber client + tenantId). tenant_budget nutzt den Helfer
// bewusst NICHT (PK=tenant_id, kein deleteMissing -> flushTenantBudgets bleibt separat).
async function flushOwnScoped({ client, tenantId, table, rows, insertRow }) {
  const own = rows.filter((r) => r.tenantId === tenantId);
  await deleteMissing(
    client,
    table,
    tenantId,
    own.map((r) => r.id),
  );
  for (const row of own) {
    await insertRow(row);
  }
}

// number-Flush (Onboarding-Lifecycle): id-PK-Upsert mit allen Lifecycle-Feldern
// (status, provider_number_id, e164 NULLABLE fuer 'requested'). Multi-Tenant (I8):
// flush ruft flushNumbers pro Tenant unter dessen RLS-GUC; flushOwnScoped kapselt
// own-Filter + deleteMissing (siehe dort). So round-trippen die Nummern aller Tenants
// (nicht mehr owner-only).
// number-Zeile -> Spiegel-Objekt. Gegenstueck zu flushNumbers, Konvention wie rowToTenant/
// rowToCall. Aus hydrateTenantInto herausgeloest, weil dessen gepinnte Zeilengrenze
// (eslint-legacy-exceptions.json) sonst durch die E5-Spalte STEIGEN wuerde - dieser Schnitt
// SENKT sie stattdessen.
function rowToNumber(r) {
  return {
    id: r.id, e164: r.e164, tenantId: r.tenant_id, provider: r.provider, status: r.status,
    providerNumberId: r.provider_number_id,
    paymentIntentId: r.payment_intent_id ?? null,
    country: r.country ?? null,
    language: r.language ?? null,
    // OUTBOUND-E5: Bestands-Nummer ohne Registrierung -> null (kein undefined-Drift).
    providerAgentPhoneNumberId: r.provider_agent_phone_number_id ?? null,
    ...(r.monthly_cost_cents === null || r.monthly_cost_cents === undefined
      ? {} : { monthlyCostCents: r.monthly_cost_cents }),
  };
}

async function flushNumbers(client, tenantId, numbers) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "number",
    rows: numbers,
    insertRow: (n) =>
      client.query(
        `INSERT INTO number (id, tenant_id, e164, provider, status, provider_number_id, payment_intent_id, country, language, monthly_cost_cents, provider_agent_phone_number_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           e164=EXCLUDED.e164, provider=EXCLUDED.provider,
           status=EXCLUDED.status, provider_number_id=EXCLUDED.provider_number_id,
           payment_intent_id=EXCLUDED.payment_intent_id,
           country=EXCLUDED.country, language=EXCLUDED.language,
           monthly_cost_cents=EXCLUDED.monthly_cost_cents,
           provider_agent_phone_number_id=EXCLUDED.provider_agent_phone_number_id`,
        [
          n.id,
          tenantId,
          n.e164 ?? null,
          n.provider || DEFAULT_PROVIDER,
          n.status,
          n.providerNumberId ?? null,
          n.paymentIntentId ?? null,
          n.country ?? null,
          n.language ?? null,
          n.monthlyCostCents ?? null,
          n.providerAgentPhoneNumberId ?? null,
        ],
      ),
  });
}

// provisioning_job-Flush (async Worker, P6b2): id-PK-Upsert der Job-Spur ueber
// flushOwnScoped (own-Filter + deleteMissing, siehe dort). status/attempts/last_error
// koennen sich aendern (Worker-Lauf), der Rest (number_id/kind/idempotency_key) bleibt
// nach dem Insert stabil. created_at ist application-provided (F4, gegen DB-now()-Skew)
// und bleibt nach dem Insert immutable.
async function flushProvisioningJobs(client, tenantId, jobs) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "provisioning_job",
    rows: jobs,
    insertRow: (j) =>
      client.query(
        `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           status=EXCLUDED.status, attempts=EXCLUDED.attempts, last_error=EXCLUDED.last_error`,
        [
          j.id,
          tenantId,
          j.numberId,
          j.kind,
          j.status,
          j.idempotencyKey,
          j.attempts,
          j.lastError ?? null,
          j.createdAt,
        ],
      ),
  });
}

// tenant_budget-Flush (P6b3): PK = tenant_id (eine Zeile pro Tenant), kein
// deleteMissing noetig (setTenantBudget loescht nie). own-Filter pro Tenant unter
// dessen RLS-GUC (zweite Linie, Muster wie flushNumbers). Upsert wie flushSettings/
// flushUsage. Money als GANZZAHL Cents.
async function flushTenantBudgets(client, tenantId, budgets) {
  const own = budgets.filter((b) => b.tenantId === tenantId);
  for (const b of own) {
    await client.query(
      `INSERT INTO tenant_budget (tenant_id, budget_cents, hard_cap_cents)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         budget_cents=EXCLUDED.budget_cents, hard_cap_cents=EXCLUDED.hard_cap_cents`,
      [tenantId, b.budgetCents, b.hardCapCents],
    );
  }
}

// usage_event-Flush (P6b3): append-only id-PK-Ledger ueber flushOwnScoped (own-Filter
// + deleteMissing, siehe dort - Retention/Erase koennten Events entfernen). Upsert:
// nur stripe_meter_sent ist nach dem Insert aenderbar.
async function flushUsageEvents(client, tenantId, events) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "usage_event",
    rows: events,
    insertRow: (e) =>
      client.query(
        `INSERT INTO usage_event (id, tenant_id, call_id, number_id, kind, quantity, cost_cents, cost_micro_cents, occurred_at, stripe_meter_sent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET stripe_meter_sent=EXCLUDED.stripe_meter_sent`,
        [
          e.id,
          tenantId,
          e.callId,
          e.numberId ?? null,
          e.kind,
          e.quantity,
          e.costCents,
          e.costMicroCents ?? null,
          e.occurredAt,
          e.stripeMeterSent,
        ],
      ),
  });
}

// call_cost_evidence-Flush (KV2-3): id-PK-Upsert ueber flushOwnScoped (own-Filter +
// deleteMissing, siehe dort). Aenderbar sind nur die Felder, die die Reifung fortschreibt;
// call_id/traeger stehen nach dem Insert fest (der Unique-Index auf (call_id, traeger)
// haelt das auch in der DB).
async function flushCallCostEvidence(client, tenantId, zeilen) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "call_cost_evidence",
    rows: zeilen,
    insertRow: (zeile) =>
      client.query(
        `INSERT INTO call_cost_evidence
           (id, tenant_id, call_id, traeger, reife, betrag_mikro_cents, waehrung, quelle,
            beleg_ref, versuche, gemessen_at, abstand_zum_gespraechsende_s, detail,
            nachreifbar)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           reife=EXCLUDED.reife, betrag_mikro_cents=EXCLUDED.betrag_mikro_cents,
           waehrung=EXCLUDED.waehrung, quelle=EXCLUDED.quelle,
           beleg_ref=EXCLUDED.beleg_ref, versuche=EXCLUDED.versuche,
           gemessen_at=EXCLUDED.gemessen_at,
           abstand_zum_gespraechsende_s=EXCLUDED.abstand_zum_gespraechsende_s,
           detail=EXCLUDED.detail, nachreifbar=EXCLUDED.nachreifbar`,
        [
          zeile.id,
          tenantId,
          zeile.callId,
          zeile.traeger,
          zeile.reife,
          zeile.betragMikroCents ?? null,
          zeile.waehrung ?? null,
          zeile.quelle ?? null,
          zeile.belegRef ?? null,
          zeile.versuche,
          zeile.gemessenAt ?? null,
          zeile.abstandZumGespraechsendeS ?? null,
          zeile.detail ? JSON.stringify(zeile.detail) : null,
          zeile.nachreifbar,
        ],
      ),
  });
}

// objectiveAchieved kann string ODER boolean sein (json speichert beides). Die
// TEXT-Spalte haelt die String-Form; null bleibt null.
function serializeObjective(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

// Rueck-Coercion zu serializeObjective (S1-3): die TEXT-Spalte liefert IMMER einen
// String oder null. "true"/"false" sind ausschliesslich Serialisierungen eines
// Booleans (claude.js setzt nie den Literal-String "true"/"false" als Fachwert) ->
// zurueck zu Boolean. Jeder andere String (z.B. "unclear") bleibt unveraendert.
// null bleibt null.
function deserializeObjective(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

// Loescht Zeilen des Tenants, deren TEXT-PK nicht mehr im Spiegel steht (Retention
// /Prune). Leere keep-Liste -> alle Zeilen des Tenants weg.
async function deleteMissing(client, table, tenantId, keepIds) {
  await deleteMissingByText({ client, table, column: "id", tenantId, keepValues: keepIds });
}

async function deleteMissingByText({ client, table, column, tenantId, keepValues }) {
  if (keepValues.length === 0) {
    await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    return;
  }
  await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND ${column} <> ALL($2::text[])`, [
    tenantId,
    keepValues,
  ]);
}

// Reconcile-Prune fuer die call-Tabelle (A6/DEPLOY-04): entfernt Retention-Zeilen
// des Tenants wie deleteMissing, schuetzt aber jedes laufende Gespraech - eine
// DB-Zeile mit status=CALL_STATUS_ACTIVE, die der (divergente) Spiegel NICHT kennt,
// wird NIE geloescht. Der eigene aktive Call steht ohnehin in keepIds (Upsert) ->
// geschuetzt sind nur FREMDE aktive Zeilen eines Overlap-/Restart-Prozesses.
// Bewusst call-lokal, NICHT im generischen deleteMissing (8 Tabellen): status=active
// heisst nur bei call "laufendes Gespraech"; bei number waere es eine aktive DID ->
// genereller Schutz verhinderte legitimes Prunen.
const CALL_STATUS_ACTIVE = "active";
async function deleteMissingCallsKeepActive(client, tenantId, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM call WHERE tenant_id=$1 AND status <> $2`, [
      tenantId,
      CALL_STATUS_ACTIVE,
    ]);
    return;
  }
  await client.query(
    `DELETE FROM call WHERE tenant_id=$1 AND status <> $2 AND id <> ALL($3::text[])`,
    [tenantId, CALL_STATUS_ACTIVE, keepIds],
  );
}

// DSGVO-Art.-17-Hard-Delete (Gegenstueck zu deleteMissingCallsKeepActive): loescht
// GENAU die uebergebenen Call-IDs, UNABHAENGIG vom status. Der Reconcile-Schutz oben
// gilt nur FREMDEN/unbekannten Zeilen eines Overlap-Prozesses - beim Erase sind es
// die EIGENEN, per tenantCallScope erfassten Zeilen des Tenants, deren Loeschung
// der Nutzer aktiv verlangt hat (Recht auf Loeschung sticht den Reconcile-Schutz).
// Laeuft als preFlush INNERHALB derselben Transaktion wie der Flush (P16/G26,
// direkt nach BEGIN) - deshalb GUC TRANSAKTIONSLOKAL setzen (dritter Parameter true),
// genau wie der per-Tenant-Flush danach. Ein Rollback des restlichen Flush (z.B.
// transienter DB-Fehler in einer Folge-Tabelle) rollt diesen Delete mit zurueck,
// statt eine teilweise DSGVO-Loeschung zu hinterlassen.
async function hardDeleteCalls(client, tenantId, callIds) {
  if (callIds.length === 0) return;
  await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await client.query(`DELETE FROM call WHERE tenant_id=$1 AND id = ANY($2::text[])`, [
    tenantId,
    callIds,
  ]);
}
