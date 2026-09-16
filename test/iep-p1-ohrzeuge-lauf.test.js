// IEP-P1 auf Skript-Ebene: der Ohrzeuge im Messbaum, ohne Netz und ohne Anruf.
//
// KEIN NETZ: Trockenlauf-Faelle laufen mit --dry-run (fetch per Stolperdraht gesperrt),
// Echt-Modus-Faelle gegen test/_iel-b11-fetch-attrappe.mjs. Der ausgelieferte Zustand
// (leerer Pin, ziel_e164 null, sprechspur_sha256 null) verweigert jeden Lauf - genau das
// pinnt der erste Fall.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { texmlOhrzeugeAnfrage } from "../scripts/iel-mess-anbieter.mjs";
import {
  MESS_TENANT_ID,
  bauMessBaum,
  ergebniszeileMitArt,
  faellePfadIn,
  leseProtokoll,
  protokollPfadIn,
  spawnDry,
  spawnEcht,
  trockenAufrufe,
  zaehlerHash,
} from "./_iel-messbaum.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXIT_VERWEIGERT = 2;
const HTTP_OK = 200;
const FALL = "OZ-vorher";
const BELEG_ART = "iel-ohrzeuge-anruf";
const PIN = "+18643028341";
const ABSENDER = "+15739090177";
const SPRECHSPUR_BYTES = Buffer.from("iep-p1-sprechspur-attrappe");
const SPRECHSPUR_SHA = createHash("sha256").update(SPRECHSPUR_BYTES).digest("hex");
const AUSGELIEFERTER_PIN_QUELLTEXT = 'const OHRZEUGE_ZIEL_PIN = "";';

function guterVorlauf(ueberschreibungen = {}) {
  return {
    belegt_am: new Date().toISOString(),
    tenant_id: MESS_TENANT_ID,
    ziel_did: PIN,
    sms_summary_opt_in: false,
    private_number_treffer: false,
    kostendecke_rest_cents: 5000,
    ...ueberschreibungen,
  };
}

// Setzt den Pin in der KOPIE des Skripts - und belegt dabei, dass er im Bestand leer steht.
function setzeZielPin(dir, pin) {
  const pfad = path.join(dir, "scripts", "iel-mess.mjs");
  const inhalt = fs.readFileSync(pfad, "utf8");
  assert.ok(inhalt.includes(AUSGELIEFERTER_PIN_QUELLTEXT), "Ausgangszustand: OHRZEUGE_ZIEL_PIN muss leer ausgeliefert werden");
  fs.writeFileSync(pfad, inhalt.replace(AUSGELIEFERTER_PIN_QUELLTEXT, `const OHRZEUGE_ZIEL_PIN = "${pin}";`));
}

function ruesteOhrzeugeFall(dir) {
  const pfad = faellePfadIn(dir);
  const konfiguration = JSON.parse(fs.readFileSync(pfad, "utf8"));
  konfiguration.ohrzeuge.sprechspur_sha256 = SPRECHSPUR_SHA;
  konfiguration.faelle[FALL].ziel_e164 = PIN;
  fs.writeFileSync(pfad, JSON.stringify(konfiguration));
}

// Ein vollstaendig scharf gestellter Messbaum: Pin, Fall, Vorlauf-Beleg und Sprechspur.
function scharferMessbaum(optionen = {}) {
  const dir = bauMessBaum({ vorlauf: guterVorlauf(), sprechspur: SPRECHSPUR_BYTES, ...optionen });
  setzeZielPin(dir, PIN);
  ruesteOhrzeugeFall(dir);
  return dir;
}

function kontoNummerRoute(gemeldeteNummer) {
  return { methode: "GET", muster: "^/v2/phone_numbers\\?", status: HTTP_OK, koerper: { data: [{ phone_number: gemeldeteNummer, status: "active" }] } };
}

describe("IEP-P1 ausgelieferter Zustand verweigert", () => {
  it("OZ-vorher --dry-run verweigert mit leerem Pin, ohne einen einzigen fetch", () => {
    const dir = bauMessBaum();
    const vorher = zaehlerHash(dir, "iel-ohrzeuge-zaehler.json");
    const ergebnis = spawnDry(dir, [FALL]);
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /VERWEIGERT: Ziel-Pin nicht gesetzt/);
    assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    assert.equal(zaehlerHash(dir, "iel-ohrzeuge-zaehler.json"), vorher);
  });

  it("der ausgelieferte Fall traegt weder ein Ziel noch einen Sprechspur-Pin", () => {
    const konfiguration = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "iel-mess.cases.json"), "utf8"));
    assert.equal(konfiguration.faelle[FALL].ziel_e164, null);
    assert.equal(konfiguration.ohrzeuge.sprechspur_sha256, null);
  });

  it("OUTBOUND_FROZEN verweigert auch bei vollstaendig scharfem Messbaum", () => {
    const dir = scharferMessbaum();
    const ergebnis = spawnDry(dir, [FALL], { OUTBOUND_FROZEN: "true" });
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /OUTBOUND_FROZEN steht/);
    assert.equal(trockenAufrufe(ergebnis.stdout), 0);
  });

  it("fehlender Vorlauf-Beleg und fehlende Sprechspur verweigern je mit eigenem Grund", () => {
    const ohneVorlauf = bauMessBaum({ sprechspur: SPRECHSPUR_BYTES });
    setzeZielPin(ohneVorlauf, PIN);
    ruesteOhrzeugeFall(ohneVorlauf);
    assert.match(spawnDry(ohneVorlauf, [FALL]).stderr, /Vorlauf-Beleg tasks\/iel-ohrzeuge-vorlauf\.json fehlt/);

    const ohneSprechspur = bauMessBaum({ vorlauf: guterVorlauf() });
    setzeZielPin(ohneSprechspur, PIN);
    ruesteOhrzeugeFall(ohneSprechspur);
    assert.match(spawnDry(ohneSprechspur, [FALL]).stderr, /Sprechspur tasks\/iel-ohrzeuge-sprechspur\.mp3 fehlt/);
  });

  it("eine Sprechspur, die vom Pin abweicht, verweigert", () => {
    const dir = scharferMessbaum({ sprechspur: Buffer.from("andere-datei") });
    const ergebnis = spawnDry(dir, [FALL]);
    assert.equal(ergebnis.status, EXIT_VERWEIGERT);
    assert.match(ergebnis.stderr, /Sprechspur weicht vom Pin ab/);
  });
});

describe("IEP-P1 scharfer Trockenlauf und Zaehler-Deckel", () => {
  it("laeuft durch, zeigt 0/18 -> 1/18 und liefert die sieben Kennzahlen im Beleg", () => {
    const dir = scharferMessbaum();
    const ergebnis = spawnDry(dir, [FALL]);
    assert.equal(ergebnis.status, 0, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stdout, /Zaehler 0\/18 -> echt waere es 1\/18/);
    assert.equal(trockenAufrufe(ergebnis.stdout), 0);

    const zeile = ergebniszeileMitArt(ergebnis.stdout, BELEG_ART);
    assert.ok(zeile, "keine Ergebniszeile mit art iel-ohrzeuge-anruf gefunden");
    const kennzahlen = zeile.ohrzeuge?.kennzahlen;
    assert.ok(kennzahlen, "kein kennzahlen-Block im Beleg");
    assert.deepEqual(Object.keys(kennzahlen).sort(), [
      "annahme_ms",
      "erste_agenten_silbe_ms",
      "fremdton_vor_hermes",
      "klang",
      "laengste_stille_ms",
      "tonereignisse",
      "turn_luecken_ms",
    ]);
    // Der Trockenlauf liefert keine echten Proben - jede Audio-Kennzahl nennt ihren Grund.
    assert.equal(kennzahlen.klang.messbar, false);
    assert.ok(kennzahlen.klang.grund.length > 0);
    // Der Vorlauf-Beleg steht maskiert im Ergebnis, nie mit voller Nummer.
    assert.equal(zeile.vorlauf.tenant_id, MESS_TENANT_ID);
    assert.ok(!JSON.stringify(zeile).includes(PIN), "volle Rufnummer im Beleg");
  });

  it("spielt die Sprechspur mit eigener command_id und schneidet als wav mit", () => {
    const dir = scharferMessbaum();
    const ergebnis = spawnDry(dir, [FALL]);
    const zeile = ergebniszeileMitArt(ergebnis.stdout, BELEG_ART);
    const schritte = zeile.schritte.map((schritt) => schritt.schritt);
    assert.ok(schritte.includes("sprechspur_start"), `Schritte: ${schritte.join(", ")}`);
    assert.match(ergebnis.stdout, /"format":"wav"/);
    assert.match(ergebnis.stdout, new RegExp(`"command_id":"${zeile.lauf_id}-sprechspur"`));
  });

  it("verweigert bei erschoepftem Deckel 18/18, ohne Netz", () => {
    const dir = scharferMessbaum({ ohrzeugeZaehler: { ausgeloest: 18, anrufe: [] } });
    const ergebnis = spawnDry(dir, [FALL]);
    assert.equal(ergebnis.status, EXIT_VERWEIGERT);
    assert.match(ergebnis.stderr, /Anruf-Budget erschoepft: 18\/18 ausgeloest/);
    assert.equal(trockenAufrufe(ergebnis.stdout), 0);
  });

  it("verweigert bei fehlender Ohrzeugen-Zaehlerdatei", () => {
    const dir = scharferMessbaum();
    fs.unlinkSync(path.join(dir, "tasks", "iel-ohrzeuge-zaehler.json"));
    const ergebnis = spawnDry(dir, [FALL]);
    assert.equal(ergebnis.status, EXIT_VERWEIGERT);
    assert.match(ergebnis.stderr, /Zaehlerdatei tasks\/iel-ohrzeuge-zaehler\.json fehlt/);
  });

  it("ruehrt die Zaehler von m1 und nachdeploy nicht an", () => {
    const dir = scharferMessbaum();
    const vorher = { m1: zaehlerHash(dir, "iel-m1-zaehler.json"), nachdeploy: zaehlerHash(dir, "iel-nachdeploy-zaehler.json") };
    spawnDry(dir, [FALL]);
    spawnDry(dir, [FALL]);
    spawnDry(dir, [FALL]);
    assert.equal(zaehlerHash(dir, "iel-m1-zaehler.json"), vorher.m1);
    assert.equal(zaehlerHash(dir, "iel-nachdeploy-zaehler.json"), vorher.nachdeploy);
    for (const datei of ["iel-m1-zaehler.lock", "iel-nachdeploy-zaehler.lock", "iel-ohrzeuge-zaehler.lock", "iel-ohrzeuge-messung.jsonl"]) {
      assert.ok(!fs.existsSync(path.join(dir, "tasks", datei)), datei);
    }
  });

  it("status nennt die dritte Gruppe und den Ohrzeugen-Fall", () => {
    const ergebnis = spawnDry(bauMessBaum(), ["status"]);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.match(ergebnis.stdout, /Zaehler ohrzeuge: 0\/18/);
    assert.match(ergebnis.stdout, /OZ-vorher\s+texml-ohrzeuge\s+ohrzeuge\s+ANRUF/);
  });

  it("sprechspur --dry-run synthetisiert nichts", () => {
    const ergebnis = spawnDry(bauMessBaum(), ["sprechspur"]);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    assert.match(ergebnis.stdout, /wuerde \d+ Zeichen synthetisieren/);
  });
});

describe("IEP-P1 Golden: das Mess-TeXML traegt genau ein Verb", () => {
  it("enthaelt nur <Response><Dial><Number> - kein <Say>, kein <Hangup>", () => {
    const fall = { anrufer_kennung: ABSENDER, ziel_e164: PIN, dial_timeout_s: 20 };
    const anfrage = texmlOhrzeugeAnfrage({ fall, laufId: "iel-test-lauf" });
    assert.deepEqual(anfrage.form.Texml.match(/<[A-Z][A-Za-z]*/g), ["<Response", "<Dial", "<Number"]);
    assert.ok(!anfrage.form.Texml.includes("<Say"));
    assert.ok(!anfrage.form.Texml.includes("<Hangup"));
    assert.match(anfrage.form.Texml, new RegExp(`<Dial callerId="\\${ABSENDER}"`));
    assert.match(anfrage.form.Texml, new RegExp(`<Number>\\${PIN}</Number>`));
    assert.equal(anfrage.form.From, ABSENDER);
  });
});

describe("IEP-P1 Echt-Modus: kein TeXML-POST vor einem vollstaendigen Beleg", () => {
  it("ohne Vorlauf-Beleg wird weder reserviert noch gewaehlt", () => {
    const dir = bauMessBaum({ sprechspur: SPRECHSPUR_BYTES });
    setzeZielPin(dir, PIN);
    ruesteOhrzeugeFall(dir);
    const protokollPfad = protokollPfadIn(dir);
    const vorher = zaehlerHash(dir, "iel-ohrzeuge-zaehler.json");
    const ergebnis = spawnEcht(dir, [FALL], { szenario: { routen: [kontoNummerRoute(PIN)] }, protokollPfad });
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /Vorlauf-Beleg/);
    const protokoll = leseProtokoll(protokollPfad);
    assert.ok(!protokoll.some((aufruf) => aufruf.pfad.includes("/v2/texml/calls/")));
    assert.equal(zaehlerHash(dir, "iel-ohrzeuge-zaehler.json"), vorher);
  });

  it("ein blosser Teiltreffer der Konto-Nummern reicht nicht", () => {
    const dir = scharferMessbaum();
    const protokollPfad = protokollPfadIn(dir);
    const teilNummer = PIN.slice(0, -1);
    const ergebnis = spawnEcht(dir, [FALL], { szenario: { routen: [kontoNummerRoute(teilNummer)] }, protokollPfad });
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /eindeutig aktive Nummer/);
    const protokoll = leseProtokoll(protokollPfad);
    assert.ok(protokoll.some((aufruf) => aufruf.pfad.includes("/v2/phone_numbers")), "Test-Voraussetzung: der Eigentumsbeleg wurde abgefragt");
    assert.ok(!protokoll.some((aufruf) => aufruf.pfad.includes("/v2/texml/calls/")));
    assert.ok(!fs.existsSync(path.join(dir, "tasks", "iel-ohrzeuge-zaehler.lock")));
  });
});
