// OUTBOUND-E3a/E3b (Befund C1/C-A/G27-C2, REIHENFOLGE-RIEGEL): der Nutzertext (E3a), der
// Betreiber-Melder (E3b) UND der Max-Dauer-/Budget-Cap (call-lifecycle.js) haengen an der
// Invariante "der Grund wird geschrieben, BEVOR der Anruf beendet/abgerechnet wird". E3a
// hatte diese Invariante NUR in routes/api-calls.js als Struktur erzwungen; in
// routes/voice.js, elevenlabs/outbound.js UND (Review-Blocker Runde 3) call-lifecycle.js
// war sie eine verschiebbare Anweisung - der Safety-Reviewer hat sie in voice.js verletzt,
// und die GESAMTE Suite blieb GRUEN (Befund C-A). Dieser Test deckt jetzt ALLE VIER Naehte
// ueber EINE Formulierung der Invariante (persistEndWithReason, src/telephony/
// call-termination.js), nicht vier kopierte.
//
// AUSDRUECKLICHE AUSNAHME (G27-C2-Fix, Fix-Vorschlag "begruendete Ausnahme statt Umbau"):
// src/telnyx-call-control-ingest.js#recordHangupOutcome persistiert den Grund ebenfalls VOR
// dem Settlement (funktional korrekt, siehe eigener Kommentar dort), bleibt aber bewusst
// AUSSERHALB dieses Riegels - eine Umstellung auf persistEndWithReason wuerde die Signatur
// von onHangup(call) aendern muessen, an der test/call-termination-order.test.js per
// LITERALEM Quelltext-Marker haengt (Befund 5). Eine vierte kopierte Formulierung bleibt
// hier ein bewusst akzeptiertes Risiko, kein blinder Fleck - der Reihenfolge-Beweis fuer
// diese Naht liegt in call-termination-order.test.js.
//
// R1  Mechanismus-Pin (Bestand): persistEnd laeuft vor bill.
// R2  Produktions-Thunk (Bestand): endFailedCallWithReason schreibt Grund vor Endstatus.
// R3  Laufzeit je Naht: persistEndWithReason({store, callId, reason, endCall}) ruft
//     recordFailureReason VOR endCall - deepEqual auf der Aufzeichnung.
// R4  SABOTAGE-FANG, generisch ueber VIER Dateien:
//     (a) Positiv-Kontrolle: jede Datei enthaelt "persistEndWithReason(" mindestens einmal
//         (Lehre pruefkommando-ohne-positiv-kontrolle - ein spaeteres "0 Treffer" beweist
//         sonst nichts).
//     (b) In KEINER der vier Dateien kommt "store.recordFailureReason(" vor - wer die
//         Anweisung als freie Zeile zurueckholt (genau die Sabotage von Befund C-A), macht
//         diesen Fall ROT.
// R5  Verdrahtungs-Pin je Naht: die persistEnd-Aufrufstellen nennen persistEndWithReason
//     (bzw. den gepruefte Delegator endFailedCallWithReason), nicht eine nackte Arrow-
//     Funktion mit einer freien recordFailureReason-Zeile darin.
//
// PFLICHT-GEGENPROBEN (Abnahme C11, manuell auszufuehren und zurueckzubauen - NICHT Teil
// dieser automatisierten Datei, weil sie den Produktionscode voruebergehend sabotieren):
//   1. In routes/voice.js store.recordFailureReason(...) wieder als freie Zeile HINTER
//      terminateAndBillCall(...) einfuegen -> R4(b) und R5 muessen ROT werden.
//   2. Dieselbe Verschiebung in elevenlabs/outbound.js -> R4(b) ROT.
//   3. beurteileAusfall (outage-detection.js) K1-Bein auf false setzen ->
//      ausfall-erkennung.test.js (E2, E3) ROT; MIN_TENANTS_SHARED_FAULT auf 99 -> nur E3
//      ROT, E2 bleibt gruen (die zwei Klauseln sind unabhaengig gepinnt).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateAndBillCall, persistEndWithReason } from "../src/telephony/call-termination.js";
import { endFailedCallWithReason } from "../src/routes/api-calls.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER_STATUS_403 = 403;

const ORDER_CRITICAL_FILES = Object.freeze([
  "src/routes/api-calls.js",
  "src/routes/voice.js",
  "src/elevenlabs/outbound.js",
  "src/telephony/call-lifecycle.js", // G27/C2-Fix (Review-Blocker Runde 3), s.u.
]);

function readSrc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

test("R1 Mechanismus-Pin (Positiv-Kontrolle): persistEnd laeuft vor bill", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persist"),
    hangUp: null,
    bill: () => order.push("bill"),
  });
  assert.deepEqual(order, ["persist", "bill"]);
});

test("R2 Produktions-Thunk: endFailedCallWithReason schreibt den Grund VOR dem Endstatus", () => {
  const seen = [];
  const store = {
    recordFailureReason: (id, reason) => seen.push(`reason:${reason}`),
    endCallRecord: (id, status) => seen.push(`end:${status}`),
  };
  endFailedCallWithReason(store, "call_x", PROVIDER_STATUS_403)();
  assert.deepEqual(seen, ["reason:not-placed:start-403", "end:failed"]);
});

test("R3 Laufzeit je Naht: persistEndWithReason ruft recordFailureReason VOR endCall", () => {
  const seen = [];
  const store = { recordFailureReason: (id, reason) => seen.push(`reason:${reason}`) };
  const thunk = persistEndWithReason({
    store,
    callId: "call_y",
    reason: "not-placed:invite-403-D51",
    endCall: () => seen.push("end"),
  });
  thunk();
  assert.deepEqual(seen, ["reason:not-placed:invite-403-D51", "end"]);
});

test("R4(a) Positiv-Kontrolle: alle vier Naht-Dateien nennen persistEndWithReason mindestens einmal", () => {
  for (const relPath of ORDER_CRITICAL_FILES) {
    const src = readSrc(relPath);
    assert.match(src, /persistEndWithReason\(/, `${relPath} nennt persistEndWithReason nicht`);
  }
});

test("R4(b) SABOTAGE-FANG: in KEINER der vier Naht-Dateien steht store.recordFailureReason( als freie Anweisung", () => {
  for (const relPath of ORDER_CRITICAL_FILES) {
    const src = readSrc(relPath);
    const freieAufrufe = src.match(/store\.recordFailureReason\(/g) || [];
    assert.equal(
      freieAufrufe.length,
      0,
      `${relPath} traegt eine freie store.recordFailureReason(-Zeile - Befund C-A waere nicht behoben`,
    );
  }
});

test("R5 Verdrahtungs-Pin je Naht: die persistEnd-Aufrufstellen sind mit dem Riegel verdrahtet", () => {
  const apiCallsSrc = readSrc("src/routes/api-calls.js");
  assert.match(apiCallsSrc, /function endFailedCallWithReason\(/);
  assert.match(apiCallsSrc, /persistEnd: endFailedCallWithReason\(store, call\.id, providerStatus\)/);
  assert.match(apiCallsSrc, /return persistEndWithReason\(/, "endFailedCallWithReason delegiert an den Riegel");

  const voiceSrc = readSrc("src/routes/voice.js");
  assert.match(voiceSrc, /persistEnd: persistEndWithReason\(\{/);

  const outboundSrc = readSrc("src/elevenlabs/outbound.js");
  const outboundTreffer = outboundSrc.match(/persistEnd: persistEndWithReason\(\{/g) || [];
  const ERWARTETE_NAEHTE_OUTBOUND = 2; // finishWithoutProviderResult + finishFromConversation
  assert.equal(outboundTreffer.length, ERWARTETE_NAEHTE_OUTBOUND, "beide EL-Naehte sind verdrahtet");

  // G27/C2-Fix (Review-Blocker Runde 3): terminateActiveCall (Max-Dauer-/Budget-Cap) war
  // die vierte, von Hand formulierte Auspraegung derselben Invariante - jetzt ueber
  // denselben Riegel.
  const lifecycleSrc = readSrc("src/telephony/call-lifecycle.js");
  assert.match(lifecycleSrc, /persistEnd: persistEndWithReason\(\{/);
});
