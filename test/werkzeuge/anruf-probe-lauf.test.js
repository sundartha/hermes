import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_TELNYX_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const COMMIT = "e".repeat(40);
const STAGING = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+4930555000199";
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const MINUTE = 60 * 1000;
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

const OFFENLEGUNG =
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.";

const GUT = {
  annahmeSekunden: 4,
  begruessung: OFFENLEGUNG,
  sprache: "de",
  auftraggeber: "Probe GmbH",
  dauerSekunden: 30,
  status: "completed",
};
const ROT = { ...GUT, status: "failed" };
const STAND_FREI = { erstversuche: 0, anrufe: 0 };

function dienstStarten(behandeln) {
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => behandeln(anfrage, Buffer.concat(teile).toString(), rueckgabe));
  });
  server.push(dienst);
  return new Promise((fertig) => dienst.listen(0, "127.0.0.1", () => fertig(dienst.address().port)));
}

function issue(vorMinuten) {
  return {
    number: 31,
    title: "Staging-Anrufprobe rot",
    user: { login: "github-actions[bot]" },
    updated_at: new Date(Date.now() - vorMinuten * MINUTE).toISOString(),
  };
}

async function aufrufen({ fall = {}, umgebung = {}, offene = [], ohneAdresse = false } = {}) {
  const vorfaelle = [];
  const schreibend = [];
  const betterStack = await dienstStarten((anfrage, roh, rueckgabe) => {
    vorfaelle.push(JSON.parse(roh));
    rueckgabe.writeHead(200);
    rueckgabe.end();
  });
  const github = await dienstStarten((anfrage, roh, rueckgabe) => {
    rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    if (anfrage.method === "GET") return rueckgabe.end(JSON.stringify(offene));
    schreibend.push({ methode: anfrage.method, koerper: JSON.parse(roh) });
    rueckgabe.end(JSON.stringify({ number: 31 }));
  });
  const adresse = `http://127.0.0.1:${betterStack}/geheim-pfad`;
  const fallWerte = { eigeneNummer: ZIEL, stand: STAND_FREI, messungen: [GUT], ...fall };
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "88",
    GITHUB_SHA: COMMIT,
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    STAGING_URL: STAGING,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify(fallWerte),
    ...(ohneAdresse ? {} : { BETTER_STACK_ALERT_URL: adresse }),
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const sichtbar = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  return { vorfaelle, schreibend, ausgabe, sichtbar, code, adresse };
}

function anrufe(ausgabe) {
  return ausgabe.split("\n").filter((zeile) => zeile.startsWith("ANRUF")).length;
}

test("Grüne Probe: ein Anruf, kein Alarm, Lauf grün", async () => {
  const { vorfaelle, schreibend, sichtbar, code } = await aufrufen();
  assert.equal(code, 0);
  assert.equal(anrufe(sichtbar), 1);
  assert.match(sichtbar, /Probe grün/);
  assert.equal(vorfaelle.length, 0);
  assert.equal(schreibend.length, 0);
  assert.doesNotMatch(sichtbar, /WARTE/);
});

test("Erstversuch rot, Wiederholung nach 120000 ms grün: kein Alarm, Hinweis im Protokoll", async () => {
  const { vorfaelle, schreibend, sichtbar, code } = await aufrufen({ fall: { messungen: [ROT, GUT] } });
  assert.equal(code, 0);
  assert.equal(anrufe(sichtbar), 2);
  assert.match(sichtbar, /WARTE 120000/);
  assert.match(sichtbar, /Erstversuch rot, Wiederholung grün/);
  assert.equal(vorfaelle.length, 0);
  assert.equal(schreibend.length, 0);
});

test("Beide Versuche rot: genau ein Vorfall probe-staging mit Titel, seit wann, Staging und erstem Schritt", async () => {
  const { vorfaelle, schreibend, sichtbar, code } = await aufrufen({ fall: { messungen: [ROT, ROT] } });
  assert.equal(code, 1);
  assert.equal(anrufe(sichtbar), 2);
  assert.match(sichtbar, /Probe rot: status/);
  assert.equal(vorfaelle.length, 1);
  assert.deepEqual(vorfaelle[0].incident, { id: "probe-staging", status: "alert" });
  const { text } = vorfaelle[0];
  assert.match(text, /Staging-Anrufprobe rot/);
  assert.match(text, /Seit: 2026-11-17T10:00:00\.000Z/);
  assert.match(text, /Umgebung: Staging/);
  assert.match(text, new RegExp(COMMIT));
  assert.match(text, /actions\/runs\/88/);
  assert.match(text, /Erster Schritt: Ursache im Lauf lesen/);
  assert.equal(schreibend.length, 1);
  assert.equal(schreibend[0].koerper.title, "Staging-Anrufprobe rot");
  assert.match(schreibend[0].koerper.body, /Seit: 2026-11-17T10:00:00\.000Z/);
});

test("Zweiter roter Lauf binnen einer Stunde meldet keinen zweiten Vorfall, nach 61 Minuten wieder", async () => {
  const fall = { messungen: [ROT, ROT] };
  const frisch = await aufrufen({ fall, offene: [issue(59)] });
  assert.equal(frisch.vorfaelle.length, 0);
  assert.match(frisch.sichtbar, /Probe-Issue #31: Text ersetzt/);
  const alt = await aufrufen({ fall, offene: [issue(61)] });
  assert.equal(alt.vorfaelle.length, 1);
});

test("Der Nachtlauf-Vorfall entprellt die Probe nicht: ein offenes Nachtlauf-Issue ändert nichts", async () => {
  const nachtlauf = { ...issue(1), number: 40, title: "Staging-Nachtlauf rot" };
  const { vorfaelle, schreibend } = await aufrufen({ fall: { messungen: [ROT, ROT] }, offene: [nachtlauf] });
  assert.equal(vorfaelle.length, 1);
  assert.equal(schreibend[0].methode, "POST");
});

test("absichtlich_rot: beide Versuche rot ohne echten Anruf, Vorfall-Weg wird erreicht", async () => {
  const { vorfaelle, sichtbar, code } = await aufrufen({ umgebung: { ABSICHTLICH_ROT: "true" } });
  assert.equal(code, 1);
  assert.equal(anrufe(sichtbar), 0);
  assert.match(sichtbar, /WARTE 120000/);
  assert.match(sichtbar, /Probe rot: messung/);
  assert.equal(vorfaelle.length, 1);
});

test("Gerissener Wert steht im Protokoll: Offenlegung weicht ab", async () => {
  const falsch = { ...GUT, begruessung: "Hallo" };
  const { sichtbar } = await aufrufen({ fall: { messungen: [falsch, falsch] } });
  assert.match(sichtbar, /Probe rot: offenlegung/);
});

test("Fehlende Adresse des Alarmwegs: nichts gewählt, Lauf rot, Name im Protokoll", async () => {
  const { sichtbar, code } = await aufrufen({ ohneAdresse: true });
  assert.equal(code, 1);
  assert.equal(anrufe(sichtbar), 0);
  assert.match(sichtbar, /probe_uebersprungen_better_stack_alert_url_fehlt/);
});

for (const name of ["STAGING_PROBE_ZIEL"]) {
  test(`Fehlt ${name}: nichts gewählt, Lauf rot, Name im Protokoll`, async () => {
    const { sichtbar, code } = await aufrufen({ umgebung: { [name]: "" } });
    assert.equal(code, 1);
    assert.equal(anrufe(sichtbar), 0);
    assert.match(sichtbar, new RegExp(`probe_uebersprungen_${name.toLowerCase()}_fehlt`));
  });
}

test("Ziel: abweichende Nummer, fremde STAGING_URL oder Live-Adresse brechen vor dem ersten Anruf ab", async () => {
  const faelle = [
    { fall: { eigeneNummer: "+4930555000100" } },
    { umgebung: { STAGING_URL: "https://hermes.example.com" } },
    { umgebung: { STAGING_URL: `${STAGING}.evil.example` } },
  ];
  for (const abweichung of faelle) {
    const { sichtbar, code, vorfaelle } = await aufrufen(abweichung);
    assert.equal(code, 1);
    assert.equal(anrufe(sichtbar), 0);
    assert.match(sichtbar, /probe_ziel_unerlaubt/);
    assert.equal(vorfaelle.length, 0);
  }
});

test("Tageslimit: bei 5 Erstversuchen oder mehr als 8 Anrufen wird nicht gewählt, bei 4 und 8 schon", async () => {
  for (const stand of [{ erstversuche: 5, anrufe: 5 }, { erstversuche: 1, anrufe: 9 }]) {
    const { sichtbar, code } = await aufrufen({ fall: { stand } });
    assert.equal(code, 0);
    assert.equal(anrufe(sichtbar), 0);
    assert.match(sichtbar, /probe_tageslimit_erreicht/);
  }
  const { sichtbar } = await aufrufen({ fall: { stand: { erstversuche: 4, anrufe: 8 } } });
  assert.equal(anrufe(sichtbar), 1);
});

test("Tagesstand nicht lesbar oder unvollständig: nicht gewählt, Lauf rot", async () => {
  for (const stand of ["unklar", { erstversuche: 1 }, null]) {
    const { sichtbar, code } = await aufrufen({ fall: { stand } });
    assert.equal(code, 1);
    assert.equal(anrufe(sichtbar), 0);
    assert.match(sichtbar, /probe_tageszaehl_unklar/);
  }
});

test("Ohne Anrufer-Modul oder ohne gültigen Commit wird nicht gewählt und der Lauf ist rot", async () => {
  const ohneModul = await aufrufen({ umgebung: { PROBE_ANRUFER_MODUL: "" } });
  assert.equal(ohneModul.code, 1);
  assert.match(ohneModul.sichtbar, /probe_anrufer_fehlt/);
  const ohneCommit = await aufrufen({ umgebung: { GITHUB_SHA: "abc" } });
  assert.equal(ohneCommit.code, 1);
  assert.match(ohneCommit.sichtbar, /probe_commit_unklar/);
  assert.equal(anrufe(ohneCommit.sichtbar), 0);
});

test("Schlüssel, Zielnummer und Alarmadresse stehen nur in Maskierungszeilen, nie im sichtbaren Protokoll oder Vorfall", async () => {
  const { ausgabe, sichtbar, vorfaelle, schreibend, adresse } = await aufrufen({ fall: { messungen: [ROT, ROT] } });
  for (const geheim of [ZIEL, adresse]) {
    assert.ok(ausgabe.includes(`::add-mask::${geheim}`));
    assert.ok(!sichtbar.includes(geheim));
    assert.ok(!JSON.stringify(vorfaelle).includes(geheim));
    assert.ok(!JSON.stringify(schreibend).includes(geheim));
  }
});

test("Alarmweg Slack allein genügt: die Probe läuft", async () => {
  const { sichtbar, code, vorfaelle } = await aufrufen({
    ohneAdresse: true,
    umgebung: { SLACK_ALERT_URL: "http://127.0.0.1:1/x" },
  });
  assert.equal(code, 0);
  assert.equal(anrufe(sichtbar), 1);
  assert.equal(vorfaelle.length, 0);
});

test("Slack-Adresse erreicht den Kindprozess: beide rote Versuche melden an Slack", async () => {
  const empfangen = [];
  const slack = await dienstStarten((anfrage, roh, rueckgabe) => {
    empfangen.push(JSON.parse(roh));
    rueckgabe.writeHead(200);
    rueckgabe.end();
  });
  const { code, sichtbar } = await aufrufen({
    ohneAdresse: true,
    fall: { messungen: [ROT, ROT] },
    umgebung: { SLACK_ALERT_URL: `http://127.0.0.1:${slack}/s` },
  });
  assert.equal(code, 1);
  assert.match(sichtbar, /Slack: Vorfall gesendet/);
  assert.equal(empfangen.length, 1);
  assert.match(empfangen[0].text, /Staging-Anrufprobe rot/);
});
