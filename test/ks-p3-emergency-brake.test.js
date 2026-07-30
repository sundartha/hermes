// KS-P3 (b): die guthaben-abgeleitete Notbremse als REINE Funktion
// (emergencyBrakeSeconds, src/call-duration.js). Kein Netz, kein Store, keine Uhr
// (F.I.R.S.T.). Die Frist eines Legs ist seit dieser Phase keine Konfigurationsgroesse
// mehr, sondern faellt aus Restguthaben und Leg-Satz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAKE_BUFFER_MINUTES, emergencyBrakeSeconds } from "../src/call-duration.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

const SECONDS_PER_MINUTE = 60;
const TARIFF = 30; // ct/min, der Worst-Case-Satz des heutigen Katalogs

// Build-Operate-Check in einer Zeile (P13): die Tabelle unten ist die Spezifikation.
const brake = (remainingCents, tariffCentsPerMin = TARIFF) =>
  emergencyBrakeSeconds({ remainingCents, tariffCentsPerMin });

test("emergencyBrakeSeconds: Restminuten + Puffer, gedeckelt durch die absolute Obergrenze", () => {
  assert.equal(brake(300), 660, "10 bezahlbare Minuten + 1 Puffer-Minute");
  assert.equal(brake(29), 60, "unter einer bezahlbaren Minute -> nur der Puffer");
  assert.equal(brake(0), 60, "kein Guthaben -> nur der Puffer, NIE 0");
  assert.equal(brake(1_000_000), MAX_CALL_DURATION_CAP_S, "viel Guthaben -> absolute Obergrenze");
});

test("emergencyBrakeSeconds: negatives Restguthaben ergibt nie eine Frist in der Vergangenheit", () => {
  // Ein ueberreservierter Bucket liefert legitim ein negatives remainingCents (kein
  // D7-Fall, s. tenantBudgetSnapshot). Eine 0-Frist terminalisierte den Call schon beim
  // Armieren - "kein Geld" ist die Aufgabe der Geld-Achse, nicht der Uhr.
  assert.equal(brake(-500), 60);
  assert.ok(brake(-500) > 0, "die Frist ist strikt positiv");
});

test("emergencyBrakeSeconds: nicht aufloesbare Eingaben fallen auf die Obergrenze, NIE auf unbegrenzt", () => {
  // remainingCents === null ist der D7-Riegel aus tenantBudgetSnapshot. Derselbe Zustand
  // sperrt am Dial ueber reserveUnreadableDenial und beim Inbound ueber budgetExceeded -
  // die Notbremse ist dort nie die letzte Linie.
  assert.equal(brake(null), MAX_CALL_DURATION_CAP_S, "unlesbares Guthaben (D7)");
  assert.equal(brake(300, 0), MAX_CALL_DURATION_CAP_S, "Satz 0 -> keine Division");
  assert.equal(brake(300, NaN), MAX_CALL_DURATION_CAP_S, "Satz NaN");
  assert.equal(brake(300, -30), MAX_CALL_DURATION_CAP_S, "negativer Satz");
  assert.equal(brake(NaN), MAX_CALL_DURATION_CAP_S, "Guthaben NaN");
});

// ---- Eigenschafts-Tests (kein Zahlenwert - sie ueberleben eine Kalibrierung) ------

test("emergencyBrakeSeconds: der Live-Zaehler bindet IMMER zuerst (Puffer-Zusage)", () => {
  // Die strukturelle Zusage von E8: solange die absolute Obergrenze nicht klemmt, liegt
  // die Frist ECHT ueber den bezahlbaren Minuten. Ohne diesen Abstand traefe bei exakt
  // aufgehendem Guthaben die Uhr zuerst und der Kunde saehe einen wortlosen Abbruch
  // statt des Abschiedssatzes. Mutationsprobe: BRAKE_BUFFER_MINUTES = 0 faerbt das rot.
  assert.ok(BRAKE_BUFFER_MINUTES > 0, "Vorbedingung: es gibt ueberhaupt einen Puffer");
  for (const remainingCents of [0, 29, 30, 300, 3000]) {
    const affordableSeconds = Math.floor(remainingCents / TARIFF) * SECONDS_PER_MINUTE;
    const frist = brake(remainingCents);
    if (frist === MAX_CALL_DURATION_CAP_S) continue; // Obergrenze klemmt -> Aussage n.z.
    assert.ok(
      frist > affordableSeconds,
      `Rest ${remainingCents} ct: Frist ${frist}s muss ueber den bezahlbaren ${affordableSeconds}s liegen`,
    );
  }
});

test("emergencyBrakeSeconds: monoton - mehr Guthaben ergibt nie eine kuerzere Frist", () => {
  const guthaben = [-500, 0, 29, 30, 300, 3000, 30000, 1_000_000];
  for (let i = 1; i < guthaben.length; i++)
    assert.ok(
      brake(guthaben[i]) >= brake(guthaben[i - 1]),
      `${guthaben[i]} ct darf keine kuerzere Frist geben als ${guthaben[i - 1]} ct`,
    );
});
