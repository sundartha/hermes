# F2 P0 — Validierungs-Seam: E164 + countryAllowed in defaults.js

> Autoritative Scope-/Design-Definition fuer Phase F2-P0. Umbrella: `docs/strategy/f2-inbound-sms-summaries.md` (Abschnitt 2.3, P0). Basis: master.

## Ziel (eng umrissen)
Den E.164-Validator und ein **Praefix-Gate** (`countryAllowed`, Toll-Fraud-Schutz) in das dependency-freie `src/store/defaults.js` legen, damit `state-ops.js` sie **zyklusfrei** importieren kann (P1 baut darauf auf). `defaults.js` importiert nichts aus `store`/`routes`/`config` und ist der bestehende Praezedenzort fuer geteilte reine Telefon-Helfer (`normNum`).

## Verifizierter Code-Stand (gegroundet, KEINE Zeilennummern uebernehmen — grep selbst)
- `src/routes/_validation.js` definiert heute: `export const E164 = /^\+[1-9]\d{6,14}$/;` (Kommentar: "'+' gefolgt von 7-15 Ziffern, erste Ziffer != 0") sowie `TEXT_LIMITS` und `invalidText`.
- `src/server.js` importiert `{ E164, invalidText } from "./routes/_validation.js"` — dieser Import MUSS unveraendert weiterfunktionieren.
- `src/store/defaults.js` exportiert bereits `normNum(n)` (strippt `\s -()`), `DEFAULT_COUNTRY="DE"`, `DEFAULT_LANGUAGE="de"`. Es importiert NICHTS aus store/routes/config (Leaf-Modul).
- `src/store/state-ops.js` importiert bereits `normNum` aus `./defaults.js` — der neue Import von `E164`/`countryAllowed` aus demselben Modul ist damit nachweislich zyklusfrei.

## Konkrete Edits

### 1. `src/store/defaults.js` — E164 spiegeln (eine Quelle, G5)
Verschiebe die E164-Konstante als kanonische Quelle hierher (neben `normNum`, gleicher Themenblock "geteilte Telefon-Helfer"). Byte-identische Regex:
```js
// E.164-Format: '+' gefolgt von 7-15 Ziffern, erste Ziffer != 0. Kanonische Quelle
// (G5): aus routes/_validation.js hierher gezogen, damit der dependency-freie
// state-ops-Setter (F2) normalisieren UND validieren kann, ohne auf den Route-Layer
// zuzugreifen (zyklusfrei: defaults.js importiert nichts aus store/routes).
export const E164 = /^\+[1-9]\d{6,14}$/;
```

### 2. `src/store/defaults.js` — DEFAULT_COUNTRY_PREFIX + countryAllowed
Magic-String vermeiden (G25): benannte Konstante fuer den Default-Praefix. KEIN `config`-Import (Leaf-Modul). Der konfigurierbare Allowlist-Ausbau (`config.allowedCountryCodes`) ist P8 — NICHT hier.
```js
// Default-Laender-Praefix fuer das Toll-Fraud-Gate (F2 H1). Benannte Konstante statt
// Magic-String; der spaetere konfigurierbare Allowlist-Ausbau (P8) baut hierauf auf.
export const DEFAULT_COUNTRY_PREFIX = "+49";

// Toll-Fraud-Schutz (F2 H1): erlaubt nur Nummern mit dem erlaubten Laender-Praefix
// (Default DE/+49). Reine Praefix-Pruefung auf der bereits normalisierten E.164-Form
// (Aufrufer normalisiert via normNum ZUERST). Nicht-String -> false (fail-closed).
export function countryAllowed(raw, prefix = DEFAULT_COUNTRY_PREFIX) {
  return typeof raw === "string" && raw.startsWith(prefix);
}
```

### 3. `src/routes/_validation.js` — Re-Export (Bestand schuetzen)
`E164` wird hier NICHT mehr definiert, sondern aus `defaults.js` re-exportiert, damit `server.js` und die `/api/calls`-Validierung unveraendert weiterlaufen (eine Quelle, kein Copy-Paste):
```js
export { E164 } from "../store/defaults.js";
```
`TEXT_LIMITS` und `invalidText` bleiben unveraendert in `_validation.js`. Den E164-Kommentar dort auf den Re-Export anpassen (kein toter Kommentar, C5).

## Invarianten / Abgrenzung
- **Verhaltens-erhaltend:** E164-Regex byte-identisch. Bestandstests, die E164 via `_validation.js` nutzen (api-routes), bleiben OHNE Aenderung gruen.
- **Kein Zyklus:** `defaults.js` -> nichts; `_validation.js` -> `defaults.js`; `server.js`/`state-ops.js` -> beide. Azyklisch.
- **Scope:** NUR der Seam. KEIN setPrivateNumber, KEIN Onboard, KEINE finishCall-Aenderung (das sind P1/P4/P7).

## Tests (neue Datei `test/f2-validation-seam.test.js`)
- `E164.test("+491701234567")` === true; `E164.test("0170...")` (ohne +) === false; `E164.test("+49")` (zu kurz) === false.
- `countryAllowed("+491701234567")` === true; `countryAllowed("+8881234567")` === false; `countryAllowed("+11234567", "+1")` === true (param greift); `countryAllowed(null)` === false.
- Re-Export-Landmine: `import { E164 } from "../src/routes/_validation.js"` liefert dieselbe Regex wie aus `defaults.js` (referenzgleich).

## Deterministisch pruefbar
`node --test test/f2-validation-seam.test.js` gruen; `npm test` insgesamt gruen (keine Regression in api-routes).
