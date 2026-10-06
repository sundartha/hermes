import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_GREETING } from "../src/store/defaults.js";
import { ALL_GREETING_TEMPLATES } from "../src/i18n/greeting-catalog.js";

const OWNER = "Jonas Beispiel";
const EXPECTED_TOOL_NAMES = ["end_call", "take_message"];
const REMOVED_PROMPT_MARKERS = [
  "book_appointment",
  "get_calendar",
  "KALENDER DEINES AUFTRAGGEBERS",
  "Buchung",
];
const UNCONDITIONAL_LINES = [
  "- Du hast KEINEN Kalenderzugriff und siehst keine Termine von ",
  "- Du buchst KEINE Termine fest.",
];

let systemPrompt, toolDefs, execTool, store;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ systemPrompt, toolDefs, execTool } = await import("../src/claude.js"));
});

test("P1b-1 Bestands-Settings tragen weiterhin true/true (Vorbedingung des Beweises)", () => {
  const s = store.tenantContext(BOOTSTRAP_TENANT_ID).settings;
  assert.equal(s.allowCalendar, true, "Seed muss den Bestandszustand abbilden");
  assert.equal(s.allowBooking, true, "Seed muss den Bestandszustand abbilden");
});

test("P1b-2 toolDefs liefert genau end_call + take_message", () => {
  assert.deepEqual(
    toolDefs().map((t) => t.name),
    EXPECTED_TOOL_NAMES,
  );
});

test("P1b-3 systemPrompt nennt inbound wie outbound keine Kalender-/Buchungsflaeche", () => {
  for (const direction of ["inbound", "outbound"]) {
    const prompt = systemPrompt(
      seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction, language: "de" }),
    );
    for (const marker of REMOVED_PROMPT_MARKERS) {
      assert.ok(!prompt.includes(marker), `${direction}: "${marker}" steht noch im Prompt`);
    }
    for (const line of UNCONDITIONAL_LINES) {
      assert.ok(prompt.includes(line), `${direction}: unbedingte Zeile fehlt: ${line}`);
    }
  }
});

test("P1b-4 execTool kennt book_appointment/get_calendar nicht mehr (kein Kalender-Schreibpfad)", () => {
  const call = seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: "outbound" });
  const before = store.getCalendar(BOOTSTRAP_TENANT_ID).length;
  assert.equal(execTool(call, "get_calendar", {}), "Unbekanntes Tool.");
  assert.equal(
    execTool(call, "book_appointment", { title: "X", start: "2030-01-01T10:00:00" }),
    "Unbekanntes Tool.",
  );
  assert.equal(
    store.getCalendar(BOOTSTRAP_TENANT_ID).length,
    before,
    "kein Kalendereintrag darf entstanden sein",
  );
});

test("P1b-5 gesprochene Begruessungs-Vorlagen versprechen keine Terminbuchung mehr", () => {
  const NO_BOOKING_PROMISE = /Termin|appointment|rendez-vous/i;
  for (const greeting of [DEFAULT_GREETING, ...ALL_GREETING_TEMPLATES]) {
    assert.ok(!NO_BOOKING_PROMISE.test(greeting), `Terminversprechen in Vorlage: ${greeting}`);
  }
});
