import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import vm from "node:vm";

import { registerTools } from "../../src/mcp-tools.js";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const STATUS = (await ausgelieferteWidgets())["agent-status"];
const WOERTERBUCH = JSON.parse(
  skriptbloecke(STATUS).find((code) => code.includes("HermesI18n = {")).match(/var WIDGET_DICT = (.*);\n/)[1],
);

function werkzeuge(kontext) {
  const handler = new Map();
  registerTools({ registerTool: (name, _konfig, fn) => handler.set(name, fn), registerResource() {} }, kontext);
  return handler;
}

async function mitGateway(state, fn) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(state));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn();
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await new Promise((fertig) => server.close(fertig));
  }
}

function zustand([zusammenfassungen, persoenlich, bank], monatsanrufe) {
  return {
    agent: { number: "+18643028341", owner: "Antonio" },
    usage: { calls: 19, planUsagePercent: 40, ...(monatsanrufe === undefined ? {} : { callsThisMonth: monatsanrufe }) },
    settings: { allowSummaries: zusammenfassungen, allowPersonalData: persoenlich, allowBankData: bank },
  };
}

async function status(sprache, einstellungen, monatsanrufe) {
  return mitGateway(zustand(einstellungen, monatsanrufe), () =>
    werkzeuge({ identity: null, scopedTenant: `tenant-${sprache}`, language: sprache }).get("get_agent_status")(),
  );
}

const TABELLE = [
  ["de", [false, false, false], "Gibt keine Daten weiter"],
  ["de", [true, false, false], "Darf Zusammenfassungen weitergeben"],
  ["de", [false, true, false], "Darf persönliche Daten weitergeben"],
  ["de", [false, false, true], "Darf Bankdaten weitergeben"],
  ["de", [true, true, false], "Darf Zusammenfassungen und persönliche Daten weitergeben"],
  ["de", [true, true, true], "Darf Zusammenfassungen, persönliche Daten und Bankdaten weitergeben"],
  ["en", [false, false, false], "Shares no data"],
  ["en", [true, false, true], "May share summaries and bank data"],
  ["en", [true, true, true], "May share summaries, personal data and bank data"],
  ["fr", [false, false, false], "Ne partage aucune donnée"],
  ["fr", [false, true, false], "Peut partager les données personnelles"],
  ["fr", [true, true, true], "Peut partager les résumés, les données personnelles et les données bancaires"],
];

test("widget-status K5: die Berechtigungen stehen als lesbarer Satz in der Sprache des Tenants", async () => {
  for (const [sprache, einstellungen, satz] of TABELLE) {
    const ergebnis = await status(sprache, einstellungen);
    assert.equal(ergebnis.structuredContent.permissions, satz, `${sprache} ${einstellungen}`);
  }
});

test("widget-status K5: die Textausgabe behält die bisherige Berechtigungszeile", async () => {
  const ergebnis = await status("de", [true, false, false]);
  assert.equal(
    ergebnis.content[0].text,
    "Agent-Nummer: +18643028341\nBesitzer: Antonio\nCalls bisher: 19\n" +
      "Monatsnutzung: 40 % des Minuten-Kontingents\n" +
      "Berechtigungen: Summaries=true, PersoenlicheDaten=false, Bankdaten=false",
  );
  assert.deepEqual(Object.keys(ergebnis.structuredContent).sort(), [
    "calls",
    "callsThisMonth",
    "number",
    "owner",
    "permissions",
    "planUsagePercent",
  ]);
  assert.equal(ergebnis.structuredContent.calls, 19);
});

function seite(sprache, mitWoerterbuch = true) {
  const anrufe = { text: "—", beobachter: [] };
  Object.defineProperty(anrufe, "textContent", {
    get() {
      return this.text;
    },
    set(wert) {
      this.text = wert;
      this.beobachter.forEach((b) => b());
    },
  });
  const wurzel = { beobachter: [] };
  const dokument = {
    documentElement: wurzel,
    querySelector: (sel) => (sel === '[data-mcp="callsThisMonth"]' ? anrufe : null),
  };
  class MutationObserver {
    constructor(rueckruf) {
      this.rueckruf = rueckruf;
    }
    observe(ziel) {
      ziel.beobachter.push(this.rueckruf);
    }
  }
  const i18n = { t: (key) => (i18n.sprache === "en" ? key : (WOERTERBUCH[i18n.sprache]?.[key] ?? key)) };
  i18n.sprache = sprache;
  const fenster = mitWoerterbuch ? { HermesI18n: i18n } : {};
  const kontext = vm.createContext({ document: dokument, MutationObserver, window: fenster });
  for (const code of skriptbloecke(STATUS).filter((s) => s.includes('data-mcp="callsThisMonth"'))) vm.runInContext(code, kontext);
  return { anrufe, wurzel, i18n };
}

test("widget-status K5: die Anrufzahl steht als „19 in diesem Monat“", () => {
  const de = seite("de");
  de.anrufe.textContent = "19";
  assert.equal(de.anrufe.text, "19 in diesem Monat");
  const en = seite("en");
  en.anrufe.textContent = "19";
  assert.equal(en.anrufe.text, "19 this month");
  const fr = seite("fr");
  fr.anrufe.textContent = "0";
  assert.equal(fr.anrufe.text, "0 ce mois-ci");
});

test("widget-status K5: ohne Zahl bleibt der Text stehen, ein Sprachwechsel setzt die Zeile neu", () => {
  const de = seite("de");
  assert.equal(de.anrufe.text, "—");
  for (const text of ["—", "x19", "19x", "1.5", ""]) {
    de.anrufe.textContent = text;
    assert.equal(de.anrufe.text, text, text);
  }
  de.anrufe.textContent = "  7 ";
  assert.equal(de.anrufe.text, "7 in diesem Monat");
  de.i18n.sprache = "fr";
  de.wurzel.beobachter.forEach((b) => b());
  assert.equal(de.anrufe.text, "7 ce mois-ci");
});

test("widget-status K5: ohne Wörterbuch steht die englische Zeile, vor der ersten Zahl bleibt der Strich", () => {
  const ohne = seite("de", false);
  ohne.wurzel.beobachter.forEach((b) => b());
  assert.equal(ohne.anrufe.text, "—");
  ohne.anrufe.textContent = "4";
  assert.equal(ohne.anrufe.text, "4 this month");
});

test("widget-status K5: callsThisMonth reicht die Monatszahl des Servers durch, calls bleibt die Summe seit Beginn", async () => {
  const ergebnis = await status("de", [true, true, true], 2);
  assert.equal(ergebnis.structuredContent.callsThisMonth, 2);
  assert.equal(ergebnis.structuredContent.calls, 19);
  const leer = await status("de", [true, true, true], 0);
  assert.equal(leer.structuredContent.callsThisMonth, 0);
  const ohne = await status("de", [true, true, true]);
  assert.equal(ohne.structuredContent.callsThisMonth, 0);
});

test("widget-status K5: die Karte schreibt „in diesem Monat“ nur an die Monatszahl, die Gesamtzahl bleibt unbeschriftet", () => {
  assert.match(STATUS, /data-mcp="callsThisMonth"/);
  assert.doesNotMatch(STATUS, /data-mcp="calls"/);
});
