// P1b (Owner-Entscheidung E1): der Telefon-Agent bucht nicht und liest im Gespraech
// keinen Kalender. Der Beweis muss gegen den BESTANDS-Settings-Zustand laufen
// (allowCalendar/allowBooking = true) - genau den traegt jeder heute existierende
// Tenant in Prod, und genau den seedt helpers.seedState by default. Ein Test gegen
// false/false wuerde nichts zeigen: er wuerde auch dann gruen, wenn P1b nur den
// Default geflippt haette (der Bestand aber unveraendert weiterbucht).
//
// Die Kalender-OWNER-Flaeche (MCP-Tool get_calendar, POST /api/calendar) ist
// NICHT Gegenstand dieses Tests und bleibt bewusst bestehen - sie haengt an der
// Profil-Achse (resolveProfile), nicht an diesen Settings.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_GREETING } from "../src/store/defaults.js";
import { GREETING_TEMPLATES } from "../src/self-service.js";

const OWNER = "Jonas Beispiel";
// Fester Tool-Satz beider Engines nach P1b.
const EXPECTED_TOOL_NAMES = ["end_call", "take_message"];
// Marker der entfernten In-Call-Kalenderflaeche. Erscheint einer davon im
// System-Prompt, verspricht der Agent wieder eine Faehigkeit, die er nicht hat.
// "Buchung" gehoert dazu (Runde-1-Fix): die outbound-SITUATION-Zeile sprach vor
// dem Fix trotz der beiden UNCONDITIONAL_LINES weiterhin von einer "Buchung" und
// davon, einen Termin als "gebucht" zu bezeichnen - ein direkter Widerspruch zum
// Phasenziel. Das Wort kommt im Bestandsprompt sonst nirgends vor (auch nicht in
// der allgemeinen Anti-Halluzinations-Regel, die von "gebucht" statt "Buchung"
// spricht), daher ist es ein eindeutiger, nicht-brittle Marker.
const REMOVED_PROMPT_MARKERS = [
  "book_appointment",
  "get_calendar",
  "KALENDER DEINES AUFTRAGGEBERS",
  "Buchung",
];
// Die beiden jetzt UNBEDINGTEN Prompt-Zeilen (vormals die false-Zweige zweier
// Ternaries). Gegenprobe: sie beweisen Zweig-Kollaps statt blosser Loeschung.
const UNCONDITIONAL_LINES = [
  "- Du hast KEINEN Kalenderzugriff. Bei Terminwuenschen nimmst du nur eine Nachricht auf.",
  "- Du darfst KEINE Termine fest buchen, nur Terminwuensche als Nachricht aufnehmen.",
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
  for (const greeting of [DEFAULT_GREETING, ...GREETING_TEMPLATES]) {
    assert.ok(!/Termin/i.test(greeting), `Terminversprechen in Vorlage: ${greeting}`);
  }
});
