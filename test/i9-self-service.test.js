// I9 — Self-Service-Login + getrennter Tenant-Pfad + engere Settings-Whitelist.
// Reiner Spawn-node:test (KEIN pglite in derselben Datei - Lehre p6a-Stall).
// Zweiter synthetischer Tenant B (seedState-Vorarbeit aus I1) + zwei Identitaeten:
//   - Tenant B = Request MIT X-Internal-Identity=<idpSubject> an srv.localUrl
//                (localhost -> vertraut, requestTenant -> resolveTenant(sub) -> B)
//   - unbekannt = vorhandene, aber unaufloesbare Identitaet -> REJECT -> 403
// Flag AN = MULTI_TENANT=true + SELF_SERVICE_ENABLED=true. Flag AUS (BASE_ENV-Default
// fuer SELF_SERVICE_ENABLED) -> Self-Service-Routen 404, Admin-Pfad byte-identisch.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { OWNER_TENANT_ID, defaultSettings } from "../src/store/defaults.js";
import { GREETING_TEMPLATES } from "../src/self-service.js";

const TENANT_B = "B";
const SUB_B = "sub-b";
const SUB_UNKNOWN = "sub-unbekannt"; // VORHANDENE, aber unaufloesbare Identitaet -> REJECT

const postJson = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const getJson = (url, headers = {}) => fetch(url, { headers });
const asTenant = (sub) => ({ "X-Internal-Identity": sub });
const tenantB = () => ({ id: TENANT_B, status: "active", idpSubject: SUB_B });

// Seed mit einem vorbelegten B-Settings-Bucket (Map-Form). seedState liefert eine
// FLACHE settings-Form (Owner-Bucket nach Migration); fuer die restrict-only-Vektoren
// (allowBankData-Vorbedingung) braucht B einen eigenen Bucket VOR dem ersten Write.
// json.load() erkennt die Map an fehlendem top-level agentName und uebernimmt beide
// Buckets gegen die Defaults aufgefuellt - der vorgeseedete B-Bucket ueberlebt.
function seedWithBSettings(bSettings, extra = {}) {
  const base = seedState({ tenants: [tenantB()], ...extra });
  return { ...base, settings: { [OWNER_TENANT_ID]: {}, [TENANT_B]: bSettings } };
}

const SS_ENV = { MULTI_TENANT: "true", SELF_SERVICE_ENABLED: "true" };

test("I9 (a) Lese-Sicht: B liest NUR B's Daten, Owner-Call nicht enthalten", async (t) => {
  const srv = await startServer({
    env: SS_ENV,
    seed: seedState({
      tenants: [tenantB()],
      calls: [
        seedCall({ id: "call_owner", tenantId: OWNER_TENANT_ID, streamToken: "owner-geheim" }),
        seedCall({ id: "call_b", tenantId: TENANT_B, streamToken: "b-geheim" }),
      ],
    }),
  });
  try {
    await t.test("GET /api/self-service/state als B -> 200, nur B's Call, kein streamToken", async () => {
      const res = await getJson(`${srv.localUrl}/api/self-service/state`, asTenant(SUB_B));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.calls.length, 1, "nur B's Call");
      assert.equal(body.calls[0].id, "call_b");
      assert.equal(body.calls.some((c) => c.id === "call_owner"), false, "Owner-Call NICHT enthalten");
      assert.equal("streamToken" in body.calls[0], false, "streamToken NIE geleakt (publicCall)");
      assert.deepEqual(body.greetingTemplates, GREETING_TEMPLATES, "Vorlagen mitgeliefert");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (b) Schreiben: B setzt agentName + allowCalendar; Owner-Bucket unberuehrt", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("agentName landet in B-Bucket, Owner unveraendert", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { agentName: "B-Agent", allowCalendar: false }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      const stored = srv.readStore().settings;
      assert.equal(stored[TENANT_B].agentName, "B-Agent", "B-Bucket traegt B's Wert");
      assert.equal(stored[TENANT_B].allowCalendar, false, "allowCalendar gesetzt");
      assert.equal(stored[OWNER_TENANT_ID].agentName, "Vodafone Agent", "Owner-Bucket unveraendert");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (c1) Nicht-Whitelist-Feld (allowSummaries) wird ignoriert", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("allowSummaries:false bleibt true (nicht in der Self-Service-Whitelist)", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { allowSummaries: false }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      assert.equal(srv.readStore().settings[TENANT_B].allowSummaries, true, "allowSummaries nicht geschrieben");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (c2) Restrict-only: allowBankData false->true wird abgelehnt", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedWithBSettings({ allowBankData: false }) });
  try {
    await t.test("Hochheben false->true ignoriert -> bleibt false", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { allowBankData: true }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      assert.equal(srv.readStore().settings[TENANT_B].allowBankData, false, "false->true abgelehnt");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (c3) Restrict-only: allowBankData true->false ist erlaubt", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedWithBSettings({ allowBankData: true }) });
  try {
    await t.test("Herabsetzen true->false wird geschrieben", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { allowBankData: false }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      assert.equal(srv.readStore().settings[TENANT_B].allowBankData, false, "true->false erlaubt");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (d1) greeting-Freitext wird abgelehnt (nur Vorlage)", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("Freitext aendert greeting NICHT (bleibt Default)", async () => {
      // Der (erfolglose) Write flusht den B-Bucket via updateSettings(save) als Map:
      // greeting bleibt die geseedete Default-Begruessung, der Freitext landet nie.
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { greeting: "Hallo ich bin boese {owner}" }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      assert.equal(srv.readStore().settings[TENANT_B].greeting, defaultSettings().greeting, "greeting unveraendert (Default)");
      assert.notEqual(srv.readStore().settings[TENANT_B].greeting, "Hallo ich bin boese {owner}", "Freitext nicht uebernommen");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (d2) greeting-Vorlage wird akzeptiert", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("Vorlage aus GREETING_TEMPLATES landet im B-Bucket", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { greeting: GREETING_TEMPLATES[1] }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      assert.equal(srv.readStore().settings[TENANT_B].greeting, GREETING_TEMPLATES[1], "Vorlage uebernommen");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (e) Disclosure-Abschalt-Versuch wird abgelehnt (keine neuen Keys)", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("allowDisclosureOff/disclosure ignoriert -> nur Default-Keys im B-Bucket", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { allowDisclosureOff: true, disclosure: "" }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      const bucket = srv.readStore().settings[TENANT_B];
      assert.equal("allowDisclosureOff" in bucket, false, "kein erfundenes Disclosure-Off-Feld");
      assert.equal("disclosure" in bucket, false, "kein disclosure-Feld geschrieben");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (f) Fail-closed: unbekannte Identitaet -> 403, kein reject-Bucket, Owner unberuehrt", async (t) => {
  const srv = await startServer({ env: SS_ENV, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("GET /api/self-service/state als unbekannt -> 403", async () => {
      assert.equal((await getJson(`${srv.localUrl}/api/self-service/state`, asTenant(SUB_UNKNOWN))).status, 403);
    });

    await t.test("POST /api/self-service/settings als unbekannt -> 403, kein reject-Bucket", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`,
        { agentName: "Boese" }, asTenant(SUB_UNKNOWN));
      assert.equal(res.status, 403);
      // 403 schreibt NICHT -> kein save() -> der Store bleibt in der FLACHEN Seed-Form
      // (Owner-Settings top-level, json.load() migriert nur in-memory). Beide
      // Invarianten sind shape-tolerant pruefbar: kein reject-Bucket UND der Owner-
      // agentName unveraendert (NIE Owner-Fallback), egal ob flach oder Map.
      const stored = srv.readStore().settings;
      assert.equal("reject" in stored, false, "kein Pseudo-Tenant-Bucket");
      assert.equal(JSON.stringify(stored).includes("Boese"), false, "boeser Wert nirgends geschrieben");
      const ownerName = stored.agentName || (stored[OWNER_TENANT_ID] && stored[OWNER_TENANT_ID].agentName);
      assert.equal(ownerName, "Vodafone Agent", "Owner-Bucket unveraendert (NIE Owner-Fallback)");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (g1) Flag AUS: Self-Service-Routen sind 404 (nicht registriert)", async (t) => {
  // SELF_SERVICE_ENABLED nicht gesetzt (BASE_ENV: "false"), MULTI_TENANT trotzdem an.
  const srv = await startServer({ env: { MULTI_TENANT: "true" }, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("GET /api/self-service/state -> 404", async () => {
      assert.equal((await getJson(`${srv.localUrl}/api/self-service/state`, asTenant(SUB_B))).status, 404);
    });

    await t.test("POST /api/self-service/settings -> 404", async () => {
      assert.equal((await postJson(`${srv.localUrl}/api/self-service/settings`, { agentName: "X" }, asTenant(SUB_B))).status, 404);
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (g2) Flag AUS: Admin POST /api/settings unveraendert (I9 beruehrt Admin-Pfad nicht)", async (t) => {
  // SELF_SERVICE_ENABLED aus, MULTI_TENANT an: POST /api/settings ist weiter
  // tenant-gescopt (I6) - B schreibt B's Bucket, genau wie ohne I9.
  const srv = await startServer({ env: { MULTI_TENANT: "true" }, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("Admin-Settings als B schreiben B's Bucket (I6-Verhalten, kein I9-Eingriff)", async () => {
      const res = await postJson(`${srv.localUrl}/api/settings`, { agentName: "Via-Admin" }, asTenant(SUB_B));
      assert.equal(res.status, 200);
      const stored = srv.readStore().settings;
      assert.equal(stored[TENANT_B].agentName, "Via-Admin", "Admin-Pfad scopt weiter auf B (I6)");
      assert.equal(stored[OWNER_TENANT_ID].agentName, "Vodafone Agent", "Owner unveraendert");
    });
  } finally {
    await srv.stop();
  }
});

test("I9 (g3) SELF_SERVICE_ENABLED an, MULTI_TENANT AUS: Routen 404, Owner-Bucket unberuehrt", async (t) => {
  // Defense-in-depth (Safety-Review-Concern): ohne MULTI_TENANT ist requestTenant
  // immer Owner -> Self-Service ist an config.multiTenant gekoppelt und darf NICHT
  // registriert sein (sonst schriebe ein localhost-Patch in den Owner-Bucket).
  const srv = await startServer({ env: { SELF_SERVICE_ENABLED: "true" }, seed: seedState({ tenants: [tenantB()] }) });
  try {
    await t.test("GET /api/self-service/state -> 404 (nicht registriert)", async () => {
      assert.equal((await getJson(`${srv.localUrl}/api/self-service/state`, asTenant(SUB_B))).status, 404);
    });

    await t.test("POST /api/self-service/settings -> 404, kein Write in den Owner-Bucket", async () => {
      const res = await postJson(`${srv.localUrl}/api/self-service/settings`, { agentName: "MTOFF" }, asTenant(SUB_B));
      assert.equal(res.status, 404);
      assert.equal(JSON.stringify(srv.readStore().settings).includes("MTOFF"), false, "kein Write");
    });
  } finally {
    await srv.stop();
  }
});
