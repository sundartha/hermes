# P15b - Aufraeum-Runde nach P15 - autoritative Spec

> Folge-Runde zu P15 (`PLAN-I18N-FIX.md`, Abschnitt "P15 - Sprachreinheits-Rest"). Basis:
> `master` = `cdf7a73`. Drei Reste, die der P15-Report ehrlich als nicht gefixt ausgewiesen hat.
> **Keine neue Katalog-ID.** Vorher-Zahlen: `npm test` 3300/3300/0, `npm run test:gates` 447/444/3
> rot (GAP-05, GAP-15 x2).

## C1 - E.164-Formatfehler: einsprachig ENGLISCH, als dokumentierte Systemgrenze

**Befund.** `E164_FORMAT_ERROR` (`src/telephony/outbound-gates.js`) ist deutsch und wird an drei
Stellen ausgeliefert: `src/routes/api-calls.js` (Vor-Gate-Pruefung), das Gate
`trunk_zero_normalized` und der Format-Zweig in `numberGateError`. Die ersten beiden feuern
**vor der Identitaetsaufloesung** - dort ist per Konstruktion kein Tenant bekannt, und ein
Kommentar im Bestand verbietet `resolveCallLanguage` an dieser Stelle ausdruecklich (es wuerde
ueber `settingsFor` lazy einen Settings-Bucket auf einer unaufgeloesten Identitaet anlegen, also
auf einem Schreibpfad).

**Owner-Entscheidung (2026-07-26).** Der Text wird **einsprachig ENGLISCH**. Ein reiner
Eingabe-/Formatfehler ist ein **Vertragsfehler der API-Kante**, keine Nutzeransprache: er ist
sprachfrei und folgt der Weltdefault-Linie - dieselbe Denkweise wie O14 (Modellsprache !=
Nutzersprache).

**SOLL.**
1. `E164_FORMAT_ERROR` wird englisch. Vorschlag: `"'to' must be E.164, e.g. +4917212345678"` -
   Beispielnummer und Feldname bleiben, damit der Hinweiswert erhalten bleibt.
2. **Alle drei** Ausgabestellen benutzen weiterhin **dieselbe eine Konstante** - auch der
   Format-Zweig in `numberGateError`, obwohl dort ein `tenantId` in Reichweite waere. Begruendung
   im Code: die Sprachfreiheit haengt an der **Fehlerklasse** (Eingabe-/Formatfehler), nicht am
   Zufall des Aufrufpfads. Ein und dieselbe Meldung darf nicht je nach Pfad die Sprache wechseln.
3. Ein Kommentar an der Konstante haelt die Grenze fest, ein Test pinnt sie: die Konstante ist
   nicht Teil von `LOCALES.<lang>.gates`, und der 400er-Pfad liefert ueber alle drei
   Tenant-Sprachen **denselben** Text.

**INVARIANTE.** Status `400`, `grund: "format"` und die Audit-Freiheit dieses Pfads (400 =
Eingabefehler -> kein Audit-Ereignis) bleiben unveraendert. `isTrunkZeroFormatError` und die
Gate-Reihenfolge werden **nicht** angefasst.

## C2 - Geldformat im Tenant-Dashboard folgt derselben Locale wie das Datum

**Befund.** P15 hat das Datumsformat vom Server geloest, `public/tenant.html` formatiert
Geldbetraege aber weiter hart mit `Intl.NumberFormat("de-DE", { style: "currency", ... })`. Der
E2E-06-Kanal `tenantHtmlFormat` sieht das nicht (seine Regex verlangt die schliessende Klammer
direkt hinter dem Locale, das Komma rettet die Stelle). Folge heute: ein EN-Dashboard zeigt
englisches Datum **neben** deutscher Waehrungsformatierung.

**SOLL.** Beide Formatierungen benutzen die **eine** Locale, die der Server bereits liefert.
Weil das Feld jetzt Datum **und** Zahl regiert, wird es ehrlich benannt:
`dateLocale` -> `formatLocale` (Feld in `GET /api/self-service/state`, Client-Variable,
`STATIC_DATE_LOCALE` -> `STATIC_FORMAT_LOCALE`). Der Server bleibt die einzige Quelle, der Client
leitet nichts ab (kein `navigator.language`), der Fallback bleibt fail-soft.

**HARTE INVARIANTE - die Geld-Achse.** Geaendert wird ausschliesslich die **Darstellung**
(Trennzeichen, Symbolstellung). Der **Waehrungscode kommt unveraendert aus den Daten** und wird
NICHT abgeleitet, geraten oder umgerechnet: Anzeige-Waehrung == Belastungs-Waehrung (Entscheidung
7.1/O12) gilt weiter. Test dagegen: derselbe Betrag in `EUR` ueber de/en/fr gerendert traegt in
allen drei Faellen `EUR`/`€`, und der **Zahlwert** (Ziffernfolge ohne Trennzeichen) ist identisch.

**Abgrenzung.** `public/calls.html` und `public/calendar.html` bleiben unberuehrt (kein
E2E-06-Kanal, eigene Runde). Der Umbenennung wegen sind die drei P15-Tests in
`test/p15-tenant-html-date-locale.test.js` **umzubenennen/nachzuziehen** - Umbenennung, keine
Abschwaechung.

## C3 - Kein interner Env-Name im Ablehnungstext

**Befund.** `countryBlocked` nennt in **allen drei** Sprachen `(ALLOWED_COUNTRY_CODES)` -
woertlich aus dem deutschen Bestand uebernommen und damit verdreifacht. Zwei Zeilen unter der
Aufrufstelle steht im Bestand der Kommentar, der genau das verbietet: "Ein Ablehnungstext nennt
NIE einen internen Env-Namen (Regel-4-Nachbarschaft): der Anrufer erfaehrt die Sperre, nicht die
Konfigurationsflaeche."

**SOLL.** Der Env-Name faellt in de/en/fr aus dem Text. Die Aussage bleibt: die Laendervorwahl
dieses Ziels ist nicht freigegeben, der Anruf wurde verweigert. Die Zielnummer `${to}` bleibt
drin (sie ist die Eingabe des Anrufers, kein Interna).

**Waechter statt Einzelfix.** Ein Test prueft **alle** Texte in `src/i18n/gate-texts.js` gegen
ein Muster fuer Konfigurations-Bezeichner (durchgehend GROSSGESCHRIEBENER Token mit Unterstrich,
z.B. `ALLOWED_COUNTRY_CODES`, `MAX_BUDGET_EUR`). So faellt der naechste Fall dieser Art beim
Schreiben auf und nicht erst im Review.

## Ausdruecklich NICHT Teil

- Gate-Reihenfolge, -Bedingungen, -Schwellen, `grund`-Schluessel, HTTP-Status: unberuehrt.
- `resolveCallLanguage` vor die Identitaetsaufloesung ziehen: ausdruecklich verworfen (Schreibpfad).
- `public/calls.html`, `public/calendar.html`, `src/claude.js`, `bridge.js`.
- `convo-bench` (Owner-Deploy-Gate, kostet echtes Geld), Deploy/Push, Rechtstexte.
- Neue Env-Variable, neue Dependency, neuer Endpunkt.

## Deterministisch pruefbares Ergebnis

| # | Befehl | Erwartung |
| --- | --- | --- |
| 1 | `node --check` auf jede geaenderte `.js` | fehlerfrei |
| 2 | `npm test` | gruen, 0 fail; 3300 + die neuen Tests |
| 3 | `npm run test:gates` | **unveraendert 3 rot** (GAP-05, GAP-15 x2). Keine neue rote ID, keine faellt weg |
| 4 | `grep -c 'Intl.NumberFormat("de-DE"' public/tenant.html` | `0` |
| 5 | `grep -c 'ALLOWED_COUNTRY_CODES' src/i18n/gate-texts.js` | `0` |
| 6 | `node --test test/e2e-06-en-purity-aggregate.test.js` | weiterhin gruen |

## Pre-Mortem

1. Die Feld-Umbenennung `dateLocale` -> `formatLocale` wurde im Server gemacht, im Client
   vergessen (oder umgekehrt) - das Dashboard fiel still auf den Fallback zurueck und zeigte
   wieder deutsche Formate, ohne dass ein Test es merkte. **Gegenmassnahme:** ein Test, der die
   Verdrahtung end-to-end prueft (Feld in der Antwort UND Konsum im Client), nicht nur die
   Existenz des Feldes.
2. Beim Geldformat wanderte die **Waehrung** mit der Locale (EUR -> USD/GBP), weil jemand
   `currency` aus der Locale ableitete. Ein Tenant sah einen anderen Betrag, als ihm belastet
   wurde. **Gegenmassnahme:** C2-Invariante + Test ueber alle drei Sprachen.
3. Der englische E.164-Text wurde in ein Locale-Buendel gelegt "damit es konsistent aussieht" -
   damit war die Systemgrenze wieder weg und der naechste Umbau lokalisierte ihn doch.
   **Gegenmassnahme:** C1 Punkt 3, Test pinnt die Sprachfreiheit ueber alle drei Tenant-Sprachen.
