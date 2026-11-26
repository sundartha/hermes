import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  EL_OUTBOUND_BOOT_ENV,
  OWNER_TEST_NUMBER,
  OWNER_TEST_REGISTRIERUNG,
  seedState,
  startServer,
  waitForLog,
} from "../helpers.js";
import { PROBE_ZUGANG_SCHLUESSEL as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { LOCALES } from "../../src/i18n/locales.ts";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-lokal.mjs", import.meta.url));
const STAGING = "https://hermes-staging-erpv.onrender.com";
const ZIEL = OWNER_TEST_NUMBER.e164;
const ERSTER_SCHLUESSEL = Object.freeze({ allowlist: "abo", reserve_erschoepft: "budget_tenant" });

function ohneAuftraggeberName(mandant = {}) {
  return seedState({
    tenants: [{ id: "owner", status: "active", ...mandant }],
    numbers: [
      vorspannSeedNummer({ tenantId: "owner", nummer: ZIEL, id: "num_owner_seed", registrierung: OWNER_TEST_REGISTRIERUNG }),
    ],
  });
}

async function mitStaging({ env = {}, mandant }, lauf) {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", HERMES_PROBE_TOKEN: TOKEN, ...EL_OUTBOUND_BOOT_ENV, ...env },
    seed: ohneAuftraggeberName(mandant),
    ownerNumber: null,
  });
  try {
    await lauf(srv);
  } finally {
    await srv.stop();
  }
}

function anruferMit(basis, abfrage) {
  return anruferBauen({
    basis,
    token: TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
  });
}

function probeStarten(lokaleBasis) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "d".repeat(40),
    STAGING_URL: STAGING,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_LOKALE_BASIS: lokaleBasis,
  };
  return new Promise((fertig) => {
    execFile("node", ["scripts/anruf-probe/probe.mjs"], { env }, (fehler, stdout, stderr) =>
      fertig({ code: fehler?.code ?? 0, ausgabe: `${stdout}${stderr}` }),
    );
  });
}

async function detailZu(content) {
  const rpc = { jsonrpc: "2.0", id: 1, result: { isError: true, content } };
  const anrufer = anruferMit(STAGING, async () => ({ ok: true, status: 200, text: async () => JSON.stringify(rpc) }));
  const fehler = await anrufer.anrufen({ ziel: ZIEL }).then(
    () => assert.fail("place_call hätte abgelehnt werden müssen"),
    (grund) => grund,
  );
  assert.equal(fehler.message, "mcp_place_call_fehlgeschlagen");
  return fehler.detail;
}

const detailZuText = (text) => detailZu([{ type: "text", text }]);

async function festeTextePruefen(tabelle) {
  for (const [sprache, { mcp }] of Object.entries(LOCALES)) {
    const feste = Object.entries(mcp[tabelle]).filter(([, text]) => typeof text === "string");
    assert.ok(feste.length > 1, `${sprache}.${tabelle} ohne feste Texte`);
    for (const [schluessel, text] of feste) {
      assert.equal(await detailZuText(text), ERSTER_SCHLUESSEL[schluessel] ?? schluessel, `${sprache}.${tabelle}.${schluessel}`);
    }
  }
}

test("Probe: ohne Auftraggeber-Namen des Mandanten endet sie mit grund keine_identitaet, ohne Meldungstext, Token oder Nummer", async () => {
  await mitStaging({}, async (srv) => {
    const { code, ausgabe } = await probeStarten(srv.localUrl);
    assert.equal(code, 1);
    assert.match(ausgabe, /^Probe rot: messung grund=mcp_place_call_fehlgeschlagen:keine_identitaet$/m);
    await waitForLog(srv, /place_call_denied .*grund=keine_identitaet tenant=owner requestedBy=probe/);
    const sichtbar = ausgabe
      .split("\n")
      .filter((zeile) => !zeile.startsWith("::add-mask::"))
      .join("\n");
    const { denials } = LOCALES.de.mcp;
    for (const verboten of [TOKEN, ZIEL, denials.keine_identitaet]) {
      assert.equal(sichtbar.includes(verboten), false);
    }
    assert.equal(srv.readStore().calls.length, 0);
  });
});

test("Probe-Anrufer: OUTBOUND_FROZEN ergibt bei englischer Mandantensprache den Grund frozen", async () => {
  await mitStaging({ env: { OUTBOUND_FROZEN: "true" }, mandant: { defaultLanguage: "en" } }, async (srv) => {
    const antworten = [];
    const anrufer = anruferMit(srv.localUrl, async (...argumente) => {
      const antwort = await abrufMitFrist(...argumente);
      antworten.push(await antwort.clone().text());
      return antwort;
    });
    await assert.rejects(anrufer.anrufen({ ziel: ZIEL }), (fehler) => {
      assert.equal(fehler.message, "mcp_place_call_fehlgeschlagen");
      assert.equal(fehler.detail, "frozen");
      return true;
    });
    const { denials } = LOCALES.en.mcp;
    assert.ok(antworten[0].includes(denials.frozen));
    assert.equal(srv.readStore().calls.length, 0);
  });
});

test("Probe-Anrufer: jeder feste Ablehnungstext aller Sprachen ergibt seinen Schlüssel", async () => {
  await festeTextePruefen("denials");
});

test("Probe-Anrufer: jeder feste Fehlertext aller Sprachen ergibt seinen Schlüssel", async () => {
  await festeTextePruefen("errors");
});

test("Probe-Anrufer: bei gleichlautenden Texten gilt der erste Schlüssel", async () => {
  const { denials } = LOCALES.de.mcp;
  assert.equal(denials.allowlist, denials.abo);
  assert.equal(await detailZuText(denials.allowlist), "abo");
  assert.equal(denials.reserve_erschoepft, denials.budget_tenant);
  assert.equal(await detailZuText(denials.reserve_erschoepft), "budget_tenant");
});

test("Probe-Anrufer: nur der ganze Text zählt, sonst bleiben Stichwortklasse oder unklar", async () => {
  const { stundenlimit, frozen } = LOCALES.de.mcp.denials;
  assert.equal(await detailZuText(stundenlimit), "stundenlimit");
  assert.equal(await detailZuText(`${stundenlimit} Zusatz`), "limit_erreicht");
  assert.equal(await detailZuText(`${frozen} Zusatz`), "unklar");
  assert.equal(await detailZuText("Etwas ganz anderes"), "unklar");
  assert.equal(await detailZu([]), "unklar");
});
