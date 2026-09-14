// I8 (call-quality Impl-1): shapeForSpeech (speech-shape.js) - deterministisches Text-Shaping
// der Modell-Antwort vor Fallback/addTranscript (TTS liest Markdown-Reste/Aufzaehlungs-
// Bindestriche/Gedankenstriche sonst woertlich vor, S1-tts). Reine Unit gegen die pure,
// exportierte Funktion (kein Netz, kein Store-Zustand noetig - der Import
// braucht nur ein DATA_DIR, wie die anderen Unit-Nahtstellen). VORSICHT-Pruefungen:
// legitime Wort-Bindestriche ("E-Mail", "Kuendigungs-Service") duerfen NIE zerstoert
// werden - nur " - "-Gedankenstriche mit Leerzeichen auf beiden Seiten.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

let shapeForSpeech;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }] }),
  );
  await import("../src/config.js");
  ({ shapeForSpeech } = await import("../src/speech-shape.js"));
});

// Input/Output-Paare (Spec Impl-1): jede Zeile ein Konzept.
const CASES = [
  // Whitespace normalisieren (Zeilenumbrueche/Mehrfach-Spaces -> EIN Leerzeichen).
  ["Guten   Tag,\n\nwie geht es Ihnen?", "Guten Tag, wie geht es Ihnen?"],
  // Markdown-Reste entfernen (*, _, #, `).
  ["Der Termin ist **fest** gebucht.", "Der Termin ist fest gebucht."],
  ["_Wichtig_: `code` und # Ueberschrift.", "Wichtig: code und Ueberschrift."],
  // Aufzaehlungs-Bindestriche am Zeilenanfang entfernen.
  ["- Freitag 14 Uhr\n- Samstag 10 Uhr", "Freitag 14 Uhr Samstag 10 Uhr."],
  // " - "-Gedankenstriche -> Komma (TTS-freundlich).
  ["Alles klar - ich buche den Termin.", "Alles klar, ich buche den Termin."],
  // Satzende sicherstellen (fehlender Schlusspunkt wird ergaenzt).
  ["Ich melde mich morgen", "Ich melde mich morgen."],
  // Bestehendes Satzende (!/?) bleibt unangetastet.
  ["Passt das fuer Sie?", "Passt das fuer Sie?"],
  ["Vielen Dank!", "Vielen Dank!"],
  // VORSICHT: Wort-Bindestriche ohne umgebende Leerzeichen bleiben erhalten.
  ["Ich schicke die E-Mail an den Kuendigungs-Service.", "Ich schicke die E-Mail an den Kuendigungs-Service."],
  // Kombination: Markdown + Aufzaehlung + Gedankenstrich + fehlendes Satzende.
  ["- **Freitag** um 14 Uhr - das passt gut", "Freitag um 14 Uhr, das passt gut."],
  // Rand-Whitespace wird getrimmt.
  ["  Alles klar.  ", "Alles klar."],
  // Haengendes Komma am Ende (z.B. Rest eines abgebrochenen Gedankenstrich-Satzes)
  // wird abgeraeumt, BEVOR der Schlusspunkt ergaenzt wird (nie ",.").
  ["Ich buche den Termin - ", "Ich buche den Termin."],
  ["Alles klar,", "Alles klar."],
];

test("I8: shapeForSpeech normalisiert Input/Output-Paare deterministisch", () => {
  for (const [input, expected] of CASES) {
    assert.equal(shapeForSpeech(input), expected, `Input: ${JSON.stringify(input)}`);
  }
});

test("I8-Grenzfaelle: leer/undefined/null bleiben falsy (Fallback-Entscheidung unberuehrt)", () => {
  assert.equal(shapeForSpeech(""), "");
  assert.equal(shapeForSpeech(undefined), undefined);
  assert.equal(shapeForSpeech(null), null);
});

test("I8-Idempotenz: bereits sauberer Satz bleibt byte-identisch", () => {
  const clean = "Alles klar, ich habe den Termin am Donnerstag um 17 Uhr gebucht.";
  assert.equal(shapeForSpeech(clean), clean);
  assert.equal(shapeForSpeech(shapeForSpeech(clean)), clean);
});
