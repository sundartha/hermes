import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { scheduleSessionRetention } from "../../src/wiring/session-aufbewahrung.js";

const ABGELAUFEN_NACH_TAGEN = 30;
const SECHS_STUNDEN_MS = 6 * 60 * 60 * 1000;

function runnerMit(query) {
  return { withClient: (fn) => fn({ query }) };
}

function zeitplanAttrappe() {
  const angemeldet = [];
  return {
    angemeldet,
    plane: async (name, intervallMs, lauf) => {
      angemeldet.push({ name, intervallMs, lauf });
    },
  };
}

async function planen(query) {
  const zeitplan = zeitplanAttrappe();
  await scheduleSessionRetention(runnerMit(query), zeitplan);
  await new Promise((fertig) => setImmediate(fertig));
  return zeitplan.angemeldet[0];
}

const ausfall = () => Promise.reject(new Error("verbindung weg"));

test("Periodischer Lauf wirft bei Fehler der Loeschabfrage, damit kein Herzschlag gesetzt wird", async () => {
  const fehler = mock.method(console, "error", () => {});
  try {
    const plan = await planen(ausfall);
    assert.equal(plan.name, "session-aufbewahrung");
    assert.equal(plan.intervallMs, SECHS_STUNDEN_MS);
    await assert.rejects(() => plan.lauf.lauf(), { message: "verbindung weg" });
  } finally {
    fehler.mock.restore();
  }
});

test("Fehler im periodischen Lauf wird ueber beiFehler geloggt", async () => {
  const fehler = mock.method(console, "error", () => {});
  try {
    const plan = await planen(ausfall);
    fehler.mock.resetCalls();
    plan.lauf.beiFehler(new Error("verbindung weg"));
    assert.deepEqual(
      fehler.mock.calls.map((aufruf) => aufruf.arguments),
      [["[retention] Session-Aufraeumen fehlgeschlagen:", "verbindung weg"]],
    );
  } finally {
    fehler.mock.restore();
  }
});

test("Start-Lauf bei Boot loggt den Fehler einmal und wirft nicht ungefangen", async () => {
  const fehler = mock.method(console, "error", () => {});
  try {
    await planen(ausfall);
    assert.deepEqual(
      fehler.mock.calls.map((aufruf) => aufruf.arguments),
      [["[retention] Session-Aufraeumen fehlgeschlagen:", "verbindung weg"]],
    );
  } finally {
    fehler.mock.restore();
  }
});

test("Erfolgreicher periodischer Lauf loescht nach 30 Tagen, loggt die Zahl und wirft nicht", async () => {
  const log = mock.method(console, "log", () => {});
  const aufrufe = [];
  const query = async (text, parameter) => {
    aufrufe.push(parameter);
    return { rows: [{ id: "a" }, { id: "b" }] };
  };
  try {
    const plan = await planen(query);
    log.mock.resetCalls();
    await plan.lauf.lauf();
    assert.deepEqual(aufrufe.at(-1), [ABGELAUFEN_NACH_TAGEN]);
    assert.deepEqual(
      log.mock.calls.map((aufruf) => aufruf.arguments),
      [[`[retention] 2 Sessions geloescht (aelter als ${ABGELAUFEN_NACH_TAGEN} Tage)`]],
    );
  } finally {
    log.mock.restore();
  }
});
