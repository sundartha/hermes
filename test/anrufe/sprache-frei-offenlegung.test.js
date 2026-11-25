import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { disclosurePrefixFor } from "../../src/i18n/locales.ts";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";
import { makePgTestStore } from "../pg-helpers.js";

const HTTP_OK = 200;
const ES_NUMMER = "+34612345678";
const FR_NUMMER = "+33612345678";
const TENANT = "t_sprache_frei";

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

async function eroeffnungFuer({ to, language, env = {} }) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV, ...env },
    seed: seedState({ settings: { language: "de" }, tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
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
  it("SO-1: Startsprache es, DE-Nummer -> Offenlegungssatz deutsch am Anfang", async () => {
    const eroeffnung = await eroeffnungFuer({ to: TELNYX_TEST_PEER_NUMBER, language: "es" });
    assert.ok(eroeffnung.startsWith(disclosurePrefixFor("de")), JSON.stringify(eroeffnung));
  });

  it("SO-2: Startsprache es, Land ohne Eintrag (ES) -> Offenlegungssatz englisch am Anfang", async () => {
    const eroeffnung = await eroeffnungFuer({ to: ES_NUMMER, language: "es" });
    assert.ok(eroeffnung.includes("an AI assistant calling on behalf of"), JSON.stringify(eroeffnung));
    assert.ok(!eroeffnung.includes("KI-Assistent"), JSON.stringify(eroeffnung));
  });

  it("SO-3: Startsprache es, FR-Nummer -> Offenlegungssatz franzoesisch", async () => {
    const eroeffnung = await eroeffnungFuer({ to: FR_NUMMER, language: "es" });
    assert.ok(eroeffnung.startsWith(disclosurePrefixFor("fr")), JSON.stringify(eroeffnung));
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

describe("Einstellung language nimmt Sprachcodes nach Form", () => {
  const setze = async (wert) => {
    const { store } = await makePgTestStore();
    await store.updateSettings(TENANT, { language: "fr" });
    await store.updateSettings(TENANT, { language: wert });
    return store.tenantContext(TENANT).settings.language;
  };

  it("SE-1: 'es' wird gespeichert", async () => {
    assert.equal(await setze("es"), "es");
  });

  it("SE-2: ' PT-br ' wird normalisiert zu 'pt-br'", async () => {
    assert.equal(await setze(" PT-br "), "pt-br");
  });

  it("SE-3: ungueltige Werte werden abgelehnt, der alte Wert bleibt", async () => {
    for (const wert of ["zz9", "x", "de_DE!", 7]) {
      assert.equal(await setze(wert), "fr", String(wert));
    }
  });

  it("SE-4: leer setzt zurueck auf keinen Wert", async () => {
    assert.equal(await setze(""), null);
    assert.equal(await setze(null), null);
  });
});
