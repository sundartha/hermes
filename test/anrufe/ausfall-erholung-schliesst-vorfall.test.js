import assert from "node:assert/strict";
import { after, test } from "node:test";

import { startServer, seedState, waitUntil } from "../helpers.js";
import { echtWarten } from "../echt-warten.js";
import { starteAttrappe } from "./attrappen-server.js";

const FRIST = { timeout: 60_000 };
const KURZER_TAKT_MS = 50;
const NACHLAUF_MS = 500;
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
    `globalThis.setInterval = (fn, ms, ...rest) => echtesIntervall(fn, ms === takt ? ${KURZER_TAKT_MS} : ms, ...rest);`,
  ].join("\n");
}

function erholterStand({ gemeldet }) {
  const stand = seedState();
  const vorhin = new Date(Date.now() - VORHIN_MS).toISOString();
  stand.outageAlerts = [
    {
      code: GRUND,
      firstSeenAt: vorhin,
      lastSeenAt: vorhin,
      lastAttemptAt: vorhin,
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

async function mitServer({ adresse, gemeldet }, ablauf) {
  const srv = await startServer({ env: umgebung(adresse), seed: erholterStand({ gemeldet }) });
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
const geschlossen = (srv) => Boolean(marker(srv).closedAt);

test("Erholung nach angenommener Meldung: genau ein resolved mit demselben incident.id, Marker geschlossen", FRIST, async () => {
  const eingang = await starteEingang([]);
  await mitServer({ adresse: eingang.url, gemeldet: true }, async (srv) => {
    await warteAuf(() => geschlossen(srv));
    await echtWarten(NACHLAUF_MS);
    assert.equal(eingang.meldungen.length, 1);
    const [meldung] = eingang.meldungen;
    assert.equal(meldung.id, GRUND);
    assert.equal(meldung.status, "resolved");
    assert.ok(meldung.text.includes(`klasse=${GRUND}`), meldung.text);
  });
});

test("Erholung ohne angenommene Meldung: kein resolved, Marker wird trotzdem geschlossen", FRIST, async () => {
  const eingang = await starteEingang([]);
  await mitServer({ adresse: eingang.url, gemeldet: false }, async (srv) => {
    await warteAuf(() => geschlossen(srv));
    await echtWarten(NACHLAUF_MS);
    assert.deepEqual(eingang.meldungen, []);
  });
});

test("abgelehntes resolved: Marker bleibt offen, der naechste Takt wiederholt, nach 2xx kein weiteres", FRIST, async () => {
  const eingang = await starteEingang([HTTP_FEHLER]);
  await mitServer({ adresse: eingang.url, gemeldet: true }, async (srv) => {
    await warteAuf(() => geschlossen(srv));
    await echtWarten(NACHLAUF_MS);
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
    await echtWarten(NACHLAUF_MS);
    assert.ok(!srv.stdout.includes("Ausfall-Melder fehlgeschlagen"), srv.stdout);
    assert.equal(geschlossen(srv), false);
  });
});
