import assert from "node:assert/strict";
import { after, test } from "node:test";

import { startServer, seedState, waitUntil } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";

const FRIST = { timeout: 60_000 };
const KURZER_TAKT_MS = 50;
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

function takt() {
  return [
    "const takt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
    "const echtesIntervall = globalThis.setInterval;",
    "let nummer = 0;",
    "globalThis.setInterval = (fn, ms, ...rest) => {",
    "  if (ms !== takt) return echtesIntervall(fn, ms, ...rest);",
    "  const eigene = nummer++;",
    `  return echtesIntervall((...args) => { console.log("[takt] " + eigene); return fn(...args); }, ${KURZER_TAKT_MS}, ...rest);`,
    "};",
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

function umgebung(adresse) {
  return {
    COST_TRUING_SWEEP_INTERVAL_MS: "61000",
    OUTAGE_ALERT_WINDOW_MS: String(FENSTER_MS),
    OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0",
    PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0",
    INBOUND_OUTAGE_ALERT_WINDOW_MS: "0",
    BETTERSTACK_ALERT_URL: adresse,
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(takt())}`,
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
const warteAuf = (bedingung) => waitUntil(bedingung, { timeoutMs: 30_000 });
const zaehleTakte = (srv) => {
  const je = new Map();
  for (const [, nummer] of srv.stdout.matchAll(/^\[takt\] (\d+)$/gm)) je.set(nummer, (je.get(nummer) ?? 0) + 1);
  return je;
};
async function warteAufWeitereTakte(srv) {
  const davor = zaehleTakte(srv);
  assert.ok(davor.size > 0, srv.stdout);
  await warteAuf(() => {
    const jetzt = zaehleTakte(srv);
    return [...davor].every(([nummer, anzahl]) => (jetzt.get(nummer) ?? 0) >= anzahl + WEITERE_TAKTE);
  });
}
const geschlossen = (srv) => Boolean(marker(srv).closedAt);

test("Erholung nach angenommener Meldung: genau ein resolved mit demselben incident.id, Marker geschlossen", FRIST, async () => {
  const eingang = await starteEingang([]);
  await mitServer({ adresse: eingang.url, gemeldet: true }, async (srv) => {
    await warteAuf(() => geschlossen(srv));
    await warteAufWeitereTakte(srv);
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
    await warteAuf(() => geschlossen(srv));
    await warteAufWeitereTakte(srv);
    assert.deepEqual(eingang.meldungen, []);
  });
});

test("Versuch ohne Annahme (alert in die Frist gelaufen): genau ein resolved, Marker geschlossen", FRIST, async () => {
  const eingang = await starteEingang([]);
  await mitServer({ adresse: eingang.url, gemeldet: false }, async (srv) => {
    await warteAuf(() => geschlossen(srv));
    await warteAufWeitereTakte(srv);
    assert.deepEqual(eingang.meldungen.map(({ id, status }) => [id, status]), [[GRUND, "resolved"]]);
  });
});

test("abgelehntes resolved: Marker bleibt offen, der naechste Takt wiederholt, nach 2xx kein weiteres", FRIST, async () => {
  const eingang = await starteEingang([HTTP_FEHLER]);
  await mitServer({ adresse: eingang.url, gemeldet: true }, async (srv) => {
    await warteAuf(() => geschlossen(srv));
    await warteAufWeitereTakte(srv);
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
    await warteAuf(() => srv.stdout.includes(`[outage] Better-Stack-Meldung ${GRUND} nicht zugestellt: `));
    assert.ok(!srv.stdout.includes(GEHEIMER_PFAD), srv.stdout);
    assert.ok(!srv.stdout.includes(stillgelegt.host), srv.stdout);
    assert.equal(geschlossen(srv), false);
  });
});

test("ohne gesetzte Adresse laeuft der Takt ohne Fehler und der Marker bleibt offen", FRIST, async () => {
  await mitServer({ adresse: "", gemeldet: true }, async (srv) => {
    await warteAuf(() => srv.stdout.includes(`outage_recovered klasse=${GRUND}`));
    await warteAufWeitereTakte(srv);
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
  const srv = await startServer({ env: umgebung(eingang.url), seed: stand });
  try {
    const zweiter = () => srv.readStore().outageAlerts.find((alert) => alert.code === ZWEITER_GRUND);
    await warteAuf(() => eingang.festgehalten() && Boolean(zweiter().closedAt));
    eingang.freigeben();
    await warteAuf(() => geschlossen(srv));
    await warteAufWeitereTakte(srv);
    assert.ok(!srv.stdout.includes("[outage-watch]"), srv.stdout);
    assert.equal(eingang.meldungen.filter(({ id }) => id === ZWEITER_GRUND).length, 1);
  } finally {
    await srv.stop();
  }
});
