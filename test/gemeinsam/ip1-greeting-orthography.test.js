import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gespeicherteBegruessungFuer,
  greetingForLanguage,
  greetingTemplatesFor,
  greetingWithCurrentOrthography,
  ALL_GREETING_TEMPLATES,
} from "../../src/i18n/greeting-catalog.js";
import { INBOUND_NOTICES, hasInboundNotice, withInboundNotice } from "../../src/i18n/inbound-notice.ts";
import { SPOKEN_TRANSLITERATION_STEMS } from ".././umlaut-stems-helper.js";

const alteFassung = (vorlage) => vorlage.replaceAll("für", "fuer");

const ANZAHL_DE_VORLAGEN = 3;
const ANZAHL_ALLER_VORLAGEN = 9;

test("IP1-G1: jede DE-Begruessungsvorlage - keine Transliteration, echte Umlaute, Pflichtsatz", () => {
  const templates = greetingTemplatesFor("de");
  assert.equal(templates.length, ANZAHL_DE_VORLAGEN, "Anzahl waehlbarer DE-Vorlagen veraendert");
  for (const [index, vorlage] of templates.entries()) {
    assert.equal(
      vorlage.match(SPOKEN_TRANSLITERATION_STEMS),
      null,
      `Vorlage ${index}: Transliteration in: ${vorlage}`,
    );
    assert.match(vorlage, /[äöü]/u, `Vorlage ${index}: kein Umlaut - Wortlaut versehentlich entfernt?`);
    assert.ok(hasInboundNotice(vorlage), `Vorlage ${index}: Pflichtsatz verloren`);
  }
  assert.equal(
    ALL_GREETING_TEMPLATES.length,
    ANZAHL_ALLER_VORLAGEN,
    "Sprach-Union veraendert (FR/EN beruehrt?)",
  );
});

test("IP1-M1: eine gespeicherte Begruessung in alter Schreibweise wird auf die heutige gehoben", () => {
  for (const vorlage of greetingTemplatesFor("de")) {
    assert.equal(greetingWithCurrentOrthography(alteFassung(vorlage)), vorlage);
    assert.equal(greetingForLanguage(alteFassung(vorlage), "de"), vorlage);
  }
});

test("IP1-M2: Abgrenzung - frei gesetzter Text, null und undefined bleiben unveraendert", () => {
  const freitext = "Mein eigener Text mit KI- und Transkriptionshinweis";
  assert.equal(greetingWithCurrentOrthography(freitext), freitext);
  assert.equal(greetingForLanguage(freitext, "de"), freitext);
  assert.equal(greetingWithCurrentOrthography(null), null);
  assert.equal(greetingWithCurrentOrthography(undefined), undefined);
  assert.equal(greetingWithCurrentOrthography("toString"), "toString");
  assert.equal(greetingWithCurrentOrthography("constructor"), "constructor");
});

test("IP1-M3: die historischen Fassungen sind KEINE waehlbaren Vorlagen", () => {
  for (const vorlage of greetingTemplatesFor("de")) {
    const alt = alteFassung(vorlage);
    if (alt === vorlage) continue;
    assert.ok(!greetingTemplatesFor("de").includes(alt), "Karten-Schluessel ist waehlbar geworden");
    assert.ok(!ALL_GREETING_TEMPLATES.includes(alt), "Karten-Schluessel in der Sprach-Union");
  }
});

test("IP1-M4: alte DE-Fassung auf einem EN-Tenant faellt auf die EN-Standardvorlage (Reihenfolge)", () => {
  assert.equal(
    greetingForLanguage(alteFassung(greetingTemplatesFor("de")[0]), "en"),
    greetingTemplatesFor("en")[0],
  );
});

const GESPEICHERTE_ROHFASSUNGEN = [
  "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht fuer {owner} aufnehmen. Wie kann ich helfen?",
  "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht fuer {owner} auf. Wie kann ich helfen?",
].map((roh) => withInboundNotice(roh, INBOUND_NOTICES.de));

test("IP1-M5: jede historische Rohfassung wird auf denselben Satz in heutiger Schreibweise gehoben", () => {
  for (const gespeichert of GESPEICHERTE_ROHFASSUNGEN) {
    const gehoben = greetingWithCurrentOrthography(gespeichert);
    assert.notEqual(gehoben, gespeichert, "alte Schreibweise nicht gehoben");
    assert.ok(greetingTemplatesFor("de").includes(gehoben), "Ziel ist keine waehlbare DE-Vorlage");
    assert.equal(alteFassung(gehoben), gespeichert, "Ziel ist ein anderer Satz");
  }
});

const KEIN_TEXT = 42;

test("IP1-M6: gespeicherteBegruessungFuer nennt bei fehlender oder nicht-textlicher Begruessung die Operation", () => {
  const ownerName = "Jonas Beispiel";
  for (const fehlend of [null, undefined, KEIN_TEXT]) {
    assert.throws(
      () => gespeicherteBegruessungFuer({ storedGreeting: fehlend, language: "de", ownerName }),
      (err) => err instanceof TypeError && err.message.includes("gespeicherteBegruessungFuer"),
    );
  }
  const text = gespeicherteBegruessungFuer({
    storedGreeting: greetingTemplatesFor("de")[0],
    language: "de",
    ownerName,
  });
  assert.ok(text.includes(ownerName) && !text.includes("{owner}"), "Besitzer nicht eingesetzt");
});
