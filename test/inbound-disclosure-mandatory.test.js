// Inbound-Pflichtsatz (ex GAP-14, tasks/i18n-tests/11-luecken-und-e2e.md): der erste
// gesprochene Satz eines Inbound-Calls muss einen Pflicht-Marker fuer KI + Aufzeichnung/
// Transkription tragen (Regel-2-Analogie fuer Inbound, s. src/i18n/inbound-notice.js).
// Umbenannt in P3 (A3): der Name traegt die ID NICHT mehr am Anfang, sonst bliebe der
// Test im test:gates-Lauf haengen (package.json config.i18nCatalogPattern).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, OWNER_TEST_NUMBER } from "./helpers.js";
import { makeDefaultState, settingsFor, updateSettings } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_GREETING } from "../src/store/defaults.js";
import { INBOUND_NOTICES } from "../src/i18n/inbound-notice.js";

// Pflicht-Marker je Sprache statt einer deutschen Regex gegen den damaligen Default
// (Pre-Mortem 5): nach dem P10-Flip loest ein Testfall OHNE gesetzte Sprache auf en auf -
// eine DE-Regex waere dann rot, und der billigste Ausweg waere das Absenken der
// Compliance-Assertion. Jeder Fall setzt seine Sprache deshalb EXPLIZIT.
const CASES = [
  ["de", INBOUND_NOTICES.de],
  ["en", INBOUND_NOTICES.en],
  ["fr", INBOUND_NOTICES.fr],
];

for (const [language, notice] of CASES) {
  test(`Inbound-Pflichtsatz: erster gesprochener Satz traegt KI- + Transkriptionshinweis (${language}) (ex GAP-14 a)`, async () => {
    const srv = await startServer({ seed: seedState({ settings: { language } }) });
    try {
      const res = await fetch(`${srv.localUrl}/voice/incoming`, {
        method: "POST",
        body: new URLSearchParams({
          CallSid: "CAgap14",
          From: "+4915112345678",
          To: OWNER_TEST_NUMBER.e164,
        }),
      });
      const body = await res.text();
      assert.ok(
        body.includes(notice),
        `Pflichtsatz (${language}) fehlt im ersten gesprochenen Satz (Launch-Blocker): ${body}`,
      );
    } finally {
      await srv.stop();
    }
  });
}

test("Inbound-Pflichtsatz: kein Doppelsatz, wenn das Greeting ihn bereits traegt", async () => {
  // P11: greetingForLanguage tauscht eine Katalog-Vorlage EINER ANDEREN Sprache gegen
  // die Standardvorlage der Anrufsprache aus (PROMPT-03) - language:"de" muss deshalb
  // EXPLIZIT gesetzt sein, damit DEFAULT_GREETING (eine DE-Vorlage) unveraendert bleibt.
  // Ohne diese Zeile loest der Weltdefault (WORLD_DEFAULT_LANGUAGE_ENABLED=true im
  // Test-Env) auf "en" auf, und das Greeting wuerde bewusst auf die EN-Vorlage wechseln.
  const srv = await startServer({
    seed: seedState({ settings: { language: "de", greeting: DEFAULT_GREETING } }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAgap14dup",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    const body = await res.text();
    const occurrences = body.split(INBOUND_NOTICES.de).length - 1;
    assert.equal(occurrences, 1, `Pflichtsatz erscheint ${occurrences}x statt genau 1x: ${body}`);
  } finally {
    await srv.stop();
  }
});

test("Inbound-Pflichtsatz: updateSettings verwirft NUR das Greeting ohne Marker, der Rest des Patches laeuft durch (ex GAP-14 b)", () => {
  const s = makeDefaultState();
  const before = settingsFor(s, BOOTSTRAP_TENANT_ID).greeting;
  const { changed } = updateSettings(s, BOOTSTRAP_TENANT_ID, {
    greeting: "Hallo.",
    agentName: "Neu",
  });
  const after = settingsFor(s, BOOTSTRAP_TENANT_ID);
  assert.equal(after.greeting, before, "Greeting ohne Pflicht-Marker MUSS verworfen werden");
  assert.equal(after.agentName, "Neu", "der uebrige Patch MUSS trotzdem durchlaufen");
  assert.ok(changed.includes("agentName"), "agentName MUSS in changed stehen");
  assert.ok(!changed.includes("greeting"), "greeting DARF NICHT in changed stehen");
});

test("Inbound-Pflichtsatz: ein Greeting MIT Marker wird angenommen (Gegenprobe)", () => {
  const s = makeDefaultState();
  const withMarker = `${INBOUND_NOTICES.de} Hallo, hier spricht Hermes.`;
  const { changed } = updateSettings(s, BOOTSTRAP_TENANT_ID, { greeting: withMarker });
  assert.equal(settingsFor(s, BOOTSTRAP_TENANT_ID).greeting, withMarker);
  assert.ok(changed.includes("greeting"));
});
