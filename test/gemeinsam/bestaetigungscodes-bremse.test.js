import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveConfirmationKey, windowIndexFor } from "../../src/call-confirmation.js";
import { startServer } from "../helpers.js";
import { mitVerbindung } from "./echtes-postgres.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { anfrage, beenden, zweiProzesse } from "./zwei-prozesse.js";

const ERWARTETER_FEHLER =
  "Mandant nach 10 auf zwei Prozesse verteilten Fehlversuchen nicht gesperrt";
const GEHEIMNIS = "bestaetigungscodes-bremse-secret-mind-32-zeichen";
const UMGEBUNG = { CALL_CONFIRMATION_SECRET: GEHEIMNIS };
const ZIEL = "+4915112345678";
const PFAD = "/api/call-confirmations";
const KOPF_MANDANT = "x-internal-tenant";
const HTTP_OK = 200;
const ZEITGRENZE_MS = 120_000;
const BEREITS_VERBRAUCHT = "already_used";
const GESPERRT = { confirmed: false, reason: undefined };
const VERBRAUCHT = { confirmed: false, reason: BEREITS_VERBRAUCHT };

const GRENZE = 10;
const HAELFTE = 5;
const UEBER_DIE_HAELFTE = 6;
const FENSTER_MS = 300_000;
const LEERE_CODES = ["", "   ", "-"];
const ABGELAUFEN_MS = 1;
const NOCH_GUELTIG_MS = Date.parse("2099-01-01T00:00:00.000Z");
const FENSTER_ABGELAUFEN = 1;
const FENSTER_GUELTIG = 2;

const MANDANT = "mandant-bremse-a";
const ANDERER = "mandant-bremse-b";
const ERSATZ = "mandant-bremse-c";
const ERSATZ_ANDERER = "mandant-bremse-d";
const MANDANTEN_JE_VERSUCH = [
  [MANDANT, ANDERER],
  [ERSATZ, ERSATZ_ANDERER],
];
const BOOTSTRAP_MANDANT = undefined;

const REGISTER_SPALTEN = {
  bestaetigung_verbrauch: ["tenant_id text", "digest text", "expires_at bigint"],
  bestaetigung_slot: ["tenant_id text", "digest text", "slot bigint", "expires_at bigint"],
  bestaetigung_fehlversuch: [
    "tenant_id text",
    "window_idx bigint",
    "count bigint",
    "expires_at bigint",
  ],
};

function anfrageMit(objective) {
  return { to: ZIEL, objective };
}

function orte({ a, b }, mandant) {
  return [
    { prozess: a, mandant },
    { prozess: b, mandant },
  ];
}

async function senden({ prozess, mandant }, koerper) {
  const kopfzeilen = mandant ? { [KOPF_MANDANT]: mandant } : {};
  const antwort = await anfrage(prozess, PFAD, { methode: "POST", koerper, kopfzeilen });
  assert.equal(antwort.status, HTTP_OK);
  return antwort.json();
}

async function codeHolen(ort, inhalt) {
  const { confirmation } = await senden(ort, inhalt);
  return confirmation.code;
}

function einloesen(ort, inhalt, code) {
  return senden(ort, { ...inhalt, confirmation_code: code });
}

async function ausstellenUndEinloesen(ort, inhalt) {
  return einloesen(ort, inhalt, await codeHolen(ort, inhalt));
}

function ablehnung({ confirmed, reason }) {
  return { confirmed, reason };
}

function codeEinesAnderenAuftrags(ort, inhalt) {
  return codeHolen(ort, { ...inhalt, objective: `${inhalt.objective}, anderer Auftrag` });
}

function mal(ort, anzahl) {
  return Array.from({ length: anzahl }, () => ort);
}

async function fehlversuche(ziele, inhalt) {
  const falsch = await codeEinesAnderenAuftrags(ziele[0], inhalt);
  for (const ort of ziele) await einloesen(ort, inhalt, falsch);
  return falsch;
}

async function gleichzeitigeFehlversuche(ziele, inhalt) {
  const falsch = await codeEinesAnderenAuftrags(ziele[0], inhalt);
  await Promise.all(ziele.map((ort) => einloesen(ort, inhalt, falsch)));
}

async function imSelbenFenster(arbeit) {
  const fenster = windowIndexFor(Date.now());
  const ergebnis = await arbeit(0);
  return windowIndexFor(Date.now()) === fenster ? ergebnis : arbeit(1);
}

async function sitzungAuf(t, adresse, { a, b }) {
  await mitVerbindung(adresse, (verbindung) =>
    verbindung.query("INSERT INTO tenant (id) SELECT unnest($1::text[])", [
      MANDANTEN_JE_VERSUCH.flat(),
    ]),
  );
  return { t, adresse, a, b, alleProzesse: [a, b] };
}

async function mitSitzung(t, arbeit) {
  const prozesse = await zweiProzesse(t, UMGEBUNG);
  if (prozesse) await arbeit(await sitzungAuf(t, prozesse.db.adresse, prozesse));
}

async function mitSitzungUnterRolle(t, arbeit) {
  const rolle = await echteDatenbankMitRolle(t);
  if (!rolle) return;
  const prozesse = await zweiProzesse(t, { ...UMGEBUNG, DATABASE_URL: rolle.adresse });
  await arbeit(await sitzungAuf(t, rolle.adresse, prozesse));
}

async function neustarten(sitzung) {
  await beenden(sitzung.a);
  await beenden(sitzung.b);
  const { a, b } = await zweiProzesse(sitzung.t, { ...UMGEBUNG, DATABASE_URL: sitzung.adresse });
  Object.assign(sitzung, { a, b });
  sitzung.alleProzesse.push(a, b);
}

function zaehlerImFenster(adresse, fenster) {
  return mitVerbindung(adresse, async (verbindung) => {
    const { rows } = await verbindung.query(
      "SELECT count::int AS zaehler FROM bestaetigung_fehlversuch WHERE window_idx = $1",
      [fenster],
    );
    return rows.map(({ zaehler }) => zaehler);
  });
}

function fehlversuchsZeilen(verbindung) {
  return verbindung
    .query("SELECT tenant_id, count::int AS zaehler FROM bestaetigung_fehlversuch")
    .then(({ rows }) => rows);
}

function zeilenAlsMandant(adresse, mandant) {
  return mitVerbindung(adresse, async (verbindung) => {
    await verbindung.query("BEGIN");
    try {
      await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [mandant]);
      return await fehlversuchsZeilen(verbindung);
    } finally {
      await verbindung.query("ROLLBACK");
    }
  });
}

function fensterwechselNachstellen(adresse, mandant) {
  return mitVerbindung(adresse, (verbindung) =>
    verbindung.query(
      `UPDATE bestaetigung_fehlversuch
          SET window_idx = window_idx - 1, expires_at = expires_at - $1
        WHERE tenant_id = $2`,
      [FENSTER_MS, mandant],
    ),
  );
}

function fehlversuchsRegisterBefuellen(verbindung) {
  return verbindung.query(
    `INSERT INTO bestaetigung_fehlversuch (tenant_id, window_idx, count, expires_at)
     VALUES ($1, $3, 1, $5), ($1, $4, 1, $6), ($2, $3, 1, $5)`,
    [MANDANT, ANDERER, FENSTER_ABGELAUFEN, FENSTER_GUELTIG, ABGELAUFEN_MS, NOCH_GUELTIG_MS],
  );
}

function fehlversuchsFensterJeMandant(verbindung) {
  return verbindung
    .query(
      `SELECT tenant_id, window_idx::int AS fenster
         FROM bestaetigung_fehlversuch
        ORDER BY tenant_id, window_idx`,
    )
    .then(({ rows }) => rows);
}

async function verteilteSperrePruefen(sitzung, { mandant, anderer }) {
  const stand = await imSelbenFenster(async () => {
    const inhalt = anfrageMit("Verteilte Fehlversuche");
    const [anA, anB] = orte(sitzung, mandant);
    const richtig = await codeHolen(anA, inhalt);
    await fehlversuche([...mal(anA, HAELFTE), ...mal(anB, HAELFTE)], inhalt);
    const gesperrtAnA = await einloesen(anA, inhalt, richtig);
    const gesperrtAnB = await einloesen(anB, inhalt, richtig);
    const [, fremdAnB] = orte(sitzung, anderer);
    const fremd = await ausstellenUndEinloesen(fremdAnB, anfrageMit("Anderer Mandant"));
    return { gesperrtAnA, gesperrtAnB, fremd };
  });
  assert.equal(stand.gesperrtAnA.confirmed, false, ERWARTETER_FEHLER);
  assert.equal(stand.gesperrtAnB.confirmed, false, ERWARTETER_FEHLER);
  assert.deepEqual(ablehnung(stand.gesperrtAnA), GESPERRT, "Sperre an A ist kein already_used");
  assert.deepEqual(ablehnung(stand.gesperrtAnB), GESPERRT, "Sperre an B ist kein already_used");
  assert.equal(stand.fremd.confirmed, true, "ein anderer Mandant bleibt ungesperrt");
}

async function neustartLauf(sitzung, mandant) {
  const verbrauchsInhalt = anfrageMit("Verbrauch vor dem Neustart");
  const sperrInhalt = anfrageMit("Sperre vor dem Neustart");
  const [anA] = orte(sitzung, mandant);
  const verbraucht = await codeHolen(anA, verbrauchsInhalt);
  const eingeloest = await einloesen(anA, verbrauchsInhalt, verbraucht);
  const richtig = await codeHolen(anA, sperrInhalt);
  const falsch = await fehlversuche(mal(anA, GRENZE), sperrInhalt);
  const gesperrtVorher = await einloesen(anA, sperrInhalt, richtig);
  await neustarten(sitzung);
  const neu = orte(sitzung, mandant);
  return {
    eingeloest,
    gesperrtVorher,
    verbrauchtNachher: await Promise.all(
      neu.map((ort) => einloesen(ort, verbrauchsInhalt, verbraucht)),
    ),
    gesperrtNachher: await Promise.all(neu.map((ort) => einloesen(ort, sperrInhalt, richtig))),
    codes: [verbraucht, richtig, falsch],
  };
}

async function neustartPruefen(sitzung, ersterMandant) {
  const stand = await imSelbenFenster((versuch) =>
    neustartLauf(sitzung, versuch === 0 ? ersterMandant : ERSATZ),
  );
  assert.equal(stand.eingeloest.confirmed, true, "das Einlösen vor dem Neustart gilt");
  assert.deepEqual(ablehnung(stand.gesperrtVorher), GESPERRT, "gesperrt vor dem Neustart");
  for (const antwort of stand.verbrauchtNachher) {
    assert.deepEqual(
      ablehnung(antwort),
      VERBRAUCHT,
      "der Code bleibt nach dem Neustart verbraucht",
    );
  }
  for (const antwort of stand.gesperrtNachher) {
    assert.deepEqual(ablehnung(antwort), GESPERRT, "Mandant nach dem Neustart nicht mehr gesperrt");
  }
  return stand;
}

async function grenzeProben(anA, anB) {
  const offen = anfrageMit("Bremse noch offen");
  const codeOffen = await codeHolen(anA, offen);
  await fehlversuche([...mal(anA, HAELFTE), ...mal(anB, HAELFTE - 1)], offen);
  const nachNeun = await einloesen(anB, offen, codeOffen);
  const zu = anfrageMit("Bremse beim zehnten");
  const codeZu = await codeHolen(anA, zu);
  await fehlversuche([anB], zu);
  return { nachNeun, nachZehn: await einloesen(anA, zu, codeZu) };
}

function grenzeStimmt({ nachNeun, nachZehn }, wann) {
  assert.equal(nachNeun.confirmed, true, `${wann}: nach 9 Fehlversuchen ist die Bremse offen`);
  assert.deepEqual(ablehnung(nachZehn), GESPERRT, `${wann}: der 10. sperrt den richtigen Code`);
}

function registerInhalt(adresse) {
  return mitVerbindung(adresse, async (verbindung) => {
    const inhalte = [];
    for (const tabelle of Object.keys(REGISTER_SPALTEN)) {
      const { rows } = await verbindung.query(`SELECT t::text AS zeile FROM "${tabelle}" t`);
      inhalte.push(...rows.map(({ zeile }) => zeile));
    }
    return inhalte;
  });
}

function spaltenDerRegister(adresse) {
  return mitVerbindung(adresse, async (verbindung) => {
    const { rows } = await verbindung.query(
      `SELECT table_name, column_name || ' ' || data_type AS spalte
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [Object.keys(REGISTER_SPALTEN)],
    );
    return rows.map(({ table_name, spalte }) => `${table_name} ${spalte}`);
  });
}

test(
  "S5: 10 auf A und B verteilte Fehlversuche sperren den Mandanten auch für den richtigen Code, ein anderer Mandant bleibt frei",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, (sitzung) =>
      verteilteSperrePruefen(sitzung, { mandant: BOOTSTRAP_MANDANT, anderer: ANDERER }),
    ),
);

test(
  "S6: 20 gleichzeitige Fehlversuche an A und B sperren an beiden Prozessen und zählen genau bis zur Grenze",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      const stand = await imSelbenFenster(async () => {
        const fenster = windowIndexFor(Date.now());
        const inhalt = anfrageMit("Gleichzeitige Fehlversuche");
        const [anA, anB] = orte(sitzung);
        const richtig = await codeHolen(anA, inhalt);
        await gleichzeitigeFehlversuche([...mal(anA, GRENZE), ...mal(anB, GRENZE)], inhalt);
        return {
          gesperrtAnA: await einloesen(anA, inhalt, richtig),
          gesperrtAnB: await einloesen(anB, inhalt, richtig),
          zaehler: await zaehlerImFenster(sitzung.adresse, fenster),
        };
      });
      assert.deepEqual(ablehnung(stand.gesperrtAnA), GESPERRT, "der richtige Code an A");
      assert.deepEqual(ablehnung(stand.gesperrtAnB), GESPERRT, "der richtige Code an B");
      assert.deepEqual(
        stand.zaehler,
        [GRENZE],
        "20 gleichzeitige Fehlversuche bringen den gemeinsamen Zähler auf genau 10",
      );
    }),
);

test(
  "S7: nach einem Neustart aller Prozesse auf derselben Datenbank bleibt der Code already_used und der Mandant gesperrt",
  { timeout: ZEITGRENZE_MS },
  (t) => mitSitzung(t, (sitzung) => neustartPruefen(sitzung, BOOTSTRAP_MANDANT)),
);

test(
  "S8: verteilte Fehlversuche sperren auch einen Mandanten, der nicht der Bootstrap-Mandant ist, unter NOBYPASSRLS",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzungUnterRolle(t, (sitzung) =>
      verteilteSperrePruefen(sitzung, { mandant: MANDANT, anderer: ANDERER }),
    ),
);

test(
  "S8: Verbrauch und Sperre eines Mandanten, der nicht der Bootstrap-Mandant ist, überstehen unter NOBYPASSRLS den Neustart",
  { timeout: ZEITGRENZE_MS },
  (t) => mitSitzungUnterRolle(t, (sitzung) => neustartPruefen(sitzung, MANDANT)),
);

test(
  "Jede Anfrage eines Mandanten löscht seine abgelaufenen Fehlversuchs-Zeilen und lässt gültige und fremde stehen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await mitVerbindung(sitzung.adresse, fehlversuchsRegisterBefuellen);
      const [anA] = orte(sitzung, MANDANT);
      await codeHolen(anA, anfrageMit("Aufräumen der Fehlversuche"));
      assert.deepEqual(await mitVerbindung(sitzung.adresse, fehlversuchsFensterJeMandant), [
        { tenant_id: MANDANT, fenster: FENSTER_GUELTIG },
        { tenant_id: ANDERER, fenster: FENSTER_ABGELAUFEN },
      ]);
    }),
);

test(
  "[NIE1] Über der Grenze bleibt der Zähler bei 10 und der richtige Code gesperrt, bei Prozesswechsel, Gleichzeitigkeit und Neustart",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      const stand = await imSelbenFenster(async () => {
        const fenster = windowIndexFor(Date.now());
        const inhalt = anfrageMit("Über der Grenze");
        const [anA, anB] = orte(sitzung);
        const richtig = await codeHolen(anA, inhalt);
        await fehlversuche(mal(anA, UEBER_DIE_HAELFTE), inhalt);
        await gleichzeitigeFehlversuche(mal(anB, UEBER_DIE_HAELFTE), inhalt);
        const vorNeustart = await einloesen(anB, inhalt, richtig);
        await neustarten(sitzung);
        const [neuA, neuB] = orte(sitzung);
        await gleichzeitigeFehlversuche([...mal(neuA, GRENZE), ...mal(neuB, GRENZE)], inhalt);
        return {
          vorNeustart,
          nachNeustartAnA: await einloesen(neuA, inhalt, richtig),
          nachNeustartAnB: await einloesen(neuB, inhalt, richtig),
          zaehler: await zaehlerImFenster(sitzung.adresse, fenster),
        };
      });
      assert.deepEqual(ablehnung(stand.vorNeustart), GESPERRT, "gesperrt nach 12 Fehlversuchen");
      assert.deepEqual(ablehnung(stand.nachNeustartAnA), GESPERRT, "gesperrt am neuen Prozess A");
      assert.deepEqual(ablehnung(stand.nachNeustartAnB), GESPERRT, "gesperrt am neuen Prozess B");
      assert.deepEqual(stand.zaehler, [GRENZE], "gesperrte Versuche zählen nicht weiter");
    }),
);

test(
  "[NIE2] Nach 9 Fehlversuchen ist die Bremse offen, der 10. sperrt, und im neuen Fenster beginnt sie bei null",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      const stand = await imSelbenFenster(async (versuch) => {
        const [mandant] = MANDANTEN_JE_VERSUCH[versuch];
        const [anA, anB] = orte(sitzung, mandant);
        const imFenster = await grenzeProben(anA, anB);
        await fensterwechselNachstellen(sitzung.adresse, mandant);
        return { imFenster, imNeuenFenster: await grenzeProben(anA, anB) };
      });
      grenzeStimmt(stand.imFenster, "im Fenster");
      grenzeStimmt(stand.imNeuenFenster, "im neuen Fenster");
    }),
);

test(
  "[NIE2] Leere Codes zählen nicht als Fehlversuch, auch nicht über die Grenze hinaus",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      const inhalt = anfrageMit("Leere Codes");
      const [anA, anB] = orte(sitzung);
      const richtig = await codeHolen(anA, inhalt);
      for (const leer of LEERE_CODES) {
        for (const ort of [...mal(anA, GRENZE), ...mal(anB, GRENZE)]) {
          const antwort = await einloesen(ort, inhalt, leer);
          assert.deepEqual(ablehnung(antwort), GESPERRT, "ein leerer Code bestätigt nie");
        }
      }
      const danach = await einloesen(anA, inhalt, richtig);
      assert.equal(danach.confirmed, true, "leere Codes dürfen den Mandanten nicht sperren");
    }),
);

test(
  "[NIE3] Die Fehlversuche eines Mandanten zählen unter NOBYPASSRLS nur für ihn",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzungUnterRolle(t, async (sitzung) => {
      const stand = await imSelbenFenster(async (versuch) => {
        const [mandant, anderer] = MANDANTEN_JE_VERSUCH[versuch];
        const [anA, anB] = orte(sitzung, mandant);
        const [fremdAnA, fremdAnB] = orte(sitzung, anderer);
        const grenzeEigen = await grenzeProben(anA, anB);
        const inhalt = anfrageMit("Anderer Mandant bis kurz vor die Grenze");
        const fremdCode = await codeHolen(fremdAnA, inhalt);
        await fehlversuche([...mal(fremdAnA, HAELFTE), ...mal(fremdAnB, HAELFTE - 1)], inhalt);
        return {
          mandant,
          anderer,
          grenzeEigen,
          fremdNachNeun: await einloesen(fremdAnB, inhalt, fremdCode),
          eigeneZeilen: await zeilenAlsMandant(sitzung.adresse, mandant),
          fremdeZeilen: await zeilenAlsMandant(sitzung.adresse, anderer),
          ohneMandant: await mitVerbindung(sitzung.adresse, fehlversuchsZeilen),
        };
      });
      grenzeStimmt(stand.grenzeEigen, "eigener Mandant");
      assert.equal(stand.fremdNachNeun.confirmed, true, "die Sperre trifft den anderen nicht");
      assert.deepEqual(stand.eigeneZeilen, [{ tenant_id: stand.mandant, zaehler: GRENZE }]);
      assert.deepEqual(stand.fremdeZeilen, [{ tenant_id: stand.anderer, zaehler: GRENZE - 1 }]);
      assert.deepEqual(stand.ohneMandant, [], "ohne gesetzten Mandanten ist keine Zeile sichtbar");
    }),
);

test(
  "[NIE4] Verbrauch und Sperre überstehen den Neustart, und kein Klartext-Code, Secret oder Schlüssel steht in Datenbank oder Log",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      const { codes } = await neustartPruefen(sitzung, MANDANT);
      const inhalte = await registerInhalt(sitzung.adresse);
      assert.ok(inhalte.length > 0, "der Lauf hinterlässt Zeilen in den Registern");
      const schluessel = deriveConfirmationKey(GEHEIMNIS);
      const tabu = [...codes, GEHEIMNIS, schluessel.toString("hex"), schluessel.toString("base64")];
      const stellen = {
        Datenbank: inhalte.join("\n"),
        Log: sitzung.alleProzesse.map((prozess) => prozess.stdout).join("\n"),
      };
      for (const [stelle, text] of Object.entries(stellen)) {
        const treffer = tabu.filter((wert) => text.includes(wert));
        assert.equal(treffer.length, 0, `${stelle} enthält ${treffer.length} geschützte Werte`);
      }
    }),
);

test(
  "[NIE5] Die Spalten der drei Register aus der Migration bleiben bestehen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      const vorhanden = await spaltenDerRegister(sitzung.adresse);
      const erwartet = Object.entries(REGISTER_SPALTEN).flatMap(([tabelle, spalten]) =>
        spalten.map((spalte) => `${tabelle} ${spalte}`),
      );
      assert.deepEqual(
        erwartet.filter((spalte) => !vorhanden.includes(spalte)),
        [],
        "die Migration hat eine Spalte gelöscht, umbenannt oder verändert",
      );
    }),
);

test(
  "[NIE5] Ohne Postgres bleibt die Bremse wie bisher im Speicher des Prozesses",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const prozess = await startServer({ env: UMGEBUNG });
    t.after(() => prozess.stop());
    const stand = await imSelbenFenster(async (versuch) => {
      const [mandant] = MANDANTEN_JE_VERSUCH[versuch];
      const ort = { prozess, mandant };
      return grenzeProben(ort, ort);
    });
    grenzeStimmt(stand, "im Speicher");
  },
);
