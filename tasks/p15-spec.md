# P15 - Sprachreinheits-Rest (E2E-06) - autoritative Spec

> Bindend vor `PLAN-I18N-FIX.md`. Das Umbrella-Dokument ist Abschnitt "P15 - Sprachreinheits-Rest"
> plus Owner-Entscheidung **O14** (Abschnitt 3). Basis: `master` = `18556df`.

## 0. Warum es diese Phase gibt

E2E-06 faellt mit keiner der 14 geplanten Phasen. P11 hat den Leck-Zaehler von 8 auf 3 gesenkt und
die drei Restlecks an P12/P13 abgegeben; keine der beiden hat sie uebernommen. Nach dem P13-Merge
am 2026-07-26 gemessen (nicht vermutet) auf `f07669f`:

```
AssertionError: gemessene Lecks: gateRejectionLiterals, mcpErrorLiterals, tenantHtmlFormat
  actual: [ 'gateRejectionLiterals', 'mcpErrorLiterals', 'tenantHtmlFormat' ]
  expected: []
```

## 1. Scope - vier Teile, alle in dieser Phase

### T1 - `tenantHtmlFormat`

`public/tenant.html` formatiert Datum/Zeit hart mit `toLocaleString("de-DE")` (eine Fundstelle,
Stand `18556df` Zeile 319 - **Zeilennummer nicht uebernehmen, grep danach**). Ein EN-Tenant sieht
deutsche Datumsformate im eigenen Dashboard.

**SOLL:** das Format folgt der Sprache, die die Seite ohnehin schon ausliefert (P9-Wurzel).
**Keine zweite Aufloesungsfunktion, kein `navigator.language`** - dieselbe Regel, die P13 fuer das
Widget durchgesetzt hat. Wenn `public/calls.html`/`calendar.html` dieselbe harte Formatierung
tragen: das ist NICHT Teil dieser Phase (E2E-06 misst sie nicht) - im Report benennen, nicht
mitfixen.

### T2 - `gateRejectionLiterals`

`src/telephony/outbound-gates.js` traegt zehn deutsche `message:`-Literale ohne Sprachverzweigung
(KYC, Abo inaktiv, Zahlungsproblem, gesperrte Nummer, Land-Gate, Stundenlimit, Wiederhol-Limit,
drei Budget-Texte). Das ist der Kanal, ueber den ein EN-Tenant erfaehrt, **warum** sein Anruf
verweigert wurde.

**SOLL:** die `message`-Texte folgen der Tenant-Sprache (de/en/fr), aus **derselben** Locale-Quelle
wie der uebrige Textkanal - kein zweiter Lookup, kein zweiter Fallback.

**HARTE INVARIANTE:** der Ablehnungs-**Grund** ist Protokoll, nicht Anzeige. `reason`/`grund`-
Schluessel, Fehlercodes, HTTP-Status und alles, was in Audit/Logs/`money-events` landet, bleiben
**byte-identisch und sprachfrei**. Die Betriebs-Forensik der Kosten-Kette unterscheidet
`grund=reserve` von `grund=budget`; verschiebt sich das, wird die Budget-Diagnose stumm wertlos.
Test dagegen: je Gate ein Fall, der den Grund-Schluessel pinnt UND den Text als sprachabhaengig
prueft.

**Die Gates selbst bleiben unangetastet.** Geaendert wird ausschliesslich der Anzeigetext einer
bereits gefallenen Ablehnung - keine Bedingung, keine Schwelle, keine Reihenfolge.

### T3 - `mcpErrorLiterals` (zwei Haelften, unterschiedlich behandelt)

**T3a - tenant-sichtbarer Text folgt der Tenant-Sprache.** Die Leertexte `"Noch keine Anrufe."`
und `"Kalender ist leer."` sowie die hart deutschen Feld-Labels im `get_agent_status`-Textblock
("Agent-Nummer:", "Besitzer:", "Voice-Engine:", "Modell:", "Berechtigungen:") kommen nach
`src/i18n/mcp-texts.js` und werden aus `loc.mcp` gelesen - genau wie die Rollen-Praefixe und
Fehlertexte, die P12/P13 dort bereits abgelegt haben. **DE bleibt byte-identisch zum Bestand.**
Das ist der offene S3-Befund aus dem P12-Review, den P13 ausdruecklich aus dem Scope genommen hat.

**T3b - Tool-Beschreibungen werden EINMALIG englisch (Owner-Entscheidung O14, bindend).** Die
Beschreibungen von `place_call`/`get_call_status`/`cancel_call`/`list_calls`/`get_calendar` und
alle `.describe()`-Schematexte (goal, briefing, mandate, constraints, context ...) sind heute
**deutsch**. Sie werden **einmal auf Englisch gezogen und bleiben dort - ohne Sprachverzweigung**,
unabhaengig von `settings.language`. Sie liest das Client-Modell (Claude in claude.ai), nicht der
Tenant: **Modellsprache != Nutzersprache** ist ab hier eine dokumentierte Systemgrenze und gehoert
als Kommentar an den Kopf von `src/mcp-tools.js`, damit die naechste Phase sie nicht versehentlich
wieder in die Lokalisierung zieht.

**HARTE INVARIANTE zu T3b - emphase-erhaltend, nicht sinngemaess uebersetzen.** In diesen Texten
stecken die in der Anrufqualitaets-Kette teuer erarbeiteten engen Verbote am Tool-
Entscheidungspunkt ("KEIN Infinitiv-Stummel wie 'Termin vereinbaren'", "frage ZUERST kurz beim
Nutzer nach", "Harte Verbote gehoeren NICHT hierher", "WOERTLICH vorgesprochen"). Jede
Grossschreibung, jede Negation, jedes Negativ-Beispiel bleibt an derselben Stelle stehen; wo das
Deutsche schroff ist, bleibt das Englische schroff. **Kein "please", kein Weichzeichnen, keine
Umstellung der Satzreihenfolge.** Beleg: ein Test, der je Beschreibung die Anzahl der
Grossschreib-Marker und die Existenz des Negativ-Beispiels pinnt - dieselbe Mechanik, mit der P11
die Verbots-Emphase der gesprochenen Prompts gehalten hat.

### T4 - R5-Korrektur am Testkanal (Pflicht, sonst ist die Phase unloesbar)

`test/e2e-06-en-purity-aggregate.test.js` greppt fuer den Kanal `mcpErrorLiterals` die
**komplette Quelldatei** `src/mcp-tools.js` gegen die Stopwortliste - inklusive der **deutschen
Kommentarzeilen**, die die Repo-Konvention ausdruecklich verlangt (8 Treffer, Stand `18556df`).
So kann der Kanal strukturell nie gruen werden, egal wie sauber der Code ist.

**SOLL:** der Kanal wird auf **tenant-sichtbaren, ausgelieferten Text** eingegrenzt - so wie es der
Nachbarkanal `gateRejectionLiterals` mit seinem `message:`-Muster bereits vormacht. Kommentare
zaehlen nicht, und die nach O14 bewusst englischen Tool-Beschreibungen zaehlen nicht.

**VERBOTEN:** die Stopwortliste `GERMAN_STOPWORDS` aufweichen, Kanaele entfernen,
`TOTAL_CHECKED_LABELS` senken oder die Erwartung `expected: []` abschwaechen. Das waere exakt der
Fehler, den P13 fuer MCP-12 ausdruecklich verboten hat: der Test hiesse weiter E2E-06 und wuerde
nichts mehr messen. Die Korrektur wird im Phasenreport **als R5 benannt und begruendet**, nicht
nebenbei mitgenommen.

**A3 (Plan-Auflage):** wird E2E-06 gruen, wandert der Test per **Umbenennung** aus `test:gates` in
den Regressionslauf - die Zuordnung laeuft allein ueber die Katalog-ID am Namensanfang
(`package.json` `config.i18nCatalogPattern`). Der Test wird NICHT geloescht; sein Regressionswert
ist der eigentliche Gewinn.

## 2. Ausdruecklich NICHT Teil dieser Phase

- `npm run convo-bench` - kostet echte Anthropic-API-Calls. Der Bench ist **Owner-Deploy-Gate**
  (Abnahme (b) in `PLAN-I18N-FIX.md` P15), nicht Aufgabe des Impl-Agenten. Nicht fahren.
- Deploy/Push. `master` ist rund 97 Commits vor `upstream/master`; das ist eine getrennte
  Owner-Entscheidung.
- GAP-05 (dauerhaft rot per O2b) und GAP-15 (wartet auf Rechtstext-Lieferung per O13).
- Die offenen P13-Restpunkte (fehlendes Safety-Urteil, Widget-Smoke im echten claude.ai).
- `public/calls.html`, `public/calendar.html`, `src/claude.js`-Prompts, `bridge.js`.
- Neue Env-Variable, neue Dependency, neuer Endpunkt: nichts davon ist noetig.

## 3. Deterministisch pruefbares Ergebnis

| # | Befehl | Erwartung |
| --- | --- | --- |
| 1 | `node --check` auf jede geaenderte `.js` | fehlerfrei |
| 2 | `npm test` | gruen, 0 fail. Vorher-Wert auf `18556df`: **3271/3271/0** - danach 3271 + neue Tests + der per A3 umgezogene E2E-06-Test |
| 3 | `npm run test:gates` | vorher **444/440/4 rot** -> nachher **3 rot**: nur noch `GAP-05` und `GAP-15` (2 Assertions). **`E2E-06` darf nicht mehr auftauchen** |
| 4 | `node --test test/e2e-06-en-purity-aggregate.test.js` | gruen, `leaks` leer |
| 5 | `grep -c 'toLocaleString("de-DE")' public/tenant.html` | `0` |
| 6 | Smoke (best-effort): Server auf freiem Port, `SKIP_TWILIO_SIGNATURE_CHECK=true` | ein abgelehnter Outbound eines EN-Tenants liefert englischen `message`-Text **und** unveraenderten Grund-Schluessel |

Punkt 3 ist das Abnahmekriterium der Phase. Wird eine der drei verbleibenden roten IDs zusaetzlich
gruen oder eine vierte rot, ist das ein Befund und gehoert in `deviations` - nicht passend
gemacht.

## 4. Pre-Mortem (aus dem Plan, hier bindend)

1. Ablehnungstexte uebersetzt, Grund-Schluessel dabei verschoben -> Betriebs-Forensik liest falsche
   Ursachen, Budget-Diagnose stumm wertlos. **Gegenmassnahme: T2-Invariante + Pin-Test.**
2. E2E-06 "gruen gemacht" durch Entschaerfen des Tests -> misst nichts mehr.
   **Gegenmassnahme: T4-Verbotsliste, R5-Begruendung im Report.**
3. `tenant.html` bekommt eine zweite Sprachquelle -> zwei Aufloesungsregeln, Anzeige faellt beim
   Sprachwechsel auseinander. **Gegenmassnahme: T1, dieselbe Quelle wie die Seite selbst.**
4. EN-Uebersetzung schleift die Verbots-Emphase ab -> das Client-Modell setzt wieder vage Auftraege
   ab, sichtbar erst am naechsten schlechten Gespraech. **Gegenmassnahme: T3b-Invariante +
   Marker-Pin-Test; convo-bench als Owner-Deploy-Gate.**
