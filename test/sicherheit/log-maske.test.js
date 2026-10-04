import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { maskiereLogText, merkeLogGeheimnisse, mitLogMaske } from "../../src/log-maske.js";
import { installProcessGuards } from "../../src/process-guards.js";
import { hashEmail, maskNumber } from "../../src/util.js";

const RUMPF_LAENGE = 40;
const GEHEIMNIS_TEILE = 4;
const MINDESTLAENGE = 16;
const NUMMER = "+4915112345678";
const EMAIL = "probe.person@example.org";
const VERDECKT = "[restricted-credential]";
const NICHT_ZIFFER = /\D/g;

const NUMMERN_FORMEN = [
  ["E.164", NUMMER],
  ["mit Leerzeichen", "+49 151 1234 5678"],
  ["mit Bindestrichen", "+49-151-1234-5678"],
  ["mit Schrägstrich", "0151/12345678"],
  ["prozentkodiert", "%2B4915112345678"],
  ["prozentkodiert in Kleinschrift", "%2b4915112345678"],
  ["prozentkodiert mit %20", "%2B49%20151%2012345678"],
  ["als JSON-Escape", "\\u002b4915112345678"],
  ["national", "0151 12345678"],
  ["international mit 00", "004915112345678"],
];

const UMGEBUNGEN = [
  ["in JSON", (nummer) => `{"to":"${nummer}"}`],
  ["im URL-Pfad", (nummer) => `/api/calls/${nummer}%E0%A4%A`],
  ["in der Abfrage", (nummer) => `?To=${nummer}&From=${nummer}`],
  ["nach Gleichheitszeichen", (nummer) => `to=${nummer} ende`],
];

const MIT_VORZEICHEN = /^(?:\+|%2b|\\u002b)/i;

const WORTNAHE_UMGEBUNGEN = [
  ["nach kodiertem Doppelpunkt", (nummer) => `phone%3A${nummer}`],
  ["direkt nach Buchstabe", (nummer) => `x${nummer}`],
];

const VOR_BUCHSTABE = [
  ["direkt vor einem Buchstaben", (nummer) => `to=${nummer}abc`],
  ["zwischen Buchstaben", (nummer) => `call${nummer}x`],
];

const KLAMMER_FORMEN = ["+1 (415) 555-0123", "+49 (0) 151 1234 5678", "(0151) 12345678"];

const TOKEN = {
  aws: "AKIA" + "Q".repeat(RUMPF_LAENGE),
  github: "ghp_" + "G".repeat(RUMPF_LAENGE),
};

const TOKEN_FORMEN = [
  ["AWS", TOKEN.aws],
  ["GitHub klassisch", TOKEN.github],
  ["GitHub fein", "github_pat_" + "A".repeat(RUMPF_LAENGE)],
  ["Slack", "xoxb-" + "S".repeat(RUMPF_LAENGE)],
  ["Stripe", "sk_live_" + "T".repeat(RUMPF_LAENGE)],
  ["Google", "AIza" + "Z".repeat(RUMPF_LAENGE)],
  ["sk-Schlüssel", "sk-ant-" + "K".repeat(RUMPF_LAENGE)],
  ["JWT", ["eyJ" + "J".repeat(RUMPF_LAENGE), "J".repeat(RUMPF_LAENGE), "J".repeat(RUMPF_LAENGE)].join(".")],
];

const ZEILEN_MIT_GEHEIMNIS = [
  ["zwei Token in einer Zeile", `a=${TOKEN.aws} b=${TOKEN.github}`, `a=${VERDECKT} b=${VERDECKT}`],
  ["Token am Zeilenende", `ende ${TOKEN.github}`, `ende ${VERDECKT}`],
  ["Bearer", "Bearer " + "B".repeat(RUMPF_LAENGE), "Bearer ***"],
  ["Bearer mit zwei Leerzeichen", "Bearer  " + "B".repeat(RUMPF_LAENGE), "Bearer  ***"],
  ["Webhook-Geheimnis", `wert=whsec_${"W".repeat(RUMPF_LAENGE)} ende`, "wert=whsec_*** ende"],
  ["x-hermes-tool-token", "x-hermes-tool-token: " + "H".repeat(RUMPF_LAENGE), "x-hermes-tool-token: ***"],
  ["xi-api-key in JSON", `{"xi-api-key":"${"X".repeat(RUMPF_LAENGE)}"}`, '{"xi-api-key":"***"}'],
  ["x-api-key", "x-api-key=" + "Y".repeat(RUMPF_LAENGE), "x-api-key=***"],
  ["x-api-key mit Leerzeichen um das Gleichheitszeichen", "x-api-key = " + "Y".repeat(RUMPF_LAENGE), "x-api-key = ***"],
  ["authorization in JSON", `{"authorization":"Basic ${"C".repeat(RUMPF_LAENGE)}"}`, '{"authorization":"Basic ***"}'],
  ["Authorization als Kopfzeile", "Authorization: " + "D".repeat(RUMPF_LAENGE), "Authorization: ***"],
  ["Authorization mit Schema und zwei Leerzeichen", "Authorization: Bearer  " + "D".repeat(RUMPF_LAENGE), "Authorization: Bearer  ***"],
  ["authorization aus util.inspect", `{ authorization: '${"E".repeat(RUMPF_LAENGE)}' }`, "{ authorization: '***' }"],
];

const HARMLOS = [
  ["ISO-Datum", "Preisstaffeln: claude-haiku-4-5 ab 2026-10-04 (naechste: -)"],
  ["ISO-Zeitstempel", "2026-10-04T18:33:12.123Z"],
  ["Datum mit Uhrzeit", "2026-10-04 18:33:12"],
  ["HTTP-Status", "HTTP 503 Service Unavailable"],
  ["Anbieter-Status mit Fehlercode", "Telnyx searchNumbers fehlgeschlagen: HTTP 422 (10015 Invalid parameter)"],
  ["Port", "listening on port=3000"],
  ["kurze Zahl", "neu=123456 rest=42"],
  ["IP-Adresse", "ip=192.168.100.200"],
  ["IPv6-Adresse", "ip=::ffff:127.0.0.1"],
  ["datierte Modell-ID", "CLAUDE_MODEL=claude-haiku-4-5-20251001"],
  ["Hex-Hash", "[boot] configHash=4f1c9e2a7712345678b0c3d9e8f71234567aa0b1c2d3e4f5a6b7c8d9e0f1a2b3"],
  ["UUID", "call=550e8400-e29b-41d4-a716-446655440000"],
  ["lange Kennung zwischen Buchstaben", "id=abc1234567890123456789xyz"],
  ["Wort authorization ohne Wert", "authorization failed for /mcp"],
];

function pruefeMaskiert(beschreibung, eingabe, erwartet) {
  const ergebnis = maskiereLogText(eingabe);
  assert.equal(ergebnis, erwartet, beschreibung);
  assert.equal(maskiereLogText(ergebnis), ergebnis, `${beschreibung}: zweite Anwendung ändert nichts`);
}

test("SG-13 jede Nummernform wird im Log ganz maskiert", () => {
  for (const [form, nummer] of NUMMERN_FORMEN) {
    const umgebungen = MIT_VORZEICHEN.test(nummer) ? [...UMGEBUNGEN, ...WORTNAHE_UMGEBUNGEN] : UMGEBUNGEN;
    for (const [ort, bette] of umgebungen) {
      pruefeMaskiert(`${form} ${ort}`, bette(nummer), bette(maskNumber(nummer)));
    }
  }
  const datumVorNummer = "2026-10-04-015112345678";
  pruefeMaskiert("Datum direkt vor einer Nummer", `datei=${datumVorNummer}.wav`, `datei=${maskNumber(datumVorNummer)}.wav`);
});

test("SG-13 Formen mit Vorzeichen direkt vor einem Buchstaben werden ganz maskiert", () => {
  for (const [form, nummer] of NUMMERN_FORMEN.filter(([, kandidat]) => MIT_VORZEICHEN.test(kandidat))) {
    for (const [ort, bette] of VOR_BUCHSTABE) {
      pruefeMaskiert(`${form} ${ort}`, bette(nummer), bette(maskNumber(nummer)));
    }
  }
});

test("SG-13 von einer Nummer mit Klammern bleibt keine vollständige Nummer lesbar", () => {
  for (const [stelle, nummer] of KLAMMER_FORMEN.entries()) {
    const sichtbareZiffern = maskiereLogText(`to=${nummer}`).replace(NICHT_ZIFFER, "");
    assert.equal(sichtbareZiffern.includes(nummer.replace(NICHT_ZIFFER, "")), false, `Klammerform ${stelle}`);
  }
});

test("SG-13 Token und Schlüssel werden im Log verdeckt", () => {
  for (const [form, token] of TOKEN_FORMEN) {
    pruefeMaskiert(form, `wert=${token} ende`, `wert=${VERDECKT} ende`);
  }
  for (const [form, zeile, erwartet] of ZEILEN_MIT_GEHEIMNIS) {
    pruefeMaskiert(form, zeile, erwartet);
  }
});

test("SG-13 E-Mail-Adressen erscheinen im Log nur als Kurz-Hash", () => {
  pruefeMaskiert("E-Mail", `an ${EMAIL}.`, `an ***@${hashEmail(EMAIL)}.`);
  pruefeMaskiert("SIP-Adresse", `sip:${NUMMER}@sip.example.org`, `sip:***@${hashEmail(`${NUMMER}@sip.example.org`)}`);
});

test("SG-13 harmlose Werte bleiben im Log lesbar", () => {
  for (const [form, zeile] of HARMLOS) {
    assert.equal(maskiereLogText(zeile), zeile, form);
  }
});

test("SG-13 Schreibfilter maskiert Text und reicht Buffer, Kodierung, Rückruf und Rückgabe durch", () => {
  const aufrufe = [];
  const strom = { name: "probe" };
  const rueckruf = () => {};
  const schreibe = function (stueck, kodierung, fertig) {
    aufrufe.push({ dies: this, stueck, kodierung, fertig });
    return "rueckgabe";
  };
  const gefiltert = mitLogMaske(schreibe);
  const puffer = Buffer.from(`to=${NUMMER}`);

  assert.equal(gefiltert.call(strom, `to=${NUMMER}`, "utf8", rueckruf), "rueckgabe");
  assert.equal(gefiltert.call(strom, puffer), "rueckgabe");

  assert.deepEqual(aufrufe[0], { dies: strom, stueck: `to=${maskNumber(NUMMER)}`, kodierung: "utf8", fertig: rueckruf });
  assert.equal(aufrufe[1].stueck, puffer);
  assert.equal(mitLogMaske(gefiltert), gefiltert);
});

function schreibeMitRekorder(einstieg) {
  const original = { stdout: process.stdout.write, stderr: process.stderr.write, einstieg: process.argv[1] };
  const gesehen = { stdout: [], stderr: [] };
  process.stdout.write = (text) => gesehen.stdout.push(String(text));
  process.stderr.write = (text) => gesehen.stderr.push(String(text));
  process.argv[1] = einstieg;
  try {
    installProcessGuards();
    console.log(`[audit] place_call to=${NUMMER}`);
    console.error(`[error] ${EMAIL}`);
  } finally {
    process.stdout.write = original.stdout;
    process.stderr.write = original.stderr;
    process.argv[1] = original.einstieg;
  }
  return gesehen;
}

test("SG-13 Crash-Netz maskiert stdout und stderr des Servers", () => {
  const gesehen = schreibeMitRekorder(path.join("src", "server.js"));
  assert.deepEqual(gesehen.stdout, [`[audit] place_call to=${maskNumber(NUMMER)}\n`]);
  assert.deepEqual(gesehen.stderr, [`[error] ***@${hashEmail(EMAIL)}\n`]);
});

test("SG-13 stdio-MCP-Server behält stdout als Datenkanal unverändert", () => {
  const gesehen = schreibeMitRekorder(path.join("src", "mcp-server.js"));
  assert.deepEqual(gesehen.stdout, [`[audit] place_call to=${NUMMER}\n`]);
  assert.deepEqual(gesehen.stderr, [`[error] ***@${hashEmail(EMAIL)}\n`]);
});

test("SG-13 als Geheimnis gilt nur ein Schlüssel-Name mit Wert ab der Mindestlänge", () => {
  const genau = "m".repeat(MINDESTLAENGE);
  const zuKurz = "n".repeat(MINDESTLAENGE - 1);
  const ohneSchluesselNamen = "v".repeat(RUMPF_LAENGE);
  merkeLogGeheimnisse({ LOGMASKE_GENAU_SECRET: genau, LOGMASKE_KURZ_PASSWORD: zuKurz, LOGMASKE_KEY_ID: ohneSchluesselNamen });
  assert.equal(
    maskiereLogText(`a=${genau} b=${zuKurz} c=${ohneSchluesselNamen}`),
    `a=*** b=${zuKurz} c=${ohneSchluesselNamen}`,
  );
});

test("SG-13 ein Geheimnis in einem längeren Geheimnis lässt vom längeren nichts sichtbar", () => {
  const kurz = "k".repeat(MINDESTLAENGE);
  const lang = `vor${kurz}nach`;
  merkeLogGeheimnisse({ LOGMASKE_TEIL_TOKEN: kurz, LOGMASKE_GANZ_TOKEN: lang });
  assert.equal(maskiereLogText(`a=${lang} b=${kurz}`), "a=*** b=***");
});

test("SG-13 Werte eigener Schlüssel aus der Umgebung werden im Log maskiert", async () => {
  const geheimnis = "geheim".repeat(GEHEIMNIS_TEILE);
  process.env.LOGMASKE_PROBE_API_KEY = geheimnis;
  process.env.LOGMASKE_PROBE_TOKEN = "kurzwert";
  await import("../../src/config.js");
  assert.equal(maskiereLogText(`schluessel=${geheimnis} ende`), "schluessel=*** ende");
  assert.equal(maskiereLogText("wert=kurzwert"), "wert=kurzwert");
});
