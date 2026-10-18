import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { echtWarten } from "../echt-warten.js";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HERMES_CTL = join(REPO, "tools", "hermes-ctl.mjs");
const BEFEHL_FRIST_MS = 90000;
const TEST_FRIST = { timeout: 170000 };
const PARALLELE_WEBHOOKS = 20;
const NACHLAUF_TAKTE = 10;
const NACHLAUF_TAKT_MS = 100;
const PEER = "+4915112345678";
const ANTWORT = "Ja, Donnerstag um 15 Uhr passt.";
const PG_FEHLERZEILE = /ECONNRESET|\[pg\].*fehlgeschlagen/;
const EXIT_FEHLER = 1;
const EXIT_AUFRUF = 2;
const PID_OHNE_PROZESS = 99999999;
const SPERRDATEI_IN_ANWEISUNG = /lösche (\S+)\.$/;
const SITZUNGEN = ["anruf", "last", "stopp", "doppelt", "abbruch", "waehrend", "verwaist", "neustart"];
const GERADE_IN_ARBEIT = /wird gerade gestartet oder gestoppt/;
const SUCH_TAKT_MS = 20;
const LOKALE_ADRESSE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/;
const WIRT_MIT_KIND = 2;
const UNTERBEFEHLE = [
  "start",
  "werkzeug",
  "bestaetigen",
  "webhook",
  "anbieter",
  "zustand",
  "flaechen",
  "stopp",
  "hilfe",
];

const arbeitsordner = mkdtempSync(join(tmpdir(), "hermes-ctl-test-"));

async function hermesCtl(sitzung, ...argumente) {
  const texte = argumente.map((wert) => (typeof wert === "string" ? wert : JSON.stringify(wert)));
  const lauf = await new Promise((fertig) => {
    execFile(
      process.execPath,
      [HERMES_CTL, ...texte, "--sitzung", sitzung],
      { cwd: REPO, env: { ...process.env, TMPDIR: arbeitsordner }, timeout: BEFEHL_FRIST_MS },
      (fehler, stdout, stderr) => fertig({ exit: fehler?.code ?? 0, stdout, stderr }),
    );
  });
  const zeilen = lauf.stdout.split("\n").filter((zeile) => zeile !== "");
  assert.equal(
    zeilen.length,
    1,
    `genau eine Ausgabezeile erwartet:\n${lauf.stdout}\n${lauf.stderr}`,
  );
  return { exit: lauf.exit, ausgabe: JSON.parse(zeilen[0]) };
}

function sitzungMit(name) {
  return async (...argumente) => {
    const { exit, ausgabe } = await hermesCtl(name, ...argumente);
    assert.equal(exit, 0, JSON.stringify(ausgabe));
    assert.equal(ausgabe.ok, true, JSON.stringify(ausgabe));
    assert.equal(typeof ausgabe.ms, "number");
    return ausgabe;
  };
}

after(async () => {
  try {
    await Promise.all(SITZUNGEN.map((sitzung) => hermesCtl(sitzung, "stopp")));
  } finally {
    rmSync(arbeitsordner, { recursive: true, force: true });
  }
});

const prozessNummern = (start) =>
  JSON.parse(readFileSync(start.zustandsdatei, "utf8")).prozesse.map(({ pid }) => pid);

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (fehler) {
    return fehler.code === "EPERM";
  }
}

async function rueckfrageBeantworten(ctl, anruf) {
  const warten = ctl("werkzeug", "await_call_event", { call_id: anruf.call_id });
  const rueckfrage = ctl("webhook", "elevenlabs-consult", {
    conversation_id: anruf.conversation_id,
    question: "Passt Donnerstag um 15 Uhr?",
  });
  const { ergebnis: ereignis } = await warten;
  assert.equal(ereignis.event, "consult");
  await ctl("werkzeug", "answer_consult", {
    call_id: anruf.call_id,
    event_id: ereignis.event_id,
    answers: [ANTWORT],
  });
  return rueckfrage;
}

test(
  "ein vollständiger Anruf mit Recherche und Rückfrage endet mit Zusammenfassung, danach lebt kein Prozess mehr",
  TEST_FRIST,
  async () => {
    const ctl = sitzungMit("anruf");
    const pids = prozessNummern(await ctl("start"));
    const anruf = await ctl("bestaetigen", {
      to: PEER,
      objective: "Termin am Donnerstag vereinbaren",
    });
    const recherche = await ctl("webhook", "elevenlabs-lookup", {
      conversation_id: anruf.conversation_id,
      query: "Öffnungszeiten Bäckerei am Markt",
    });
    assert.equal(recherche.status, 200);
    assert.equal(recherche.koerper.status, "ok");

    const beantwortet = await rueckfrageBeantworten(ctl, anruf);
    assert.equal(beantwortet.status, 200);
    assert.equal(beantwortet.koerper.status, "answered");
    assert.match(beantwortet.koerper.answer, /Donnerstag um 15 Uhr/);

    await ctl("anbieter", "elevenlabs-ende", { call_id: anruf.call_id });
    const ende = await ctl("zustand", anruf.call_id, "--warten-auf", "completed");
    assert.equal(ende.status, "completed");
    const { ergebnis } = await ctl("werkzeug", "get_call_result", { call_id: anruf.call_id });
    assert.ok(ergebnis.result_summary.length > 0);

    const stopp = await ctl("stopp");
    assert.deepEqual(stopp.beendet.map(({ pid }) => pid).sort(), [...pids].sort());
    assert.deepEqual(pids.filter(lebt), []);
  },
);

describe("mit laufender Sitzung", TEST_FRIST, () => {
  const ctl = sitzungMit("last");
  let start;

  before(async () => {
    start = await ctl("start");
  });

  after(() => hermesCtl("last", "stopp"));

  test("20 parallele Telnyx-Statusrückrufe werden alle mit 200 angenommen, ohne abgerissene Datenbankverbindung", async () => {
    const antworten = await Promise.all(
      Array.from({ length: PARALLELE_WEBHOOKS }, (_unbenutzt, nummer) =>
        ctl("webhook", "telnyx-status", {
          callId: `call_unbekannt_${nummer}`,
          CallStatus: "completed",
        }),
      ),
    );
    assert.deepEqual(
      antworten.map(({ status }) => status),
      Array(PARALLELE_WEBHOOKS).fill(200),
    );
    const protokoll = JSON.parse(readFileSync(start.zustandsdatei, "utf8")).protokolle.hermes;
    for (let takt = 0; takt < NACHLAUF_TAKTE; takt += 1) {
      await echtWarten(NACHLAUF_TAKT_MS);
      const fehlerzeilen = readFileSync(protokoll, "utf8")
        .split("\n")
        .filter((zeile) => PG_FEHLERZEILE.test(zeile));
      assert.deepEqual(fehlerzeilen, []);
    }
  });

  test("die Zustandsdatei nennt für ElevenLabs, Exa und Anthropic je eine Attrappe auf diesem Rechner", () => {
    const { attrappen } = JSON.parse(readFileSync(start.zustandsdatei, "utf8"));
    for (const anbieter of ["elevenLabs", "exa", "anthropic"]) {
      assert.match(attrappen[anbieter], LOKALE_ADRESSE, anbieter);
    }
  });

  test("ein falsch signierter Telnyx-Webhook wird mit 403 abgelehnt", async () => {
    const abgelehnt = await ctl(
      "webhook",
      "telnyx-status",
      { callId: "call_gefaelscht", CallStatus: "completed" },
      "--falsche-signatur",
    );
    assert.equal(abgelehnt.status, 403);
  });

  test("zustand --warten-auf endet nach seiner Frist mit dem erreichten Status, wenn der Anruf den gewünschten nicht erreicht", async () => {
    const anruf = await ctl("bestaetigen", {
      to: PEER,
      objective: "Rückruf wegen Lieferung klären",
    });
    const { exit, ausgabe } = await hermesCtl(
      "last",
      "zustand",
      anruf.call_id,
      "--warten-auf",
      "completed",
    );
    assert.equal(exit, EXIT_FEHLER);
    assert.match(ausgabe.fehler, /nicht auf completed/);
    assert.match(ausgabe.tun, /elevenlabs-ende/);
  });
});

test(
  "stopp zweimal hintereinander beendet beim ersten Mal die Prozesse und meldet beim zweiten Mal eine leere Liste",
  TEST_FRIST,
  async () => {
    const ctl = sitzungMit("stopp");
    const pids = prozessNummern(await ctl("start"));
    const erstes = await ctl("stopp");
    assert.deepEqual(erstes.beendet.map(({ pid }) => pid).sort(), pids.sort());
    assert.deepEqual(pids.filter(lebt), []);
    const zweites = await ctl("stopp");
    assert.deepEqual(zweites.beendet, []);
  },
);

async function doppeltStartenUndStoppen() {
  const laeufe = await Promise.all([hermesCtl("doppelt", "start"), hermesCtl("doppelt", "start")]);
  const gestartet = laeufe.filter(({ ausgabe }) => ausgabe.ok);
  const abgelehnt = laeufe.filter(({ ausgabe }) => !ausgabe.ok);
  assert.equal(gestartet.length, 1, JSON.stringify(laeufe));
  const [{ exit, ausgabe: verweigert }] = abgelehnt;
  assert.equal(exit, EXIT_FEHLER);
  assert.match(verweigert.fehler, GERADE_IN_ARBEIT);
  const pids = prozessNummern(gestartet[0].ausgabe);
  const stopp = await sitzungMit("doppelt")("stopp");
  assert.deepEqual(stopp.beendet.map(({ pid }) => pid).sort(), pids.sort());
  assert.deepEqual(pids.filter(lebt), []);
  const [, sperrdatei] = verweigert.tun.match(SPERRDATEI_IN_ANWEISUNG);
  return sperrdatei;
}

test(
  "zwei gleichzeitige start derselben Sitzung starten Hermes genau einmal, auch wenn ein abgebrochener Start seine Sperre liegen ließ",
  TEST_FRIST,
  async () => {
    const sperrdatei = await doppeltStartenUndStoppen();
    writeFileSync(sperrdatei, String(PID_OHNE_PROZESS));
    await doppeltStartenUndStoppen();
  },
);

test("ein Sitzungsname mit Pfadteilen wird abgelehnt und löscht nichts außerhalb des Sitzungsordners", async () => {
  const fremd = join(arbeitsordner, "fremd");
  mkdirSync(fremd, { recursive: true });
  writeFileSync(join(fremd, "bleibt.txt"), "");
  const { exit, ausgabe } = await hermesCtl("../fremd", "stopp");
  assert.equal(exit, EXIT_FEHLER);
  assert.match(ausgabe.fehler, /Ungültiger Sitzungsname/);
  assert.equal(existsSync(join(fremd, "bleibt.txt")), true);
});

test("hilfe nennt genau die neun Unterbefehle", async () => {
  const ausgabe = await sitzungMit("nie-gestartet")("hilfe");
  assert.deepEqual(
    ausgabe.befehle.map(({ aufruf }) => aufruf.split(" ")[0]),
    UNTERBEFEHLE,
  );
});

test("flaechen zählt Werkzeuge, Routen und Webhooks passend zur Liste", async () => {
  const { anzahl, flaechen } = await sitzungMit("nie-gestartet")("flaechen");
  assert.deepEqual(Object.keys(anzahl).sort(), ["Route", "Webhook", "Werkzeug"]);
  for (const [art, zahl] of Object.entries(anzahl)) {
    assert.equal(flaechen.filter((eintrag) => eintrag.art === art).length, zahl);
  }
  assert.ok(flaechen.some(({ art, flaeche }) => art === "Werkzeug" && flaeche === "place_call"));
});

test(
  "ein Werkzeugaufruf ohne laufende Sitzung endet mit Exit ungleich 0 und sagt, was zu tun ist",
  TEST_FRIST,
  async () => {
    const { exit, ausgabe } = await hermesCtl("nie-gestartet", "werkzeug", "list_calls", "{}");
    assert.notEqual(exit, 0);
    assert.equal(ausgabe.ok, false);
    assert.match(ausgabe.fehler, /nie-gestartet/);
    assert.match(ausgabe.tun, /start/);
  },
);

async function alsUnbekanntAbgelehnt(argumente, exit, fehler) {
  const { exit: erhalten, ausgabe } = await hermesCtl("nie-gestartet", ...argumente);
  assert.equal(erhalten, exit);
  assert.equal(ausgabe.ok, false);
  assert.match(ausgabe.fehler, fehler);
}

test("der geerbte Objektname toString wird als unbekannter Befehl abgelehnt", () =>
  alsUnbekanntAbgelehnt(["toString"], EXIT_AUFRUF, /Unbekannter Befehl: toString/));

test("der geerbte Objektname constructor wird als unbekannter Webhook abgelehnt", () =>
  alsUnbekanntAbgelehnt(
    ["webhook", "constructor", "{}"],
    EXIT_FEHLER,
    /Unbekannter Webhook: constructor/,
  ));

const sitzungsOrdner = (sitzung) => join(arbeitsordner, "hermes-ctl", sitzung);

async function bisOrdnerDa(sitzung) {
  while (!existsSync(sitzungsOrdner(sitzung))) await echtWarten(SUCH_TAKT_MS);
}

const prozessZeilen = (spalten) =>
  execFileSync("ps", ["-axo", spalten], { encoding: "utf8" }).split("\n");

const felder = (zeile) => zeile.trim().split(/\s+/);

function prozesseDerGruppe(gruppe) {
  return prozessZeilen("pid=,pgid=")
    .map((zeile) => felder(zeile).map(Number))
    .filter(([, pgid]) => pgid === gruppe);
}

async function wirtNummer(sitzung) {
  const kennung = `wirt.mjs ${sitzungsOrdner(sitzung)}`;
  for (;;) {
    const zeile = prozessZeilen("pid=,args=").find((eintrag) => eintrag.includes(kennung));
    if (zeile !== undefined) return Number(felder(zeile)[0]);
    await echtWarten(SUCH_TAKT_MS);
  }
}

test(
  "stirbt der Wirt beim Hochfahren, meldet start das Scheitern und lässt keinen Prozess seiner Gruppe zurück",
  TEST_FRIST,
  async () => {
    const start = hermesCtl("abbruch", "start");
    const wirt = await wirtNummer("abbruch");
    while (prozesseDerGruppe(wirt).length < WIRT_MIT_KIND) await echtWarten(SUCH_TAKT_MS);
    process.kill(wirt, "SIGKILL");
    const { exit, ausgabe } = await start;
    assert.equal(exit, EXIT_FEHLER);
    assert.match(ausgabe.fehler, /Start der Sitzung „abbruch“ gescheitert/);
    assert.deepEqual(prozesseDerGruppe(wirt), []);
    assert.equal(existsSync(sitzungsOrdner("abbruch")), false);
  },
);

async function startHartAbbrechen(sitzung) {
  const start = execFile(process.execPath, [HERMES_CTL, "start", "--sitzung", sitzung], {
    cwd: REPO,
    env: { ...process.env, TMPDIR: arbeitsordner },
  });
  const wirt = await wirtNummer(sitzung);
  start.kill("SIGKILL");
  return wirt;
}

test(
  "bricht start hart ab, bevor der Wirt bereit ist, beendet stopp den weiterlaufenden Wirt samt seiner Gruppe",
  TEST_FRIST,
  async () => {
    const wirt = await startHartAbbrechen("verwaist");
    const stopp = await sitzungMit("verwaist")("stopp");
    assert.deepEqual(stopp.beendet, [{ rolle: "wirt", pid: wirt }]);
    assert.equal(lebt(wirt), false);
    assert.deepEqual(prozesseDerGruppe(wirt), []);
    assert.equal(existsSync(sitzungsOrdner("verwaist")), false);
  },
);

test(
  "bricht start hart ab, beendet ein zweites start den weiterlaufenden Wirt samt seiner Gruppe, bevor es neu startet",
  TEST_FRIST,
  async () => {
    const alt = await startHartAbbrechen("neustart");
    const ctl = sitzungMit("neustart");
    const pids = prozessNummern(await ctl("start"));
    assert.equal(lebt(alt), false);
    assert.deepEqual(prozesseDerGruppe(alt), []);
    assert.equal(pids.includes(alt), false);
    const stopp = await ctl("stopp");
    assert.deepEqual(stopp.beendet.map(({ pid }) => pid).sort(), pids.sort());
  },
);

test(
  "stopp während eines laufenden start wird abgelehnt, der Start läuft zu Ende und lässt sich danach stoppen",
  TEST_FRIST,
  async () => {
    const start = hermesCtl("waehrend", "start");
    await bisOrdnerDa("waehrend");
    const { exit, ausgabe } = await hermesCtl("waehrend", "stopp");
    assert.equal(exit, EXIT_FEHLER);
    assert.match(ausgabe.fehler, GERADE_IN_ARBEIT);
    const gestartet = await start;
    assert.equal(gestartet.ausgabe.ok, true, JSON.stringify(gestartet.ausgabe));
    const pids = prozessNummern(gestartet.ausgabe);
    const stopp = await sitzungMit("waehrend")("stopp");
    assert.deepEqual(stopp.beendet.map(({ pid }) => pid).sort(), pids.sort());
  },
);

test("ein Argument, das kein JSON ist, wird mit Hinweis auf die Schreibweise abgelehnt", async () => {
  const { exit, ausgabe } = await hermesCtl(
    "nie-gestartet",
    "werkzeug",
    "list_calls",
    "{kein json",
  );
  assert.equal(exit, EXIT_FEHLER);
  assert.match(ausgabe.fehler, /Kein gültiges JSON/);
  assert.match(ausgabe.tun, /einfachen Anführungszeichen/);
});

test("ein unbekanntes Anbieter-Ereignis wird abgelehnt und nennt das bekannte", async () => {
  const { exit, ausgabe } = await hermesCtl("nie-gestartet", "anbieter", "elevenlabs-anfang", "{}");
  assert.equal(exit, EXIT_FEHLER);
  assert.match(ausgabe.fehler, /Unbekanntes Anbieter-Ereignis: elevenlabs-anfang/);
  assert.match(ausgabe.tun, /elevenlabs-ende/);
});
