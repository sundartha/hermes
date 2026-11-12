import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForStoreState, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const BILLED_MINUTES = 5;
const DOMESTIC_TARIFF_CENTS = 20;
const DOMESTIC_TO = "+4915112345678";
const HTTP_OK = 200;
const SUMMARY = "Kurze Zusammenfassung.";
const TARIFF_ENV = { VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS) };
const CALLER_LINES = [
  { role: "caller", text: "Guten Tag, ich moechte gerne einen Termin vereinbaren.", at: ANSWERED_AT },
  { role: "caller", text: "Am Donnerstag um zehn Uhr waere mir recht.", at: ANSWERED_AT },
];

const postStatus = async (srv, callId, callStatus) => {
  const res = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams({ CallStatus: callStatus }),
  });
  assert.equal(res.status, HTTP_OK);
};

const meldungen = (store, callId) => store.notifications.filter((n) => n.callId === callId).length;
const warteAufMeldung = (srv, callId) => waitForStoreState(srv, (store) => meldungen(store, callId) > 0);
const anruf = (srv, callId) => srv.readStore().calls.find((call) => call.id === callId);

function beendeterAnruf(id, over = {}) {
  return seedCall({
    id,
    direction: "outbound",
    from: DOMESTIC_TEST_NUMBER.e164,
    to: DOMESTIC_TO,
    summary: SUMMARY,
    transcript: CALLER_LINES,
    ...over,
  });
}

const beantworteterAnruf = (id, over = {}) =>
  beendeterAnruf(id, { status: "completed", answeredAt: ANSWERED_AT, endedAt: ENDED_AT, ...over });

test("Abschluss einmal: zwei gleichzeitige und ein dritter completed-Status melden und buchen je genau einmal, failed meldet genau einmal", async () => {
  const seed = seedState({
    calls: [beantworteterAnruf("abschluss_fertig"), beendeterAnruf("abschluss_fehl", { status: "active" })],
  });
  const srv = await startServer({ env: TARIFF_ENV, seed });
  try {
    await Promise.all([postStatus(srv, "abschluss_fertig", "completed"), postStatus(srv, "abschluss_fertig", "completed")]);
    await warteAufMeldung(srv, "abschluss_fertig");
    await postStatus(srv, "abschluss_fertig", "completed");
    await postStatus(srv, "abschluss_fehl", "failed");
    await warteAufMeldung(srv, "abschluss_fehl");

    const store = srv.readStore();
    assert.equal(meldungen(store, "abschluss_fertig"), 1);
    assert.equal(meldungen(store, "abschluss_fehl"), 1);
    assert.equal(store.usage[BOOTSTRAP_TENANT_ID].costCents, BILLED_MINUTES * DOMESTIC_TARIFF_CENTS);
  } finally {
    await srv.stop();
  }
});

test("Posteingang: ein abgeschlossener Eingangsanruf mit Inhalt bekommt den Eintrag, ein gescheiterter nicht", async () => {
  const eingang = { direction: "inbound", from: DOMESTIC_TO, to: DOMESTIC_TEST_NUMBER.e164 };
  const seed = seedState({
    calls: [
      beantworteterAnruf("posteingang_fertig", eingang),
      beendeterAnruf("posteingang_fehl", { ...eingang, status: "active" }),
    ],
  });
  const srv = await startServer({ env: TARIFF_ENV, seed });
  try {
    await postStatus(srv, "posteingang_fertig", "completed");
    await postStatus(srv, "posteingang_fehl", "failed");
    await warteAufMeldung(srv, "posteingang_fertig");
    await warteAufMeldung(srv, "posteingang_fehl");
    await waitForStoreState(srv, (store) => store.calls.find((c) => c.id === "posteingang_fertig")?.inboxEntryAt);

    assert.ok(anruf(srv, "posteingang_fertig").inboxEntryAt, "completed mit Inhalt: Eintrag gesetzt");
    assert.ok(!anruf(srv, "posteingang_fehl").inboxEntryAt, "failed: kein Eintrag");
  } finally {
    await srv.stop();
  }
});
