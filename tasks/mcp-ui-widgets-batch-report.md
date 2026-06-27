# MCP Rich-UI — Widgets-Batch (get_my_number, list_calls, get_calendar)

Branch `phase/mcp-ui-widgets-batch` auf Basis `master` (61f1b38). Additives Muster wie
P2/P3/W3: **KEINE** Seam-Kern-Aenderung (contract/ports/registry/Adapter byte-identisch),
nur Katalog-/Widget-/Tool-Verdrahtung + die generische Binding-Erweiterung. Kein neuer
npm-Dep, ESM, kein Build-Step, deutsche Kommentare ohne Umlaute.

## Plan-Kurzfassung

Drei weitere read-only Widgets ueber den BESTEHENDEN UiRenderer-Seam:
- Stufe 0 (`structuredContent` + `outputSchema`, schema-validiert) IMMER, Stufe-0-Text
  byte-identisch zum Bestand (Backward-Compat, additiv).
- Stufe 1 (`ui://`-Widget) nur bei faehigem Host ueber `enableWidgetUi(...)`; sonst
  fail-closed Fallback auf Stufe 0.
- Eine Whitelist je Tool (`pickX`) VOR Text + structuredContent + Widget — kein
  PII/Secret/Roh-Transkript/Audio/Cross-Tenant-Feld passiert.
- Self-contained Widget-HTML (Inline-Tokens, `@dsCard` Zeile 1, kein `@import`/`<link>`/
  `href`), `data-mcp`-Slots == Whitelist-Schluessel; Binding erbt W1 (kein eigenes Script).

## Die EINE nicht-triviale Stelle: generisches Objekt-Listen-Rendering (`widget-bind.js`)

`list_calls`/`get_calendar` liefern **Arrays von Objekten**. Das W1-Binding fuellte bisher
nur flache Skalar-Slots + skalare Zeilen (`last_transcript_lines`). Erweitert wurde es
**generisch und DRY**:
- `rowFields(container)` — liest die deklarierten Sub-Felder eines Slots aus dem Attribut
  `data-mcp-row="feld1,feld2,..."` (das Binding kennt KEINE konkreten Widget-Felder; die
  View deklariert ihre Spalten — OCP, analog zur bestehenden `data-mcp`-Slot-Konvention).
- `renderRows(doc, container, items)` — je Eintrag eine `<div class="row">` mit einer
  `<span class="cell" data-field="<feld>">` je deklariertem Feld; 3-arg-Signatur und
  Clear-vor-Render-Disziplin **wie `renderLines`**.
- `applyField`-Dispatch: Array + `data-mcp-row` deklariert -> `renderRows`; Array ohne
  Deklaration -> `renderLines` (Bestandspfad `last_transcript_lines` **unveraendert**);
  sonst `textContent`.

**Begruendung / Invarianten:**
- **XSS-sicher (harter S1):** Werte landen AUSSCHLIESSLICH ueber `textContent`, NIE
  `innerHTML`. Test BIND3 weist nach, dass ein `<img onerror>`-String verbatim als Text
  landet und KEIN DOM-Kind erzeugt.
- **DRY (S2):** eine Quelle in `widget-bind.js`; `BIND_SCRIPT` bleibt die
  `Function.prototype.toString`-Projektion DERSELBEN Funktionen (`rowFields`/`renderRows`
  mit aufgenommen) — die Iframe-Logik existiert nur einmal, kein Copy-Paste je Widget.
- **Pure/ohne DOM testbar:** das Mapping/Escaping/Row-Rendering ist reine Funktion und
  wird mit einem Fake-DOM (`node:test`, kein Browser-Dep) geprueft.

Serverseitige Formatierung: Timestamps (`startedAt`/`start`/`end`) werden im `pickX` ueber
den **bestehenden** `fmt`-Helper formatiert (eine Quelle — derselbe Formatter wie der
Stufe-0-Text, keine Duplizierung, kein Datum-Wissen im generischen Binder).

## Whitelist je Tool (Daten-Kontrakt, Eigendaten des Tenants)

| Tool            | `structuredContent`            | pro Eintrag (genau diese Felder)                                       |
| --------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `get_my_number` | `{ number }`                   | — (number nullable; fail-closed leer -> null)                          |
| `list_calls`    | `{ calls: [ … ] }`             | `id, direction, counterparty (to@outbound/from@inbound), status (mapStatus), startedAt (fmt), summary?` |
| `get_calendar`  | `{ calendar: [ … ] }`          | `title, start (fmt), end (fmt)`                                         |

`counterparty`/`title` sind nullable (eine einzelne defekte Zeile darf nicht die ganze
Liste per Schema-Fehler killen), `summary` optional. `get_calendar` bleibt hinter dem
`allowCalendar`-Profil-Gate (Tool nur dann registriert — unveraendert).

Stufe-0-Text wird aus DENSELBEN gewhitelisteten Eintraegen gebaut (`callTextLine` bzw.
inline) — keine zweite Aufloesung von to/from/status/Datum (S2). Byte-identisch zum
Bestand fuer alle realistischen Daten; leerer Fall behaelt "Noch keine Anrufe."/"Kalender
ist leer." + leere Liste im `structuredContent` (Schema verlangt structuredContent auch
leer).

## Tests (29 neu, alle gruen)

- `test/mcp-ui-w1-bind.test.js` (+6, pure Binding, Fake-DOM): `rowFields`-Parsing
  (trim/leer/fehlend/defensiv ohne `getAttribute`); `renderRows` (Rows/Zellen/`data-field`,
  fehlendes Feld -> leere Zelle, Clear-vor-Render); **XSS** (textContent, kein Markup);
  `applyField`-Dispatch (Objekt-Liste -> Rows; Skalar-Array -> turns **unveraendert**);
  `bind` end-to-end; `BIND_SCRIPT`-Projektion + kein `innerHTML`. Die Bestands-Invariante
  T-W1-AC1 deckt jetzt auch die 3 neuen Widgets ab (genau eine BIND_SCRIPT-Quelle).
- `test/mcp-ui.test.js` (+17): je Tool AC1 (Stufe-0-Text + schema-valides
  `structuredContent`), AC2 (faehiger Host -> genau eine Resource + `_meta`), AC3
  (Fallback fail-closed: kein `_meta`/Resource, Stufe 0 bleibt), AC4 (**Whitelist**: ein
  RICH_STATE mit Roh-Transkript/PII/Secrets/Cross-Tenant beweist Nicht-Durchreichung,
  exakte Key-Mengen, Resource-HTML statisch), AC6 (self-contained, read-only, erbt W1,
  Listen-Widgets deklarieren `data-mcp-row`); plus leere-Liste-Faelle.

**Verifikation:** `node --check` auf alle geaenderten/neuen `.js` gruen; `BIND_SCRIPT`-Inner
ist valides JS; `npm run check:tokens` -> exit 0 (neue Widgets `@import`-frei; Widget-HTML
ist NICHT im `tokens.lock`-Manifest, daher kein Nachzug noetig); Bestandssuite
**1160 -> 1183, fail 0** (alle 29 neuen Tests oben drauf, keine Regression).

## Self-Review gegen clean-code.md (S1/S2 = keine)

- **S1 (Tests/Korrektheit/Sicherheit): keine.** Neues Verhalten getestet (29). XSS-Gate:
  ausschliesslich `textContent` (BIND3 beweist es), nie `innerHTML`. Safety-Gates/
  Disclosure/Call-Pfad unberuehrt (reine Read-/Render-Schicht, kein Callback). Secrets/PII/
  Roh-Transkript/Audio/Cross-Tenant per Whitelist gefiltert (AC4 je Tool).
- **S2 (Duplizierung): keine.** Binding-Logik EINE Quelle (`widget-bind.js` + toString-
  Projektion). Text UND structuredContent lesen dieselben gewhitelisteten Eintraege. `fmt`
  serverseitig wiederverwendet. Test-Harness (captureUi/withGateway/capableHost/
  readbackResource/FALLBACK_CASES) geteilt, nicht kopiert.
- **S3/S4 (gebuendelt):** `renderRows` auf 3-arg reduziert (`fields` intern via
  `rowFields` — F1 vermieden, Signatur konsistent zu `renderLines`). Benannte Konstanten
  statt Magic-Strings (`ROW_CLASS`/`CELL_CLASS`/`ROW_FIELDS_ATTR`/`FIELD_ATTR`/`FIELD_SEP`).
  `callTextLine` benennt das Legacy-Textformat (1 Verwender, aber dokumentiert die
  Byte-Kompat-Sicht). Neue Widget-Ids aus der **kanonischen** Quelle `widget-catalog.js`
  importiert (mcp-native-Re-Export ist laut Datei-Kommentar historisch); Adapter
  byte-identisch.

## Bewusste Abweichungen / Nicht-Ziele

- KEIN Callback/Schreib-Aktion (alle 3 read-only), kein neues Tool, keine W1-/Seam-Kern-
  Aenderung. Live-Host-Smoke (W2) bleibt offen wie bei der ganzen Kette.
- Timestamps im `structuredContent` sind server-formatierte Anzeige-Strings (wie das
  bestehende `last_transcript_lines`); die kanonischen Maschinendaten liegen in der
  REST-API. Bewusst: kein Datum-Wissen im generischen Binder, keine `fmt`-Duplizierung.
- Degenerierter Fall (fehlende `to`/`from` -> counterparty `null`) rendert "null" statt des
  alten "undefined" im Text — nur bei malformed Call-Daten, dokumentiert akzeptiert.
