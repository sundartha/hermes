// F9 (A6, T2) - reine Max-Dauer-Rechenlogik (remainingMaxDurationMs/cappedEndedAtMs) +
// setCallEndedAt (expliziter End-Anker). config-frei: defaultMaxDurationS wird als Argument
// hereingereicht (der Aufrufer liefert den Fallback, TABU fuer F9). Verankert
// IMMER am echten Call-Start (answeredAt bevorzugt, sonst startedAt), NIE an Date.now()/Boot-
// Zeit - deshalb feste ANCHOR/nowMs-Werte statt Toleranz-Fenster (F.I.R.S.T.: repeatable).
//
// Speist den Boot-Re-Arm (F10) + Re-Attach (F12): beide Funktionen sind bewusst OHNE
// Server-Verdrahtung geshippt (Praezedenzfall F1: tryReserveOutboundBudget landete genauso
// vor seiner Verdrahtung), darum reiner Unit-Test ohne Spawn/pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  createCall,
  setCallEndedAt,
  remainingMaxDurationMs,
  cappedEndedAtMs,
  classifyCallTime,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const ANCHOR = Date.parse("2026-01-01T00:00:00.000Z");
const DEFAULT_MAX_S = 300;
const SECONDS_60 = 60;
const SECONDS_400 = 400;
const MS_PER_S = 1000;

// Minimaler Call-Ausschnitt, den beide pure Funktionen lesen (answeredAt/startedAt/
// maxDurationS). Kein voller createCall-Record noetig (reine Rechenlogik, F.I.R.S.T.: fast).
const call = (overrides) => ({
  startedAt: null,
  answeredAt: null,
  maxDurationS: null,
  ...overrides,
});

// ---- remainingMaxDurationMs ----

test("remainingMaxDurationMs: answeredAt vor 60s, max 180s -> 120000 verbleibend", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: 180 });
  const remaining = remainingMaxDurationMs(c, ANCHOR + SECONDS_60 * MS_PER_S, DEFAULT_MAX_S);
  assert.equal(remaining, 120000);
});

test("remainingMaxDurationMs: answeredAt vor 400s, max 180s -> 0 (Clamp, Zombie ueberzogen)", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: 180 });
  const remaining = remainingMaxDurationMs(c, ANCHOR + SECONDS_400 * MS_PER_S, DEFAULT_MAX_S);
  assert.equal(remaining, 0);
});

test("remainingMaxDurationMs: maxDurationS=null -> injizierter Default (300s) greift", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: null });
  const remaining = remainingMaxDurationMs(c, ANCHOR + SECONDS_60 * MS_PER_S, DEFAULT_MAX_S);
  assert.equal(remaining, 240000);
});

test("remainingMaxDurationMs: answeredAt fehlt -> Anker faellt auf startedAt zurueck", () => {
  const c = call({
    answeredAt: null,
    startedAt: new Date(ANCHOR).toISOString(),
    maxDurationS: 180,
  });
  const remaining = remainingMaxDurationMs(c, ANCHOR + SECONDS_60 * MS_PER_S, DEFAULT_MAX_S);
  assert.equal(remaining, 120000);
});

test("remainingMaxDurationMs: kein Anker (answeredAt+startedAt null) -> 0, kein Throw/NaN-Leak", () => {
  const c = call({ answeredAt: null, startedAt: null, maxDurationS: 180 });
  const remaining = remainingMaxDurationMs(c, ANCHOR + SECONDS_60 * MS_PER_S, DEFAULT_MAX_S);
  assert.equal(remaining, 0);
});

// ---- cappedEndedAtMs ----

test("cappedEndedAtMs: Zombie (now weit nach Limit) -> gekappt auf anchor+limit, NIE Boot-Abstand", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: 180 });
  const nowMs = ANCHOR + SECONDS_400 * MS_PER_S;
  assert.equal(cappedEndedAtMs(c, nowMs, DEFAULT_MAX_S), ANCHOR + 180000);
});

test("cappedEndedAtMs: Live-Cap (now vor Limit) -> now selbst gewinnt", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: 180 });
  const nowMs = ANCHOR + SECONDS_60 * MS_PER_S;
  assert.equal(cappedEndedAtMs(c, nowMs, DEFAULT_MAX_S), nowMs);
});

test("cappedEndedAtMs: now == anchor+limit -> beide Grenzen gleich, deterministisch anchor+limit", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: 180 });
  const nowMs = ANCHOR + 180000;
  assert.equal(cappedEndedAtMs(c, nowMs, DEFAULT_MAX_S), ANCHOR + 180000);
});

test("cappedEndedAtMs: kein Anker (answeredAt+startedAt null) -> 0, kein Throw/NaN-Leak", () => {
  const c = call({ answeredAt: null, startedAt: null, maxDurationS: 180 });
  assert.equal(cappedEndedAtMs(c, ANCHOR + SECONDS_60 * MS_PER_S, DEFAULT_MAX_S), 0);
});

// ---- classifyCallTime (G5, Review-Blocker Runde 2: gemeinsame Entscheidung fuer Boot-Re-Arm
// F10 und Re-Attach F12 - vorher an beiden Stellen dupliziert) ----

test("classifyCallTime: aktiv im Zeitfenster -> expired=false, remaining wie remainingMaxDurationMs", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: 180 });
  const nowMs = ANCHOR + SECONDS_60 * MS_PER_S;
  assert.deepEqual(classifyCallTime(c, nowMs, DEFAULT_MAX_S), { remaining: 120000, expired: false });
});

test("classifyCallTime: ueberzogen (remaining=0) -> expired=true", () => {
  const c = call({ answeredAt: new Date(ANCHOR).toISOString(), maxDurationS: 180 });
  const nowMs = ANCHOR + SECONDS_400 * MS_PER_S;
  assert.deepEqual(classifyCallTime(c, nowMs, DEFAULT_MAX_S), { remaining: 0, expired: true });
});

// ---- setCallEndedAt (expliziter Anker, F10/F12-Seam) ----

test("setCallEndedAt: aktiver Call wird terminalisiert mit dem EXPLIZITEN Anker (nicht Date.now())", () => {
  const s = makeDefaultState();
  const c = createCall(s, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  const explicitAnchorIso = new Date(ANCHOR + 180000).toISOString();

  const result = setCallEndedAt(s, c.id, "completed", explicitAnchorIso);

  assert.equal(result.changed, true);
  assert.equal(result.call.status, "completed");
  assert.equal(result.call.endedAt, explicitAnchorIso);
});

test("setCallEndedAt: bereits terminaler Call ist ein No-op (changed=false, endedAt unveraendert)", () => {
  const s = makeDefaultState();
  const c = createCall(s, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  const firstEndedAt = new Date(ANCHOR + 60000).toISOString();
  setCallEndedAt(s, c.id, "completed", firstEndedAt);

  const second = setCallEndedAt(s, c.id, "failed", new Date(ANCHOR + 999000).toISOString());

  assert.equal(
    second.changed,
    false,
    "aus einem bereits terminalen Status heraus kein Ueberschreiben",
  );
  assert.equal(second.call.status, "completed", "Status bleibt der zuerst gesetzte");
  assert.equal(second.call.endedAt, firstEndedAt, "endedAt bleibt der zuerst gesetzte Anker");
});
