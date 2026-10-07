import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifiesAsInboxEntry } from "../src/inbox-entry.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const AT = "2026-01-01T00:00:00Z";
const ERWARTETE_FALLZAHL = 18;
const caller = (text) => ({ role: "caller", text, at: AT });
const agent = (text) => ({ role: "agent", text, at: AT });
const GREETING = agent("Hallo, hier ist der KI-Assistent von Jonas Beispiel.");
const ON = { allowSummaries: true };
const OFF = { allowSummaries: false };

const inbound = (over = {}) =>
  seedCall({ direction: "inbound", from: "+4915112345678", to: "+15005550006", status: "completed", ...over });

const CASES = [
  ["Anrufer legt nach 1 s auf (nur Agent-Begruessung)", inbound({ transcript: [GREETING] }), ON, false],
  ["Rauschen/Echo (caller '.')", inbound({ transcript: [GREETING, caller(".")] }), ON, false],
  ["einzelnes Fuellwort (caller 'aeh')", inbound({ transcript: [GREETING, caller("aeh")] }), ON, false],
  ["einzelnes 'ok' (2 Zeichen, 1 Turn)", inbound({ transcript: [GREETING, caller("ok")] }), ON, false],
  ["zwei kurze echte Turns", inbound({ transcript: [GREETING, caller("Ja."), caller("Donnerstag.")] }), ON, true],
  ["ein langer Satz, dann auflegen", inbound({ transcript: [GREETING, caller("Ich wollte fragen, ob Sie Donnerstag Zeit haben")] }), ON, true],
  ["technischer Abbruch (failed) mit Inhalt", inbound({ status: "failed", transcript: [GREETING, caller("Ich wollte fragen, ob Sie Donnerstag Zeit haben")] }), ON, false],
  ["cancelled mit Inhalt", inbound({ status: "cancelled", transcript: [GREETING, caller("Ich wollte fragen, ob Sie Donnerstag Zeit haben")] }), ON, false],
  ["outbound mit Inhalt", inbound({ direction: "outbound", transcript: [GREETING, caller("Ich wollte fragen, ob Sie Donnerstag Zeit haben")] }), ON, false],
  ["echtes Gespraech, Summaries abgeschaltet", inbound({ transcript: [GREETING, caller("Ja."), caller("Donnerstag.")] }), OFF, false],
  ["echtes Gespraech, settings fehlt ganz", inbound({ transcript: [GREETING, caller("Ja."), caller("Donnerstag.")] }), undefined, false],
  ["leeres Transkript", inbound({ transcript: [] }), ON, false],
  ["Transkript fehlt ganz (kaputter Datensatz)", inbound({ transcript: undefined }), ON, false],
  ["nur Agent-Zeilen, viele", inbound({ transcript: [GREETING, agent("Noch da?"), agent("Hallo?")] }), ON, false],
  [
    "zwei kurze Turns UNTER der Zeichenschwelle (pinnt INBOX_MIN_CALLER_TURNS allein)",
    inbound({ transcript: [GREETING, caller("ok"), caller("ja")] }),
    ON,
    true,
  ],
  [
    "ein Turn mit exakt 12 Zeichen (Zeichenschwelle von unten)",
    inbound({ transcript: [GREETING, caller("Termine bald")] }),
    ON,
    true,
  ],
  [
    "ein Turn mit 11 Zeichen (Zeichenschwelle von oben - knapp verfehlt)",
    inbound({ transcript: [GREETING, caller("Termine bal")] }),
    ON,
    false,
  ],
  [
    "11 Zeichen + ein Fuellwort unter callerSubstanceMinLen (Fuellwort zaehlt nicht mit)",
    inbound({ transcript: [GREETING, caller("Termine bal"), caller(".")] }),
    ON,
    false,
  ],
];

test("INBOX-P1-A: die Fall-Tabelle aus E-2 haelt vollstaendig", () => {
  assert.equal(CASES.length, ERWARTETE_FALLZAHL, "Fall-Tabelle geschrumpft/gewachsen - Aenderung bewusst nachziehen");
  for (const [name, call, settings, expected] of CASES) {
    assert.equal(qualifiesAsInboxEntry(call, settings), expected, name);
  }
});

test("INBOX-P1-A-Sabotage: nie angekommen bleibt nie angekommen (Gegenprobe zu callerHasSpoken)", () => {
  for (const fragment of [".", "aeh", "mh", "ok", " ja "]) {
    assert.equal(
      qualifiesAsInboxEntry(inbound({ transcript: [GREETING, caller(fragment)] }), ON),
      false,
      `Rausch-/Fuellfragment "${fragment}" darf keinen Eintrag erzeugen`,
    );
  }
});

function makeHarness({ call, summarizeCall, settings = ON, omitQualifier = false }) {
  const protokoll = [];
  const store = {
    protokoll,
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: () => {},
    purgeTranscript: (id) => protokoll.push(`purge:${id}`),
    tenantContext: () => ({ settings: { agentName: "Hermes", ...settings } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: () => {},
    markInboxEntry: (id, qualifies) => protokoll.push(`mark:${id}:${qualifies}`),
  };
  const deps = {
    store,
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall,
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
    qualifiesAsInboxEntry: (aCall, aSettings) => {
      protokoll.push("praedikat");
      return qualifiesAsInboxEntry(aCall, aSettings);
    },
  };
  if (omitQualifier) delete deps.qualifiesAsInboxEntry;
  return { callFinish: makeCallFinish(deps), store };
}

const ECHTES_GESPRAECH = [GREETING, caller("Ja."), caller("Donnerstag.")];

test("INBOX-P1-B reihenfolge-vor-purge: das Praedikat laeuft VOR purgeTranscript", async () => {
  const call = inbound({ transcript: [...ECHTES_GESPRAECH] });
  const { callFinish, store } = makeHarness({ call, summarizeCall: async () => ({ summary: "x", actionItems: [] }) });
  await callFinish.finishCall(call);
  assert.deepEqual(store.protokoll, ["praedikat", `purge:${call.id}`, `mark:${call.id}:true`]);
});

test("INBOX-P1-B summary-exception-setzt-marker: summarizeCall wirft -> Marker steht trotzdem", async () => {
  const call = inbound({ transcript: [...ECHTES_GESPRAECH] });
  const { callFinish, store } = makeHarness({
    call,
    summarizeCall: async () => {
      throw new Error("llm down");
    },
  });
  await callFinish.finishCall(call);
  assert.ok(store.protokoll.includes(`mark:${call.id}:true`), "R-1: der Marker ueberlebt den Fehlerpfad");
});

test("INBOX-P1-B allowSummaries-false-kein-marker: der Tenant will keine Nachbereitung", async () => {
  const call = inbound({ transcript: [...ECHTES_GESPRAECH] });
  const { callFinish, store } = makeHarness({ call, summarizeCall: async () => null, settings: OFF });
  await callFinish.finishCall(call);
  assert.ok(store.protokoll.includes(`mark:${call.id}:false`), "kein Eintrag, aber der Aufruf faellt");
  assert.ok(!store.protokoll.includes(`mark:${call.id}:true`));
});

test("INBOX-P1-B fruehe-return-pfad: nicht-completed erreicht das Praedikat gar nicht", async () => {
  const call = inbound({ status: "no-answer", transcript: [] });
  const { callFinish, store } = makeHarness({ call, summarizeCall: async () => null });
  await callFinish.finishCall(call);
  assert.deepEqual(store.protokoll, [], "Frueh-Return VOR dem try: kein Praedikat, kein Marker");
});

test("INBOX-P1-B default-ist-fail-closed: ohne Verdrahtung entsteht KEIN Eintrag", async () => {
  const call = inbound({ transcript: [...ECHTES_GESPRAECH] });
  const { callFinish, store } = makeHarness({ call, summarizeCall: async () => null, omitQualifier: true });
  await callFinish.finishCall(call);
  assert.ok(store.protokoll.includes(`mark:${call.id}:false`));
  assert.ok(!store.protokoll.includes("praedikat"), "der Default lief, nicht die echte Regel");
});
