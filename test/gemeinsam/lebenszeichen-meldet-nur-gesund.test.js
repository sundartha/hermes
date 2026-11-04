import { test } from "node:test";
import assert from "node:assert/strict";
import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import {
  MELDE_PFAD,
  MELDE_TOKEN,
  antwortetMit,
  antwortetNie,
  lebenszeichenZeilen,
  mitEmpfaenger,
  mitGemeldetemDienst,
  mitLebenszeichenDienst,
  unerreichbaresMeldeZiel,
  wirdWahr,
} from "./lebenszeichen-hilfe.mjs";

const HTTP_OK = 200;
const HTTP_OHNE_INHALT = 204;
const HTTP_FEHLER = 500;

const SCHNELLER_TAKT = { HERZSCHLAG_TAKT_MS: "20" };
const MESS_TAKT_MS = 100;
const LANGE_FRIST_MS = "60000";
const NACHLAUF_MS = 100;
const STILLE_MS = 60;
const ERSTER_TAKT_MS = 600;

const GESUND_MELDUNGEN = 5;
const MESS_MINDESTSPANNE_MS = (GESUND_MELDUNGEN - 2) * MESS_TAKT_MS;
const ERSTER_TAKT_MINDESTABSTAND_MS = ERSTER_TAKT_MS / 2;

const MELDET_NICHT = "Lebenszeichen: gesunder Dienst meldet nicht an die Herzschlag-Adresse";
const KEINE_LOGZEILE = "Lebenszeichen: gescheiterte Meldung ergibt nicht die erwartete Logzeile";
const NICHT_ABGEBROCHEN =
  "Lebenszeichen: nie beantwortete Meldung wird nach der Frist nicht abgebrochen";
const KEIN_FOLGETAKT = "Lebenszeichen: nach einer gescheiterten Meldung kommt keine weitere";
const EIN_EINTRAG_JE_MELDUNG = "Lebenszeichen: mehr als ein Logeintrag je Meldung";
const WARNUNG_TROTZ_ERFOLG = "Lebenszeichen: Warnung im Log trotz gelungener Meldung";
const ADRESSE_IM_LOG = "Lebenszeichen: ein Teil der Herzschlag-Adresse steht im Log";
const STILLE_OHNE_BELEG =
  "Lebenszeichen: die Stille beim Start belegt nichts, auch mit kurzem Takt kommt keine Meldung";

const JEDE_ZEILE = "";
const FREMDER_HOST = "herzschlag.example.test";
const IN_ANFUEHRUNGSZEICHEN = `"https://${FREMDER_HOST}${MELDE_PFAD}"`;
const OHNE_SCHEMA_MIT_LEERZEICHEN = ` ${FREMDER_HOST}${MELDE_PFAD} `;

function assertOhneAdresse(dienst, adressTeile) {
  for (const teil of adressTeile) assert.equal(dienst.stdout.includes(teil), false, ADRESSE_IM_LOG);
}

function zeilenMit(dienst, teil) {
  return lebenszeichenZeilen(dienst).filter((zeile) => zeile.includes(teil));
}

async function assertZeilen(dienst, teil, anzahl = 1) {
  const erschienen = await wirdWahr(() => zeilenMit(dienst, teil).length >= anzahl);
  assert.equal(erschienen, true, KEINE_LOGZEILE);
}

async function assertDienstUnberuehrt(dienst) {
  const antwort = await abrufMitFrist(`${dienst.localUrl}/healthz`);
  assert.equal(antwort.status, HTTP_OK, "Lebenszeichen: /healthz weicht von 200 ab");
  assert.equal(dienst.child.exitCode, null, "Lebenszeichen: der Dienst ist beendet");
  for (const wort of ["uncaughtException", "unhandledRejection"]) {
    assert.equal(dienst.stdout.includes(wort), false, `Lebenszeichen: ${wort} im Log`);
  }
}

test("Lebenszeichen: ein gesunder Dienst mit JSON-Speicher meldet je Takt genau einmal an die hinterlegte Adresse", async () => {
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_OK), umgebung: { HERZSCHLAG_TAKT_MS: String(MESS_TAKT_MS) } },
    async (dienst, empfaenger) => {
      const genug = await wirdWahr(() => empfaenger.meldungen.length >= GESUND_MELDUNGEN);
      assert.equal(genug, true, MELDET_NICHT);
      const gemessen = empfaenger.meldungen.slice(0, GESUND_MELDUNGEN);
      const anDieAdresse = gemessen.every(({ pfad }) => pfad === MELDE_PFAD);
      assert.equal(anDieAdresse, true, "Lebenszeichen: Meldung ging an einen anderen Pfad");
      const spanne = gemessen.at(-1).zeitMs - gemessen[0].zeitMs;
      assert.ok(
        spanne >= MESS_MINDESTSPANNE_MS,
        `Mehr als eine Meldung je Takt: Spanne ${spanne} ms`,
      );
      assert.equal(lebenszeichenZeilen(dienst).length, 0, WARNUNG_TROTZ_ERFOLG);
    },
  );
});

test("Lebenszeichen: eine Antwort 204 ohne Inhalt gilt als gelungen und ergibt keine Warnung", async () => {
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_OHNE_INHALT), umgebung: SCHNELLER_TAKT },
    async (dienst, empfaenger) => {
      const genug = await wirdWahr(() => empfaenger.meldungen.length >= GESUND_MELDUNGEN);
      assert.equal(genug, true, MELDET_NICHT);
      assert.equal(lebenszeichenZeilen(dienst).length, 0, WARNUNG_TROTZ_ERFOLG);
    },
  );
});

test("Lebenszeichen: Antwort 500 ergibt je Meldung einen Logeintrag ohne Adresse, keine Wiederholung, der Takt läuft weiter", async () => {
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_FEHLER), umgebung: { HERZSCHLAG_TAKT_MS: "500" } },
    async (dienst, empfaenger) => {
      await assertZeilen(dienst, "HTTP 500");
      await echtWarten(NACHLAUF_MS);
      assert.equal(
        empfaenger.meldungen.length,
        1,
        "Lebenszeichen: gescheiterte Meldung wurde wiederholt",
      );
      assert.equal(lebenszeichenZeilen(dienst).length, 1, EIN_EINTRAG_JE_MELDUNG);
      await assertZeilen(dienst, "HTTP 500", 2);
      assertOhneAdresse(dienst, empfaenger.adressTeile);
    },
  );
});

test("Lebenszeichen: eine unerreichbare Adresse nennt die Fehlerart des Netzes ohne Adresse, der Takt läuft weiter", async () => {
  const { adresse, adressTeile } = await unerreichbaresMeldeZiel();
  await mitLebenszeichenDienst({ HERZSCHLAG_URL: adresse, ...SCHNELLER_TAKT }, async (dienst) => {
    await assertZeilen(dienst, "ECONNREFUSED", 2);
    assertOhneAdresse(dienst, adressTeile);
  });
});

test("Lebenszeichen: eine nie beantwortete Meldung wird nach der Frist abgebrochen und nennt TimeoutError ohne Adresse", async () => {
  await mitGemeldetemDienst(
    { antworte: antwortetNie, umgebung: { HERZSCHLAG_TAKT_MS: "300", HERZSCHLAG_FRIST_MS: "20" } },
    async (dienst, empfaenger) => {
      const abgebrochen = await wirdWahr(() => empfaenger.verbindungen.abgebrochen >= 1);
      assert.equal(abgebrochen, true, NICHT_ABGEBROCHEN);
      assert.equal(
        empfaenger.meldungen.length,
        1,
        "Lebenszeichen: der Abbruch kam erst mit dem nächsten Takt",
      );
      await assertZeilen(dienst, "TimeoutError");
      assert.equal(lebenszeichenZeilen(dienst).length, 1, EIN_EINTRAG_JE_MELDUNG);
      assert.equal(await wirdWahr(() => empfaenger.meldungen.length >= 2), true, KEIN_FOLGETAKT);
      assertOhneAdresse(dienst, empfaenger.adressTeile);
    },
  );
});

test("[NIE1] eine ungültige Adresse mit erfundenem Token steht in keiner Form im Log", async () => {
  for (const adresse of [IN_ANFUEHRUNGSZEICHEN, OHNE_SCHEMA_MIT_LEERZEICHEN]) {
    await mitLebenszeichenDienst({ HERZSCHLAG_URL: adresse, ...SCHNELLER_TAKT }, async (dienst) => {
      await assertZeilen(dienst, JEDE_ZEILE);
      assertOhneAdresse(dienst, [adresse, adresse.trim(), MELDE_TOKEN, FREMDER_HOST]);
    });
  }
});

test("[NIE2] eine leere Adresse und eine aus lauter Leerzeichen schalten den Takt aus", async () => {
  for (const adresse of ["", "   "]) {
    await mitLebenszeichenDienst({ HERZSCHLAG_URL: adresse, ...SCHNELLER_TAKT }, async (dienst) => {
      await echtWarten(STILLE_MS);
      assert.equal(
        lebenszeichenZeilen(dienst).length,
        0,
        "Lebenszeichen: Meldeversuch ohne Adresse",
      );
    });
  }
});

test("[NIE3] bei Antwort 500 läuft der Dienst unverändert weiter", async () => {
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_FEHLER), umgebung: SCHNELLER_TAKT },
    async (dienst) => {
      await assertZeilen(dienst, "HTTP 500", 2);
      await assertDienstUnberuehrt(dienst);
    },
  );
});

test("[NIE3] bei einer ungültigen Adresse läuft der Dienst unverändert weiter", async () => {
  await mitLebenszeichenDienst(
    { HERZSCHLAG_URL: IN_ANFUEHRUNGSZEICHEN, ...SCHNELLER_TAKT },
    async (dienst) => {
      await assertZeilen(dienst, JEDE_ZEILE, 2);
      await assertDienstUnberuehrt(dienst);
    },
  );
});

test("[NIE4] eine nie beantwortete Meldung hält den nächsten Takt nicht auf", async () => {
  await mitEmpfaenger(antwortetNie, async (empfaenger) => {
    const umgebung = {
      HERZSCHLAG_URL: empfaenger.adresse,
      HERZSCHLAG_FRIST_MS: LANGE_FRIST_MS,
      ...SCHNELLER_TAKT,
    };
    await mitLebenszeichenDienst(umgebung, async () => {
      const weitere = await wirdWahr(() => empfaenger.meldungen.length >= 3);
      assert.equal(weitere, true, "Lebenszeichen: der Takt wartet auf die offene Meldung");
      assert.equal(
        empfaenger.verbindungen.abgebrochen,
        0,
        "Lebenszeichen: die erste Meldung ist nicht mehr offen",
      );
    });
  });
});

test("[NIE5] mit dem Standardtakt geht beim Start keine Meldung hinaus, mit kurzem Takt an dieselbe Adresse schon", async () => {
  await mitEmpfaenger(antwortetMit(HTTP_OK), async (empfaenger) => {
    const adresse = { HERZSCHLAG_URL: empfaenger.adresse };
    await mitLebenszeichenDienst(adresse, async (dienst) => {
      await echtWarten(NACHLAUF_MS);
      assert.equal(empfaenger.meldungen.length, 0, "Lebenszeichen: Meldung beim Start");
      assert.equal(lebenszeichenZeilen(dienst).length, 0, "Lebenszeichen: Meldeversuch beim Start");
    });
    await mitLebenszeichenDienst({ ...adresse, ...SCHNELLER_TAKT }, async () => {
      const gemeldet = await wirdWahr(() => empfaenger.meldungen.length >= 1);
      assert.equal(gemeldet, true, STILLE_OHNE_BELEG);
    });
  });
});

test("[NIE5] die erste Meldung kommt nach einem vollen Takt", async () => {
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_OK), umgebung: { HERZSCHLAG_TAKT_MS: String(ERSTER_TAKT_MS) } },
    async (_dienst, empfaenger) => {
      const dienstBereitMs = performance.now();
      const gemeldet = await wirdWahr(() => empfaenger.meldungen.length >= 1);
      assert.equal(gemeldet, true, "Lebenszeichen: nach einem vollen Takt kam keine erste Meldung");
      const abstand = empfaenger.meldungen[0].zeitMs - dienstBereitMs;
      assert.ok(abstand >= ERSTER_TAKT_MINDESTABSTAND_MS, `Erste Meldung schon nach ${abstand} ms`);
    },
  );
});
