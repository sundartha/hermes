import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  ACCEPTED_WINDOWS,
  CONFIRMATION_CODE_LENGTH,
  CONFIRMATION_SECRET_MIN_LENGTH,
  CONFIRMATION_WINDOW_MS,
  DERIVATION_VERSION,
  MAX_FAILED_CONFIRMATIONS_PER_WINDOW,
  acceptanceEndMs,
  canonicalCallRequest,
  deriveConfirmationKey,
  issueConfirmationCode,
  slotDigest,
  usedCodeDigest,
  verifyConfirmationCode,
  windowIndexFor,
} from "../../src/call-confirmation.js";
import { ANTWORTFRIST_MS } from "./antwortfrist.mjs";
import { echteDatenbank, mitVerbindung } from "./echtes-postgres.js";
import { mitGestartetemHermes } from "./pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { anfrage, beenden, zweiProzesse } from "./zwei-prozesse.js";

const ERWARTETER_FEHLER =
  "Code an Prozess B als bestätigt angenommen, obwohl Prozess A ihn schon verbraucht hat";
const GEGENRICHTUNG_FEHLER =
  "Code an Prozess A als bestätigt angenommen, obwohl Prozess B ihn schon verbraucht hat";
const GEHEIMNIS = "bestaetigungscodes-einmal-secret-mind-32-zeichen";
const UMGEBUNG = { CALL_CONFIRMATION_SECRET: GEHEIMNIS };
const ZIEL = "+4915112345678";
const BEREITS_VERBRAUCHT = "already_used";
const HTTP_OK = 200;
const ZEITGRENZE_MS = 120_000;
const MANDANT = "mandant-einmal-a";
const ANDERER_MANDANT = "mandant-einmal-b";
const GLEICHZEITIGE_RUNDEN = 5;
const ANFRAGEN_JE_PROZESS = 2;
const RLS_FEHLER = /row-level security|policy/i;
const DEPLOY_TOKEN = "bestaetigungscodes-einmal-deploy-token-mind-32";
const VERSION_DER_MIGRATION = 3;
const ABDRUCK_LAENGE = 6;
const VORGAENGER_SCHEMA = {
  account: "020fca 2c6758 3ffb9e 450c39 8ad82e 9fbfd2 b27dfb e10a1e eb6c63 f722a0",
  action_item:
    "0dd9e1 28b23b 41fa6f 5ba163 661bcc 6e47a9 7441dc 935dde 9c3f29 b52a8c b7551b e10a1e e1a15a",
  audit_log: "14d283 4d1ea2 4e99ab 673f95 739438 97f0bb 9fbfd2 b32077 fe11b6",
  calendar_event: "0dd9e1 2229a2 41fa6f 5c146c 6e6748 79515f 953ccc a1ed3f e10a1e e1a15a e843cd",
  call: "0066eb 042eb8 05dd64 0722c1 08231b 0dd9e1 0e9202 151fdd 241e36 24f2e6 2f2256 3790b1 3a801c 3e662d 3fbdd7 400886 4123d9 41fa6f 4eccc1 4f21fa 500673 51676f 521180 54c4c6 54f041 571c89 57fe66 581b66 5be505 5ffdd8 603f06 67133d 6aaed1 6d6359 71a51f 726985 752997 776ced 7d5a21 7eab54 8133e8 9394e1 990a14 99f402 9dae5a 9e8fc2 a59f27 a742cc a843cc ab8268 aec79b aee466 b21721 b6d3de bb84b8 bc4fca bce573 c6e433 cfe8cf d1c379 d9ab41 d9d09f dbe247 e10a1e e1a15a e62e58 e8e476 eac4d8 eca74f eeab51 f781fd f90c18 faff9f fb152f",
  call_cost_evidence:
    "0101cf 0d121e 0dd9e1 267b04 41fa6f 44ddbe 487c6f 5b925a 8211e5 98a9be a24f8a a32bc4 bdf741 be5143 d7e35e db442a e10a1e e1a15a f4e583 ff5596",
  cookie_consent_log:
    "03f3ba 1049a1 4d2ae8 501292 615055 673f95 9fbfd2 b500ed bbd76c cd4eb8 e6f36a effc60",
  cost_cross_check: "41fa6f 46a9bf 8112d7 831b46 878a53 d11758 efb71f",
  notification:
    "0dd9e1 41fa6f 564263 707dbf 9ddd52 b7551b cde4ec ce40da de72d3 e10a1e e1a15a e843cd",
  number:
    "04d405 06a77e 0dd9e1 2e59a4 3a801c 3a8bcf 41fa6f 4ce78f 697210 7552ab 8350d0 961d95 999f1b a0edc8 a234ee d5d3ac dc96f4 df39e7 e10a1e e1a15a e9f7d1 eb6c63",
  number_assignment: "006578 0dd9e1 1e2d8d 41fa6f 5fe9ca 6b70e1 6ccbcd b66c3d dc83b8 e10a1e e1a15a",
  number_platform_binding_guard: "278bb3",
  outage_alert:
    "41fa6f 51a8fc 53d608 569e93 5fbcba 77f54a 80cb3e 896707 8a3df1 b46abe d18303 d4e550 e1a15a",
  platform_anrufpause: "3e7cc9 41fa6f 72093a 831b46 980bf8 99c253 d11c27",
  platform_number_use:
    "22aa44 36f2e5 41fa6f 4e99ab 789b58 8523dc 87171f a879da ab025e ae8be9 baac98 df39e7 e1a15a fc67df",
  platform_tts_usage: "2f8463 3bbdc8 41fa6f 6dd333 831b46 908523 9167da c317c1 f8483c",
  profile: "366c83 3817b1 41fa6f 4e41ec 9fb702 e10a1e",
  provisioning_job:
    "0dd9e1 0f939e 18e7b8 223572 23b832 38e048 41fa6f 4ac72a 6ccbcd 873cdd 99f402 e10a1e e1a15a e97889 eb6c63",
  schema_migrations: "046753 27b992 429515 506d69 9fbfd2 be562e",
  session: "29c89b 327b08 39f25d 424d96 6ae934 9fbfd2 e10a1e e1a15a e4edf1 e91751 eb6c63 f722a0",
  settings:
    "0dd9e1 12a429 1a0d1f 21d384 22fa2d 2718e9 282fa3 3559a2 40d8be 41fa6f 68a6e1 697210 6d299a 8575ec 901846 bf44b3 e10a1e e423aa",
  tenant:
    "066ba9 0a39dd 11faa4 205b55 2540c6 2c1c1b 2d1af6 33df60 34ee87 4b4e3d 50ba05 68e2ec 7fa251 808476 8f6839 94d448 979d0d 986b4f 9fbfd2 a51977 af26a2 b1b575 b37b5c b8361b bbc1af bea3f6 d2ebd0 d6efb3 ddf0b0 de6365 e1a15a e34ebf e44ba6 e9f7d1 eb6c63 ece9c5 f78ca3 f96933",
  tenant_budget: "0dd9e1 1f0218 41fa6f a2aea1 a6a11c cdd4c5 cf32f3 e10a1e eb6c63",
  transcript_segment:
    "0dd9e1 19b37b 3c5e3b 41fa6f 5b925a b52a8c b6a09e cc2726 ce40da da135d e10a1e f71242",
  usage:
    "007724 07b9b6 0dd9e1 101566 288ef4 300933 41fa6f 858230 aba1b6 be8934 d9ac76 dbf92a e10a1e e85b18 ee03aa ff9e14",
  usage_event:
    "0dd9e1 1d0732 2d9bfc 41fa6f 48962c 4ac72a 8142de 891dc0 a43d54 b7551b c748c8 d40d06 e10a1e e1a15a ed6dbf",
};

const FESTE_STARTZEIT = Date.parse("2026-01-15T12:02:00.000Z");
const FESTES_FENSTERENDE = Date.parse("2026-01-15T12:05:00.000Z");
const FESTES_ANNAHMEENDE = Date.parse("2026-01-15T12:10:00.000Z");
const FESTER_MANDANT = "mandant-fest";
const FESTE_ANFRAGE = { to: ZIEL, objective: "Rueckruf vereinbaren" };
const codeSlot0 = "F2YKAA";
const codeSlot1 = "4NT7M6";
const digestVerbrauch = "64fd9a415696c201f20dc3bb7eddda59505be06bb7413c3e78397cebb76d9e38";
const digestSlot = "4aec4ca9c0bdb3b11b15064ce7fc6b15f4bb4ca5cb252d99e92fe0c4ce053946";

const ABGELAUFEN_MS = 1;
const NOCH_GUELTIG_MS = Date.parse("2099-01-01T00:00:00.000Z");
const REGISTER_MIT_ABLAUF = ["bestaetigung_verbrauch", "bestaetigung_slot"];
const WARTENDE_ABFRAGEN = `SELECT count(*)::int AS wartend FROM pg_stat_activity
  WHERE datname = current_database() AND wait_event_type = 'Lock'`;

const SCHEMA_KATALOG = `
  SELECT 'spalte' AS art, table_name AS name,
         column_name || ' ' || data_type || ' ' || is_nullable || ' ' || COALESCE(column_default, '') AS definition
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'regel', conrelid::regclass::text, conname || ' ' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'index', tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'policy', tablename, policyname || ' ' || COALESCE(qual, '') || ' ' || COALESCE(with_check, '')
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT 'rls', relname, relrowsecurity::text || ' ' || relforcerowsecurity::text
    FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  UNION ALL
  SELECT 'trigger', tgrelid::regclass::text, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL
  SELECT 'funktion', proname, pg_get_functiondef(oid)
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prokind = 'f'`;

function alsMandantAm(prozess, mandant) {
  return { localUrl: prozess.localUrl, kopfzeilen: { "x-internal-tenant": mandant } };
}

function anfrageMit(objective) {
  return { to: ZIEL, objective };
}

async function bestaetigungAnProzess(prozess, inhalt) {
  const antwort = await anfrage(prozess, "/api/call-confirmations", {
    methode: "POST",
    koerper: inhalt,
    kopfzeilen: prozess.kopfzeilen,
  });
  assert.equal(antwort.status, HTTP_OK);
  return antwort.json();
}

async function codeAusstellen(prozess, inhalt) {
  const { confirmation } = await bestaetigungAnProzess(prozess, inhalt);
  return confirmation.code;
}

function einloesen(prozess, inhalt, code) {
  return bestaetigungAnProzess(prozess, { ...inhalt, confirmation_code: code });
}

function ablehnung({ confirmed, reason }) {
  return { confirmed, reason };
}

function falscherCode(richtigerCode) {
  const [erstes, ...rest] = richtigerCode;
  return `${erstes === "0" ? "1" : "0"}${rest.join("")}`;
}

function fehlversuche(prozess, inhalt, { richtigerCode, anzahl }) {
  const falsch = falscherCode(richtigerCode);
  return Promise.all(Array.from({ length: anzahl }, () => einloesen(prozess, inhalt, falsch)));
}

function bremseAmProzessAusloesen(prozess, inhalt, richtigerCode) {
  const anzahl = MAX_FAILED_CONFIRMATIONS_PER_WINDOW;
  return fehlversuche(prozess, inhalt, { richtigerCode, anzahl });
}

async function sperrenAmErstenProzess({ a, b }, objective) {
  const inhalt = anfrageMit(objective);
  const richtigerCode = await codeAusstellen(a, inhalt);
  await bremseAmProzessAusloesen(a, inhalt, richtigerCode);
  const anA = await einloesen(a, inhalt, richtigerCode);
  const anB = await einloesen(b, inhalt, richtigerCode);
  return { anA, anB };
}

async function imSelbenFenster(arbeit) {
  const fenster = windowIndexFor(Date.now());
  const ergebnis = await arbeit();
  return windowIndexFor(Date.now()) === fenster ? ergebnis : arbeit();
}

async function mitZweiProzessen(t, arbeit) {
  const prozesse = await zweiProzesse(t, UMGEBUNG);
  if (prozesse) await arbeit(prozesse);
}

function mandantenAnlegen(adresse, mandanten) {
  return mitVerbindung(adresse, (verbindung) =>
    verbindung.query("INSERT INTO tenant (id) SELECT unnest($1::text[])", [mandanten]),
  );
}

async function mitProzessenUnterRolle(t, arbeit) {
  const rolle = await echteDatenbankMitRolle(t);
  if (!rolle) return;
  const prozesse = await zweiProzesse(t, { ...UMGEBUNG, DATABASE_URL: rolle.adresse });
  await mandantenAnlegen(rolle.adresse, [MANDANT, ANDERER_MANDANT]);
  await arbeit({ ...prozesse, rolle });
}

async function codeGiltNurEinmal({ a, b }) {
  const richtungen = [
    { erster: a, zweiter: b, objective: "Einmal A dann B", fehler: ERWARTETER_FEHLER },
    { erster: b, zweiter: a, objective: "Einmal B dann A", fehler: GEGENRICHTUNG_FEHLER },
  ];
  for (const { erster, zweiter, objective, fehler } of richtungen) {
    const inhalt = anfrageMit(objective);
    const code = await codeAusstellen(a, inhalt);
    const zuerst = await einloesen(erster, inhalt, code);
    assert.equal(zuerst.confirmed, true, `${objective}: das erste Einlösen muss gelten`);
    const danach = await einloesen(zweiter, inhalt, code);
    assert.equal(danach.confirmed, false, fehler);
    assert.equal(danach.reason, BEREITS_VERBRAUCHT, `${objective}: Grund der Ablehnung`);
  }
}

async function bremseNachFehlversuchen(prozess) {
  const offen = anfrageMit("Bremse vor der Sperre");
  const codeOffen = await codeAusstellen(prozess, offen);
  await fehlversuche(prozess, offen, {
    richtigerCode: codeOffen,
    anzahl: MAX_FAILED_CONFIRMATIONS_PER_WINDOW - 1,
  });
  const nachLetztemFreien = await einloesen(prozess, offen, codeOffen);
  const gesperrt = anfrageMit("Bremse in der Sperre");
  const codeGesperrt = await codeAusstellen(prozess, gesperrt);
  await fehlversuche(prozess, gesperrt, { richtigerCode: codeGesperrt, anzahl: 1 });
  const nachGrenze = await einloesen(prozess, gesperrt, codeGesperrt);
  return { nachLetztemFreien, nachGrenze };
}

async function registerTabellen(verbindung) {
  const { rows } = await verbindung.query(`SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
  return rows.map((zeile) => zeile.name);
}

async function zeilenJeTabelle(verbindung, mandant) {
  const zeilen = {};
  for (const tabelle of await registerTabellen(verbindung)) {
    const { rows } = await verbindung.query(
      `SELECT t::text AS zeile FROM "${tabelle}" t WHERE tenant_id = $1`,
      [mandant],
    );
    if (rows.length > 0) zeilen[tabelle] = rows.map((zeile) => zeile.zeile);
  }
  return zeilen;
}

async function alsMandant(verbindung, mandant, arbeit) {
  await verbindung.query("BEGIN");
  try {
    await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [mandant]);
    return await arbeit();
  } finally {
    await verbindung.query("ROLLBACK");
  }
}

function alteDigests(mandant, code, canonical) {
  const fenster = windowIndexFor(Date.now());
  const akzeptiert = Array.from({ length: ACCEPTED_WINDOWS }, (_, abstand) => fenster - abstand);
  return akzeptiert.flatMap((idx) => [
    sha256(`${mandant}|${idx}|${code}`),
    sha256(`slot|${mandant}|${idx}|${canonical}`),
  ]);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function schemaAbdruecke(verbindung) {
  const { rows } = await verbindung.query(SCHEMA_KATALOG);
  return rows.map(
    ({ art, name, definition }) =>
      `${name} ${sha256(`${art} ${definition}`).slice(0, ABDRUCK_LAENGE)}`,
  );
}

function vorgaengerAbdruecke() {
  return Object.entries(VORGAENGER_SCHEMA).flatMap(([name, abdruecke]) =>
    abdruecke.split(" ").map((abdruck) => `${name} ${abdruck}`),
  );
}

async function aufVorgaengerstand(verbindung) {
  const { rows } = await verbindung.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  for (const { tablename } of rows) {
    if (!Object.hasOwn(VORGAENGER_SCHEMA, tablename)) {
      await verbindung.query(`DROP TABLE "${tablename}" CASCADE`);
    }
  }
  await verbindung.query("DELETE FROM schema_migrations WHERE version >= $1", [
    VERSION_DER_MIGRATION,
  ]);
}

function startenUndBeenden(adresse) {
  return mitGestartetemHermes(adresse, { HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN }, async () => {});
}

async function bisWartend(beobachter, anzahl) {
  const grenze = Date.now() + ANTWORTFRIST_MS;
  while (Date.now() < grenze) {
    const { rows } = await beobachter.query(WARTENDE_ABFRAGEN);
    if (rows[0].wartend >= anzahl) return;
  }
  assert.fail(`keine ${anzahl} wartenden Abfragen binnen ${ANTWORTFRIST_MS} ms`);
}

function mitOffenemVerbrauch(adresse, { mandant, confirmation }, arbeit) {
  const windowIdx = windowIndexFor(Date.parse(confirmation.expires_at)) - 1;
  const digest = usedCodeDigest({
    key: deriveConfirmationKey(GEHEIMNIS),
    tenantId: mandant,
    windowIdx,
    normalizedCode: confirmation.code,
  });
  return mitVerbindung(adresse, async (schreiber) => {
    await schreiber.query("BEGIN");
    await schreiber.query(
      "INSERT INTO bestaetigung_verbrauch (tenant_id, digest, expires_at) VALUES ($1, $2, $3)",
      [mandant, digest, acceptanceEndMs(windowIdx)],
    );
    return mitVerbindung(adresse, (beobachter) =>
      arbeit({
        wartenBis: (anzahl) => bisWartend(beobachter, anzahl),
        abschliessen: () => schreiber.query("COMMIT"),
      }),
    );
  });
}

async function registerBefuellen(verbindung) {
  const zeilen = [
    [MANDANT, "abgelaufen", ABGELAUFEN_MS],
    [MANDANT, "gueltig", NOCH_GUELTIG_MS],
    [ANDERER_MANDANT, "abgelaufen", ABGELAUFEN_MS],
  ];
  for (const zeile of zeilen) {
    await verbindung.query(
      "INSERT INTO bestaetigung_verbrauch (tenant_id, digest, expires_at) VALUES ($1, $2, $3)",
      zeile,
    );
    await verbindung.query(
      "INSERT INTO bestaetigung_slot (tenant_id, digest, slot, expires_at) VALUES ($1, $2, 1, $3)",
      zeile,
    );
  }
}

test(
  "S1: ein von A ausgestellter Code gilt nur am ersten Prozess, der zweite antwortet already_used, in beiden Richtungen",
  { timeout: ZEITGRENZE_MS },
  (t) => mitZweiProzessen(t, (prozesse) => codeGiltNurEinmal(prozesse)),
);

test(
  "S2: derselbe Code gleichzeitig an A und B gilt genau einmal, die Bremse bleibt unverändert",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ a, b }) => {
      const inhalt = anfrageMit("Gleichzeitig einlösen");
      const code = await codeAusstellen(a, inhalt);
      const antworten = await Promise.all(
        [a, b].map((prozess) => einloesen(prozess, inhalt, code)),
      );
      assert.equal(
        antworten.filter((antwort) => antwort.confirmed).length,
        1,
        "gleichzeitiges Einlösen muss genau einmal bestätigen",
      );
      const verlierer = antworten[0].confirmed ? b : a;
      assert.deepEqual(
        ablehnung(antworten.find((antwort) => !antwort.confirmed)),
        { confirmed: false, reason: BEREITS_VERBRAUCHT },
        "die andere Antwort lautet already_used",
      );
      const { nachLetztemFreien, nachGrenze } = await imSelbenFenster(() =>
        bremseNachFehlversuchen(verlierer),
      );
      assert.equal(
        nachLetztemFreien.confirmed,
        true,
        "nach 9 Fehlversuchen ist die Bremse noch offen",
      );
      assert.deepEqual(
        ablehnung(nachGrenze),
        { confirmed: false, reason: undefined },
        "der 10. Fehlversuch sperrt auch den richtigen Code",
      );
    }),
);

test(
  "S3: nach dem Einlösen an A stellt B für dieselbe Anfrage einen neuen Code aus, der alte bleibt abgelehnt, der neue gilt",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ a, b }) => {
      const inhalt = anfrageMit("Slot-Vorschub");
      const verbraucht = await codeAusstellen(a, inhalt);
      assert.equal((await einloesen(a, inhalt, verbraucht)).confirmed, true);
      const frisch = await codeAusstellen(b, inhalt);
      assert.notEqual(
        frisch,
        verbraucht,
        "B muss nach dem Verbrauch an A einen anderen Code ausstellen",
      );
      assert.deepEqual(
        ablehnung(await einloesen(b, inhalt, verbraucht)),
        { confirmed: false, reason: BEREITS_VERBRAUCHT },
        "der verbrauchte Code bleibt abgelehnt",
      );
      assert.equal((await einloesen(a, inhalt, frisch)).confirmed, true, "der frische Code gilt");
    }),
);

test(
  "S4: Szenario 1 gilt auch für einen Mandanten, der nicht der Bootstrap-Mandant ist, unter einer Rolle mit NOBYPASSRLS",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitProzessenUnterRolle(t, ({ a, b }) =>
      codeGiltNurEinmal({ a: alsMandantAm(a, MANDANT), b: alsMandantAm(b, MANDANT) }),
    ),
);

test("Die Digests beider Register bleiben feste HMAC-Werte mit eigenem Unterschlüssel je Register", () => {
  const fest = {
    key: deriveConfirmationKey(GEHEIMNIS),
    tenantId: FESTER_MANDANT,
    windowIdx: windowIndexFor(FESTE_STARTZEIT),
  };
  assert.deepEqual(
    {
      verbrauch: usedCodeDigest({ ...fest, normalizedCode: codeSlot0 }),
      slot: slotDigest({
        ...fest,
        canonical: canonicalCallRequest({ to: ZIEL, args: FESTE_ANFRAGE }),
      }),
    },
    { verbrauch: digestVerbrauch, slot: digestSlot },
  );
});

test(
  "Läuft noch ein Verbrauch desselben Codes, bestätigt kein Prozess: der erste scheitert am Eintrag, der zweite wartet und sieht already_used, ein anderer Mandant wartet nicht",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ db, a, b }) => {
      await mandantenAnlegen(db.adresse, [MANDANT, ANDERER_MANDANT]);
      const anA = alsMandantAm(a, MANDANT);
      const inhalt = anfrageMit("Offener Verbrauch");
      const { confirmation } = await bestaetigungAnProzess(anA, inhalt);
      const { code } = confirmation;
      const stand = await mitOffenemVerbrauch(
        db.adresse,
        { mandant: MANDANT, confirmation },
        async ({ wartenBis, abschliessen }) => {
          const amEintrag = einloesen(anA, inhalt, code);
          await wartenBis(1);
          const fremd = alsMandantAm(b, ANDERER_MANDANT);
          const fremdeAntwort = await einloesen(fremd, inhalt, await codeAusstellen(fremd, inhalt));
          const anDerSperre = einloesen(alsMandantAm(b, MANDANT), inhalt, code);
          await wartenBis(2);
          await abschliessen();
          return {
            fremdeAntwort,
            amEintrag: await amEintrag,
            anDerSperre: await anDerSperre,
          };
        },
      );
      assert.equal(
        stand.fremdeAntwort.confirmed,
        true,
        "ein anderer Mandant läuft durch, während dieser Mandant wartet",
      );
      assert.equal(
        stand.amEintrag.confirmed,
        false,
        "ein Konflikt beim Eintragen ist nie eine Bestätigung",
      );
      assert.deepEqual(
        ablehnung(stand.anDerSperre),
        { confirmed: false, reason: BEREITS_VERBRAUCHT },
        "wer hinter dem Mandanten wartet, sieht danach den Verbrauch",
      );
    }),
);

test(
  "Jede Anfrage eines Mandanten löscht seine abgelaufenen Zeilen aus beiden Registern und lässt gültige und fremde stehen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ db, a }) => {
      await mandantenAnlegen(db.adresse, [MANDANT, ANDERER_MANDANT]);
      await mitVerbindung(db.adresse, registerBefuellen);
      await codeAusstellen(alsMandantAm(a, MANDANT), anfrageMit("Aufräumen"));
      await mitVerbindung(db.adresse, async (verbindung) => {
        for (const tabelle of REGISTER_MIT_ABLAUF) {
          const { rows } = await verbindung.query(
            `SELECT tenant_id, digest FROM "${tabelle}" ORDER BY tenant_id, digest`,
          );
          assert.deepEqual(
            rows,
            [
              { tenant_id: MANDANT, digest: "gueltig" },
              { tenant_id: ANDERER_MANDANT, digest: "abgelaufen" },
            ],
            tabelle,
          );
        }
      });
    }),
);

test(
  "[NIE1] Am selben Prozess wird ein Code nur einmal bestätigt, auch wenn viele Anfragen gleichzeitig an beide Prozesse gehen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ a, b }) => {
      const einzeln = anfrageMit("Zweimal am selben Prozess");
      const code = await codeAusstellen(a, einzeln);
      assert.equal((await einloesen(a, einzeln, code)).confirmed, true);
      assert.deepEqual(ablehnung(await einloesen(a, einzeln, code)), {
        confirmed: false,
        reason: BEREITS_VERBRAUCHT,
      });

      const runden = Array.from({ length: GLEICHZEITIGE_RUNDEN }, async (_, runde) => {
        const inhalt = anfrageMit(`Gleichzeitig Runde ${runde}`);
        const rundenCode = await codeAusstellen(a, inhalt);
        const ziele = Array.from({ length: ANFRAGEN_JE_PROZESS }, () => [a, b]).flat();
        const antworten = await Promise.all(
          ziele.map((prozess) => einloesen(prozess, inhalt, rundenCode)),
        );
        return antworten.filter((antwort) => antwort.confirmed).length;
      });
      assert.deepEqual(
        await Promise.all(runden),
        Array.from({ length: GLEICHZEITIGE_RUNDEN }, () => 1),
        "je Runde bestätigt genau eine von vier gleichzeitigen Anfragen",
      );
    }),
);

test(
  "[NIE1] Nach einem Neustart aller Prozesse auf derselben Datenbank bleibt ein verbrauchter Code abgelehnt",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ db, a, b }) => {
      const inhalt = anfrageMit("Neustart");
      const code = await codeAusstellen(a, inhalt);
      assert.equal((await einloesen(a, inhalt, code)).confirmed, true);
      await beenden(a);
      await beenden(b);
      const neu = await zweiProzesse(t, { ...UMGEBUNG, DATABASE_URL: db.adresse });
      for (const prozess of [neu.a, neu.b]) {
        assert.deepEqual(
          ablehnung(await einloesen(prozess, inhalt, code)),
          { confirmed: false, reason: BEREITS_VERBRAUCHT },
          "ein neu gestarteter Prozess darf den verbrauchten Code nicht bestätigen",
        );
      }
    }),
);

test("[NIE2] Ableitung, Fenster, Codelänge und Secret-Mindestlänge bleiben Wert für Wert gleich", () => {
  assert.deepEqual(
    {
      CONFIRMATION_WINDOW_MS,
      ACCEPTED_WINDOWS,
      CONFIRMATION_CODE_LENGTH,
      CONFIRMATION_SECRET_MIN_LENGTH,
      DERIVATION_VERSION,
      MAX_FAILED_CONFIRMATIONS_PER_WINDOW,
    },
    {
      CONFIRMATION_WINDOW_MS: 300_000,
      ACCEPTED_WINDOWS: 2,
      CONFIRMATION_CODE_LENGTH: 6,
      CONFIRMATION_SECRET_MIN_LENGTH: 32,
      DERIVATION_VERSION: "v2",
      MAX_FAILED_CONFIRMATIONS_PER_WINDOW: 10,
    },
  );
  assert.equal(deriveConfirmationKey("x".repeat(31)), null);
  assert.ok(deriveConfirmationKey("x".repeat(32)));

  const key = deriveConfirmationKey(GEHEIMNIS);
  const fest = {
    key,
    tenantId: FESTER_MANDANT,
    canonical: canonicalCallRequest({ to: ZIEL, args: FESTE_ANFRAGE }),
  };
  assert.deepEqual(
    [0, 1].map((slot) => issueConfirmationCode({ ...fest, nowMs: FESTE_STARTZEIT, slot })),
    [
      { code: codeSlot0, expiresAtMs: FESTES_FENSTERENDE },
      { code: codeSlot1, expiresAtMs: FESTES_FENSTERENDE },
    ],
  );
  assert.equal(acceptanceEndMs(windowIndexFor(FESTE_STARTZEIT)), FESTES_ANNAHMEENDE);

  const tabelle = [
    { code: codeSlot0, jetzt: FESTE_STARTZEIT, slot: 0, gilt: true },
    { code: codeSlot0.toLowerCase(), jetzt: FESTE_STARTZEIT, slot: 0, gilt: true },
    { code: codeSlot0, jetzt: FESTES_ANNAHMEENDE - 1, slot: 0, gilt: true },
    { code: codeSlot0, jetzt: FESTES_ANNAHMEENDE, slot: 0, gilt: false },
    { code: codeSlot0, jetzt: FESTE_STARTZEIT, slot: 1, gilt: false },
    { code: codeSlot1, jetzt: FESTE_STARTZEIT, slot: 1, gilt: true },
    { code: codeSlot0.slice(1), jetzt: FESTE_STARTZEIT, slot: 0, gilt: false },
    { code: "", jetzt: FESTE_STARTZEIT, slot: 0, gilt: false },
  ];
  for (const { code, jetzt, slot, gilt } of tabelle) {
    assert.equal(
      verifyConfirmationCode({ ...fest, code, nowMs: jetzt, slotForWindow: () => slot }),
      gilt,
      `Code ${code} zur Zeit ${jetzt} mit Slot ${slot}`,
    );
  }
});

test(
  "[NIE2] Am Eingang gilt already_used vor Bremse vor Verbrauch, und die Route stellt die abgeleiteten Codes aus",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ db, a }) => {
      await mandantenAnlegen(db.adresse, [MANDANT]);
      const prozess = alsMandantAm(a, MANDANT);
      const inhalt = anfrageMit("Reihenfolge");
      const fest = {
        key: deriveConfirmationKey(GEHEIMNIS),
        tenantId: MANDANT,
        canonical: canonicalCallRequest({ to: ZIEL, args: inhalt }),
      };
      const stand = await imSelbenFenster(async () => {
        const jetzt = Date.now();
        const { confirmation } = await bestaetigungAnProzess(prozess, inhalt);
        const eingeloest = await einloesen(prozess, inhalt, confirmation.code);
        const frisch = await codeAusstellen(prozess, inhalt);
        await bremseAmProzessAusloesen(prozess, inhalt, frisch);
        return {
          jetzt,
          confirmation,
          eingeloest,
          frisch,
          verbraucht: await einloesen(prozess, inhalt, confirmation.code),
          richtig: await einloesen(prozess, inhalt, frisch),
        };
      });
      assert.deepEqual(
        { code: stand.confirmation.code, expiresAtMs: Date.parse(stand.confirmation.expires_at) },
        issueConfirmationCode({ ...fest, nowMs: stand.jetzt, slot: 0 }),
        "die Route leitet über Mandant, Fenster und Slot 0 ab",
      );
      assert.equal(stand.eingeloest.confirmed, true);
      assert.equal(
        stand.frisch,
        issueConfirmationCode({ ...fest, nowMs: stand.jetzt, slot: 1 }).code,
        "nach dem Verbrauch stellt die Route Slot 1 aus",
      );
      assert.deepEqual(
        ablehnung(stand.verbraucht),
        { confirmed: false, reason: BEREITS_VERBRAUCHT },
        "already_used kommt vor der Bremse",
      );
      assert.deepEqual(
        ablehnung(stand.richtig),
        { confirmed: false, reason: undefined },
        "die Bremse kommt vor dem Verbrauch: der richtige Code bleibt gesperrt",
      );
    }),
);

test(
  "[NIE3] Kein Klartext-Code, kein Secret und kein Schlüssel steht in der Datenbank, im Log oder in der Antwort",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ db, a, b }) => {
      await mandantenAnlegen(db.adresse, [MANDANT]);
      const anA = alsMandantAm(a, MANDANT);
      const inhalt = anfrageMit("Kein Klartext");
      const code = await codeAusstellen(anA, inhalt);
      const falsch = falscherCode(code);
      const abgelehnt = await einloesen(anA, inhalt, falsch);
      assert.equal((await einloesen(anA, inhalt, code)).confirmed, true);
      const zweimal = await einloesen(alsMandantAm(b, MANDANT), inhalt, code);

      const zeilen = await mitVerbindung(db.adresse, (verbindung) =>
        zeilenJeTabelle(verbindung, MANDANT),
      );
      assert.ok(
        Object.keys(zeilen).length > 0,
        "das Einlösen hinterlässt eine Zeile des Mandanten",
      );

      const key = deriveConfirmationKey(GEHEIMNIS);
      const canonical = canonicalCallRequest({ to: ZIEL, args: inhalt });
      const tabu = [
        code,
        falsch,
        GEHEIMNIS,
        key.toString("hex"),
        key.toString("base64"),
        ...alteDigests(MANDANT, code, canonical),
      ];
      const orte = {
        Datenbank: JSON.stringify(zeilen),
        "Log von A": a.stdout,
        "Log von B": b.stdout,
        Antworten: JSON.stringify([abgelehnt, zweimal]),
      };
      for (const [ort, text] of Object.entries(orte)) {
        const treffer = tabu.filter((wert) => text.includes(wert));
        assert.equal(treffer.length, 0, `${ort} enthält ${treffer.length} geschützte Werte`);
      }
    }),
);

test(
  "[NIE4] Unter NOBYPASSRLS sieht und verändert ein Mandant nie die Register eines anderen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitProzessenUnterRolle(t, async ({ a, b, rolle }) => {
      const eigener = alsMandantAm(a, MANDANT);
      const andererAmZweiten = alsMandantAm(b, ANDERER_MANDANT);
      const inhalt = anfrageMit("Mandantentrennung");
      const code = await codeAusstellen(eigener, inhalt);
      assert.notEqual(code, await codeAusstellen(andererAmZweiten, inhalt));
      assert.equal((await einloesen(eigener, inhalt, code)).confirmed, true);
      assert.deepEqual(
        ablehnung(await einloesen(andererAmZweiten, inhalt, code)),
        { confirmed: false, reason: undefined },
        "der verbrauchte Code eines Mandanten ist für den anderen nur ein falscher Code",
      );

      await mitVerbindung(rolle.adresse, async (verbindung) => {
        const { rows: rollen } = await verbindung.query(
          "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
        );
        assert.deepEqual(rollen, [{ rolbypassrls: false, rolsuper: false }]);

        const eigene = await alsMandant(verbindung, MANDANT, () =>
          zeilenJeTabelle(verbindung, MANDANT),
        );
        const tabellen = Object.keys(eigene);
        assert.ok(tabellen.length > 0, "der Mandant sieht seine eigenen Register");

        assert.deepEqual(await zeilenJeTabelle(verbindung, MANDANT), {}, "ohne Mandant sichtbar");
        assert.deepEqual(
          await alsMandant(verbindung, ANDERER_MANDANT, () => zeilenJeTabelle(verbindung, MANDANT)),
          {},
          "für den anderen Mandanten sichtbar",
        );

        for (const tabelle of tabellen) {
          const { rows } = await verbindung.query(
            `SELECT c.relrowsecurity, c.relforcerowsecurity, p.policyname, p.with_check IS NOT NULL AS mit_pruefung
               FROM pg_class c JOIN pg_policies p ON p.tablename = c.relname
              WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`,
            [tabelle],
          );
          assert.deepEqual(
            rows,
            [
              {
                relrowsecurity: true,
                relforcerowsecurity: true,
                policyname: "tenant_isolation",
                mit_pruefung: true,
              },
            ],
            tabelle,
          );
          const geloescht = await alsMandant(verbindung, ANDERER_MANDANT, () =>
            verbindung.query(`DELETE FROM "${tabelle}" WHERE tenant_id = $1`, [MANDANT]),
          );
          assert.equal(geloescht.rowCount, 0, `${tabelle}: fremde Zeilen gelöscht`);
          await assert.rejects(
            alsMandant(verbindung, MANDANT, () =>
              verbindung.query(`UPDATE "${tabelle}" SET tenant_id = $1`, [ANDERER_MANDANT]),
            ),
            RLS_FEHLER,
            `${tabelle}: Zeile an einen anderen Mandanten übertragen`,
          );
        }
      });

      assert.deepEqual(
        ablehnung(await einloesen(alsMandantAm(b, MANDANT), inhalt, code)),
        { confirmed: false, reason: BEREITS_VERBRAUCHT },
        "der eigene Verbrauch bleibt bestehen",
      );
    }),
);

test(
  "[NIE6] Der falsche Code bleibt streng: nicht leer, so lang wie der richtige, ein anderer, und er zählt an beiden Prozessen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async ({ a, b }) => {
      const inhalt = anfrageMit("Strenger falscher Code");
      const stand = await imSelbenFenster(async () => {
        const richtig = await codeAusstellen(a, inhalt);
        await fehlversuche(a, inhalt, {
          richtigerCode: richtig,
          anzahl: MAX_FAILED_CONFIRMATIONS_PER_WINDOW - 1,
        });
        await fehlversuche(b, inhalt, { richtigerCode: richtig, anzahl: 1 });
        return { richtig, anA: await einloesen(a, inhalt, richtig) };
      });
      for (const richtig of [stand.richtig, "0ABCDE", "ZABCDE"]) {
        const falsch = falscherCode(richtig);
        assert.ok(falsch.length > 0, "der falsche Code ist nicht leer");
        assert.equal(
          falsch.length,
          richtig.length,
          "der falsche Code ist so lang wie der richtige",
        );
        assert.notEqual(falsch, richtig, "der falsche Code ist ein anderer");
      }
      assert.deepEqual(
        ablehnung(stand.anA),
        { confirmed: false, reason: undefined },
        "9 Fehlversuche an A und einer an B sperren den richtigen Code",
      );
    }),
);

test(
  "[NIE5] Das Einspielen der Migration auf eine befüllte Datenbank der Vorgängerversion lässt Schema und Zeilen bestehen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    await startenUndBeenden(db.adresse);
    const verbindung = await db.verbinden();
    await verbindung.query("INSERT INTO tenant (id) VALUES ($1)", [MANDANT]);
    await aufVorgaengerstand(verbindung);

    await startenUndBeenden(db.adresse);

    const { rows: versionen } = await verbindung.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [VERSION_DER_MIGRATION],
    );
    assert.equal(versionen.length, 1, "der Start spielt die Migration auf dem Vorgängerstand ein");
    const vorhanden = new Set(await schemaAbdruecke(verbindung));
    const verloren = vorgaengerAbdruecke().filter((abdruck) => !vorhanden.has(abdruck));
    assert.deepEqual(
      verloren,
      [],
      "die Migration hat Bestehendes gelöscht, umbenannt oder verändert",
    );
    const { rows } = await verbindung.query("SELECT id FROM tenant WHERE id = $1", [MANDANT]);
    assert.deepEqual(rows, [{ id: MANDANT }], "bestehende Zeilen bleiben");
  },
);

test(
  "[NIE6] Bremse zählt über Prozesse: nach den Fehlversuchen an einem Prozess ist der Mandant an beiden gesperrt",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitZweiProzessen(t, async (prozesse) => {
      const { anA, anB } = await imSelbenFenster(() =>
        sperrenAmErstenProzess(prozesse, "Bremse über Prozesse"),
      );
      assert.deepEqual(ablehnung(anA), { confirmed: false, reason: undefined });
      assert.deepEqual(
        ablehnung(anB),
        { confirmed: false, reason: undefined },
        "der andere Prozess zählt die Fehlversuche mit",
      );
    }),
);
