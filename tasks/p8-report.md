# Phase P8 (f1-p8) - Detailbericht

## Status
ABGESCHLOSSEN. Gate = PASS (dualer Review). Tests 831/831 gruen. Fix-Runden: 0. NICHT committet.

Scope REDUZIERT durch Owner #6 (strikt 1 Nummer/Tenant): keine primary-/Mehrfachnummern-Logik,
keine laenderpassende Absenderwahl. `outboundFrom` bleibt 2-arg (kein `to`-Param). Strategie-Doc
§3.6 (mehrnummern-Absenderwahl) entfaellt bewusst.

## Umgesetzte Dateien + Kernentscheidungen

1. **src/server.js**
   - `outboundFrom(s, tenantId)` gibt zusaetzlich `numberRecord` (den vollen `findActiveNumber`-Record)
     zurueck. Der Toll-Fraud-/I7-Riegel bleibt unangetastet: `from` = eigene aktive Nummer oder
     `null` -> Reject, NIE Owner-/Fremdnummer. Nur ein Feld ergaenzt (kein toter Code, konsumiert
     in der Call-Site).
   - Am `createCall` (server.js:763): hartes `b.language || "de"` ersetzt durch
     `const language = store.resolveCallLanguage({ tenantId, numberRecord })` - DIESELBE Praezedenz
     wie Inbound (settings.language -> number.language -> tenant.defaultLanguage -> "de"). Der
     P4-Helper wird wiederverwendet (Fassade injiziert `s` via `load()`), identisch zur bestehenden
     Inbound-Call-Site (server.js:434). `language` wird an `createCall` durchgereicht.

2. **src/config.js** (config.js:141)
   - Default `ALLOWED_COUNTRY_CODES` von `"+49"` auf `"+49,+33,+44"` (DE/FR/UK) erweitert.
   - Land-Gate prueft weiter das ZIEL (`matchesPrefix(to, ...)`), fail-closed: Ziel ausserhalb der
     drei Vorwahlen geblockt. Bewusst NICHT global (`"*"`).

3. **.env.example** (Zeile 48/49): Default-Trio synchron nachgezogen.

4. **render.yaml** (Zeile ~47/48): Blueprint-value (kein `sync:false`) synchron nachgezogen.

5. **test/f1-p8-outbound-lang.test.js** (neu): 3 Faelle - FR-Nummer fuehrt FR; `settings.language=en`
   schlaegt FR-Nummer; DE-Default ohne `language` -> `de`. Owner-Pfad-Test (json.load migriert flache
   settings in Owner-Bucket), deckt volle Praezedenz ab.

6. **test/number-gate.test.js**: neuer `+49,+33,+44`-Fall (FR/UK passieren, US `+1` fail-closed
   geblockt). Setzt den Wert explizit, da BASE_ENV `ALLOWED_COUNTRY_CODES="*"` hart setzt.

## Bewusste Abweichungen

- **D1 (owner-bestaetigungswuerdig):** Call-Body-Param `b.language` wird NICHT mehr beruecksichtigt.
  `resolveCallLanguage` ist die eine kuratierte Quelle (konsistent mit Inbound; verhindert, dass ein
  API-/MCP-Aufrufer die Sprachzuordnung per Call-Parameter umgeht - R8-Geist). Verhaltens-Aenderung
  ggue. altem `b.language || "de"`. Falls `b.language` als schwaechster expliziter Override gewuenscht
  waere: `b.language || resolveCallLanguage(...)` - schwaecht aber Owner #8.
- **D2:** Strategie-Doc §3.6 (`outboundFrom(s,tenantId,to)` + primary/laenderpassende Absenderwahl)
  entfaellt durch Owner #6. Signatur bleibt 2-arg, kein `to`-Param, keine primary-Logik.
- **Test-Methodik (keine echte Abweichung):** Der neue Default ist ueber den Spawn-Pfad nicht als
  reiner config-Default beobachtbar (BASE_ENV erzwingt `"*"`). Der number-gate-Test setzt den Wert
  darum explizit und beweist das Drei-Prefix-Verhalten (R2-Absicherung gegen zu weites Gate).

## Invarianten (verifiziert)

- **DE byte-identisch:** `resolveCallLanguage` faellt ohne gesetzte Felder auf `"de"`; inbound-routing
  + Voice-Locales-Snapshots gruen.
- **fail-closed:** Ziel ausserhalb `+49,+33,+44` -> 403 (US `+1` per Test geblockt). Unbekannte
  Sprache -> `de` (`localeFor`).
- **Praezedenz:** settings.language -> number.language -> tenant.defaultLanguage -> "de"
  (state-ops.js:314), identisch Inbound/Outbound.
- **Offenlegung:** fest verdrahtet/kuratiert pro Locale (`localeFor(call.language).disclosure`),
  nicht waehlbar/abschaltbar; disclosure-regression gruen.
- **Toll-Fraud I7:** `from` = eigene aktive Nummer oder `null` -> Reject, NIE Owner-Nummer.
- **Budget-Schnittmenge** (global + pro-Tenant) unangetastet. Keine neue npm-Dep. Keine Secrets.
- **Single-Number-Routing byte-identisch** (outbound-tenant 6/6).

## Test-Ergebnis

`npm test` (voller Spawn-Lauf, json+pglite): **831 pass / 0 fail / 0 skipped (~30s)**. Gezielt
vorab gruen: f1-p8-outbound-lang.test.js (3 neu), number-gate.test.js (neuer +49,+33,+44-Fall),
outbound-tenant.test.js + inbound-routing.test.js (35/35). Keine pre-existing roten Tests.

## Review-Verdikte

- **Safety/Verhalten:** PASS. Keine Blocker. DE byte-identisch, Praezedenz exakt, language durchgereicht,
  Offenlegung fest verdrahtet, Land-Gate prueft Ziel/fail-closed, I7-Riegel intakt, Budget-Schnittmenge
  unberuehrt, keine Dep/Secrets.
- **Clean-Code:** PASS. Keine S1/S2. Kein Magic Number (Config-Default mit Pre-Mortem-Kommentar R2),
  kein toter Code, keine Duplizierung (Helper wiederverwendet, nicht neu). node --check sauber.

## Offene Punkte / Smoke-Gates

- **SHOULD (S3, ausserhalb Diff):** src/mcp-tools.js:88 bewirbt weiter einen optionalen `language`-Param
  ("Gespraechssprache, Default de."), der seit P8 server-seitig ignoriert wird (No-Op, Least
  Astonishment). Param entfernen ODER Beschreibung auf "wird aus Nummer/Settings abgeleitet, Body-Wert
  ignoriert" aendern. Kein Safety-/Korrektheits-Bruch -> kein Blocker.
- **SHOULD (S4, Doku-Drift):** Default `+49,+33,+44` lebt an drei synchronen Stellen (config.js,
  .env.example, render.yaml); bei zukuenftiger Aenderung als Trio ziehen.
- **D1 Owner-Bestaetigung:** Verwerfen von `b.language` bestaetigen lassen.
- **Smoke (Owner):** echter Outbound von FR-Nummer (fuehrt FR) + Ziel `+33`/`+44` erlaubt + Ziel
  ausserhalb Liste geblockt - live noch offen.
- **Commit/Push:** noch nicht committet.
