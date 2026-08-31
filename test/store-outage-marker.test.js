// OUTBOUND-E3b: openOutageAlert/claimOutageAlert/closeOutageAlert - backend-frei (Muster
// test/plattform-nummer-bindung.test.js), reine In-Process-Units, kein Netz, kein pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, openOutageAlert, claimOutageAlert, closeOutageAlert } from "../src/store/state-ops.js";

const BUCKET = "not-placed:invite-403";
const T0_ISO = "2026-08-27T16:45:00.000Z";
const T0_MS = Date.parse(T0_ISO);
const EINE_MINUTE_ISO = "2026-08-27T16:46:00.000Z";
const EINE_MINUTE_MS = Date.parse(EINE_MINUTE_ISO);

test("keine offene Zeile -> undefined", () => {
  const state = makeDefaultState();
  assert.equal(openOutageAlert(state, BUCKET), undefined);
});

test("claimOutageAlert legt beim ersten Aufruf eine neue offene Zeile an", () => {
  const state = makeDefaultState();
  const marker = claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS });
  assert.equal(marker.code, BUCKET);
  assert.equal(marker.firstSeenAt, T0_ISO);
  assert.equal(marker.lastSeenAt, T0_ISO);
  assert.equal(marker.lastAttemptAt, null);
  assert.equal(marker.reportedAt, null);
  assert.equal(marker.deliveredChannels, null);
  assert.equal(marker.closedAt, null);
  assert.equal(openOutageAlert(state, BUCKET), marker);
});

test("claimOutageAlert aktualisiert lastSeenAt, laesst firstSeenAt unangetastet", () => {
  const state = makeDefaultState();
  claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS });
  const zweiterAufruf = claimOutageAlert(state, { code: BUCKET, nowMs: EINE_MINUTE_MS });
  assert.equal(zweiterAufruf.firstSeenAt, T0_ISO);
  assert.equal(zweiterAufruf.lastSeenAt, EINE_MINUTE_ISO);
});

test("claimOutageAlert(sent=true, channels=[]) setzt lastAttemptAt, NICHT reportedAt (S3-1)", () => {
  const state = makeDefaultState();
  const marker = claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS, sent: true, channels: [] });
  assert.equal(marker.lastAttemptAt, T0_ISO);
  assert.equal(marker.reportedAt, null);
});

test("claimOutageAlert(sent=true, channels=['mail']) setzt reportedAt + deliveredChannels (S3-2)", () => {
  const state = makeDefaultState();
  const marker = claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS, sent: true, channels: ["mail"] });
  assert.equal(marker.reportedAt, T0_ISO);
  assert.equal(marker.deliveredChannels, "mail");
});

test("idempotenz: zweimal claim in derselben Millisekunde erzeugt EINEN Marker, nicht zwei", () => {
  const state = makeDefaultState();
  claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS });
  claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS });
  const offene = state.outageAlerts.filter((alert) => alert.code === BUCKET && alert.closedAt === null);
  assert.equal(offene.length, 1);
});

test("closeOutageAlert schliesst die offene Zeile (Historie bleibt stehen)", () => {
  const state = makeDefaultState();
  claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS });
  const geschlossen = closeOutageAlert(state, { code: BUCKET, nowMs: EINE_MINUTE_MS });
  assert.equal(geschlossen.closedAt, EINE_MINUTE_ISO);
  assert.equal(openOutageAlert(state, BUCKET), undefined, "keine offene Zeile mehr");
  assert.equal(state.outageAlerts.length, 1, "die Zeile selbst bleibt stehen (Historie)");
});

test("closeOutageAlert ohne offene Zeile -> null, kein Wurf", () => {
  const state = makeDefaultState();
  assert.equal(closeOutageAlert(state, { code: BUCKET, nowMs: T0_MS }), null);
});

test("claimOutageAlert NACH einem closeOutageAlert legt eine NEUE offene Zeile an (Muster bindPlatformNumber)", () => {
  const state = makeDefaultState();
  claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS });
  closeOutageAlert(state, { code: BUCKET, nowMs: EINE_MINUTE_MS });
  const neuerVorfall = claimOutageAlert(state, { code: BUCKET, nowMs: EINE_MINUTE_MS });
  assert.equal(neuerVorfall.closedAt, null);
  const ERWARTETE_ZEILEN = 2; // geschlossene Historie + neue offene Zeile
  assert.equal(state.outageAlerts.length, ERWARTETE_ZEILEN, "zwei Zeilen: die geschlossene Historie + die neue offene");
});

test("verschiedene Eimer (codes) sind unabhaengige Marker", () => {
  const state = makeDefaultState();
  claimOutageAlert(state, { code: "not-placed:invite-403", nowMs: T0_MS });
  claimOutageAlert(state, { code: "not-placed:start-403", nowMs: T0_MS });
  assert.ok(openOutageAlert(state, "not-placed:invite-403"));
  assert.ok(openOutageAlert(state, "not-placed:start-403"));
  closeOutageAlert(state, { code: "not-placed:invite-403", nowMs: EINE_MINUTE_MS });
  assert.equal(openOutageAlert(state, "not-placed:invite-403"), undefined);
  assert.ok(openOutageAlert(state, "not-placed:start-403"), "der andere Eimer bleibt unberuehrt");
});
