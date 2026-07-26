# P15b — Detailbericht: Aufräum-Runde nach P15

**Gate: PASS**
**finalBranch:** `phase/i18n-p15b-aufraeumen` (HEAD `34cdf91`)
**Basis:** `master` = `cdf7a73` + Spec-Commit `f839e50` (Merge-Base-Check bestanden, kein stale base)

---

## 1. Plan (gekürzt)

Drei code-gegroundete Befunde aus der P15-Nachlese, ohne neue Quelldatei/Env/Dependency/Endpunkt (genau eine neue Testdatei):

- **C1 — E164_FORMAT_ERROR**: Grep-Beleg, dass **kein** Test den deutschen Wortlaut pinnt (`"to muss E.164 sein…"`). Alle Konsumenten prüfen nur `status`/`grund` oder ein sprachneutrales `/E\.164/`-Muster. Entscheidung: der Text wird **einsprachig Englisch** (`'to' must be E.164, e.g. +4917212345678`), begründet als Systemgrenze — reiner Eingabe-/Formatfehler ist ein Vertragsfehler der API-Kante, keine Nutzeransprache (Analogie zu O14). Alle drei Ausgabestellen (numberGateError-Formatzweig, Gate `trunk_zero_normalized`, Pre-Gate in `routes/api-calls.js`) teilen weiterhin dieselbe Konstante.
- **C2 — `dateLocale` in `GET /api/self-service/state`**: Grep über den ganzen Baum zeigt **genau einen** Produktivkonsument (`public/tenant.html`); `apps/web` liest das Feld nie (eigene hartkodierte Locale-Konstanten). Feld wird zu `formatLocale` umbenannt, weil es künftig auch Geldformatierung trägt. Geld-Invariante: der Währungscode kommt ausschließlich aus den Daten (`plan.currency`/`s.currency`), niemals aus der Locale — nur das erste `Intl.NumberFormat`-Argument (die Locale) wird geändert, die `currency`-Option bleibt unangetastet. Das Bundle-Feld `LOCALES.<lang>.dateLocale` (speist zusätzlich `claude.js`/`mcp-tools.js`) bleibt bewusst unverändert — eigene Folge-Runde.
- **C3 — interner Env-Name im Ablehnungstext**: `countryBlocked` nennt in de/en/fr `(ALLOWED_COUNTRY_CODES)` im Nutzertext. Fix per generischem Wächter statt Einzelfix: Muster `GROSS-mit-mind.-einem-Unterstrich` (`/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/`) über **alle** Texte in `src/i18n/gate-texts.js`, empirisch kalibriert (KYC/SMS/EUR/E.164/NaN/Hermes schlagen NICHT an, `ALLOWED_COUNTRY_CODES`/`MAX_BUDGET_EUR`/`OUTBOUND_FROZEN` schlagen an).

Reihenfolge zwingend rot-vor-grün (T-Serie/P11): erst die drei Assertions rot sehen (Wächter 3 Treffer, verschärfter E2E-06-Kanal 9 `leaks=["tenantHtmlFormat"]`), dann fixen.

Abgrenzung (bewusst nicht angefasst): keine Gate-Bedingung/-Schwelle/-Reihenfolge/`grund`/Status/Audit, `LOCALES.<lang>.dateLocale` als Bundle-Schlüssel, `public/calls.html`/`calendar.html` (existieren laut Umsetzung ohnehin nicht mehr), `claude.js`, `bridge.js`, `disclosureSentence`, `apps/web`, `/api/self-service/billing/status` (403-Aktivierungspfad bleibt im `de-DE`-Fallback — Bestandsverhalten).

---

## 2. Implementierungs-Zusammenfassung

Umgesetzt exakt nach Spec/Plan, Branch `phase/i18n-p15b-aufraeumen`, HEAD `34cdf91`.

- **C1**: `src/telephony/outbound-gates.js` — `E164_FORMAT_ERROR` auf Englisch umgestellt, ausführlicher Kommentar zur Systemgrenze ergänzt. Status 400 / `grund: "format"` / `audit: null` unverändert. Bestandstest `test/p15-gate-denial-language.test.js` **erweitert** (nicht gesenkt): zweite Ausgabestelle (`trunk_zero_normalized`) mitgeprüft, neuer Pin "Text liegt in keinem Locale-Bundle", neuer Pin "Pre-Gate liefert dieselbe Konstante, kein eigenes Literal".
- **C2**: `src/self-service-routes.js` (`dateLocale` → `formatLocale` im `/state`-Payload) und `public/tenant.html` (Deklaration/Setter/Konsum in `formatPlanPrice`, Zeitstempel, Verlängerungsdatum umbenannt) end-to-end nachgezogen. Zwei Kommentar-Korrekturen zu veralteten Doku-Verweisen. Testdatei `test/p15-tenant-html-date-locale.test.js` per `git mv` zu `test/p15b-tenant-html-format-locale.test.js` umbenannt, Assertions nachgezogen + neuer End-to-End-Verdrahtungstest (Feldname aus dem HTML extrahiert und gegen die echte Serverantwort geprüft — fängt eine einseitige Umbenennung). `test/bk1-plan-price-format.test.js` um die vm-Extraktion von `STATIC_FORMAT_LOCALE`/`setFormatLocale` erweitert (Bestandserwartungen wortgleich, Fallback bleibt `de-DE`) plus zwei neue Geld-Achsen-Tests.
- **C3**: `src/i18n/gate-texts.js` — `ALLOWED_COUNTRY_CODES` aus den drei `countryBlocked`-Texten entfernt, Zielnummer bleibt. Neue Datei `test/p15b-gate-texts-no-config-names.test.js` (generischer Wächter + Kalibrierungstest).
- `test/e2e-06-en-purity-aggregate.test.js`: Kanal-9-Regex verschärft (Anker endet am Locale-Literal statt an der schließenden Klammer) — schließt den in der Spec benannten blinden Fleck (`Intl.NumberFormat("de-DE", {…})` rutschte wegen des Kommas durch).

### Abweichungen vom Plan (deviations, alle dokumentiert im IMPL-Report)

1. Plan 2.5(d) forderte `assert.doesNotMatch(src, /E\.164/)` gegen `src/routes/api-calls.js` — am echten Code unerfüllbar, da Zeile 69 einen legitimen GAP-35-Kommentar mit "E.164" trägt. Umgesetzt wurde die Intention (kein zweitgefasster Formatfehler-**Text**) als Scan nur über Nicht-Kommentar-Zeilen. Kein Abschwächen des Pins auf `error: E164_FORMAT_ERROR`.
2. Ein neuer Kommentar in `public/tenant.html` enthielt zunächst wörtlich `navigator.language` und ließ den Bestandswächter dagegen rot werden; Kommentar umformuliert statt Wächter aufgeweicht.
3. Plan-Prüfpunkt 8 (`grep dateLocale public/ src/self-service-routes.js` → 0 Treffer) ist in sich widersprüchlich zu Plan-Abschnitt 2.3, der den Bundle-Zugriff `localeFor(language).dateLocale` selbst vorschreibt — `public/` hat 0 Treffer (erfüllt), `self-service-routes.js` hat bewusst 3 (1 vorgeschriebener Zugriff + 2 vorgegebene Kommentarzeilen).
4. Plan-Prüfpunkt 10 ("genau 8 Dateien") ist eine Rechenschieflage des Plans selbst — die eigenen Abschnitte 2.1–2.8 plus neue Datei ergeben 9 (3 `src/`, 1 `public/`, 5 `test/`, davon 1 neu, 1 umbenannt). Der Dateisatz entspricht exakt dem Plan, nur die genannte Zahl nicht.
5. Ein versehentlicher, auf sich selbst zeigender `node_modules`-Symlink brach `npm test` reproduzierbar (Exit 194); entfernt, nichts davon committet.
6. Erster Volllauf hatte 1 roten Test (`test/request-tenant.test.js`, `fetch failed`) — bekannter vorbestehender Voll-Last-Spawn-Race, isoliert 4/4 grün, zweiter Volllauf 3307/3307/0.

### Noch rote Gate-IDs (`npm run test:gates`)

Unverändert **3 rot**, identisch vor und nach dem Branch:
- `GAP-05`
- `GAP-15` (×2 — Platzhalter- und EN-Fassung)

Keine neue rote ID, keine ist weggefallen (Baseline `master` zeigt dieselben drei).

---

## 3. Safety-Urteil

**Verdikt: FREIGABE (approved=true).** Alle Kernflags grün: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`; `testWeakened=false`. Keine Blocker.

Eigenständige Belege der Reviewerin (nicht nur Übernahme der Phasentests):

- **Safety-Gates**: kommentar-gestrippter Diff von `outbound-gates.js` gegen `master` zeigt **genau eine** geänderte Codezeile (die Anzeige-Konstante). Jede Bedingung, Schwelle, Prüfreihenfolge, jeder `grund`-Schlüssel, jeder HTTP-Status byte-identisch; `grund=reserve` vs. `grund=budget` unberührt.
- **Geld-Achse**: eigenes vm-Skript gegen die ausgelieferte `formatPlanPrice`-Funktion — 499 Cent EUR rendert unter de-DE/en-GB/fr-FR als "4,99 €"/"€4.99"/"4,99 €" (Ziffernfolge überall "499", Währung überall EUR); USD bleibt unter jeder Locale USD, kein Euro-Zeichen, keine Umrechnung. Alte harte de-DE-Ausgabe == neue formatLocale-Ausgabe für DE (byte-identisch).
- **Verdrahtung C2**: Server sendet `formatLocale`, Client liest `s.formatLocale`; repo-weiter Grep zeigt keinen verbliebenen `s.dateLocale`-Leser. Bundle-Schlüssel `dateLocale` bleibt bewusst (speist `claude.js`/`mcp-tools.js`).
- **Systemgrenze C1**: rekursiver Scan über das gesamte `LOCALES`-Objekt (alle Sprachen, Funktionen materialisiert) — 0 Vorkommen des neuen und des alten Textes im Bundle. Alle drei Ausgabestellen liefern denselben Text/Status/`grund`.
- **C3**: 0 env-artige Bezeichner (GROSS+Unterstrich) in `GATE_TEXTS` bzw. im gesamten `LOCALES`-Baum.

### Unabhängige Testläufe (independentTestSummary)

- **JSON-Backend, Branch**: 3295/3295/0 (2× gefahren, beide grün; roh 3307, 12 Datei-Wrapper abgezogen).
- **JSON-Backend, Baseline `master`**: 3288/3287/1 — der eine Fehlschlag ist der bekannte Voll-Last-Flake (`p10-world-default-language-switch`), isoliert 6/6 grün.
- **Delta Branch vs. Master**: +7 Tests, alle grün, kein Test entfernt — deckt sich exakt mit den 7 neuen/erweiterten Tests.
- **`npm run test:gates`, Branch und Baseline**: identisch 24/21/3 — dieselben drei IDs (`GAP-05`, `GAP-15`×2).
- **PG-Backend** (`STORE_BACKEND=pg`): Branch 2965/2917/48, Master 2958/2910/48 — Liste der 48 Fehlschläge **byte-identisch** zwischen Branch und Master, jeder Fehlschlag `[store] FATAL: pg-Backend nicht initialisierbar` (kein lokales Postgres in der Sandbox), keine P15b-Datei ausser `e2e-06` betroffen (dort am Import-FATAL, nicht an der geänderten Regex).
- Betroffene Dateien isoliert (7 Dateien inkl. `outbound-gates-order`, `deny-diagnosability`): 59/59 grün.

### Notierte Restpunkte (kein Blocker)

1. Der geführte Aktivierungspfad (403 → `renderActivation`) holt nie `/api/self-service/state` und rendert Plan-Kacheln/Einrichtungsgebühr weiterhin im `de-DE`-Fallback — unverändertes Bestandsverhalten, im Code kommentiert.
2. Der E2E-06-Wächter bleibt literal-verankert (`Intl.NumberFormat("de-DE"` / `toLocaleString("de-DE"`), fängt kein `new Intl.NumberFormat(STATIC_FORMAT_LOCALE, ...)` — strukturell robuster wäre eine Folgerunde.
3. Kosmetischer Textfehler in einer Assertion-Meldung (`bk1-plan-price-format.test.js:91`: sagt "EUR-Locale", setzt aber `en-GB`) — Test selbst korrekt.
4. `PLAN-SECURITY.md` nicht aktualisiert für die C3-Härtung (niedrige Priorität, Spec verlangt es nicht).
5. Spec nennt `public/calls.html`/`calendar.html` als unberührt — beide existieren im Repo nicht mehr (reine Spec-Altlast).
6. Vorbestehender Voll-Last-Flake (`WORLD_DEFAULT_LANGUAGE_ENABLED` Test), nicht vom Branch verursacht, isoliert grün.

---

## 4. Clean-Code-Audit (S1–S4)

**Verdikt: PASS, blocker=false.** `s1=[]`, `s2=[]`, `s3=[]`, `s4=[]` — keine Befunde in irgendeiner Schweregrad-Klasse.

Begründung (passNotes):
- G5 (eine Wahrheitsquelle) für Ablehnungstexte weiterhin über genau **einen** Resolver (`localeFor` → `gates`), keine zweite Kopie der Auflösungslogik.
- Alle drei Locale-Tabellen (de/en/fr) vollständig, strukturell gegen fehlende Schlüssel abgesichert (der neue Wächter-Test erzwingt `sprachen × schlüssel` als Abdeckungszähler — G27, keine Pflegeliste).
- `formatLocale`-Rename konsistent Server↔Client, per End-to-End-Test gegen einseitige Umbenennung abgesichert.
- Geld-Achse (Währungscode vs. Darstellungslocale) sauber getrennt und mit zwei dedizierten Tests gepinnt.
- E.164-Systemgrenze explizit dokumentiert und an allen drei Ausgabestellen getestet.
- 30/30 einschlägige Tests lokal grün, `node --check` sauber.
- Kosmetische topTodos (keine Flags): lange Kommentarblöcke in `gate-texts.js`/`outbound-gates.js` könnten künftig gestrafft werden; `self-service-routes.js`-Kommentar verweist bewusst auf die offene Folge-Runde für `claude.js`/`mcp-tools.js` (kein aktueller Verstoß).

Selbstauskunft der Implementierung (cleanCodeSelfCheck) deckt sich damit: keine Magic Numbers, kein toter/auskommentierter Code, keine ungenutzten Imports, ≤3 Argumente, eine Aufgabe je Funktion, Kommentare deutsch ohne Umlaute. Ein bewusst akzeptiertes S4-Muster (dasselbe "Funktionswert mit Platzhaltern materialisieren"-Idiom in zwei Testdateien über zwei verschiedene Quellen) wurde geprüft und nicht extrahiert, da eine gemeinsame Hilfsfunktion die beiden Testdateien aneinander gekoppelt hätte, ohne echte Logik zu sparen — vom Plan so vorgesehen, keine Scope-Erweiterung.

---

## 5. Fix-Runden

Keine — der erste Implementierungsdurchlauf erreichte in beiden Reviews (Safety und Clean-Code) direkt PASS ohne Blocker. Die einzigen Korrekturen fanden **während** der Implementierung statt (siehe Abweichungen 1–2 oben: unerfüllbare Plan-Assertion an Kommentarzeile angepasst, eigener neuer Kommentar wegen Wächter-Kollision umformuliert) und sind keine nachträgliche Fix-Runde im Sinne von Review-Feedback.

---

## 6. Bestandstests nachgezogen (nicht entschärft) — explizite Übersicht

| Datei | Art des Nachzugs | Erwartungen |
|---|---|---|
| `test/p15-gate-denial-language.test.js` | Erweitert um zweite Ausgabestelle (`trunk_zero_normalized`) + 2 neue Pins (Bundle-Ausschluss, Pre-Gate-Konsistenz) | strikt mehr geprüft, nichts entfernt |
| `test/p15-tenant-html-date-locale.test.js` → `test/p15b-tenant-html-format-locale.test.js` | `git mv` (von Git als Rename erkannt), Feldnamen nachgezogen, 1 neuer End-to-End-Verdrahtungstest ergänzt | alle 3 Bestandsassertions bleiben, plus neue |
| `test/bk1-plan-price-format.test.js` | vm-Extraktion um `STATIC_FORMAT_LOCALE`/`setFormatLocale` erweitert, 2 neue Geld-Achsen-Tests | bestehende Preis-Erwartungen ("4,99 €" etc.) **wortgleich** unverändert |
| `test/e2e-06-en-purity-aggregate.test.js` | Kanal-9-Regex verschärft (Anker endet am Locale-Literal statt an schließender Klammer) | strikt **breiter** (mehr Treffer möglich), vor dem Fix nachweislich rot — keine Abschwächung |

Beleg für "nicht entschärft" (`testWeakened=false`): unabhängig von der Safety-Reviewerin per eigenem Vergleich Branch-vs-Master nachgerechnet (+7 Tests, 0 entfernt, 0 übersprungen), sowie die Kanal-9-Regex ausdrücklich als "vor dem Fix rot, danach grün" nachvollzogen.

---

## 7. Geld-Invariante — wie belegt

Die Kernaussage der Phase (Anzeige-Währung == Belastungs-Währung, Locale ändert nur die Darstellung) wurde auf drei unabhängigen Ebenen bewiesen:

1. **Statischer Codepfad**: `formatPlanPrice(amountCents, currency)` in `public/tenant.html` — nur das erste `Intl.NumberFormat`-Argument (Locale) wurde geändert, die `currency`-Option (`String(currency).toUpperCase()`) blieb unverändert. Kein Codepfad leitet `currency` aus einer Locale ab (Plan-Abschnitt 5, explizit als Abgrenzung benannt).
2. **Testebene** (`test/bk1-plan-price-format.test.js`, an der per `vm` aus dem echten HTML extrahierten Funktion, kein Nachbau): 499 Cent in `"eur"` bleibt über de-DE/en-GB/fr-FR bei Ziffernfolge "499" und Euro-Symbol; ein zweiter Test zeigt, dass `usd` unter `en-GB`-Locale kein Euro-Zeichen erzeugt.
3. **Unabhängige Safety-Review** (eigenes, separates vm-Skript, nicht aus dem Testcode übernommen): 499 EUR → "4,99 €" / "€4.99" / "4,99 €" unter de-DE/en-GB/fr-FR, Ziffernfolge und Währungscode in allen drei Fällen identisch (EUR); Gegenprobe "usd" → "4,99 $" / "US$4.99" / "4,99 $US", nirgends ein Euro-Zeichen, keine Umrechnung. Zusätzlich Byte-Identität geprüft: alte hartcodierte de-DE-Formatierung == neue `formatLocale`-Formatierung für den DE-Fall.

Damit ist die Invariante nicht nur im Plan behauptet, sondern durch Code-Diff (keine `currency`-Zeile geändert), durch neue automatisierte Tests und durch eine dritte, unabhängig geschriebene Stichprobe dreifach belegt.
