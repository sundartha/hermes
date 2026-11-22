import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";

Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });

const store = await import("../../src/store.js");
const { BOOTSTRAP_TENANT_ID } = await import("../pg-helpers.js");
await store.oeffneSpeicher();

const JETZT = "2026-11-19T10:00:00.000Z";

test("JSON-Speicher über die Fassade: unbekannter Token und unbekannte Adresse liefern null und false statt zu werfen", async () => {
  const newsletter = store.speicherBereiche(store).newsletter;

  assert.equal(await newsletter.confirmNewsletterRecipientByToken("unbekannt", JETZT), null);
  assert.equal(await newsletter.unsubscribeNewsletterRecipientByToken("unbekannt"), null);
  assert.equal(await newsletter.removeNewsletterRecipient(BOOTSTRAP_TENANT_ID, "niemand@example.com"), false);
});
