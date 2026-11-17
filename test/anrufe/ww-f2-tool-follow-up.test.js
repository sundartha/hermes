import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../../src/i18n/locales.js";
import { announcesToolAction, followUpToolsFor } from "../../src/tool-follow-up.ts";

const ANNOUNCEMENT = "Ich gebe das an Jonas weiter.";
const NO_ANNOUNCEMENT = "Donnerstag um siebzehn Uhr passt gut.";
const LANGUAGES = ["de", "en", "fr"];


test("WW-F2-7 followUpToolsFor: jede einzelne Bedingung ist fail-closed", () => {
  const tools = [{ name: "take_message" }];
  const base = {
    enabled: true,
    alreadyUsed: false,
    text: ANNOUNCEMENT,
    language: "de",
    candidateTools: tools,
  };
  assert.deepEqual(followUpToolsFor(base), tools, "Gutfall");
  assert.equal(followUpToolsFor({ ...base, enabled: false }), null, "Flag aus");
  assert.equal(followUpToolsFor({ ...base, alreadyUsed: true }), null, "Obergrenze B2");
  assert.equal(followUpToolsFor({ ...base, candidateTools: [] }), null, "nichts zu erzwingen");
  assert.equal(followUpToolsFor({ ...base, text: NO_ANNOUNCEMENT }), null, "keine Ankuendigung");
  assert.equal(followUpToolsFor({ ...base, text: "" }), null, "kein Text");
});

test("WW-F2-8 (B4) die Erkennung traegt in allen drei Produktsprachen - je ein Treffer und ein Nicht-Treffer", () => {
  const cases = {
    de: {
      hits: [
        "Ich gebe das an Jonas weiter.",
        "Da müsste ich Rücksprache halten, ob Jonas das akzeptiert.",
        "Da muesste ich Ruecksprache halten.",
      ],
      misses: ["Donnerstag um siebzehn Uhr passt gut.", "Guten Tag, ich rufe im Auftrag an."],
    },
    en: {
      hits: ["I will pass it on to Jonas.", "Let me check with Jonas first."],
      misses: ["Thursday at five works fine.", "I look forward to hearing from you."],
    },
    fr: {
      hits: ["Je vais en parler à Jonas.", "Je transmets la demande."],
      misses: ["Jeudi dix-sept heures, cela convient.", "Bonjour, j'appelle pour un rendez-vous."],
    },
  };
  for (const lang of LANGUAGES) {
    for (const hit of cases[lang].hits)
      assert.equal(announcesToolAction(hit, lang), true, `${lang}: nicht erkannt - ${hit}`);
    for (const miss of cases[lang].misses)
      assert.equal(announcesToolAction(miss, lang), false, `${lang}: falsch erkannt - ${miss}`);
  }
});

test("WW-F2-9 Sprach-Paritaet: markers und nudge existieren in jeder Sprache, der Steuertext nennt KEIN Werkzeug", () => {
  const TOOL_NAMES = ["end_call", "take_message", "get_consult", "look_up"];
  for (const lang of LANGUAGES) {
    const followUp = LOCALES[lang].prompt.followUp;
    const markers = [...followUp.consultMarkers, ...followUp.messageMarkers];
    assert.ok(markers.length > 0, `${lang}: markers`);
    for (const parts of markers)
      assert.ok(
        Array.isArray(parts) && parts.length > 0 && parts.every((p) => typeof p === "string" && p),
        `${lang}: ein Marker ist keine nicht-leere Teile-Liste`,
      );
    assert.equal(typeof followUp.nudge, "string");
    assert.ok(
      followUp.nudge.startsWith("[") && followUp.nudge.endsWith("]"),
      `${lang}: kein Steuertext`,
    );
    for (const name of TOOL_NAMES)
      assert.equal(followUp.nudge.includes(name), false, `${lang}: nudge nennt ${name}`);
  }
});
