// KS-P7: die Denylist traegt seit KS-P0/KS-P6 den Hauptschutz gegen teure Ziele. Drei
// Konzepte: (1) jedes neu aufgenommene Ziel sperrt und nennt den treffenden Praefix,
// (2) Nachbarlaender und Startmaerkte passieren weiterhin (Ueberblockierungs-Schutz),
// (3) die Liste bleibt strukturell eindeutig. Die Zielnummern in (1) sind BEWUSST
// handgeschrieben und NICHT aus der Liste abgeleitet - eine aus der Liste erzeugte
// Erwartung waere tautologisch und wuerde eine geloeschte Zeile nicht rot faerben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deniedPrefix, DENIED_PREFIXES } from "../src/telephony/number-denylist.js";

// Ziel -> erwarteter Treffer. Der Praefix ist Teil der Erwartung, weil das Audit-Detail
// ihn nennt (grund=denylist praefix=...) und die Forensik daran haengt.
const HIGH_COST_TARGETS = {
  "+5352345678": "+53", // Kuba (TOD 1)
  "+50934567890": "+509", // Haiti
  "+23276123456": "+232", // Sierra Leone
  "+23670123456": "+236", // Zentralafrikanische Republik
  "+23999112233": "+239", // Sao Tome und Principe
  "+240222123456": "+240", // Aequatorialguinea
  "+2463701234": "+246", // Diego Garcia
  "+2476123": "+247", // Ascension
  "+252612345678": "+252", // Somalia
  "+2902345": "+290", // St. Helena
  "+2917123456": "+291", // Eritrea
  "+67077212345": "+670", // Timor-Leste
  "+6723123456": "+672", // Norfolk
  "+6745551234": "+674", // Nauru
  "+67570123456": "+675", // Papua-Neuguinea
  "+6777412345": "+677", // Salomonen
  "+6785551234": "+678", // Vanuatu
  "+681821234": "+681", // Wallis und Futuna
  "+68251234": "+682", // Cookinseln
  "+6834002": "+683", // Niue
  "+68673012345": "+686", // Kiribati
  "+6882901234": "+688", // Tuvalu
  "+6904012": "+690", // Tokelau
  "+8502381234": "+850", // Nordkorea
  "+8781012345": "+878", // UPT (Klasse 1)
};

// Nachbar-Laendercodes der neuen Eintraege + die Startmaerkte. Ueberblockierung ist der
// teure Fehler dieser Phase: sie faellt sonst erst am Kunden auf.
const ORDINARY_TARGETS = [
  "+4915112345678",
  "+491701234567", // DE Mobil
  "+33612345678",
  "+447700900123", // FR, UK
  "+12025550123",
  "+16045550123", // US, CA
  "+18685550123", // Trinidad (NANP, bewusst NICHT gesperrt)
  "+34600000000",
  "+5511987654321", // ES, BR
  "+525512345678", // MX (Nachbar von +53)
  "+679123456",
  "+687751234", // FJ, NC (Nachbarn der Pazifik-Codes)
  "+6913201234",
  "+685721234", // FM, WS
  "+233241234567",
  "+237671234567", // GH, CM (Nachbarn von +232/+236)
  "+238991234567",
  "+251911234567", // CV, ET (Nachbarn von +239/+252)
  "+254712345678",
  "+61412345678", // KE, AU (Nachbar von +672)
  "+821012345678",
  "+85251234567", // KR, HK (Nachbarn von +850)
];

test("KS-P7: neu aufgenommene Hochpreis-Ziele sperren und nennen den treffenden Praefix", () => {
  for (const [to, praefix] of Object.entries(HIGH_COST_TARGETS))
    assert.equal(deniedPrefix(to), praefix, `${to} muss gesperrt sein (Praefix ${praefix})`);
});

test("KS-P7: Nachbarlaender und Startmaerkte passieren die Denylist", () => {
  for (const to of ORDINARY_TARGETS)
    assert.equal(deniedPrefix(to), null, `${to} darf NICHT gesperrt werden`);
});

test("KS-P7: die Liste bleibt E.164-foermig, dubletten- und ueberdeckungsfrei", () => {
  for (const p of DENIED_PREFIXES) assert.match(p, /^\+[1-9]\d+$/, `${p} ist kein E.164-Praefix`);
  assert.equal(new Set(DENIED_PREFIXES).size, DENIED_PREFIXES.length, "Dublette in der Liste");
  for (const a of DENIED_PREFIXES)
    for (const b of DENIED_PREFIXES)
      if (a !== b)
        assert.ok(!b.startsWith(a), `${a} verdeckt ${b} - der Audit-Praefix waere mehrdeutig`);
});
