import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const EIGENE_NUMMER = "+33123456789";
const ANRUFER = "+4915112345678";

const seedGespeichertFr = () =>
  seedState({
    settings: { language: "en" },
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", defaultLanguage: "fr" }],
    numbers: [
      {
        ...vorspannSeedNummer({ tenantId: BOOTSTRAP_TENANT_ID, nummer: EIGENE_NUMMER, id: "num_owner" }),
        country: "FR",
        language: "fr",
      },
    ],
  });

test("5986-4a: Eingehender Anruf startet auf de, auch wenn Nummer fr, Mandant fr und Einstellung en gespeichert haben", async () => {
  const srv = await startServer({ env: { ALLOWED_NUMBERS: ANRUFER }, seed: seedGespeichertFr() });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CA5986four", From: ANRUFER, To: EIGENE_NUMMER }),
    });
    assert.equal(antwort.status, HTTP_OK);
    const eingehend = srv.readStore().calls.find((call) => call.direction === "inbound");
    assert.equal(eingehend.language, "de");
  } finally {
    await srv.stop();
  }
});
