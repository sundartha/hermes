// P8/FMT-28-Konsum: die "Heute ist ..."-Zeile des Systemprompts gilt in der Zeitzone des
// TENANTS (store.tenantTimezone), nicht der Server-Prozess-Zeitzone. In-process, Muster
// test/personal-assistant-characterization.test.js (DATA_DIR vor config-Import, dann
// dynamischer Import der reinen Funktionen).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_TIMEZONE } from "../src/store/defaults.js";

const T_AUCKLAND = "t_auckland";
const T_BERLIN = "t_berlin";
const T_GARBAGE = "t_garbage";
const T_NO_TZ = "t_no_tz";

let systemPrompt, store;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Owner" },
        { id: T_AUCKLAND, status: "active", ownerName: "Owner", timezone: "Pacific/Auckland" },
        { id: T_BERLIN, status: "active", ownerName: "Owner", timezone: "Europe/Berlin" },
        { id: T_GARBAGE, status: "active", ownerName: "Owner", timezone: "Mars/Olympus" },
        { id: T_NO_TZ, status: "active", ownerName: "Owner" },
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ systemPrompt } = await import("../src/claude.js"));
});

const nowLine = (prompt) => prompt.match(/Heute ist [^\n]+\./)?.[0];
const call = (tenantId) => seedCall({ tenantId });

test("unterschiedliche Tenant-Zeitzonen faerben die 'Heute ist'-Zeile unterschiedlich", () => {
  const auckland = nowLine(systemPrompt(call(T_AUCKLAND)));
  const berlin = nowLine(systemPrompt(call(T_BERLIN)));
  assert.ok(auckland);
  assert.ok(berlin);
  assert.notEqual(auckland, berlin, "unterschiedliche IANA-Zonen muessen unterschiedliche Uhrzeiten ergeben");
});

test("Muell-Zeitzone -> Prompt baut ohne Throw, Ergebnis stimmt mit DEFAULT_TIMEZONE ueberein", () => {
  assert.doesNotThrow(() => systemPrompt(call(T_GARBAGE)));
  const garbage = nowLine(systemPrompt(call(T_GARBAGE)));
  const expected = new Date().toLocaleString("de-DE", {
    timeZone: DEFAULT_TIMEZONE,
    weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  assert.equal(garbage, `Heute ist ${expected}.`);
});

test("Tenant ohne timezone -> identisch zu Europe/Berlin (Bestands-Neutralitaet fuer DE)", () => {
  const noTz = nowLine(systemPrompt(call(T_NO_TZ)));
  const berlin = nowLine(systemPrompt(call(T_BERLIN)));
  assert.equal(noTz, berlin);
});
