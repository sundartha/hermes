import assert from "node:assert/strict";
import { after, test } from "node:test";

import { logBis } from "../gemeinsam/log-bis.mjs";
import { startServer, seedState, waitUntil } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { PLATFORM_ALERT_SMS_TO_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";

const FRIST = { timeout: 60_000 };
const WEITERE_TAKTE = 2;
const FENSTER_MS = 3_600_000;
const VORHIN_MS = 60_000;
const HTTP_OK = 200;
const HTTP_FEHLER = 500;
const GEHEIMER_PFAD = "geheimer-eingang-q7x9";
const GRUND = "not-placed:invite-403";
const ZIEL = "+4915112345678";

const geoeffnet = [];
after(async () => {
  await Promise.all(geoeffnet.map((schliessen) => schliessen()));
});

async function starteEingang(antworten) {
  const meldungen = [];
  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const { incident, text } = JSON.parse(roh);
      if (incident.id !== GRUND) return res.writeHead(HTTP_OK).end();
      meldungen.push({ id: incident.id, status: incident.status, text });
      res.writeHead(antworten[meldungen.length - 1] ?? HTTP_OK).end();
    });
  });
  geoeffnet.push(attrappe.close);
  return { url: `${attrappe.url}/${GEHEIMER_PFAD}`, host: new URL(attrappe.url).host, meldungen };
}

function takt(ueberlappung) {
  return [
    "const takt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
    "const echtesIntervall = globalThis.setInterval;",
    "const echtesPromise = globalThis.Promise;",
    "const laeufe = [];",
    "let runden = 0;",
    "function starteLauf(fn) {",
    "  let erstes = null;",
    "  let gesehen = false;",
    "  globalThis.Promise = new Proxy(echtesPromise, {",
    "    construct(ziel, argumente) {",
    "      const zuerst = !gesehen;",
    "      gesehen = true;",
    "      const neues = Reflect.construct(ziel, argumente);",
    "      if (zuerst) erstes = neues;",
    "      return neues;",
    "    },",
    "  });",
    "  try { fn(); } finally { globalThis.Promise = echtesPromise; }",
    "  return erstes;",
    "}",
    "function loeseAus(lauf) {",
    `  if (lauf.laeuft && !${ueberlappung}) { console.log("[takt-uebersprungen] " + lauf.nummer); return null; }`,
    "  lauf.laeuft = true;",
    '  console.log("[takt] " + lauf.nummer);',
    "  const fertig = () => { lauf.laeuft = false; };",
    "  const ende = echtesPromise.resolve(starteLauf(lauf.fn));",
    "  ende.then(fertig, fertig);",
    "  return ende;",
    "}",
    "globalThis.setInterval = (fn, ms, ...rest) => {",
    "  if (ms !== takt) return echtesIntervall(fn, ms, ...rest);",
    "  laeufe.push({ fn, nummer: laeufe.length, laeuft: false });",
    "  return echtesIntervall(() => {}, ms, ...rest);",
    "};",
    'process.on("SIGUSR2", () => {',
    "  const runde = ++runden;",
    "  const gestartet = laeufe.map(loeseAus).filter(Boolean);",
    '  console.log("[takt-runde] " + runde);',
    '  echtesPromise.allSettled(gestartet).then(() => console.log("[takt-runde-fertig] " + runde));',
    "});",
  ].join("\n");
}

function erholterStand({ gemeldet, versucht = true }) {
  const stand = seedState();
  const vorhin = new Date(Date.now() - VORHIN_MS).toISOString();
  stand.outageAlerts = [
    {
      code: GRUND,
      firstSeenAt: vorhin,
      lastSeenAt: vorhin,
      lastAttemptAt: versucht ? vorhin : null,
      reportedAt: gemeldet ? vorhin : null,
      deliveredChannels: gemeldet ? "better-stack" : null,
      closedAt: null,
    },
  ];
  stand.calls = [
    { id: "call_ok", direction: "outbound", to: ZIEL, endedAt: vorhin, answeredAt: vorhin, failureReason: null },
  ];
  return stand;
}

function umgebung(adresse, ueberlappung = false) {
  return {
    COST_TRUING_SWEEP_INTERVAL_MS: "61000",
    OUTAGE_ALERT_WINDOW_MS: String(FENSTER_MS),
    PLATFORM_ALERT_SMS_TO: PLATFORM_ALERT_SMS_TO_BEISPIEL,
    OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0",
    PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0",
    INBOUND_OUTAGE_ALERT_WINDOW_MS: "0",
    BETTERSTACK_ALERT_URL: adresse,
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(takt(ueberlappung))}`,
  };
}

async function mitServer({ adresse, gemeldet, versucht }, ablauf) {
  const srv = await startServer({ env: umgebung(adresse), seed: erholterStand({ gemeldet, versucht }) });
  try {
    return await ablauf(srv);
  } catch (fehler) {
    throw new Error(`${fehler.message}\n${srv.stdout}`, { cause: fehler });
  } finally {
    await srv.stop();
  }
}

const marker = (srv) => srv.readStore().outageAlerts.find((alert) => alert.code === GRUND);
const warteAuf = (bedingung) => waitUntil(bedingung, { timeoutMs: FRIST.timeout });
const OHNE_EIGENE_FRIST = new AbortController().signal;
const zeile = (srv, text) => logBis(srv, `${text}\n`, { signal: OHNE_EIGENE_FRIST });
const rundenGesendet = new WeakMap();
async function sendeRunde(srv) {
  const nummer = (rundenGesendet.get(srv) ?? 0) + 1;
  rundenGesendet.set(srv, nummer);
  srv.child.kill("SIGUSR2");
  await zeile(srv, `[takt-runde] ${nummer}`);
  return nummer;
}
async function laufeRunde(srv) {
  await zeile(srv, `[takt-runde-fertig] ${await sendeRunde(srv)}`);
}
async function laufeWeitereRunden(srv) {
  for (let nummer = 0; nummer < WEITERE_TAKTE; nummer++) await laufeRunde(srv);
}
const zuGrund = (eingang) => eingang.meldungen.filter(({ id }) => id === GRUND);
const zaehleUebersprungene = (srv) => [...srv.stdout.matchAll(/^\[takt-uebersprungen\] \d+$/gm)].length;
const geschlossen = (srv) => Boolean(marker(srv).closedAt);

test("Erholung nach angenommener Meldung: genau ein resolved mit demselben incident.id, Marker geschlossen", FRIST, async () => {
  const eingang = await starteEingang([]);
  await mitServer({ adresse: eingang.url, gemeldet: true }, async (srv) => {
    await laufeRunde(srv);
    await warteAuf(() => geschlossen(srv));
    await laufeWeitereRunden(srv);
    assert.equal(eingang.meldungen.length, 1);
    const [meldung] = eingang.meldungen;
    assert.equal(meldung.id, GRUND);
    assert.equal(meldung.status, "resolved");
    assert.ok(meldung.text.includes(`klasse=${GRUND}`), meldung.text);
  });
});

test("Erholung ohne je versuchte Meldung: kein resolved, Marker wird sofort geschlossen", FRIST, async () => {
  const eingang = await starteEingang([]);
  await mitServer({ adresse: eingang.url, gemeldet: false, versucht: false }, async (srv) => {
    await laufeRunde(srv);
    await warteAuf(() => geschlossen(srv));
    await laufeWeitereRunden(srv);
    assert.deepEqual(eingang.meldungen, []);
  });
});

test("Versuch ohne Annahme (alert in die Frist gelaufen): genau ein resolved, Marker geschlossen", FRIST, async () => {
  const eingang = await starteEingang([]);
  await mitServer({ adresse: eingang.url, gemeldet: false }, async (srv) => {
    await laufeRunde(srv);
    await warteAuf(() => geschlossen(srv));
    await laufeWeitereRunden(srv);
    assert.deepEqual(eingang.meldungen.map(({ id, status }) => [id, status]), [[GRUND, "resolved"]]);
  });
});

test("abgelehntes resolved: Marker bleibt offen, der naechste Takt wiederholt, nach 2xx kein weiteres", FRIST, async () => {
  const eingang = await starteEingang([HTTP_FEHLER]);
  await mitServer({ adresse: eingang.url, gemeldet: true }, async (srv) => {
    await laufeRunde(srv);
    await laufeRunde(srv);
    await warteAuf(() => geschlossen(srv));
    await laufeWeitereRunden(srv);
    assert.deepEqual(eingang.meldungen.map(({ id, status }) => [id, status]), [
      [GRUND, "resolved"],
      [GRUND, "resolved"],
    ]);
  });
});

test("ohne Eingang bleibt der Marker offen, Ausgabe nennt weder Adresse noch Pfad", FRIST, async () => {
  const stillgelegt = await starteEingang([]);
  await Promise.all(geoeffnet.splice(0).map((schliessen) => schliessen()));
  await mitServer({ adresse: stillgelegt.url, gemeldet: true }, async (srv) => {
    await laufeRunde(srv);
    assert.ok(srv.stdout.includes(`[outage] Better-Stack-Meldung ${GRUND} nicht zugestellt: `), srv.stdout);
    assert.ok(!srv.stdout.includes(GEHEIMER_PFAD), srv.stdout);
    assert.ok(!srv.stdout.includes(stillgelegt.host), srv.stdout);
    assert.equal(geschlossen(srv), false);
  });
});

test("ohne gesetzte Adresse laeuft der Takt ohne Fehler und der Marker bleibt offen", FRIST, async () => {
  await mitServer({ adresse: "", gemeldet: true }, async (srv) => {
    await laufeRunde(srv);
    assert.ok(srv.stdout.includes(`outage_recovered klasse=${GRUND}`), srv.stdout);
    await laufeWeitereRunden(srv);
    assert.ok(!srv.stdout.includes("Ausfall-Melder fehlgeschlagen"), srv.stdout);
    assert.equal(geschlossen(srv), false);
  });
});

const ZWEITER_GRUND = "not-placed:invite-404";

async function starteHaltendenEingang() {
  const meldungen = [];
  let festgehalten = null;
  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const { incident } = JSON.parse(roh);
      meldungen.push({ id: incident.id, status: incident.status });
      if (incident.id === GRUND && festgehalten === null) {
        festgehalten = res;
        return;
      }
      res.writeHead(HTTP_OK).end();
    });
  });
  geoeffnet.push(attrappe.close);
  return {
    url: `${attrappe.url}/${GEHEIMER_PFAD}`,
    meldungen,
    festgehalten: () => festgehalten !== null,
    freigeben: () => festgehalten.writeHead(HTTP_OK).end(),
  };
}

test("Marker wird waehrend des Takts von anderer Seite geschlossen: der Takt laeuft ohne Fehler durch, kein resolved fuer den zweiten Marker aus dem alten Takt", FRIST, async () => {
  const eingang = await starteHaltendenEingang();
  const stand = erholterStand({ gemeldet: true });
  stand.outageAlerts.push({ ...stand.outageAlerts[0], code: ZWEITER_GRUND });
  const srv = await startServer({ env: umgebung(eingang.url, true), seed: stand });
  try {
    const zweiter = () => srv.readStore().outageAlerts.find((alert) => alert.code === ZWEITER_GRUND);
    await sendeRunde(srv);
    await warteAuf(() => eingang.festgehalten());
    await sendeRunde(srv);
    await warteAuf(() => Boolean(zweiter().closedAt));
    eingang.freigeben();
    await zeile(srv, "[takt-runde-fertig] 1");
    await zeile(srv, "[takt-runde-fertig] 2");
    await warteAuf(() => geschlossen(srv));
    await laufeWeitereRunden(srv);
    assert.ok(!srv.stdout.includes("[outage-watch]"), srv.stdout);
    assert.equal(eingang.meldungen.filter(({ id }) => id === ZWEITER_GRUND).length, 1);
  } finally {
    await srv.stop();
  }
});

test("langsamer Eingang haelt die Antwort ueber mehrere Takte fest: genau ein resolved, Marker geschlossen", FRIST, async () => {
  const eingang = await starteHaltendenEingang();
  await mitServer({ adresse: eingang.url, gemeldet: true }, async (srv) => {
    await sendeRunde(srv);
    await warteAuf(() => eingang.festgehalten());
    for (let nummer = 0; nummer <= WEITERE_TAKTE; nummer++) await sendeRunde(srv);
    assert.ok(zaehleUebersprungene(srv) >= WEITERE_TAKTE + 1, srv.stdout);
    assert.deepEqual(zuGrund(eingang), [{ id: GRUND, status: "resolved" }]);
    eingang.freigeben();
    await zeile(srv, "[takt-runde-fertig] 1");
    await warteAuf(() => geschlossen(srv));
    await laufeWeitereRunden(srv);
    assert.deepEqual(zuGrund(eingang), [{ id: GRUND, status: "resolved" }]);
  });
});
