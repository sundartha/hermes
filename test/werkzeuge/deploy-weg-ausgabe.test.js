import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ausgabeAnlegen,
  ausgabenSchreiben,
  AusgabeVerweigert,
  zeileBauen,
} from "../../tools/deploy-weg/ausgabe.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";
import { abwarten } from "../../tools/deploy-weg/takt.mjs";
import { sammler, temporaerOrdner, testUhr, umgebungFuer } from "./deploy-weg-attrappe.mjs";

const TAKT_MS = 1000;
const GRENZE_MS = 3000;
const VIER_VERSUCHE = 4;

test("Ausgabe-Katalog verweigert unbekannte Meldungen und unzulässige Werte", () => {
  assert.throws(() => zeileBauen("gibt_es_nicht"), AusgabeVerweigert);
  assert.throws(() => zeileBauen("gespraech_teil", { teil: "+49 151 12345678" }), AusgabeVerweigert);
  assert.throws(() => zeileBauen("produktion", { commit: "https://beispiel.invalid" }), AusgabeVerweigert);
  assert.throws(() => zeileBauen("anrufe", { anzahl: "3" }), AusgabeVerweigert);
  assert.throws(() => zeileBauen("anrufe", {}), AusgabeVerweigert);
  assert.throws(() => zeileBauen("deploy_status", { status: "geheim" }), AusgabeVerweigert);
  assert.equal(zeileBauen("deploy_status", { status: "live" }), "Deploy-Status: live");
});

test("GitHub-Ausgaben verweigern Zeilenumbrüche und schreiben ja/nein", (kontext) => {
  const datei = join(temporaerOrdner(kontext), "ausgaben");
  assert.throws(() => ausgabenSchreiben(datei, { commit: "a\nb" }), AusgabeVerweigert);
  ausgabenSchreiben(datei, { deploy: true, hoertest: false });
  assert.equal(readFileSync(datei, "utf8"), "deploy=ja\nhoertest=nein\n");
});

test("add-mask kodiert Prozent und Zeilenumbruch und überspringt leere Werte", () => {
  const zeilen = [];
  ausgabeAnlegen((zeile) => zeilen.push(zeile)).maskiere(["a%b\nc", "", undefined]);
  assert.deepEqual(zeilen, ["::add-mask::a%25b%0Ac"]);
});

test("Einstellungen: fremde Adressen für GitHub, Render und Hermes werden abgelehnt", () => {
  const { zeilen, ausgabe } = sammler();
  const umgebung = umgebungFuer("http://127.0.0.1:9", {
    GITHUB_API_URL: "https://fremd.invalid",
    STAGING_URL: "http://staging.invalid",
  });
  assert.throws(() => einstellungenLesen("staging", umgebung, ausgabe), { name: "Abbruch" });
  assert.deepEqual(zeilen, [
    "Einstellung fehlt oder ist ungültig: STAGING_URL",
    "Einstellung fehlt oder ist ungültig: GITHUB_API_URL",
  ]);
});

test("Einstellungen: ein Deploy-Token unter 32 Zeichen wird abgelehnt und nicht ausgegeben", () => {
  const { zeilen, ausgabe } = sammler();
  const umgebung = umgebungFuer("http://127.0.0.1:9", { HERMES_DEPLOY_TOKEN: "zu-kurz" });
  assert.throws(() => einstellungenLesen("deploy", umgebung, ausgabe), { name: "Abbruch" });
  assert.deepEqual(zeilen, ["Einstellung fehlt oder ist ungültig: HERMES_DEPLOY_TOKEN"]);
});

test("abwarten versucht bis zur Schutzgrenze im Takt und meldet sie dann", async () => {
  const uhr = testUhr();
  let versuche = 0;
  const ergebnis = await abwarten({ uhr, taktMs: TAKT_MS, schutzgrenzeMs: GRENZE_MS }, async () => {
    versuche += 1;
    return undefined;
  });
  assert.equal(ergebnis.schutzgrenze, true);
  assert.equal(versuche, VIER_VERSUCHE);
  assert.deepEqual(uhr.wartezeiten, [TAKT_MS, TAKT_MS, TAKT_MS]);
});
