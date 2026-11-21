import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_TELNYX_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";
import { urteilen } from "../../scripts/anruf-probe/urteil.mjs";

const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const JETZT = Date.parse("2026-11-17T10:00:00.000Z");
const COMMIT = "e".repeat(40);
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const GRUSS =
  "Hallo, hier ist der KI-Assistent von Probe GmbH. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?";
const GRUSS_OWNER = "Hey, hier ist Hermes, dein KI-Assistent. Wie kann ich dir helfen?";
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

const GUT = {
  annahmeSekunden: 4,
  begruessung: GRUSS,
  gegenseite: [GRUSS],
  stillstandSekunden: 4,
  sprache: "de",
  auftraggeber: "Probe GmbH",
  vorname: "Anna",
  richtung: "eingehend",
  dauerSekunden: 30,
  status: "completed",
};

const TABELLE = [
  ["eine Eröffnung ist grün", {}, []],
  ["Eröffnung zweimal als eigene Zeilen", { gegenseite: [GRUSS, GRUSS] }, ["eroeffnung_doppelt"]],
  ["Eröffnung zweimal in einer Zeile", { gegenseite: [`${GRUSS} ${GRUSS}`] }, ["eroeffnung_doppelt"]],
  ["Eröffnung als Fremd- und Owner-Fassung", { gegenseite: [GRUSS, GRUSS_OWNER] }, ["eroeffnung_doppelt"]],
  ["Eröffnung mit anderen Zeilen dazwischen ist grün", { gegenseite: [GRUSS, "Ja, gern."] }, []],
  ["ausgehend: Offenlegung zweimal", { richtung: "ausgehend", begruessung: "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.", gegenseite: ["Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.", "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst."] }, ["eroeffnung_doppelt"]],
  ["unbekannte Sprache meldet nur offenlegung", { sprache: "xx", gegenseite: [GRUSS, GRUSS] }, ["offenlegung"]],
  ["Stillstand genau 20 s ist grün", { stillstandSekunden: 20 }, []],
  ["Stillstand 21 s ist rot", { stillstandSekunden: 21 }, ["stillstand"]],
  ["Stillstand nicht gemessen ist nicht rot", { stillstandSekunden: undefined }, []],
  ["Dopplung und Stillstand und Status", { gegenseite: [GRUSS, GRUSS], stillstandSekunden: 30, status: "failed" }, ["eroeffnung_doppelt", "stillstand", "status"]],
];

for (const [name, abweichung, erwartet] of TABELLE) {
  test(`Hörprobe Urteil: ${name}`, () => {
    const urteil = urteilen({ ...GUT, ...abweichung });
    assert.deepEqual(urteil.gerissen, erwartet);
    assert.equal(urteil.gruen, erwartet.length === 0);
  });
}

function antwort(strukturiert) {
  const rpc = { jsonrpc: "2.0", id: 1, result: { isError: false, structuredContent: strukturiert } };
  return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
}

function stand(abweichung = {}) {
  return {
    call_id: "c1",
    status: "in_progress",
    duration_s: 0,
    started_at: new Date(JETZT).toISOString(),
    answered_at: new Date(JETZT + 4000).toISOString(),
    last_transcript_lines: [],
    failure_reason: null,
    ...abweichung,
  };
}

async function messen(fensterJeAbfrage) {
  const uhr = { zeit: JETZT, jetzt: () => uhr.zeit, warte: async (ms) => (uhr.zeit += ms) };
  const aufgelegt = [];
  const abfrage = async (url, optionen) => {
    const { name } = JSON.parse(optionen.body).params;
    if (name === "place_call") return antwort({ call_id: "c1", status: "dialing" });
    if (name === "cancel_call") {
      aufgelegt.push(uhr.zeit);
      return antwort({});
    }
    const nummer = uhr.zeit === JETZT ? 0 : (uhr.zeit - JETZT) / 2000;
    const fenster = fensterJeAbfrage(nummer);
    if (fenster === "ende") return antwort(stand({ status: "completed", duration_s: 30 }));
    return antwort(stand({ last_transcript_lines: fenster }));
  };
  const anrufer = anruferBauen({
    basis: BASIS,
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
  });
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  return { messung, aufgelegt };
}

const G = `Gegenseite: ${GRUSS}`;

test("Hörprobe Anrufer: sich überlappende Fenster derselben Eröffnung zählen einmal, Urteil grün", async () => {
  const { messung } = await messen((n) => {
    if (n === 0) return [];
    if (n === 1 || n === 2) return [G];
    if (n === 3) return [G, "Agent: Hallo"];
    return "ende";
  });
  assert.deepEqual(messung.gegenseite, [GRUSS]);
  assert.equal(messung.begruessung, GRUSS);
  assert.equal(messung.stillstandSekunden, 4);
  assert.deepEqual(urteilen(messung), { gruen: true, gerissen: [] });
});

test("Hörprobe Anrufer: zwei Eröffnungen hintereinander werden beide gesammelt, Urteil eroeffnung_doppelt", async () => {
  const { messung } = await messen((n) => {
    if (n === 0) return [];
    if (n === 1) return [G];
    if (n === 2) return [G, G];
    if (n === 3) return [G, G, "Agent: Hallo"];
    return "ende";
  });
  assert.deepEqual(messung.gegenseite, [GRUSS, GRUSS]);
  assert.deepEqual(urteilen(messung).gerissen, ["eroeffnung_doppelt"]);
});

test("Hörprobe Anrufer: Stillstand zählt von der ersten Eröffnung bis zur nächsten Zeile jeder Rolle", async () => {
  const frueh = await messen((n) => (n === 0 ? [] : n === 1 ? [G] : n === 2 ? [G, "Agent: Hallo"] : "ende"));
  assert.equal(frueh.messung.stillstandSekunden, 2);
  const spaet = await messen((n) => (n === 0 ? [] : n === 1 ? [G] : n < 12 ? [G] : n === 12 ? [G, "Agent: Hallo"] : "ende"));
  assert.equal(spaet.messung.stillstandSekunden, 22);
  assert.deepEqual(urteilen(spaet.messung).gerissen, ["stillstand"]);
});

test("Hörprobe Anrufer: Ende ohne weitere Zeile innerhalb der Grenze ist grün, danach rot", async () => {
  const knapp = await messen((n) => (n === 0 ? [] : n < 11 ? [G] : "ende"));
  assert.equal(knapp.messung.stillstandSekunden, 20);
  assert.deepEqual(urteilen(knapp.messung).gerissen, []);
  const lang = await messen((n) => (n === 0 ? [] : n < 12 ? [G] : "ende"));
  assert.equal(lang.messung.stillstandSekunden, 22);
  assert.deepEqual(urteilen(lang.messung).gerissen, ["stillstand"]);
});

test("Hörprobe Anrufer: läuft der Anruf stumm bis zum harten Auflegen, ist der Stillstand bis dahin gemessen", async () => {
  const { messung, aufgelegt } = await messen((n) => (n === 0 ? [] : n === 1 ? [G] : n <= 30 ? [G] : "ende"));
  assert.equal(aufgelegt.length, 1);
  assert.equal(messung.stillstandSekunden, aufgelegt[0] / 1000 - JETZT / 1000 - 2);
  assert.ok(urteilen(messung).gerissen.includes("stillstand"));
});

test("Hörprobe Anrufer: ohne Gegenseitenzeile bleibt der Stillstand ungemessen", async () => {
  const { messung } = await messen((n) => (n === 0 ? [] : n === 1 ? ["Agent: Hallo"] : "ende"));
  assert.deepEqual(messung.gegenseite, []);
  assert.equal(messung.stillstandSekunden, undefined);
});

function dienstStarten(behandeln) {
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => behandeln(anfrage, Buffer.concat(teile).toString(), rueckgabe));
  });
  server.push(dienst);
  return new Promise((fertig) => dienst.listen(0, "127.0.0.1", () => fertig(dienst.address().port)));
}

async function probeLaufen(messungen, umgebung = {}) {
  const vorfaelle = [];
  const betterStack = await dienstStarten((anfrage, roh, rueckgabe) => {
    vorfaelle.push(JSON.parse(roh));
    rueckgabe.writeHead(200);
    rueckgabe.end();
  });
  const github = await dienstStarten((anfrage, roh, rueckgabe) => {
    rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    rueckgabe.end(anfrage.method === "GET" ? "[]" : JSON.stringify({ number: 31 }));
  });
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "88",
    GITHUB_SHA: COMMIT,
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    STAGING_URL: BASIS,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, stand: { erstversuche: 0, anrufe: 0 }, messungen }),
    BETTER_STACK_ALERT_URL: `http://127.0.0.1:${betterStack}/geheim-pfad`,
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { vorfaelle, ausgabe, code };
}

test("Hörprobe Lauf: doppelte Eröffnung in beiden Versuchen ist rot mit Namen und erreicht den Alarmweg", async () => {
  const doppelt = { ...GUT, gegenseite: [GRUSS, GRUSS] };
  const { vorfaelle, ausgabe, code } = await probeLaufen([doppelt, doppelt]);
  assert.equal(code, 1);
  assert.match(ausgabe, /Probe rot: eroeffnung_doppelt/);
  assert.equal(vorfaelle.length, 1);
  assert.deepEqual(vorfaelle[0].incident, { id: "probe-staging", status: "alert" });
});

test("Hörprobe Lauf: Stillstand ist rot mit Namen, eine grüne Wiederholung hebt den Erstversuch auf", async () => {
  const still = { ...GUT, stillstandSekunden: 40 };
  const rot = await probeLaufen([still, still]);
  assert.match(rot.ausgabe, /Probe rot: stillstand/);
  assert.equal(rot.vorfaelle.length, 1);
  const erholt = await probeLaufen([still, GUT]);
  assert.equal(erholt.code, 0);
  assert.equal(erholt.vorfaelle.length, 0);
});

test("Hörprobe Lauf: absichtlich_rot macht die Probe auch mit grüner Messung rot und meldet", async () => {
  const { vorfaelle, ausgabe, code } = await probeLaufen([GUT], { ABSICHTLICH_ROT: "true" });
  assert.equal(code, 1);
  assert.match(ausgabe, /Probe rot: messung/);
  assert.equal(vorfaelle.length, 1);
});
