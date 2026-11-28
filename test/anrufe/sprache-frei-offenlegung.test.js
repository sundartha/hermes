import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { disclosurePrefixFor } from "../../src/i18n/locales.ts";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const ES_NUMMER = "+34612345678";
const FR_NUMMER = "+33612345678";

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

async function eroeffnungFuer({ to, language, env = {} }) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV, ...env },
    seed: seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, objective: "Termin vereinbaren", language }),
    });
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    const inhalt = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
    return inhalt.dynamic_variables.eroeffnung_gesagt;
  } finally {
    await srv.stop();
  }
}

describe("Offenlegung bei Startsprache ohne eigene Texte", () => {
  it("SO-1: Startsprache es, DE-Nummer -> Offenlegungssatz englisch am Anfang", async () => {
    const eroeffnung = await eroeffnungFuer({ to: TELNYX_TEST_PEER_NUMBER, language: "es" });
    assert.ok(eroeffnung.startsWith(disclosurePrefixFor("en")), JSON.stringify(eroeffnung));
  });

  it("SO-2: Startsprache es, Land ohne Eintrag (ES) -> Offenlegungssatz englisch am Anfang", async () => {
    const eroeffnung = await eroeffnungFuer({ to: ES_NUMMER, language: "es" });
    assert.ok(eroeffnung.includes("an AI assistant calling on behalf of"), JSON.stringify(eroeffnung));
    assert.ok(!eroeffnung.includes("KI-Assistent"), JSON.stringify(eroeffnung));
  });

  it("SO-3: Startsprache es, FR-Nummer -> Offenlegungssatz englisch am Anfang", async () => {
    const eroeffnung = await eroeffnungFuer({ to: FR_NUMMER, language: "es" });
    assert.ok(eroeffnung.startsWith(disclosurePrefixFor("en")), JSON.stringify(eroeffnung));
  });

  it("SO-4: Startsprache de, Land ohne Eintrag (ES) -> Offenlegung bleibt beim Auftraggeber deutsch", async () => {
    const eroeffnung = await eroeffnungFuer({ to: ES_NUMMER, language: "de" });
    assert.ok(eroeffnung.includes("KI-Assistent"), JSON.stringify(eroeffnung));
    assert.ok(!eroeffnung.includes("the AI assistant of"), JSON.stringify(eroeffnung));
  });
});

describe("Offenlegung mit Render-Standard WORLD_DEFAULT_LANGUAGE_ENABLED=false", () => {
  it("SO-6: Startsprache es, Land ohne Eintrag (ES) -> Offenlegungssatz englisch, nicht deutsch", async () => {
    const eroeffnung = await eroeffnungFuer({
      to: ES_NUMMER,
      language: "es",
      env: { WORLD_DEFAULT_LANGUAGE_ENABLED: "false" },
    });
    assert.ok(eroeffnung.includes("an AI assistant calling on behalf of"), JSON.stringify(eroeffnung));
    assert.ok(!eroeffnung.includes("KI-Assistent"), JSON.stringify(eroeffnung));
  });
});

describe("Offenlegung ohne Startsprache", () => {
  it("SO-5: ohne Startsprache, Land ohne Eintrag (ES), Auftraggeber de -> Offenlegung deutsch, nicht englisch", async () => {
    const eroeffnung = await eroeffnungFuer({ to: ES_NUMMER });
    assert.ok(eroeffnung.includes("KI-Assistent"), JSON.stringify(eroeffnung));
    assert.ok(!eroeffnung.includes("the AI assistant of"), JSON.stringify(eroeffnung));
  });
});
