import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import vm from "node:vm";

import { OWNER_TEST_FIRST_NAME, mcpPost, readToolResult, seedCall, seedState, startServer, toolCall, waitUntil } from "../helpers.js";
import { ausgelieferteWidgets, skriptbloecke } from "../gemeinsam/ausgelieferte-widgets.js";
import { legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 5_000;
const ERGEBNIS = "ui/notifications/tool-result";
const ANRUF = (await ausgelieferteWidgets()).call;
const SKRIPT_I18N = skriptbloecke(ANRUF).find((code) => code.includes("HermesI18n = {"));
const SKRIPT_CALL = skriptbloecke(ANRUF).filter((code) => code.includes("TOOL_GET_STATUS")).at(-1);

const umgebung = {};
const gespeicherteAnrufe = () => umgebung.srv.readStore().calls;

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  const signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer, publicUrl: "https://agent.test", kennung: "5179-widget" }),
    VORSPANN_KLINGEL_FRIST_MS: "300",
    FRISTEN_TAKT_MS: "200",
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

async function statusAusMcp(callId) {
  const antwort = await mcpPost(`${umgebung.srv.localUrl}/mcp`, null, toolCall("get_call_status", { call_id: callId }));
  return (await readToolResult(antwort)).structuredContent;
}

async function statusNachKlingelfrist() {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(0));
  await waitUntil(() => gespeicherteAnrufe().find((eintrag) => eintrag.id === callId).status === "failed", { timeoutMs: WARTE_FRIST_MS });
  return statusAusMcp(callId);
}

function knoten() {
  const attribute = {};
  return {
    textContent: "",
    className: "",
    style: {},
    children: [],
    get firstChild() {
      return this.children[0] ?? null;
    },
    appendChild(kind) {
      this.children.push(kind);
      return kind;
    },
    removeChild() {},
    getAttribute: (name) => attribute[name] ?? null,
    setAttribute: (name, wert) => {
      attribute[name] = String(wert);
    },
    removeAttribute: (name) => {
      delete attribute[name];
    },
    addEventListener() {},
  };
}

function widgetImBrowser() {
  const knoten_je_wahl = new Map();
  const hole = (sel) => {
    if (!knoten_je_wahl.has(sel)) knoten_je_wahl.set(sel, knoten());
    return knoten_je_wahl.get(sel);
  };
  const hoerer = [];
  const gesendet = [];
  const takte = new Map();
  let zaehler = 0;
  const fenster = {
    __hermesUiReady: true,
    parent: { postMessage: (nachricht) => gesendet.push(nachricht.params) },
    setInterval: (fn) => {
      zaehler += 1;
      takte.set(zaehler, fn);
      return zaehler;
    },
    clearInterval: (id) => takte.delete(id),
    setTimeout: () => 1,
    clearTimeout() {},
    addEventListener: (art, fn) => art === "message" && hoerer.push(fn),
    dispatchEvent() {},
    CustomEvent: function CustomEvent(art) {
      this.type = art;
    },
    document: {
      documentElement: { lang: "" },
      readyState: "complete",
      body: knoten(),
      querySelector: hole,
      querySelectorAll: () => [...knoten_je_wahl.values()].filter((el) => el.getAttribute("data-i18n") !== null),
      createElement: knoten,
      addEventListener() {},
    },
  };
  fenster.window = fenster;
  vm.createContext(fenster);
  vm.runInContext(SKRIPT_I18N, fenster);
  vm.runInContext(SKRIPT_CALL, fenster);
  hole('[data-mcp="call_id"]').textContent = "c1";
  const schicke = (inhalt, sprache) =>
    hoerer.forEach((fn) => fn({ data: { method: ERGEBNIS, params: { structuredContent: inhalt, _meta: { "hermes/locale": sprache, "hermes/content_locale": sprache } } } }));
  const statusAbfragen = () => gesendet.filter((p) => p.name === "get_call_status").length;
  return { hole, schicke, statusAbfragen, laufendeTakte: () => takte.size, tick: () => [...takte.values()].forEach((fn) => fn()) };
}

async function zeigeBeendetImWidget(sprache) {
  const widget = widgetImBrowser();
  assert.equal(widget.laufendeTakte(), 1);
  widget.schicke(await statusNachKlingelfrist(), sprache);
  const abfragenNachEnde = widget.statusAbfragen();
  widget.tick();
  return { widget, abfragenNachEnde };
}

test("5179: ein nicht angenommener Vorspann-Anruf erscheint nach der Klingelfrist im Widget als beendet und das Widget fragt nicht weiter", async () => {
  const { widget, abfragenNachEnde } = await zeigeBeendetImWidget("en");

  assert.equal(widget.hole("[data-hud-phase]").textContent, "Nobody picked up.");
  assert.equal(widget.hole("[data-failure-display]").textContent, "No answer");
  assert.equal(widget.laufendeTakte(), 0);
  assert.equal(widget.statusAbfragen(), abfragenNachEnde);
});

test("5179: dasselbe Widget zeigt den nicht angenommenen Anruf auf Deutsch als Niemand hat abgenommen und Nicht erreicht", async () => {
  const { widget, abfragenNachEnde } = await zeigeBeendetImWidget("de");

  assert.equal(widget.hole("[data-hud-phase]").textContent, "Niemand hat abgenommen.");
  assert.equal(widget.hole("[data-failure-display]").textContent, "Nicht erreicht");
  assert.equal(widget.laufendeTakte(), 0);
  assert.equal(widget.statusAbfragen(), abfragenNachEnde);
});
