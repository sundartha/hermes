# Phase PA-21: C2-Kommentar-Kosmetik (Flach-config-Pfade -> Namespace-Form)

## Ergebnis

45 Kommentar-Zeilen in 32 Dateien (31 `src/`, 1 `scripts/`) auf Namespace-Form
(`config.<namespace>.<key>`) umgeschrieben, exakt gemaess Plan. Keine Code-,
Test- oder .md-Zeile veraendert. `git diff --stat`: 32 Dateien, +45/-45,
netto 0 Zeilen. Jede geaenderte Zeile ist eine Kommentarzeile (verifiziert
per Filter auf `//`/`*`-Praefix nach Diff-Vorzeichen).

## Verifikation

- `node --check` auf allen 32 beruehrten Dateien: 0 FAIL.
- `npm test`: 2422/2422 gruen, 0 fail (identisch zur erwarteten Baseline;
  Kommentar-only -> keine Testaenderung noetig, keine Testdatei angefasst).
  Der Lauf deckt json- UND pg/pglite-Backend ab (dieselbe `node --test`-
  Suite enthaelt Tests fuer beide Backends).
- Smoke: Server lokal gebootet (Dummy-Env + `SKIP_TWILIO_SIGNATURE_CHECK=true`
  + `bootstrap-tenant.js` fuer eine aktive Nummer), `/healthz` -> 200,
  `/voice/turn` -> 200 (korrektes No-Active-Call-Hangup-Verhalten). smokePass=true.

## Abschluss-Grep (C2-Gate)

Nach dem Fix verbleiben in `src`/`scripts` nur die 5 geplanten Keep-(b)-Notizen
(bewusste "existiert nicht mehr"-Historien-Hinweise) + der eine Out-of-Scope-Treffer
in `src/db/schema.sql` (`.sql`, ausserhalb des Scopes `src/**/*.js` + `scripts/*.{js,mjs}`):

| Datei:Zeile | Kommentar-Token | Begruendung (unveraendert korrekt) |
|---|---|---|
| `src/config.js:243` | `config.telnyxAssistantId etc. existiert nicht mehr` | Migrations-Notiz; `telnyxAssistantId` ist kein Blatt-Key (nested `telnyxAssistant`) |
| `src/db/schema.sql:22` | `config.ownerName mehr` | `.sql`-Datei, harter Scope-Ausschluss (Keep-(b)-Inhalt ohnehin) |
| `src/sms-summary.js:10` | `NICHT mehr config.ownerNumber` | Historien-Notiz (Owner-Removal, AK #5); `ownerNumber` existiert nicht |
| `src/store/json.js:432` | `kein config.ownerName-Fallback mehr` | dito |
| `src/store/state-ops.js:639` | `kein config.ownerName mehr` | dito |
| `src/telephony/call-finish.js:77` | `NICHT mehr config.ownerNumber` | dito |

Zusaetzlich bewusst ausserhalb des Fix-Sets (kein C2, siehe Plan Abschnitt 5):
`scripts/convo-bench/judge.mjs:6` (`output_config.format` - Anthropic-API-Feld,
kein Hermes-config-Key) und der `cfg.maxBudgetCents`-Cluster in
`src/store/defaults.js` / `src/store/state-ops.js` (lokaler Funktionsparameter
`cfg`, gebunden an `config.billing`, kein Flach-`config.`-Zugriff).

## Angrenzende, bewusst nicht behobene Ungenauigkeiten (Scope-Disziplin)

Wie im Plan (Abschnitt 6) vorgesehen bleiben zwei veraltete Modul-Verweise
neben dem jetzt korrekten config-Pfad unveraendert (separater, vorbestehender
C2, nicht Teil dieser Phase):

- `src/store/state-ops.js:372` ("server.js: config.safety.maxCallDurationS") -
  realer Aufrufer ist `call-lifecycle.js`/`reattach.js`.
- `scripts/convo-bench/texml.mjs:22` ("server.js: ... config.server.publicUrl")
  - der reale Ausdruck lebt in `voice-render.js:37`.

## Deviations vom Plan

Keine. Alle 38 Plan-Zeilen (45 Token-Ersetzungen) 1:1 umgesetzt, Keep-Set
unveraendert gelassen, Ausschluss-Set nicht angefasst.
