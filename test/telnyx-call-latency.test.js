// K0 (PLAN-CONVERSATION-OPTIMIZATION.md): Offline-Unit-Test der reinen Auswerte-Funktionen
// aus scripts/telnyx-call-latency.mjs. Importiert NUR turnRowFrom/assistantTurnRows/median/
// medianRow - kein Netz, kein process.exit (der isMain-Guard im Skript verhindert main()
// beim Import, Muster test/telnyx-assistant-config.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  turnRowFrom,
  assistantTurnRows,
  median,
  medianRow,
} from "../scripts/telnyx-call-latency.mjs";

// === turnRowFrom =====================================================================

test("turnRowFrom: vollstaendiges metadata-Objekt -> alle fuenf Felder + sent_at uebernommen", () => {
  const message = {
    sent_at: "2026-07-12T17:19:13.528Z",
    metadata: {
      transcription_duration_ms: 120,
      llm_first_token_duration_ms: 900,
      audio_first_token_duration_ms: 300,
      end_user_perceived_latency_ms: 2287,
      start_speaking_plan_extra_wait_duration_ms: 0,
    },
  };

  const row = turnRowFrom(message);

  assert.equal(row.sentAt, "2026-07-12T17:19:13.528Z");
  assert.equal(row.transcription_duration_ms, 120);
  assert.equal(row.llm_first_token_duration_ms, 900);
  assert.equal(row.audio_first_token_duration_ms, 300);
  assert.equal(row.end_user_perceived_latency_ms, 2287);
  assert.equal(row.start_speaking_plan_extra_wait_duration_ms, 0);
});

test("turnRowFrom: fehlendes metadata-Objekt -> alle fuenf Felder undefined (keine erfundene 0)", () => {
  const row = turnRowFrom({ sent_at: "t1" });

  assert.equal(row.sentAt, "t1");
  assert.equal(row.transcription_duration_ms, undefined);
  assert.equal(row.end_user_perceived_latency_ms, undefined);
});

test("turnRowFrom: metadata ist kein Objekt (z.B. String) -> faellt fail-closed auf leeres Objekt zurueck", () => {
  const row = turnRowFrom({ sent_at: "t1", metadata: "kaputt" });

  assert.equal(row.llm_first_token_duration_ms, undefined);
});

test("turnRowFrom: einzelnes fehlendes Feld im metadata-Objekt -> nur DIESES Feld undefined, Rest uebernommen", () => {
  const row = turnRowFrom({
    sent_at: "t1",
    metadata: { end_user_perceived_latency_ms: 1551 }, // andere vier Felder fehlen
  });

  assert.equal(row.end_user_perceived_latency_ms, 1551);
  assert.equal(row.transcription_duration_ms, undefined);
  assert.equal(row.llm_first_token_duration_ms, undefined);
});

test("turnRowFrom: null/undefined message -> wirft nicht, liefert leere Zeile", () => {
  const row = turnRowFrom(null);

  assert.equal(row.sentAt, null);
  assert.equal(row.end_user_perceived_latency_ms, undefined);
});

// === assistantTurnRows ================================================================

test("assistantTurnRows: filtert NUR role=assistant, ignoriert system/user, behaelt Reihenfolge", () => {
  const messages = [
    { role: "system", sent_at: "t0", metadata: {} },
    { role: "assistant", sent_at: "t1", metadata: { end_user_perceived_latency_ms: 2012 } },
    { role: "user", sent_at: "t2", metadata: {} },
    { role: "assistant", sent_at: "t3", metadata: { end_user_perceived_latency_ms: 1551 } },
  ];

  const rows = assistantTurnRows(messages);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].sentAt, "t1");
  assert.equal(rows[0].end_user_perceived_latency_ms, 2012);
  assert.equal(rows[1].sentAt, "t3");
  assert.equal(rows[1].end_user_perceived_latency_ms, 1551);
});

test("assistantTurnRows: leeres Array -> leeres Array (kein Crash)", () => {
  assert.deepEqual(assistantTurnRows([]), []);
});

test("assistantTurnRows: kaputte Eintraege (null) im Array werden uebersprungen statt zu werfen", () => {
  const messages = [null, { role: "assistant", sent_at: "t1", metadata: {} }, undefined];

  const rows = assistantTurnRows(messages);

  assert.equal(rows.length, 1);
});

// === median ============================================================================

test("median: ungerade Anzahl -> mittlerer Wert", () => {
  assert.equal(median([3, 1, 2]), 2);
});

test("median: gerade Anzahl -> Mittel der zwei mittleren Werte", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("median: leere Liste -> undefined (keine erfundene 0)", () => {
  assert.equal(median([]), undefined);
});

test("median: undefined/NaN-Werte werden vor der Berechnung rausgefiltert", () => {
  assert.equal(median([undefined, 10, undefined, 20, NaN]), 15);
});

test("median: nur ein Wert -> dieser Wert", () => {
  assert.equal(median([42]), 42);
});

// === medianRow ==========================================================================

test("medianRow: berechnet den Median je Feld unabhaengig ueber mehrere Turns (reale Werte, afix-testcall2)", () => {
  const rows = [
    turnRowFrom({ sent_at: "t1", metadata: { end_user_perceived_latency_ms: 2012 } }),
    turnRowFrom({ sent_at: "t2", metadata: { end_user_perceived_latency_ms: 1551 } }),
    turnRowFrom({ sent_at: "t3", metadata: { end_user_perceived_latency_ms: 2417 } }),
  ];

  const meds = medianRow(rows);

  assert.equal(meds.end_user_perceived_latency_ms, 2012, "Median von 2012/1551/2417 = 2012");
  assert.equal(meds.transcription_duration_ms, undefined, "kein Turn liefert dieses Feld -> undefined");
});

test("medianRow: leeres Zeilen-Array -> jedes Feld undefined (kein Crash)", () => {
  const meds = medianRow([]);

  assert.equal(meds.end_user_perceived_latency_ms, undefined);
  assert.equal(meds.llm_first_token_duration_ms, undefined);
});
