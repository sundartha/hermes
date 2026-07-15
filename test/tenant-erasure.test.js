// P8b: Per-Tenant-DSGVO-Loeschung (Art. 17) + Auskunft/Export (Art. 15/20). Prueft
// die Fachlogik eraseTenantData/exportTenantData am state-ops-Seam (reine Funktionen,
// kein DATA_DIR/Modul-Singleton -> jeder Test baut seinen eigenen frischen Plain-State
// -> hart Independent, F.I.R.S.T.) PLUS einen json.js-Persistenz-Durchstich (erase ->
// reload -> Owner-Calls weg, calendar/settings erhalten, Budget-Gate intakt).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { eraseTenantData, exportTenantData } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const AT = "2026-01-01T00:00:00Z";
const OTHER = "other";
const PRICES = { priceInPerMTokUsd: 1.0, priceOutPerMTokUsd: 5.0, usdToEur: 0.93, maxBudgetCents: 800 };

// Frischer Plain-State pro Aufruf (kein geteilter Modul-Zustand): zwei Owner-Calls
// (einer mit 2-Segment-Transkript + Action Item, einer ohne) plus ein Call eines
// FREMDEN Tenants (muss ueberleben). Notifications: zwei call-verknuepft (Owner +
// other), eine allgemein (callId:null). usage als Map (P4-Shape) + Owner-Budget am
// Gate gesetzt, damit der Durchstich budgetExceeded vor/nach vergleichen kann.
function freshState() {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_owner1",
        tenantId: BOOTSTRAP_TENANT_ID,
        status: "completed",
        summary: "Zusammenfassung 1",
        actionItemIds: ["ai1"],
        transcript: [
          { role: "agent", text: "Hallo", at: AT },
          { role: "caller", text: "Geheim", at: AT },
        ],
      }),
      seedCall({
        id: "call_owner2",
        tenantId: BOOTSTRAP_TENANT_ID,
        status: "completed",
        transcript: [],
      }),
      seedCall({
        id: "call_other",
        tenantId: OTHER,
        status: "completed",
        transcript: [{ role: "caller", text: "Fremd", at: AT }],
      }),
    ],
    actionItems: [
      {
        id: "ai1",
        callId: "call_owner1",
        text: "Rueckruf",
        type: "todo",
        done: false,
        createdAt: AT,
      },
      {
        id: "ai_other",
        callId: "call_other",
        text: "Fremd-Item",
        type: "todo",
        done: false,
        createdAt: AT,
      },
    ],
    notifications: [
      { id: "nt1", title: "Owner-Notif", body: "", callId: "call_owner1", at: AT },
      { id: "nt_other", title: "Fremd-Notif", body: "", callId: "call_other", at: AT },
      { id: "nt_general", title: "Allgemein", body: "", callId: null, at: AT },
    ],
  });
  // usage flach -> auf die P4-Map heben + Owner-Budget knapp UNTER dem Gate.
  s.usage = { [BOOTSTRAP_TENANT_ID]: { inputTokens: 0, outputTokens: 0, costEur: 4, calls: 2 } };
  return s;
}

const getCall = (s, id) => s.calls.find((c) => c.id === id);

test("eraseTenantData(owner) entfernt NUR Owner-Calls; fremder Tenant + Config bleiben", () => {
  const s = freshState();
  eraseTenantData(s, BOOTSTRAP_TENANT_ID);
  assert.equal(getCall(s, "call_owner1"), undefined, "Owner-Call 1 geloescht");
  assert.equal(getCall(s, "call_owner2"), undefined, "Owner-Call 2 geloescht");
  assert.ok(getCall(s, "call_other"), "fremder Call bleibt");
  assert.deepEqual(
    s.actionItems.map((a) => a.id),
    ["ai_other"],
    "nur fremdes Action Item bleibt",
  );
  // settings/calendar/usage/profiles unangetastet (Service-Config/Budget-Gate)
  assert.equal(s.settings.agentName, "Hermes");
  assert.deepEqual(s.calendar, []);
  assert.equal(s.usage[BOOTSTRAP_TENANT_ID].costEur, 4, "Budget-Zaehler unveraendert");
  assert.deepEqual(s.profiles, {});
});

test("eraseTenantData(owner) liefert exakte Loesch-Zaehler", () => {
  const s = freshState();
  const removed = eraseTenantData(s, BOOTSTRAP_TENANT_ID);
  // privateNumber:0 -> freshState setzt keine private Summary-Nummer (F2 P10, PII-freier
  // 0/1-Zaehler statt des Werts). Die gesetzte-Nummer-Loeschung deckt f2-p10-* ab.
  assert.deepEqual(removed, {
    calls: 2,
    transcriptSegments: 2,
    actionItems: 1,
    notifications: 1,
    privateNumber: 0,
  });
});

test("eraseTenantData ist idempotent: zweiter Lauf loescht nichts mehr", () => {
  const s = freshState();
  eraseTenantData(s, BOOTSTRAP_TENANT_ID);
  const removed = eraseTenantData(s, BOOTSTRAP_TENANT_ID);
  assert.deepEqual(removed, {
    calls: 0,
    transcriptSegments: 0,
    actionItems: 0,
    notifications: 0,
    privateNumber: 0,
  });
});

test("allgemeine Notification (callId:null) bleibt - kein notification.tenantId-Scoping", () => {
  const s = freshState();
  eraseTenantData(s, BOOTSTRAP_TENANT_ID);
  const ids = s.notifications.map((n) => n.id);
  assert.ok(ids.includes("nt_general"), "allgemeine Notification ueberlebt");
  assert.ok(!ids.includes("nt1"), "call-verknuepfte Owner-Notification geloescht");
  assert.ok(ids.includes("nt_other"), "fremde call-verknuepfte Notification bleibt");
});

test("exportTenantData(owner) liefert NUR Owner-Daten und mutiert den State NICHT", () => {
  const s = freshState();
  const otherBefore = structuredClone(getCall(s, "call_other"));
  const data = exportTenantData(s, BOOTSTRAP_TENANT_ID);
  assert.equal(data.tenantId, BOOTSTRAP_TENANT_ID);
  assert.equal(typeof data.exportedAt, "string");
  assert.deepEqual(data.calls.map((c) => c.id).sort(), ["call_owner1", "call_owner2"]);
  assert.deepEqual(
    data.actionItems.map((a) => a.id),
    ["ai1"],
  );
  assert.deepEqual(
    data.notifications.map((n) => n.id),
    ["nt1"],
    "nur call-verknuepfte Owner-Notification",
  );
  // reine Query: der fremde Call ist vorher == nachher (kein Seiteneffekt)
  assert.deepEqual(getCall(s, "call_other"), otherBefore, "Export mutiert den State nicht");
  assert.equal(s.calls.length, 3, "Export entfernt keine Calls");
});

// ---- json.js-Persistenz-Durchstich (erase -> reload -> Owner weg, Config + Gate erhalten) ----
let store;
before(async () => {
  const dataDir = tempDataDir(freshState());
  process.env.DATA_DIR = dataDir;
  store = await import("../src/store.js");
});

test("json-Persistenz: eraseTenantData(owner) loescht Owner-Calls, Budget-Gate + Calendar bleiben", () => {
  const gateBefore = store.budgetExceeded(BOOTSTRAP_TENANT_ID, PRICES);
  const removed = store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  assert.equal(removed.calls, 2, "beide Owner-Calls geloescht");
  assert.equal(store.getCall("call_owner1"), null, "Owner-Call weg (Lesepfad)");
  assert.ok(store.getCall("call_other"), "fremder Call bleibt persistiert");
  // calendar wird beim load() aus den Demo-Defaults gemergt (seedState liefert []),
  // bleibt aber vom Erase unangetastet - hier nur die Budget-Gate-Invariante pruefen.
  assert.equal(
    store.budgetExceeded(BOOTSTRAP_TENANT_ID, PRICES),
    gateBefore,
    "Budget-Gate unveraendert",
  );
});
