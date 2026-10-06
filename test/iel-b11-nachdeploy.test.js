import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  N2_URTEIL,
  kindbeinStatus,
  n2Urteil,
  sammleElGespraeche,
  sipNachrichtenBeleg,
} from "../scripts/iel-mess-belege.mjs";
import { texmlAnrufAnfrage } from "../scripts/iel-mess-anbieter.mjs";
import {
  bauMessBaum,
  ergebniszeileMitArt,
  faellePfadIn,
  ielMessDateiNamen,
  jsonZeilenAus,
  leseProtokoll,
  m1ZaehlerHash,
  protokollPfadIn,
  setzeZusatzFall,
  spawnDry,
  spawnEcht,
  trockenAufrufe,
} from "./_iel-messbaum.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const EXIT_VERWEIGERT = 2;
const SIP_TRYING = 100;
const SIP_OK = 200;
const SIP_FORBIDDEN = 403;
const SIP_NOT_FOUND = 404;
const SIP_PROXY_AUTH_REQUIRED = 407;
const SIP_TEMPORARILY_UNAVAILABLE = 480;
const SIP_NICHT_AKZEPTABEL = 487;
const SIP_SERVICE_UNAVAILABLE = 503;
const NICHT_DISKRIMINIERENDE_CODES = Object.freeze([
  SIP_NOT_FOUND,
  SIP_PROXY_AUTH_REQUIRED,
  SIP_NICHT_AKZEPTABEL,
  SIP_FORBIDDEN,
  SIP_TEMPORARILY_UNAVAILABLE,
  SIP_SERVICE_UNAVAILABLE,
  null,
  undefined,
]);

function methodenVon(protokoll) {
  return protokoll.map((aufruf) => aufruf.methode);
}

function enthaeltPfadTeil(protokoll, teil) {
  return protokoll.some((aufruf) => aufruf.pfad.includes(teil));
}

describe("IEL-B11 Trockenlauf: N1/N2/N-D und Setup-Varianten", () => {
  it("kopiert exakt die scripts/iel-mess*-Dateien in den Messbaum", () => {
    const dir = bauMessBaum();
    const kopiert = fs.readdirSync(path.join(dir, "scripts")).sort();
    assert.deepEqual(kopiert, ielMessDateiNamen());
  });

  it("Test 1: N2-ohne-inbound --dry-run ohne Wegwerf-Datei liefert 0/3 -> 1/3, kein Netz, n2_urteil NICHT_DISKRIMINIEREND", () => {
    const dir = bauMessBaum();
    const ergebnis = spawnDry(dir, ["N2-ohne-inbound"]);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.match(ergebnis.stdout, /Zaehler 0\/3 -> echt waere es 1\/3/);
    const zeilen = ergebnis.stdout.trim().split("\n");
    assert.equal(zeilen.at(-1), "[TROCKEN] fetch-Aufrufe in diesem Lauf: 0");
    const ergebniszeile = ergebniszeileMitArt(ergebnis.stdout, "iel-nachdeploy-anruf");
    assert.ok(ergebniszeile, "keine Ergebniszeile mit art iel-nachdeploy-anruf gefunden");
    assert.ok("from" in ergebniszeile);
    assert.ok("request_uri" in ergebniszeile);
    assert.ok(Array.isArray(ergebniszeile.trunk_inventar));
    assert.ok(Object.hasOwn(ergebniszeile, "sip_status"));
    assert.equal(ergebniszeile.n2_urteil, N2_URTEIL.NICHT_DISKRIMINIEREND);
  });

  it("Test 2: N1-m7-m8 --dry-run laeuft ohne trunk_inventar", () => {
    const dir = bauMessBaum();
    const ergebnis = spawnDry(dir, ["N1-m7-m8"]);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    const ergebniszeile = ergebniszeileMitArt(ergebnis.stdout, "iel-nachdeploy-anruf");
    assert.ok(ergebniszeile);
    assert.ok(!("trunk_inventar" in ergebniszeile));
  });

  it("Test 2: N-D --dry-run laeuft ohne Anruf", () => {
    const dir = bauMessBaum();
    const ergebnis = spawnDry(dir, ["N-D"]);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.equal(trockenAufrufe(ergebnis.stdout), 0);
  });

  it("Test 2: setup --nachdeploy --dry-run und setup --nur-ausgehend --dry-run laufen exit 0", () => {
    for (const option of ["--nachdeploy", "--nur-ausgehend"]) {
      const dir = bauMessBaum();
      const ergebnis = spawnDry(dir, ["setup", option]);
      assert.equal(ergebnis.status, 0, `${option}: ${ergebnis.stderr}`);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });

  it("Test 3: Nachdeploy-Trockenlaeufe ruehren tasks/iel-m1-zaehler.json nicht an", () => {
    const dir = bauMessBaum();
    const vorher = m1ZaehlerHash(dir);
    spawnDry(dir, ["N2-ohne-inbound"]);
    spawnDry(dir, ["N1-m7-m8"]);
    spawnDry(dir, ["setup", "--nachdeploy"]);
    const nachher = m1ZaehlerHash(dir);
    assert.equal(nachher, vorher);
    assert.ok(!fs.existsSync(path.join(dir, "tasks", "iel-m1-zaehler.lock")));
    assert.ok(!fs.existsSync(path.join(dir, "tasks", "iel-nachdeploy-messung.jsonl")));
  });
});

describe("IEL-B11 Zaehler-Gruppen und Grenzen", () => {
  it("Test 4: F-A --dry-run bei M1 5/5 verweigert mit dem M1-Budgettext", () => {
    const dir = bauMessBaum({ m1Zaehler: { ausgeloest: 5, anrufe: [] } });
    const ergebnis = spawnDry(dir, ["F-A"]);
    assert.equal(ergebnis.status, EXIT_VERWEIGERT);
    assert.match(ergebnis.stderr, /VERWEIGERT: Anruf-Budget erschoepft: 5\/5 ausgeloest/);
  });

  it("Test 5: N2-ohne-inbound --dry-run bei nachdeploy 3/3 verweigert", () => {
    const dir = bauMessBaum({ nachdeployZaehler: { ausgeloest: 3, anrufe: [] } });
    const ergebnis = spawnDry(dir, ["N2-ohne-inbound"]);
    assert.equal(ergebnis.status, EXIT_VERWEIGERT);
    assert.match(ergebnis.stderr, /VERWEIGERT: Anruf-Budget erschoepft: 3\/3 ausgeloest/);
  });

  it("Test 6: fehlende Nachdeploy-Zaehlerdatei verweigert", () => {
    const dir = bauMessBaum();
    fs.unlinkSync(path.join(dir, "tasks", "iel-nachdeploy-zaehler.json"));
    const ergebnis = spawnDry(dir, ["N2-ohne-inbound"]);
    assert.equal(ergebnis.status, EXIT_VERWEIGERT);
    assert.match(ergebnis.stderr, /Zaehlerdatei tasks\/iel-nachdeploy-zaehler\.json fehlt/);
  });

  it("Test 7: Fall ohne/mit ungueltigem zaehler-Feld verweigert vor jedem Netzzugriff", () => {
    for (const zaehlerWert of [undefined, "x", "toString"]) {
      const dir = bauMessBaum();
      const konfigurationPfad = faellePfadIn(dir);
      const konfiguration = JSON.parse(fs.readFileSync(konfigurationPfad, "utf8"));
      const bestandsFall = konfiguration.faelle["N2-ohne-inbound"];
      const fall = { ...bestandsFall };
      if (zaehlerWert === undefined) delete fall.zaehler;
      else fall.zaehler = zaehlerWert;
      setzeZusatzFall(dir, "Z-BAD", fall);
      const ergebnis = spawnDry(dir, ["Z-BAD"]);
      assert.equal(ergebnis.status, EXIT_VERWEIGERT, `zaehler=${zaehlerWert}: ${ergebnis.stderr}`);
      assert.match(ergebnis.stderr, /keine gueltige Zaehler-Gruppe/);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });

  it("Test 8: Nachdeploy-Zielpruefung verweigert Spike2, TEST-NET und fremde Kennungen/Hosts", () => {
    const ziele = [
      "+4915112345678",
      "tel:+4915112345678",
      "sip:+4915112345678@sip.rtc.elevenlabs.io:5060;transport=tcp",
      "sip:+15739090177@sip.rtc.elevenlabs.io:5060;transport=tcp",
      "sip:iel-probe@192.0.2.1:5060",
      "sip:+12025550176@evil.example:5060",
    ];
    for (const sipZiel of ziele) {
      const dir = bauMessBaum();
      const konfigurationPfad = faellePfadIn(dir);
      const konfiguration = JSON.parse(fs.readFileSync(konfigurationPfad, "utf8"));
      const basisFall = konfiguration.faelle["N2-ohne-inbound"];
      setzeZusatzFall(dir, "Z-ZIEL", { ...basisFall, sip_ziel: sipZiel });
      const ergebnis = spawnDry(dir, ["Z-ZIEL"]);
      assert.equal(ergebnis.status, EXIT_VERWEIGERT, `sip_ziel=${sipZiel}: stdout=${ergebnis.stdout} stderr=${ergebnis.stderr}`);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });
});

describe("IEL-B11 geteilte 60-s-Grenzen", () => {
  it("Test 9a: HART_MAX_S/WACHHUND_AUFLEGEN_S/NACHFASSEN_S/NOTAUS_S sind je genau einmal definiert", () => {
    for (const konstante of ["HART_MAX_S", "WACHHUND_AUFLEGEN_S", "NACHFASSEN_S", "NOTAUS_S"]) {
      let treffer = 0;
      for (const datei of ielMessDateiNamen()) {
        const inhalt = fs.readFileSync(path.join(ROOT, "scripts", datei), "utf8");
        const muster = new RegExp(`${konstante} =`, "g");
        const funde = inhalt.match(muster) ?? [];
        treffer += funde.length;
      }
      assert.equal(treffer, 1, `${konstante} sollte genau 1x definiert sein, war ${treffer}`);
    }
  });

  it("Test 9b: F-A und N2-ohne-inbound teilen dieselben Auflege-Stufen im Trockenlauf", () => {
    const dirM1 = bauMessBaum({ m1Zaehler: { ausgeloest: 0, anrufe: [] } });
    const m1Ergebnis = spawnDry(dirM1, ["F-A"]);
    const dirNachdeploy = bauMessBaum();
    const nachdeployErgebnis = spawnDry(dirNachdeploy, ["N2-ohne-inbound"]);
    const auflegeGruende = (stdout) => {
      const zeile = jsonZeilenAus(stdout).find((objekt) => objekt.auflegen);
      return zeile?.auflegen?.map((eintrag) => eintrag.grund);
    };
    assert.deepEqual(auflegeGruende(m1Ergebnis.stdout), auflegeGruende(nachdeployErgebnis.stdout));
  });
});

describe("IEL-B11 Echt-Modus: setup --nur-ausgehend", () => {
  it("Test 10: baut bei unerwartetem inbound_trunk sofort wieder ab und leakt kein Passwort", () => {
    const dir = bauMessBaum();
    const protokollPfad = protokollPfadIn(dir);
    const szenario = {
      routen: [
        { methode: "POST", muster: "^/v1/convai/phone-numbers$", status: HTTP_OK, koerper: { phone_number_id: "pn_test" } },
        {
          methode: "GET",
          muster: "^/v1/convai/phone-numbers/pn_test$",
          status: HTTP_OK,
          koerper: {
            phone_number: "+12025550176",
            label: "IEL Nach-Deploy Wegwerf am Agenten",
            assigned_agent: { agent_id: "agent_b11_test" },
            inbound_trunk: { allowed_numbers: [] },
          },
        },
        { methode: "DELETE", muster: "^/v1/convai/phone-numbers/pn_test$", status: HTTP_OK, koerper: {} },
      ],
    };
    const ergebnis = spawnEcht(dir, ["setup", "--nur-ausgehend"], { szenario, protokollPfad });
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    const protokoll = leseProtokoll(protokollPfad);
    assert.deepEqual(methodenVon(protokoll), ["POST", "GET", "GET", "DELETE"]);
    assert.ok(!fs.existsSync(path.join(dir, "tasks", "iel-m1-wegwerf.json")));
    const postAufruf = protokoll[0];
    const trunkConfig = postAufruf.koerper?.outbound_trunk_config;
    const passwort = trunkConfig?.credentials?.password;
    assert.ok(passwort && passwort.length > 0, "Test-Voraussetzung: Passwort im POST-Koerper vorhanden");
    assert.ok(!ergebnis.stdout.includes(passwort) && !ergebnis.stderr.includes(passwort));
  });

  it("Test 11: Normalfall legt die Wegwerf-Datei an", () => {
    const dir = bauMessBaum();
    const protokollPfad = protokollPfadIn(dir);
    const szenario = {
      routen: [
        { methode: "POST", muster: "^/v1/convai/phone-numbers$", status: HTTP_OK, koerper: { phone_number_id: "pn_test" } },
        {
          methode: "GET",
          muster: "^/v1/convai/phone-numbers/pn_test$",
          status: HTTP_OK,
          koerper: { phone_number: "+12025550176", label: "IEL Nach-Deploy Wegwerf am Agenten", assigned_agent: { agent_id: "agent_b11_test" } },
        },
      ],
    };
    const ergebnis = spawnEcht(dir, ["setup", "--nur-ausgehend"], { szenario, protokollPfad });
    assert.equal(ergebnis.status, 0, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.ok(fs.existsSync(path.join(dir, "tasks", "iel-m1-wegwerf.json")));
    assert.match(ergebnis.stdout, /inbound_trunk nein/);
  });
});

describe("IEL-B11 N1 nutzt den Digest-Weg (Review-Fix)", () => {
  it("N1-m7-m8 ist in scripts/iel-mess.cases.json auf digest:true gestellt (Spec E20/M7)", () => {
    const konfiguration = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "iel-mess.cases.json"), "utf8"));
    assert.equal(konfiguration.faelle["N1-m7-m8"].digest, true);
  });

  it("texmlAnrufAnfrage traegt fuer den N1-Fall <Sip username password>, wenn Wegwerf-Zugangsdaten vorliegen", () => {
    const konfiguration = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "iel-mess.cases.json"), "utf8"));
    const fall = konfiguration.faelle["N1-m7-m8"];
    const geheim = { username: "ielm1testbenutzer", password: "ielm1testpasswort" };
    const anfrage = texmlAnrufAnfrage({ fall, gemeinsam: konfiguration.gemeinsam, header: konfiguration.gemeinsam.probe_header, laufId: "iel-test-lauf", geheim });
    assert.match(anfrage.form.Texml, /<Sip username="ielm1testbenutzer" password="ielm1testpasswort">/);
    assert.match(anfrage.form.Texml, /<Sip>sip:/);
  });

  it("N1-m7-m8 setzt Wegwerf-Digest per PATCH VOR jeder Zaehler-Reservierung und jedem TeXML-POST; misslingt die Verifikation, wird verweigert", () => {
    const wegwerf = { phone_number_id: "pn_test", label: "IEL Nach-Deploy Wegwerf am Agenten" };
    const dir = bauMessBaum({ wegwerf });
    const protokollPfad = protokollPfadIn(dir);
    const nachdeployZaehlerPfad = path.join(dir, "tasks", "iel-nachdeploy-zaehler.json");
    const zaehlerVorher = fs.readFileSync(nachdeployZaehlerPfad, "utf8");
    const registrierungsAntwort = {
      phone_number: "+12025550176",
      label: "IEL Nach-Deploy Wegwerf am Agenten",
      assigned_agent: { agent_id: "agent_b11_test" },
      inbound_trunk: { allowed_numbers: [] },
    };
    const szenario = {
      routen: [
        { methode: "GET", muster: "^/v1/convai/phone-numbers/pn_test$", status: HTTP_OK, koerper: registrierungsAntwort },
        { methode: "PATCH", muster: "^/v1/convai/phone-numbers/pn_test$", status: HTTP_OK, koerper: {} },
      ],
    };
    const ergebnis = spawnEcht(dir, ["N1-m7-m8"], { szenario, protokollPfad });
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /Zugangsdaten nicht wirksam gesetzt/);

    const protokoll = leseProtokoll(protokollPfad);
    assert.ok(!enthaeltPfadTeil(protokoll, "/v2/texml/calls/"), "kein TeXML-POST, da die Verifikation vor dem Anruf scheitert");

    const patchAufrufe = protokoll.filter((aufruf) => aufruf.methode === "PATCH");
    assert.ok(patchAufrufe.length >= 1, "kein PATCH protokolliert - N1 haette den Digest-Weg genommen");
    const [ersterPatch] = patchAufrufe;
    const credentials = ersterPatch.koerper?.inbound_trunk_config?.credentials;
    assert.ok(credentials?.username && credentials.username.length > 0, "PATCH ohne Benutzername - kein echter Digest-Zugang gesetzt");
    assert.ok(credentials?.password && credentials.password.length > 0, "PATCH ohne Passwort - kein echter Digest-Zugang gesetzt");

    assert.deepEqual(methodenVon(protokoll), ["GET", "GET", "PATCH", "GET", "PATCH", "GET"]);

    const zaehlerNachher = fs.readFileSync(nachdeployZaehlerPfad, "utf8");
    assert.equal(zaehlerNachher, zaehlerVorher, "Zaehler-Datei haette sich ohne Reservierung nicht aendern duerfen");
  });
});

describe("IEL-B11 Echt-Modus: N1/N2 Verweigerungen vor der Reservierung", () => {
  it("Test 12: N2 verweigert, wenn das Trunk-Inventar nicht lesbar ist, ohne TeXML-POST", () => {
    const wegwerf = { phone_number_id: "pn_test", label: "IEL Nach-Deploy Wegwerf am Agenten" };
    const dir = bauMessBaum({ wegwerf });
    const vorherHash = m1ZaehlerHash(dir);
    const protokollPfad = protokollPfadIn(dir);
    const szenario = {
      routen: [
        {
          methode: "GET",
          muster: "^/v1/convai/phone-numbers/pn_test$",
          status: HTTP_OK,
          koerper: { phone_number: "+12025550176", label: "IEL Nach-Deploy Wegwerf am Agenten", assigned_agent: { agent_id: "agent_b11_test" } },
        },
        { methode: "GET", muster: "^/v1/convai/phone-numbers$", status: HTTP_SERVER_FEHLER, koerper: {} },
      ],
    };
    const ergebnis = spawnEcht(dir, ["N2-ohne-inbound"], { szenario, protokollPfad });
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /Trunk-Inventar vor dem Anruf nicht lesbar \(HTTP 500\)/);
    const protokoll = leseProtokoll(protokollPfad);
    assert.ok(!enthaeltPfadTeil(protokoll, "/v2/texml/calls/"));
    assert.equal(m1ZaehlerHash(dir), vorherHash);
    assert.ok(!fs.existsSync(path.join(dir, "tasks", "iel-nachdeploy-zaehler.lock")));
  });

  it("Test 13: N2 verweigert vor der Reservierung, wenn die Registrierung inbound_trunk zeigt", () => {
    const wegwerf = { phone_number_id: "pn_test", label: "IEL Nach-Deploy Wegwerf am Agenten" };
    const dir = bauMessBaum({ wegwerf });
    const protokollPfad = protokollPfadIn(dir);
    const szenario = {
      routen: [
        {
          methode: "GET",
          muster: "^/v1/convai/phone-numbers/pn_test$",
          status: HTTP_OK,
          koerper: {
            phone_number: "+12025550176",
            label: "IEL Nach-Deploy Wegwerf am Agenten",
            assigned_agent: { agent_id: "agent_b11_test" },
            inbound_trunk: { allowed_numbers: [] },
          },
        },
      ],
    };
    const ergebnis = spawnEcht(dir, ["N2-ohne-inbound"], { szenario, protokollPfad });
    assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${ergebnis.stdout}\n${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /inbound_trunk passt nicht zum Messaufbau/);
    const protokoll = leseProtokoll(protokollPfad);
    assert.ok(!enthaeltPfadTeil(protokoll, "/v2/texml/calls/"));
    assert.ok(!protokoll.some((aufruf) => aufruf.pfad === "/v1/convai/phone-numbers"));
  });

  it("Test 14: N1 verweigert vor jedem TeXML-POST, wenn der Agent nicht passt", () => {
    for (const agentId of [null, "agent_fremd"]) {
      const wegwerf = { phone_number_id: "pn_test", label: "IEL Nach-Deploy Wegwerf am Agenten" };
      const dir = bauMessBaum({ wegwerf });
      const protokollPfad = protokollPfadIn(dir);
      const zugewiesenerAgent = agentId ? { agent_id: agentId } : {};
      const szenario = {
        routen: [
          {
            methode: "GET",
            muster: "^/v1/convai/phone-numbers/pn_test$",
            status: HTTP_OK,
            koerper: {
              phone_number: "+12025550176",
              label: "IEL Nach-Deploy Wegwerf am Agenten",
              assigned_agent: zugewiesenerAgent,
              inbound_trunk: { allowed_numbers: [] },
            },
          },
        ],
      };
      const ergebnis = spawnEcht(dir, ["N1-m7-m8"], { szenario, protokollPfad });
      assert.equal(ergebnis.status, EXIT_VERWEIGERT, `agentId=${agentId}: ${ergebnis.stdout}\n${ergebnis.stderr}`);
      assert.match(ergebnis.stderr, /nicht ELEVENLABS_AGENT_ID zugewiesen/);
      const protokoll = leseProtokoll(protokollPfad);
      assert.ok(!protokoll.some((aufruf) => aufruf.methode === "PATCH"));
      assert.ok(!enthaeltPfadTeil(protokoll, "/v2/texml/calls/"));
    }
  });
});

describe("IEL-B11 reine Belege-Funktionen", () => {
  it("U1: n2Urteil - nur 200 ist ANNAHME_DISKRIMINIEREND", () => {
    for (const sipStatus of NICHT_DISKRIMINIERENDE_CODES) {
      assert.equal(n2Urteil({ sipStatus }), N2_URTEIL.NICHT_DISKRIMINIEREND, `sipStatus=${sipStatus}`);
    }
    assert.equal(n2Urteil({ sipStatus: SIP_OK }), N2_URTEIL.ANNAHME_DISKRIMINIEREND);
  });

  it("U2: kindbeinStatus - nur genau EIN Kindbein liefert einen Status", () => {
    const hauptbein = "call_sid_haupt";
    const einKind = kindbeinStatus({ calls: [{ parent_call_sid: hauptbein, sip_hangup_cause: "404" }], hauptbein });
    assert.equal(einKind.sip_status, SIP_NOT_FOUND);

    const nurElternbein = kindbeinStatus({ calls: [{ sid: hauptbein, parent_call_sid: null, sip_hangup_cause: "200" }], hauptbein });
    assert.equal(nurElternbein.sip_status, null, "das Elternbein selbst (kein Kind) darf keinen Status liefern");

    const zweiKinder = kindbeinStatus({
      calls: [
        { parent_call_sid: hauptbein, sip_hangup_cause: "200" },
        { parent_call_sid: hauptbein, sip_hangup_cause: "404" },
      ],
      hauptbein,
    });
    assert.equal(zweiKinder.sip_status, null, "zwei Kindbeine sind mehrdeutig - kein Status");

    for (const wert of ["200abc", "", "0"]) {
      const kindMitUngueltigemWert = kindbeinStatus({ calls: [{ parent_call_sid: hauptbein, sip_hangup_cause: wert }], hauptbein });
      assert.equal(kindMitUngueltigemWert.sip_status, null, `wert=${wert}`);
    }
  });

  it("U3: sipNachrichtenBeleg - nur die erste Zeile, Query maskiert, Kopfzeilen nie im Ergebnis", () => {
    const inviteZeile = "INVITE sip:+12025550176@sip.rtc.elevenlabs.io:5060?X-Hermes-Probe=abc SIP/2.0";
    const proxyKopfzeile = 'Proxy-Authorization: Digest response="GEHEIM"';
    const nachrichten = [
      { direction: "in", raw_message: `${inviteZeile}\r\n${proxyKopfzeile}\r\n` },
      { direction: "out", raw_message: `SIP/2.0 ${SIP_TRYING} Trying\r\n` },
      { direction: "out", raw_message: `SIP/2.0 ${SIP_PROXY_AUTH_REQUIRED} Proxy Authentication Required\r\n` },
      { direction: "out", raw_message: `SIP/2.0 ${SIP_OK} OK\r\n` },
    ];
    const beleg = sipNachrichtenBeleg(nachrichten);
    assert.equal(beleg.request_uri, "sip:…0176@sip.rtc.elevenlabs.io:5060");
    assert.deepEqual(beleg.antwort_codes, [SIP_TRYING, SIP_PROXY_AUTH_REQUIRED, SIP_OK]);
    const belegAlsText = JSON.stringify(beleg);
    assert.ok(!belegAlsText.includes("GEHEIM"));
  });

  it("U4: sammleElGespraeche gibt dynamic_variables nur als Namen zurueck, nie als Werte", async () => {
    const geheimnisse = ["GEHEIM_TENANT_TOKEN", "GEHEIM_SIP_BINDING", "GEHEIM_OWNER_NAME"];
    const [tenantToken, sipBinding, ownerName] = geheimnisse;
    const gespraech = {
      conversation_id: "conv1",
      agent_id: "agent1",
      status: "done",
      metadata: { termination_reason: "normal", call_duration_secs: 5, phone_call: { phone_number_id: "pn1" } },
      transcript: [{ role: "agent", message: "hallo" }],
      conversation_initiation_client_data: {
        dynamic_variables: { tenant_token: tenantToken, sip_hermes_call_binding: sipBinding, owner_name: ownerName },
      },
    };
    const kontext = {
      laufId: "iel-b11-u4-test",
      registrierung: { id: "pn1" },
      uhr: { startMs: Date.now() },
      transport: {
        async senden(anfrage) {
          if (anfrage.pfad.startsWith("/v1/convai/conversations?")) return { status: HTTP_OK, json: { conversations: [{ conversation_id: "conv1" }] } };
          return { status: HTTP_OK, json: gespraech };
        },
      },
    };
    const ergebnis = await sammleElGespraeche(kontext);
    const ergebnisAlsText = JSON.stringify(ergebnis);
    for (const geheim of geheimnisse) assert.ok(!ergebnisAlsText.includes(geheim), `Geheimwert ${geheim} geleakt`);
    const [erstesGespraech] = ergebnis.gespraeche;
    assert.deepEqual(erstesGespraech.variablen_namen.sort(), ["owner_name", "sip_hermes_call_binding", "tenant_token"]);
  });
});
