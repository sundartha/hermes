# PLAN-I18N-FIX

Fix-Plan fuer die 53 offenen Katalog-IDs des i18n-Launch-Testkatalogs.

## 1. Kopf

**Zweck.** Dieser Plan legt fest, in welcher Reihenfolge die 53 offenen Befunde des
i18n-Launch-Testkatalogs behoben werden, was der Owner vorher entscheiden muss, welches Risiko
jede Phase traegt und woran ihre Abnahme haengt. Er ist ein Plan, keine Umsetzung: kein Schritt
hier ist bereits ausgefuehrt.

**Basis.** Commit `9a5e9a6`, Arbeitsbaum sauber.

**Gemessene Ausgangslage.** `npm test`: 3044 Tests, 2958 gruen, **86 rot**. 85 der roten Blaetter
entfallen auf **53 Katalog-IDs** (GAP-18 buendelt 12 Subtests unter einem Elterntest). Das 86.
Rot ist `test/voice-status-lifecycle.test.js:137` - ein dokumentierter Voll-Last-Flake, isoliert
gruen, keine Katalog-ID, kein Befund (siehe Abschnitt 7).

**Datengrundlage.** `tasks/i18n-tests/16-befund-klassifikation.md` (je ID: Sachverhalt, Art,
Aufwand, Risiko, beruehrte Produktionsdateien, Abhaengigkeiten, `brennt_heute`, Migrationsrisiko,
Beleg). Ergaenzend `tasks/i18n-tests/13-live-env-befund.md` (Live-Env gegen `render.yaml`),
`tasks/i18n-tests/00-kanonische-liste.md` (Regeln R1-R5), `PLAN-I18N-TESTS.md` Kapitel 7
(Entscheidungsstand). Wo dieser Plan von der Klassifikation abweicht, steht die Abweichung mit
Beleg an der betreffenden Phase - er ueberschreibt sie an drei Stellen (P2, P6, Abschnitt 6).

**Abnahme-Mechanik.** Die Suite ist getrennt (Aufgabe 1, laeuft parallel):

- `npm test` = Regressionsschutz. **Muss immer gruen sein.** Jede Phase, die ihn rot laesst, ist
  nicht abgenommen.
- `npm run test:gates` = Launch-Gate. Darf rot sein; die Rot-Liste sinkt mit jeder Phase.
  Startwert 53 Katalog-IDs, Zielwert 0.

**Stehende Abnahme-Auflage A3 (gilt fuer JEDE Phase, in keinem der drei Entwuerfe enthalten).**
Ein Katalogtest, der nach seinem Fix gruen ist, aber in `test:gates` liegen bleibt, ist **kein
Regressionsschutz** - in einer Suite, deren Rot toleriert wird, faellt ein spaeteres Umkippen
niemandem auf. Deshalb gehoert zu jeder Phasenabnahme ein zusaetzlicher Schritt: die jetzt gruenen
Katalogtests **wandern in die Regressionssuite** (`npm test`), und die Rot-Liste von `test:gates`
schrumpft um genau diese IDs - beides mit Zahl belegt (53 -> n). Ohne diesen Schritt endet der
Plan mit 53 gruenen Tests in einer Suite, die niemand als Gate liest, und null neuem
Regressionsschutz.

**Stehende Abnahme-Auflage A6: Deploy-Wahrheit.** `git push origin` macht **nichts** live; Render
deployt vom Upstream-Remote. Ab P1 gilt fuer jede Phase: `GET /healthz` des Live-Dienstes liefert
den Commit, der gepusht wurde. Ohne diesen Abgleich gilt eine Phase als **nicht live**, egal was
der lokale Branch sagt. Zusaetzlich: der Live-Service ist **Dashboard-managed**;
`render.yaml` ist Referenz, nicht Wahrheit (belegt: `ALLOWED_COUNTRY_CODES` live `*` statt
`+49,+33,+44`; `MAX_BUDGET_EUR` live `30` statt `8`).

---

## 2. Kurzurteil

Zuerst kommt, was heute schon Geld verliert, ungewollte Anrufe zulaesst oder eine Rechtspflicht
verletzt - und was diesen Schaden ueberhaupt sichtbar macht. Zuletzt kommt die Sprache, weil sie
erst am Weltstarttag jemandem auffaellt.

Konkret: **Sicht** (P1) vor allem, weil sonst keine spaetere Phase am laufenden Dienst
nachweisbar ist. Dann **Wahl-Sicherheit** (P2) und der **Inbound-Pflichtsatz** (P3) - beides
brennt heute bei jedem Anruf. Dann die drei Geld-Ketten in Abhaengigkeitsreihenfolge:
**Abo-Lebenszyklus** (P4), **Herkunfts-Tarifierung** (P5), **Budget-Fenster** (P6),
**Boot-Kohaerenz** (P7). Erst danach die Sprachkette: **Geo-Identitaet** (P8), **Web-Texte** (P9),
**Weltdefault-Flip** (P10), **gesprochene Sprache** (P11), **MCP** (P12), **Widget** (P13),
**Rechtstexte** (P14).

**Der eine Satz, warum diese Reihenfolge und keine andere:** die Sprachkette haengt an einer
einzigen Konstante, deren Umlegen den gesamten Bestand auf Englisch kippen kann - und die drei
Vorbedingungen dieses Umlegens (Land am Tenant, korrigierter Schreibpfad, verifizierter Backfill)
sind teurer und langsamer als jeder Geld- oder Gate-Fix davor, weshalb die Geld- und
Gate-Fixes nichts gewinnen, wenn man sie hinter die Sprache stellt, die Sprache aber alles
verliert, wenn man sie vor ihre Vorbedingungen stellt.

---

## 3. Was der Owner entscheiden muss, BEVOR gefixt wird

> **Keine Zeile dieser Tabelle ist ein Implementierungsauftrag.** Es sind Fragen an den Owner mit
> einer Empfehlung und der Folge jeder Option. Ein Implementierer, der eine dieser Zeilen als
> Aufgabe liest und die Empfehlung einfach umsetzt, arbeitet gegen diesen Plan. Das ist in diesem
> Projekt bereits einmal schiefgegangen.

| # | Frage | betrifft IDs | Empfehlung | Folge wenn anders | blockiert |
| --- | --- | --- | --- | --- | --- |
| **O1** | **Ablesefrage, keine Codefrage:** welche Werte stehen im Render-Dashboard des Live-Service (`srv-d8m0fhflk1mc73bno570`) fuer `BUDGET_MONTH_ENABLED`, `DEFAULT_TENANT_BUDGET_CENTS`, `VOICE_TARIFF_DEFAULT_CENTS`, `MAX_CALLS_PER_HOUR`, `METRICS_ENABLED`? | GAP-01, GAP-32, GAP-33, GAP-35, GAP-10, GAP-07 | Werte einmal ablesen, in `test/prod-env.js` `LIVE_MEASURED` eintragen. **Praezisierung des Ist-Zustands (am Code geprueft, nicht nur "teils unmeasured"):** von diesen fuenf Achsen steht heute nur `BUDGET_MONTH_ENABLED` in `LIVE_UNMEASURED`; `DEFAULT_TENANT_BUDGET_CENTS`, `VOICE_TARIFF_DEFAULT_CENTS`, `MAX_CALLS_PER_HOUR` und `METRICS_ENABLED` stehen in KEINER der beiden Listen und laufen ueber `LIVE_ENV = {...RENDER_ENV, ...LIVE_MEASURED}` still auf Blueprint-Werten - der GAP-33-Smoke behauptet damit Live-Aussagen auf Blueprint-Zahlen, ohne das kenntlich zu machen. **Auflage:** jede hier abgelesene Achse wird nach der Ablesung entweder in `LIVE_MEASURED` oder (falls unbekannt) in `LIVE_UNMEASURED` eingetragen - keine bleibt danach still auf dem Blueprint-Wert. Insbesondere: steht `BUDGET_MONTH_ENABLED` bereits auf `true`? Das Projektgedaechtnis notiert es seit 2026-07-25 als AN, der GAP-33-Bericht fuehrt dieselbe Achse als nicht belegt - genau eine der beiden Aussagen ist falsch, und keine Codearbeit kann das entscheiden. **Nicht Teil dieser Ablesung:** `MAX_CALL_DURATION_CAP_S` ist keine Env-Variable, sondern eine Code-Konstante in `src/store/defaults.js:250-253` mit dem ausdruecklichen Kommentar "KEIN Operator-Knopf" - sie steht in keinem Dashboard und darf durch diese Frage nicht zu einer werden (siehe O6). | Ohne Ablesung bauen P6 und P7 auf geratenen Zahlen. Ein `fatal:true`-Flip mit falsch angenommenen Live-Werten legt den Dienst beim naechsten Boot still - der belegte Divergenzfall (Land-Gate live `*`) ist der Beweis, dass `render.yaml` hier nicht traegt. Steht das Flag bereits AN, faellt GAP-01s `brennt_heute` weg - die **Notwendigkeit** des Codefixes bleibt (sein Test verlangt den Reset ausdruecklich bei `budgetMonthEnabled=false`), nur die Dringlichkeit sinkt. | P6, P7 (+ Betriebsauflage in P1) |
| **O2** | Welche automatische Reaktion gehoert zu welchem Stripe-Ereignis: `charge.dispute.created`, `charge.refunded`, `subscription.paused`, `invoice.payment_action_required`? | GAP-03 | Abgestuft statt einheitlich: Dispute -> **keine** Sperre, sondern Warnung + Plattform-Alarm + Audit (Disputes gehen regelmaessig zugunsten des Haendlers aus). Refund -> Periodenguthaben auf 0, kein Hard-Suspend. Paused -> Outbound sperren, Inbound weiter. `payment_action_required` -> Warnung mit Frist, Sperre erst nach Fristablauf. Keine Reaktion loescht Daten oder gibt eine DID frei; jede ist reversibel und schreibt Audit. | Einheitliches Suspend sperrt zahlende Kunden bei jedem Bankstreit und erzeugt Abwanderung. Einheitliches Nur-Loggen laesst den heutigen Zustand bestehen: nach einem Chargeback telefoniert der Kunde unveraendert weiter. | P4 |
| **O2b** | **Widerspruch, der vor P4 aufgeloest werden muss:** bleiben Stripe-Coupons fuer den DID-Kauf uneingeschraenkt erlaubt, oder braucht es eine explizite Coupon-Allowlist? `test/gap-05-number-hold.test.js:51-75` verlangt woertlich `allow_promotion_codes !== 'true'` mit der Begruendung "darf nur GEMEINSAM mit einer expliziten Coupon-Allowlist gesetzt werden" - die urspruenglich vorgesehene Gegenmassnahme ("Coupons bleiben erlaubt, keine neue Allowlist") macht genau diesen Teil des Tests nicht gruen. | GAP-05 | Eine der beiden Optionen bewusst waehlen: (a) Coupons ganz abschalten (`allow_promotion_codes=false`), oder (b) eine schlanke, gepflegte Coupon-Allowlist einfuehren. Keine dritte Option macht den Test gruen. | Ohne Entscheidung flippt der Implementierer unter Abnahmedruck `allow_promotion_codes` auf `false` und eine laufende Marketing-Aktion laeuft still ins Leere (genau P4 Pre-Mortem 2), oder er senkt die Test-Erwartung. Die zweite GAP-05-Achse (Hold/Kartenbindung auch bei 100-%-Coupon nie umgehbar) ist von dieser Entscheidung unabhaengig und deckt die erste Assertion des Tests unveraendert ab. | P4 |
| **O3** | Wird die Herkunfts-Tarifkorrektur rueckwirkend auf bereits gebuchte Perioden angewandt, und werden betroffene Tenants informiert? | ORIG-01, ORIG-02, ORIG-03 | Nicht rueckwirkend, ab Deploy; keine Nachbelastung, keine Gutschrift. **Aber Pflicht:** die bisherige Abweichung wird einmalig ausgewertet und dokumentiert, damit die Groessenordnung des Verlusts bekannt ist. Tenants mit spuerbar steigendem Minutenpreis werden einmal informiert. | Rueckwirkende Nachbelastung trifft Kunden fuer einen Fehler, den sie nicht verursacht haben, und erzeugt genau die Chargebacks, die P4 gerade behandeln lernt. Ohne Auswertung ist der teuerste Umbau des Plans hinterher nicht bewertbar. **Wichtig:** diese Frage blockiert den **Codefix nicht**, nur die Behandlung bereits gebuchter Perioden. | P5 (nur Nebenpfad) |
| **O3b** | **Widerspruch, der vor P5 aufgeloest werden muss:** wird Inbound auf eine eigene DID ueberhaupt bepreist - und wenn ja, mit welchem Satz? `test/orig-01-05-cost-origin.test.js:90-115` assertiert heute woertlich `voiceEvents.length === 0` fuer Inbound (kein VOICE_MINUTE-Event ueberhaupt); die urspruenglich vorgesehene Gegenmassnahme "bucht mit dem Inlandssatz" ist das **Gegenteil** davon - beides gleichzeitig ist unmoeglich. | ORIG-03 | **Ja, Inlandssatz des DID-Landes.** Der Sachverhalt der Testnachricht ("darf keinen Auslands-Worst-Case fuer Inbound erzeugen") bleibt dabei erhalten - nur die Assertion "gar kein Event" wird nach R5 auf "Event zum Inlandssatz, nicht zum Auslands-Worst-Case" korrigiert. Das ist keine Absenkung der Erwartung, sondern eine Korrektur der Assertion auf den im Testnamen beschriebenen Sachverhalt. | Wird stattdessen die heutige Assertion woertlich uebernommen (Inbound bleibt ungebucht), muss P5 ausdruecklich benennen, welches ANDERE Glied Inbound-Kosten dann gegen Tenant- **und** Plattform-Decke bucht. Ohne eine dieser beiden Festlegungen darf ORIG-03 nicht gebaut werden - sonst schaltet der Implementierer unter Abnahmedruck `recordVoiceMinuteMeter` fuer Inbound lautlos ab und der Budget-Guard wird fuer Dauer-Inbound blind (Absolute Regel 1, P5 Pre-Mortem 3). | P5 |
| **O4** | Was passiert mit Sperre **und** Verbrauchszaehler bei einer unbezahlten Folgeperiode - nicht nur, ob heute gesperrte Tenants reaktiviert werden? Stripe sendet `SUBSCRIPTION.UPDATED` (der geplante Reset-Anker) auch dann, wenn die Rechnung der neuen Periode **nicht** bezahlt ist (`past_due`/`unpaid`, laufendes Dunning). | GAP-01 | Reaktivierung **und** Zaehler-Reset haengen an **derselben** Bedingung: `subscription.status` aktiv/trialing UND bezahlte letzte Rechnung. Alle uebrigen bleiben gesperrt UND ihr Verbrauchszaehler wird NICHT zurueckgesetzt; sie erscheinen in einer Audit-Liste. Jede Reaktivierung schreibt Audit und loest eine Plattform-SMS aus. | Reaktivierung gegated, Reset ungegated (die urspruenglich einzig erwogene Variante): ein nicht zahlender Tenant bleibt zwar gesperrt, bekommt aber bei **jedem** Periodenwechsel ein frisches Ausgabekontingent auf Plattformkosten - unbegrenzt oft, bis der geteilte Plattform-Topf greift. Das ist dieselbe Schadensklasse wie die volle Automatik, nur ueber die Reset- statt die Reaktivierungs-Kante, und faellt am GAP-01-Test nicht auf (der faehrt `status:'active'`). Keine Automatik fuer beides: jeder rechtmaessig gesperrte zahlende Kunde braucht manuellen Eingriff - genau das, was diese Phase beheben soll. | P6 |
| **O5** | Welche Zahlen gelten fuer das Pro-Tenant-Stundenlimit und fuer die verbleibende globale Notbremse (Entscheidung 7.7)? **Am Code verifiziert: `MAX_CALLS_PER_HOUR` ist heute BEIDES gleichzeitig** - die globale Bremse (`outbound-gates.js:190-192`) UND der effektive Pro-Tenant-Default (`userHourReached`: `profile.maxCallsPerHour == null ? config.safety.maxCallsPerHour : Math.min(...)`), und bezahlte Plaene setzen `maxCallsPerHour: null` (`plans.js:106`), laufen also heute ueber den globalen Wert. Der Umbau macht `MAX_CALLS_PER_HOUR` zur Pro-Tenant-Achse und braucht dafuer einen **neuen** Schluessel fuer die Plattformbremse. | GAP-10 | Der heutige Wert wird zum Pro-Tenant-Limit (6/h je Tenant statt 6/h fuer alle), die globale Notbremse bekommt einen **eigenen, neuen Env-Namen** (Richtwert 60/h) und **wird im Dashboard GESETZT, bevor der Code deployt wird** - nicht als Code-Default gestartet. Beide wirken als Schnittmenge - wie bei den Budget-Achsen. Boot-Banner und `configHash` aus P1 weisen **beide** Achsen aus. Ein Profil mit `maxCallsPerHour: 0` (DEFAULT_PROFILE, kein Outbound) hat nach dem Umbau weiterhin 0 - `Math.min(global, profil)` darf ein restriktives Profil nicht anheben. | Globale Bremse ersatzlos entfernt = **Verstoss gegen Absolute Regel 1**; ein kompromittierter Account faehrt beliebig viele Anrufe, jeder einzeln unter dem Tenant-Limit. **Neuer Schluessel ohne vorherige Dashboard-Belegung:** der im Dashboard heute gesetzte `MAX_CALLS_PER_HOUR`-Wert behaelt seinen Namen, wechselt aber lautlos die Semantik zum Pro-Tenant-Limit; die Plattformbremse laeuft dann am Deploy-Tag auf dem Code-Default (Richtwert 60) statt auf dem heutigen Wert - eine unbemerkte ~10-fache Erhoehung der Plattform-Kapazitaet. Beim heutigen plattformweiten Limit bleiben: ein aktiver Tenant verdraengt weiterhin alle anderen vom Outbound. | P6 |
| **O6** | Ueber welchen Hebel wird die Boot-Kohaerenz hergestellt - Tenant-Decke anheben, Worst-Case-Tarif senken oder Max-Gespraechsdauer senken? Und: wird die Vorab-Reserve kuenftig aus dem **echten Zieltarif** gerechnet statt aus dem globalen Worst-Case? **`MAX_CALL_DURATION_CAP_S` ist keine Env-Variable, sondern eine Code-Konstante (`src/store/defaults.js:250-253`, Kommentar "KEIN Operator-Knopf -> nicht config.js") und deckelt zusaetzlich `place_call.max_duration_s` im MCP-Schema (`mcp-tools.js:456`).** | GAP-32, GAP-33 | **Beides kombinieren:** (a) die Reserve aus dem echten Zieltarif rechnen, den die Herkunfts-Achse aus P5 ohnehin liefert - der globale Worst-Case-Default von 300 ct/min steht gegen empirisch gemessene ~5,4 ct/min; (b) `MAX_CALL_DURATION_CAP_S` **als Code-Konstante** senken statt die Decke anzuheben (Rechnung: um die Reserve von 1500 ct unter die Tenant-Decke von 600 ct zu bringen, muss sie auf 120 s). **Guardrail:** der Hebel darf NICHT `VOICE_TARIFF_DEFAULT_CENTS` senken. Der Tarif ist die Messgroesse, mit der das Budget-Gate rechnet; ihn kleinzurechnen macht das Gate blind und ist faktisch eine Aufweichung von Absoluter Regel 1. **Zweiter Guardrail:** `MAX_CALL_DURATION_CAP_S` bleibt Code-Konstante und wird NICHT zur Env-Variable gemacht - sie ist eine der in Absoluter Regel 1 genannten Sicherungen (Max-Gespraechsdauer) und bewusst nicht per Operator-Knopf abschaltbar. | Decke anheben: jeder Tenant darf permanent mehr ausgeben, das Kostenrisiko pro Kunde steigt sofort und global. **Max-Dauer senken: jeder Anruf jedes Bestandskunden endet kuenftig frueher (Richtwert 120 statt 300 s) - das ist eine sofort spuerbare Verhaltensaenderung fuer laufende Gespraeche, nicht nur eine Zahlenkorrektur, und sie deckelt gleichzeitig den `place_call`-Body-Override.** Tarif senken (verboten): die Reserve unterschaetzt teure Ziele, das Gate wird genau in der Richtung blind, gegen die es gebaut wurde. Gar nicht entscheiden: der `fatal:true`-Flip ist nicht deploybar, GAP-32/GAP-33 bleiben rot, der Blueprint bleibt als Wiederherstellungspfad tot. | P7 |
| **O7** | Wie lautet der exakte Pflicht-Wortlaut des Inbound-Hinweises (KI + Aufzeichnung) je Sprache? Wird ein Settings-Patch ohne Marker **selektiv** (nur das Greeting-Feld) oder total abgelehnt? Werden Bestandsgreetings migriert? | GAP-14, WEB-04 | Kurzer, fester Wortlaut je Sprache (de/en/fr), als nicht abschaltbarer Praefix, nur wenn der Marker fehlt - analog zum Offenlegungssatz bei Outbound. Ablehnung **selektiv** (nur das Greeting-Feld faellt, andere Felder gehen durch - genau das verlangt der Test bereits). Bestandsgreetings einmalig per Migration nachruesten. | Total-Ablehnung: ein Bestandskunde kann seinen Agentennamen nicht mehr aendern, weil sein altes Greeting den Marker nicht traegt - ein Support-Fall pro betroffenem Kunden. Validierung des Kundentextes statt festem Praefix: die Pflichtaussage haengt am Formulierungsgeschick des Kunden - genau das, was bei der Outbound-Offenlegung bewusst ausgeschlossen wurde. Ohne Migration bleibt die Compliance-Luecke bei Bestandskunden bestehen, obwohl der Code sie angeblich schliesst. | P3 |
| **O8** | Wie wird beim Web-Login das Land des Tenants bestimmt: IP-Geolokation, aktive Abfrage oder Onboard-Redirect? | LANG-02, E2E-04, FMT-28 | **Aktive Abfrage** im ersten Self-Service-Schritt, ergaenzt um die Ableitung aus der DID-Vorwahl (Owner-Entscheidung E2). **Kein** IP-Geo als stille Uebernahme; hoechstens als sichtbare Vorbelegung. Ohne ableitbares Land bleibt das Feld leer und der bestehende Pfad greift. | IP-Geo: jeder Reisende und VPN-Nutzer bekommt dauerhaft ein falsches Land - mit Folgen fuer Sprache, Tarif und DID-Land, und der Fehler sieht spaeter wie eine Kundenangabe aus. Gar keine Bestimmung: LANG-02 bleibt ungefixt und der Flip aus P10 ist nicht deploybar. | P8 |
| **O9** | Was bedeutet ein Landwechsel fuer eine bereits gekaufte DID: neue Nummer kaufen, alte behalten oder Wechsel verbieten? | E2E-01 | Vorerst **verbieten** - der Endpunkt antwortet mit einem stabilen Fehlercode (409) und Verweis auf den Support statt mit dem heutigen stillen 200-OK-No-Op. Billigste sichere Option, bis der DID-Lebenszyklus entschieden ist. "Strikt 1 Nummer pro Tenant" bleibt unangetastet. | Automatischer Neukauf: jeder Klick erzeugt laufende Mietkosten - die Nummern-Proliferation vom Juni 2026 als Selbstbedienung. Alte behalten: Land, Sprache und Absendernummer laufen dauerhaft auseinander und machen die gerade korrigierte Herkunfts-Tarifierung wieder unscharf. | P8 |
| **O10** | Wird schriftlich bestaetigt, dass das neue Zeitzonenfeld am Tenant **nur** die Anzeige beeinflusst und niemals ein Anrufzeit-Gate speist (LAW-07 ist abgelehnt)? Woraus wird es fuer Bestandstenants abgeleitet? | FMT-28 | Zusicherung schriftlich; Ableitung aus dem DID-Land. Ein Test pinnt, dass **kein** Gate-Modul das Feld liest. | Ohne Zusicherung schleicht sich frueher oder spaeter ein Anrufzeit-Gate durch die Hintertuer ein - ein ungetestetes Gate, das Anrufe blockiert, die der Kunde bezahlt hat, und das niemand bewusst beschlossen hat. | P8 |
| **O11** | Nach welchem Kriterium werden Bestandsdatensaetze VOR dem `DEFAULT_LANGUAGE`-Flip nachgetragen - und wie viele NULL-Zeilen gibt es ueberhaupt in `tenant.default_language` und `number.language`? | WORLD-01, WORLD-03, PROMPT-03, PROMPT-09, UI-14, UI-18, FMT-28 | **Erst messen, dann backfillen.** Land aus der DID-Vorwahl ableiten (E2), daraus die Sprache; DE/AT/CH -> `de`, FR -> `fr`. Bleibt das Land unableitbar, wird der Datensatz explizit auf `de` gesetzt, weil jeder heutige Bestandskunde faktisch deutschsprachig bedient wird. Flip erst, wenn die Zaehlung 0 NULL-Zeilen liefert. **Genau EIN Backfill-Lauf** fuer alle Ketten, nicht einer pro Buendel - diese Frage wird einmal beantwortet und gilt fuer Greeting, MCP-Tools und Widget gleichlautend. | Flip ohne Backfill: Bestandskunden werden am Deploy-Tag auf Englisch begruesst. Das ist der teuerste einzelne Fehler in diesem Plan. Backfill pauschal auf `en`: derselbe Schaden mit mehr Arbeit. Ohne vorherige Messung bleibt das gesamte Migrationsargument eine Vermutung und der Backfill ist nicht verifizierbar. | P10 |
| **O12** | Bleibt `paymentCurrency=usd` ein legaler Konfigurationswert, oder wird der usd-Zweig als Altlast abgeschafft? | MCP-08 | **Behalten** und die Anzeige der tatsaechlichen Belastungswaehrung folgen lassen. Das ist keine Abkehr von Entscheidung 7.1 (EUR ueberall), sondern deren Invariante: Anzeige-Waehrung == Belastungs-Waehrung. Der Test prueft Waehrungs-**Treue**, keine USD-Vorgabe. | Abschaffung: der Katalogtest wird gegenstandslos und muss **geloescht** werden (nicht umgeschrieben) - dann ist MCP-08 nachtraeglich ein `test-falsch`-Fall und niemand darf Code dafuer schreiben. Beibehaltung ohne Treue-Fix: Hermes zeigt `$` und bucht `EUR` - in den USA FTC-relevant, in der EU PAngV-widrig. | P12 |
| **O13** | Wer liefert die anwaltlich freigegebenen Rechtstexte (AGB, Datenschutz, Impressum) in DE und EN, und bis wann? | GAP-15 | **Sofort bei Beginn von P1 beauftragen**, auch wenn der Fix erst in P14 landet - das ist das einzige Element im Plan mit externem Vorlauf, den keine Codearbeit verkuerzt. DE bleibt die verbindliche Fassung (Festlegung EN-Marketing/DE-Legal), EN als ausdruecklich informative Uebersetzung mit Vorrangklausel. Bis freigegebener Text vorliegt liefert die EN-Route **404** statt eines Platzhalters. | Wird erst in P14 begonnen, steht am Launch-Tag ein Platzhalter-Datenschutztext auf einer weltweit verkaufenden Website. Maschinelle Uebersetzung: Zusicherungen im Netz, die niemand geprueft hat - schlechter als eine fehlende Seite. | P14 (Bestellung in P1) |

---

## 4. Plan-weite Auflagen

Fuenf Punkte, die **keiner** der drei Vorentwuerfe enthielt und die quer zu den Phasen liegen. Sie
stehen hier, weil sie sonst in einer Phase verschwinden, in die sie nur zur Haelfte gehoeren.

### A1 - Der Flip aendert nicht nur Fallbacks beim LESEN, sondern Default-Parameter beim SCHREIBEN

`src/store/state-ops.js:674` (`seedBootstrapNumber`) und `:1257` (`requestNumber`) tragen
`language = DEFAULT_LANGUAGE` als **Default-Parameter**. Nach dem Flip materialisiert jede so
angelegte Nummer ohne expliziten Sprachwert `en` **in den Datensatz** - auch fuer einen Tenant mit
`country=DE`, weil dieser Pfad `languageForCountry(country)` gar nicht fragt.

Ein Backfill der alten NULL-Zeilen hilft dagegen **nicht**: der Fehler entsteht AB dem Flip, bei
jedem neuen Datensatz, non-NULL geschrieben - also unsichtbar fuer jede NULL-Zaehlung.

**Auflage:** beide Default-Parameter werden **vor** dem Flip auf eine Ableitung aus dem Land
umgestellt, mit Test je Pfad. Das ist Teilschritt 1 von P10 und Vorbedingung des Flips.

### A2 - Zehn heute gruene Tests kippen am Flip, nicht vier - und sind KEINE Loeschkandidaten

**Korrektur gegenueber der ersten Fassung dieses Plans.** Ein nackter Flip wurde in einer
Repo-Kopie gemessen (`DEFAULT_LANGUAGE` `"de"` -> `"en"`, volle Suite gegen die Baseline diffed).
Ergebnis: nicht vier, sondern **zehn** vorher gruene Tests werden rot. Zwei davon sind
sicherheits-/qualitaetsrelevant und muessen als **eigene Gegenmassnahme in P10** behandelt werden,
nicht erst in P11:

| Test | assertiert heute | nach dem Flip (gemessen) |
| --- | --- | --- |
| `test/f1-geo-onboard.test.js:69` | `json.language === DEFAULT_LANGUAGE` ("Onboard ohne country -> Fallback DE/de") | Ist bleibt `de`, Konstante wird `en` -> rot |
| `test/f1-geo-onboard.test.js:91` | dasselbe fuer ungueltiges `country` | rot |
| `test/f1-geo-store.test.js:161` | `num.language === DEFAULT_LANGUAGE` (`seedBootstrapNumber`: Default-Geo = DE/de) | rot |
| `test/f1-geo-store.test.js:178` | dasselbe fuer `requestNumber` | rot |
| `test/f1-i18n-locale.test.js` (3 Faelle) | Locale-Mechanismus-Pins gegen `DEFAULT_LANGUAGE === "de"` | rot (R5-Behandlung siehe P10-Tabelle) |
| `test/f1-geo-onboard.test.js` (2. Fall) / `f1-p8-outbound-lang.test.js` | Sprachaufloesung gegen den heutigen Default | rot |
| **`test/disclosure-regression.test.js` ("T-P2-09: disclosureSentence")** | Offenlegungssatz eines DE-Bestandstenants ist deutsch | **Ist-Wert nach dem Flip gemessen: "Hello, this is an AI assistant calling on behalf of Jonas Beispiel..." - der fest verdrahtete Offenlegungssatz (Absolute Regel 2) kippt fuer jeden Call, dessen Sprache nicht aufloest, auf Englisch. Ein deutscher Angerufener bekommt die Pflichtoffenlegung in einer Sprache, die er evtl. nicht versteht.** |
| **`test/telnyx-elevenlabs-inbound.test.js`** | Gerendertes TeXML fuer einen DE-Tenant | **Ist-Rendering nach dem Flip gemessen: `<Gather language="en-GB" ...><Say voice="Azure.en-GB-SoniaNeural" language="en-GB">Hallo, hier ist der KI-Assistent von Maria...</Say>`. Der Greeting-TEXT bleibt deutsch (kommt aus `settings.greeting`), aber STT-Locale und TTS-Stimme kippen auf en-GB - ein deutscher Satz wird von einer britischen Stimme vorgelesen, deutsche Anrufer werden von einem englischen Erkenner transkribiert. Genau die Achse, die empirisch auf `de-DE` festgenagelt ist.** |
| `test/finishcall-billing-once.test.js` | (unklar, ob am Flip haengt) | isoliert gemessen weiterhin gruen -> **Flake, kein Flip-Effekt**, hier nur der Vollstaendigkeit halber gelistet |

Alle drei Vorentwuerfe schrieben fuer ihre Flip-Phase "npm test bleibt gruen". Das stimmt nicht -
weder mit vier noch mit zehn Tests ungeloest.

Wichtiger: die ersten vier dieser Tests sind **die Regressionsanzeige fuer A1**. Wer sie am
Flip-Tag "anpasst", statt den Schreibpfad zu korrigieren, schaltet genau den Alarm ab, der den
Bestandsschaden meldet.

**Auflage 1 (Messung statt Liste).** Vor P10 Schritt 3 (Flip) wird die Suite einmal mit geflipptem
`DEFAULT_LANGUAGE` gegen den dann aktuellen Stand gefahren und die vollstaendige Diff-Liste im
Phasenreport dokumentiert - diese Tabelle ist der Ausgangspunkt, nicht das letzte Wort.

**Auflage 2 (Schreibpfad-Vierergruppe).** In P10 Teilschritt 1 - **vor** dem Flip - wird die
Assertion der ersten vier Tests von `DEFAULT_LANGUAGE` auf das im Testnamen selbst genannte
Subjekt (`"de"` bzw. `languageForCountry(DEFAULT_COUNTRY)`) umgehaengt, im **selben Commit** wie
die Schreibpfad-Korrektur. Die vier Tests muessen danach gruen sein und beim Flip gruen
**bleiben**. Bleiben sie es nicht, ist der Schreibpfad falsch. Das ist kein Absenken einer
Erwartung: der Testname sagt "Default-Geo = DE/de", die Assertion sagt jetzt dasselbe.

**Auflage 3 (Absolute Regel 2 als P10-Gegenmassnahme, nicht erst P11).** Der Offenlegungssatz- und
der STT-/TTS-Locale-Effekt sind keine Sprachqualitaets-Fragen, die bis P11 warten koennen - sie
sind eine Regel-1/Regel-2-Frage am Tag des Flips selbst. P10 Schritt 3 (Flip) bekommt deshalb eine
eigene Gegenmassnahme: **der Offenlegungssatz und die Gather-/Say-Locale muessen fuer jeden
Bestandstenant nach dem Flip byte-/attribut-identisch zum Vor-Flip-Zustand bleiben**, verifiziert
nicht am Text allein, sondern am gerenderten TwiML/TeXML (siehe P10-Abnahme unten).

### A3 - Gefixte Gate-Tests wandern in die Regressionssuite

Siehe Abschnitt 1. Steht in jeder Phasenabnahme.

### A4 - Die Schnittmengen-Pruefung gilt auch fuer die Geld-Achse, nicht nur fuers Stundenlimit

Alle drei Entwuerfe sichern GAP-10 vorbildlich ab ("das globale Limit BLEIBT und wirkt als
Schnittmenge"). Bei GAP-01 tut es keiner. Dort wird die EUR-Achse vom Lebenszeit- auf ein
Perioden-Fenster umgebaut, und `MAX_BUDGET_EUR` ist ein **geteilter Topf ueber alle Tenants**.

**Auflage:** P6 braucht einen Test, der belegt, dass der globale Plattform-Topf nach dem Umbau
weiterhin greift, wenn viele Tenants je unter ihrer eigenen Periodendecke bleiben. Ein
Perioden-Reset, der die globale Achse versehentlich mitzieht, hebt genau das Gate auf, das
Absolute Regel 1 schuetzt - und zwar lautlos, weil das Gate dann einfach nie mehr ausloest.

### A5 - Der Telnyx-Assistant-Provisioner ist ein Auslieferungsweg fuer Greeting und Pflichtsatz

Alle drei Entwuerfe stellen die richtige Frage, welcher Gespraechspfad im Live-Call aktiv ist -
aber nur fuer die PROMPT-Kette. Ist der Assistant-Pfad live, laufen **Greeting und damit GAP-14
sowie WEB-04 nicht ueber `voice.js`/`defaults.js`**, sondern ueber die Assistant-Konfiguration.
Die wird von einem Skript geschrieben, das die **ganze** Live-Config aus der lokalen `.env`
erzeugt: ohne gesetzte `TELNYX_ASSISTANT_ID` entsteht ein **neuer** Assistant, ohne
`TELNYX_ELEVENLABS_MODEL` wird die **Stimme still umgestellt**; der Update-POST ist ein
Deep-Merge, ein Feld laesst sich nur aktiv abschalten.

**Auflage:** vor P3 wird festgestellt, ueber welchen Kanal das gesprochene Greeting live entsteht.
Ist es der Assistant, ist der Provisioner-Lauf ein **eigener, protokollierter Schritt mit
vollstaendig gesetzter Env** - nicht das Nebenprodukt eines Deploys. Dieselbe Frage gilt fuer P11.

---

## 5. Der Phasenschnitt

14 Phasen. Der Schnitt ist bewusst feiner als in allen drei Vorentwuerfen: dort waren die letzten
Phasen 10-21 IDs gross, was das eigene Kriterium "einzeln deploybar und einzeln rueckrollbar"
verletzt. Ausnahme bleibt P11 - dort ist die Buendelung inhaltlich begruendet (siehe dort).

**Deploy- vs. Merge-Reihenfolge.** Die Nummerierung ist eine **Deploy**-Reihenfolge. Mehrere
Phasen duerfen parallel gebaut und gemergt werden; serialisiert werden nur die riskanten Deploys.
Wo eine Phase eine andere **live** voraussetzt, steht das ausdruecklich unter "Vorbedingung".

---

### P1 - Sicht und Deploy-Wahrheit

**IDs (2):** GAP-36, GAP-35

**Ziel.** Der Dienst sagt, welchen Commit und welche Konfiguration er faehrt, und eine Ablehnung
im Land-/Gate-Pfad erzeugt ein Ereignis mit Land und Sprache. Damit wird jede folgende Phase am
laufenden Dienst nachweisbar und ein Laender-Totalausfall sichtbar.

**Position.** Ganz vorn, obwohl kein Kunde es merkt. Der Live-Service ist Dashboard-managed,
`git push origin` macht nichts live, `/healthz` liefert heute nur `{ok:true}`. Ohne Fingerabdruck
ist fuer **keine** spaetere Phase belegbar, dass der Fix live ist - und ohne Denial-Ereignis merkt
beim Weltstart niemand, dass ein ganzes Land stumm blockiert wird. GAP-35 ist zusaetzlich das
Beobachtungsinstrument fuer die Gate-Verschaerfung in P2. Bewusst **ohne** GAP-21 (anders als im
Siegerentwurf): der Fix mit dem hoechsten Blast-Radius gehoert nicht in denselben Commit wie das
Instrument, das ihn diagnostizieren soll.

**Vorbedingung.** Keine Owner-Entscheidung. Parallel: O1 (Ablesung) anstossen, O13 (Rechtstexte)
**bestellen**.

**Pre-Mortem.**
1. Ein Angreifer las `/healthz`, dort standen `allowedCountryCodes='*'` und `maxCallsPerHour` im
   Klartext, und legte den Toll-Fraud-Burst genau in die Luecke. Ursache: der Test verlangte nur
   "ein nicht-leerer String", also wurde der billigste Weg gewaehlt und Rohwerte ausgegeben -
   `/healthz` ist unauthentifiziert.
2. `METRICS_ENABLED` wurde eingeschaltet und das Denial-Ereignis trug die Ziel-E164. Zielrufnummern
   von Kunden landeten im Log eines Drittanbieters - ein Datenschutzvorfall aus einer
   Diagnose-Verbesserung.
3. Der GAP-35-Test war gruen, weil er `render.yaml` prueft, waehrend `METRICS_ENABLED` live nie
   gesetzt wurde. Gate erfuellt, Blindheit unveraendert - und beim Weltstart fiel ein blockiertes
   Land trotzdem niemandem auf.

**Gegenmassnahme.**
- **ENTSCHAERFT (1/3):** `configHash` ist ein Hash (sha256 ueber ein definiertes Tupel), niemals
  Rohwerte; `commit` traegt nur den Git-SHA. Ein Test greppt die Antwort gegen eine Verbotsliste
  (Ziffernfolgen >= 7, `sk_`, `+`, Env-Rohwerte) und belegt, dass kein Secret-Feld einfliesst
  (Absolute Regel 4). **Die Verbotsliste wird nur auf die Nicht-Hash-Felder angewendet**, `configHash`
  separat nur gegen sein Format (`/^[a-f0-9]{64}$/`) geprueft - ein sha256-Hex-String enthaelt mit
  ~2-3 % Wahrscheinlichkeit irgendwo sieben aufeinanderfolgende Ziffern und wuerde die
  Ziffernfolgen-Regel sonst commit-abhaengig zufaellig rot machen, in einer Suite, die als
  Regressionsschutz immer gruen sein muss.
- **ENTSCHAERFT (2):** das Denial-Ereignis traegt ausschliesslich ISO-Land, Sprache und
  Ablehnungsgrund - nie eine Rufnummer, nie ein Transkriptfragment, nie eine Tenant-ID im
  Klartext. Ein Test greppt das Ereignis-Schema gegen E164-Muster.
- **ENTSCHAERFT (3) durch Trennung:** der `render.yaml`-Flip macht den Test gruen, die **Live**-
  Wirkung braucht zusaetzlich `METRICS_ENABLED` im Render-Dashboard. Das steht als ausdrueckliche
  **Betriebsauflage** im Abnahmeprotokoll, nicht im Code.
- **Zusatz:** die aktive Budget-Achse (`BUDGET_MONTH_ENABLED`) gehoert in denselben Boot-Banner -
  ein Safety-Gate-Schalter, den man nur per DB-Messung ablesen kann, ist genau die Luecke, die
  GAP-36 schliessen soll (und der Grund, warum O1 heute eine Ablesefrage ist).
- **GETRAGEN:** `METRICS_ENABLED=true` erzeugt zusaetzliche Log-Last unbekannten Umfangs. Wird nach
  einer Woche am Render-Log-Volumen nachgemessen.

**Abnahme.** GAP-36, GAP-35 nicht mehr in der Rot-Liste (53 -> 51). `npm test` gruen. A3: beide
Tests in die Regressionssuite ueberfuehrt. Zusaetzlich: `curl /healthz` lokal (commit + configHash
vorhanden, keine Rohwerte) und **nach dem Deploy** gegen die Live-URL, `commit` == gepushter
Upstream-Commit. Betriebsauflage `METRICS_ENABLED` im Dashboard gesetzt und quittiert.

**R5-Loeschpflichten.** Keine.

**Aufwand.** 1 bis 1,5 Tage.

---

### P2 - Wahl-Sicherheit und Anruf-Mechanik

**IDs (4):** GAP-18, GAP-25, GAP-22, GAP-21

**Ziel.** Die Gate-Kette laesst heute NANP-Premium-/One-Ring-Ziele durch, kann bei `011`-Eingabe
einen Dritten falsch anwaehlen, bezahlt Mailbox-Gespraeche als volle Anrufe und kappt Gespraeche am
15-s-Provider-Hardcut.

**Position.** Direkt nach der Sicht, weil drei der vier Fixes die Menge erlaubter Anrufe nur
**verkleinern** und per Konstruktion keinen neuen Anrufpfad oeffnen koennen - maximaler Schaden bei
minimalem Fix-Risiko. Kein `abhaengt_von`, keine Owner-Entscheidung.

**Abweichung von der Klassifikation (belegt).** Dort steht GAP-18 mit `brennt_heute=nein`. Am
Live-Zustand ist das falsch: `ALLOWED_COUNTRY_CODES` steht live auf `*`
(`tasks/i18n-tests/13-live-env-befund.md`, Boot-Banner jeder Boot 07-18 bis 07-25), und
`src/telephony/outbound-gates.js:59-90` enthaelt in `PREMIUM_PREFIXES` **kein einziges** `+1`-
Praefix (verifiziert). NANP-Premium-Ziele sind damit **heute** erreichbar.

**Vorbedingung.** P1 live (Denial-Ereignis sichtbar, Deploy verifizierbar). Fachlich vor GAP-21:
den Feldnamen der Telnyx-Origination gegen einen echten **Objekt-GET** der Live-API belegen -
Praezedenzfall Call-Control-App-ID, falsches Feld = 422 auf JEDEM Outbound, und die Telnyx-Doku
weicht von der API ab. Fuer GAP-22 den heutigen Turn-Budget-Wert am Live-Dienst ablesen, nicht aus
`render.yaml`.

**Pre-Mortem.**
1. Die neue NANP-Sperrliste blockierte beim Weltstart echte Karibik-Kunden - `+1-473` ist Grenada
   **und** IRSF-Liebling. Aufgefallen ist es erst bei der Kuendigung, weil nur negative Tests
   existierten und ein Denial keinen Alarm ausloest.
2. Das `machine_detection`-Feld hiess im Telnyx-Payload anders als angenommen. Der erste Deploy
   nach dem Merge lieferte 422 auf jedem Outbound; der Dienst war fuer Outbound zwei Stunden tot,
   bevor jemand ins Provider-Log sah.
3. Die Machine-Detection klassifizierte leise oder langsam antwortende **Menschen** als
   Anrufbeantworter und legte auf. Kunden bekamen ihren Termin nie und sahen nur "Anruf beendet".
4. Das Turn-Budget wurde durch `LLM_MAX_RETRIES=0` "gerettet". Seither war jeder transiente
   Anthropic-Aussetzer ein Gespraechsabbruch statt einer Verzoegerung - schlimmer als der seltene
   15-s-Hardcut.
5. `normalizeDialTarget` wurde global auf `011` umgestellt; ein deutscher Tenant, der eine Nummer
   mit fuehrender `011`-Ziffernfolge eingab, landete bei einem Dritten.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** GAP-18 strikt als **SUB-Ranges** (dokumentierte Premium-/One-Ring-NPAs), NIE
  ganze Laendercodes, keine Bereichs-Wildcards - das ist die bereits im Code dokumentierte
  Konvention. Zusaetzlich ein **POSITIV-Test**, der beweist, dass eine gewoehnliche US-Mobilnummer
  durchkommt: ein negativer Test kann Ueberblockierung nicht fangen. Jeder Denial schreibt
  Grund + Praefix ins Audit.
- **ENTSCHAERFT (2):** GAP-21 wird hinter einem **Env-Schalter mit Default AUS** gemergt, der
  Feldname gegen den Objekt-GET belegt, **ein** echter Probe-Anruf gegen eine Mailbox gefahren,
  dann der Schalter AN. Rollback ist eine Env-Variable ohne Deploy.
- **ENTSCHAERFT (3):** AMD wirkt nur als Signal mit Detection-Timeout. Bei "unbekannt" wird wie mit
  einem Menschen weitergesprochen (fail-open Richtung Gespraech), aufgelegt wird nur bei
  eindeutigem Maschinen-Ergebnis. Ein Test pinnt beide Zweige.
- **ENTSCHAERFT (4):** GAP-22 wird durch Kappen der **Summe** geloest (Synthese-Budget +
  Turn-Budget < Hardcut), NICHT durch Streichen von Retries. Ein Test rechnet
  `(retries+1)*timeout + Backoff < 12000 ms` nach. `npm run convo-bench` (n >= 5) vor und nach;
  das DE-Ergebnis darf nicht schlechter werden.
- **ENTSCHAERFT (5):** GAP-25 normalisiert `011` **nur**, wenn das Heimatland des Tenants NANP ist.
  Fuer DE/AT/CH/FR bleibt der Wahlpfad **byte-identisch** - der gesamte heutige Kundenstamm ist
  beweisbar unberuehrt.
- **GETRAGEN:** die Trefferhaeufigkeit des 15-s-Hardcuts im echten Betrieb ist unbelegt. Der Fix
  ist trotzdem korrekt, weil der Defekt in der heutigen Live-Konfiguration liegt.

**Abnahme.** GAP-18 (alle 12 Subtests), GAP-25, GAP-22, GAP-21 nicht mehr in der Rot-Liste
(51 -> 47). `npm test` gruen. A3 erfuellt. A6: `/healthz`-Commit stimmt. Nicht automatisierbar:
ein Probe-Anruf auf eine Mailbox beendet den Call frueh; ein Probe-Anruf mit langsamer Synthese
laeuft ohne Hardcut durch.

**R5-Loeschpflichten.** Keine.

**Aufwand.** 2 bis 2,5 Tage inkl. Probe-Anruf und Bench.

---

### P3 - Inbound-Pflichtsatz (Compliance im laufenden Betrieb)

**IDs (2):** WEB-04, GAP-14

**Ziel.** Jeder Inbound-Anruf laeuft heute ohne den Pflichthinweis auf KI und Aufzeichnung, und
zwar sprachunabhaengig. Der Hinweis wird strukturell erzwungen, nicht dem Modell ueberlassen; die
Greeting-Vorlagen bekommen in einem Zug de/en/fr.

**Position.** Bewusst frueh und **aus der Sprachphase herausgeloest** - hier weicht der Plan vom
Siegerentwurf ab, der GAP-14 in Phase 8 haengt. Der Pflichtsatz fehlt **heute** bei jedem einzelnen
Inbound-Call; technisch ist es eine Greeting-Vorlage plus eine Validierung. Die Sprachverzweigung
darauf warten zu lassen kauft Eleganz mit Wochen offener Transparenzpflicht. WEB-04 liegt hier,
weil die Vorlagen sonst zweimal angefasst werden.

**Wichtig:** diese Phase aendert **keine** Sprachauswahl. Sie legt die Vorlagen fuer de/en/fr an;
welche gewaehlt wird, bleibt bis P10 unveraendert.

**Vorbedingung.** O7 beantwortet (Wortlaut, selektiv/total, Migration). **A5 geklaert:** ueber
welchen Kanal entsteht das gesprochene Greeting live - `voice.js`/`defaults.js` oder die
Telnyx-Assistant-Konfiguration? WEB-04 allein ist ohne Rueckfrage umsetzbar und kann vorgezogen
werden, falls O7 haengt.

**Pre-Mortem.**
1. Der Pflichtsatz wurde als harter Praefix vor JEDES Greeting gesetzt. Kunden, die ihn bereits
   selbst im Greeting hatten, begruessten Anrufer doppelt; die zusaetzlichen Sekunden vor dem
   ersten inhaltlichen Wort trieben die Auflegequote spuerbar hoch - gemessen hat es niemand, weil
   Inbound-Abbrueche keine Metrik hatten.
2. `updateSettings` wurde total fail-closed gemacht und lehnte den ganzen Patch ab. Ein
   Bestandskunde konnte seinen Agentennamen nicht mehr aendern, weil sein altes Greeting den
   Marker nicht trug - ein Support-Fall pro betroffenem Kunden.
3. Der Pflichtsatz wurde in den Prompt geschrieben statt in den gerenderten Erstsatz. Das Modell
   liess ihn bei jedem dritten Anruf weg, und ein Anruf ohne Aufzeichnungshinweis wurde zum
   Beschwerdefall.
4. Der Assistant-Pfad war live. Die Phase lieferte den Pflichtsatz ueber den Provisioner aus, das
   Skript lief mit unvollstaendiger lokaler `.env` - dabei wurde die Stimme aller Kunden still
   umgestellt und ein zweiter Assistant angelegt.
5. **`test/inbound-disclosure-mandatory.test.js` wurde mit einer rein deutschen Erkennungs-Regex**
   (`/aufgezeichnet|wird transkribiert|mitgeschnitten/i`) gebaut, weil der Testfall ohne gesetzte
   Sprache seedet und in P3 noch auf `DEFAULT_LANGUAGE=de` aufloest - der Test war gruen und wanderte
   nach A3 in die Regressionssuite. Nach dem Flip in P10 loest derselbe Testfall auf `en` auf, der
   Pflichtsatz wird englisch gerendert, die deutsche Regex greift nicht mehr, und `npm test` (das ab
   dann immer gruen sein muss) wird rot. Der billigste Ausweg unter Abnahmedruck ist, die
   Compliance-Assertion aufzuweichen oder den Pflichtsatz sprachunabhaengig deutsch zu belassen.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** der Pflichtsatz wird nur vorangestellt, wenn der Marker im Greeting
  **fehlt** (Selektiv-Variante, die der Test bereits verlangt) - kein Doppelsatz. Wortlaut kurz,
  als erster Teilsatz derselben Begruessung. `convo-bench` n >= 5 vor/nach.
- **ENTSCHAERFT (2):** `updateSettings` lehnt **selektiv** nur das Greeting-Feld ab, nie den ganzen
  Patch; ein Test pinnt genau das. Bestandsgreetings werden **einmalig per Migration** nachgeruestet,
  nicht bei jedem Write geprueft.
- **ENTSCHAERFT (3):** der Satz wird **gerendert, nicht promptet** - fest verdrahtet im ersten
  gesprochenen Satz, analog zum Offenlegungssatz bei Outbound (Absolute Regel 2 sinngemaess auf
  Inbound uebertragen). Kein Setting schaltet ihn ab. **Guardrail:** der Inbound-Pflichtsatz bekommt
  dafuer ein **eigenes** Bundle-Feld; `localeFor(language).disclosure(ownerName)` selbst wird in
  dieser Phase **nicht angefasst** - ein Fehler dort trifft sofort den Outbound-Offenlegungssatz auf
  beiden Engines (Budget + Realtime, Absolute Regel 2). Ein Test pinnt den Outbound-Wortlaut
  byte-genau vor und nach P3 (`test/disclosure-regression.test.js`).
- **ENTSCHAERFT (5):** `test/inbound-disclosure-mandatory.test.js` wird in P3 bereits
  **sprachparametrisiert** gebaut (eigene Erkennungsworte je de/en/fr), nicht mit einer deutschen
  Regex gegen den damaligen Default. Alternative, falls das den Zeitrahmen sprengt: der Testfall
  laeuft gegen einen Tenant mit explizitem `language: 'de'` statt gegen den Default - das ist kein
  Absenken, der Test heisst "Inbound-Pflichtsatz", nicht "Default-Sprache".
- **ENTSCHAERFT (4), A5:** ist der Assistant der Auslieferungsweg, ist der Provisioner-Lauf ein
  eigener, protokollierter Schritt mit **vollstaendig gesetzter** Env (insbesondere
  `TELNYX_ASSISTANT_ID` und `TELNYX_ELEVENLABS_MODEL`), mit Objekt-GET vorher und nachher. Nie als
  Nebenprodukt eines Deploys.
- **NICHT ANTASTEN:** die ASCII-Transliteration der gesprochenen DE-Strings (`src/i18n/locales.js`)
  bleibt; FR behaelt bewusst Akzente. Das ist gepinnt und kein Encoding-Bug.

**Abnahme.** WEB-04, GAP-14 nicht mehr in der Rot-Liste (47 -> 45). `npm test` gruen. A3 erfuellt.
A6 erfuellt. Zusaetzlich: ein echter Inbound-Probe-Anruf enthaelt den Pflichtsatz hoerbar im ersten
Satz - auf dem Kanal, der laut A5 live aktiv ist.

**R5-Loeschpflichten.** Keine.

**Aufwand.** 1 bis 1,5 Tage plus Migration.

---

### P4 - Abo-Lebenszyklus: die drei Geldleckagen ohne Vorbedingung

**IDs (3):** GAP-05, GAP-03, GAP-04

**Ziel.** Kein kostenloser DID-Bezug ueber Gutschein, keine folgenlose Chargeback-/Refund-/
Pause-Meldung, keine Aktivierung ohne erfolgreiches Provisioning.

**Position.** Drei unabhaengige Knoten (kein `abhaengt_von`, keine Nachfolger) in einer
Datei-Nachbarschaft (`src/billing/{stripe,webhook,activation}.js`, `src/onboarding.js`). Sie
kommen vor der ORIG-Kette, weil sie die einzigen `brennt_heute`-Befunde sind, die weder eine
Vorbedingung haben noch von einer spaeteren Phase beruehrt werden - hier sind sie am schnellsten
wirksam. GAP-05 zuerst innerhalb der Phase: es ist der einzige, der ohne jede Kundeninteraktion
ausgeloest werden kann (ein geleakter Coupon-Code genuegt) und mit jeder DID laufende Mietkosten
erzeugt; `allow_promotion_codes` steht bereits unbedingt auf `true`.

**Vorbedingung.** O2 beantwortet. P1 live.

**Pre-Mortem.**
1. `dispute.created` sperrte sofort hart. Stripe entschied die Dispute drei Wochen spaeter
   zugunsten des Haendlers - der Kunde war da schon weg und hatte den Vorgang oeffentlich
   beschrieben. Ursache: die Reaktion wurde als einheitlicher Suspend gebaut, weil das die
   einfachste Implementierung war und der Test nur "nicht mehr IGNORE" verlangte.
2. `allow_promotion_codes` wurde pauschal abgeschaltet. Eine laufende Marketing-Aktion lief ins
   Leere und niemand verband die ausbleibenden Anmeldungen mit dem Commit.
3. Der Webhook kam wie ueblich doppelt. Die neue Suspend-Logik lief zweimal, und die manuelle
   Reaktivierung des Supports wurde vom zweiten Durchlauf wieder ueberschrieben.
4. GAP-04 wurde als Rollback der Aktivierung gebaut. Das Provisioning gelang beim automatischen
   Retry 40 Sekunden spaeter doch - aber die Aktivierung war bereits zurueckgerollt. Der Kunde
   hatte bezahlt und kam nicht ins Dashboard.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** die Reaktion je Ereignistyp ist **Owner-Entscheidung O2** und wird nicht vom
  Implementierer gewaehlt. Jede automatische Sperre ist reversibel, schreibt Audit mit Ereignis-ID
  und loest eine Plattform-SMS aus; keine Sperre loescht Daten oder gibt eine DID frei.
- **ENTSCHAERFT (2):** GAP-05 trennt die zwei Achsen sauber - **Coupons bleiben erlaubt**, aber
  **Hold und Kartenbindung sind auch bei 100 % nie umgehbar**. Keine neue Env-Allowlist, die
  gepflegt werden muesste. Ein Test belegt, dass ein 100-%-Coupon den Hold nicht umgeht.
- **ENTSCHAERFT (3):** Idempotenz je Stripe-Event-ID, mit Test fuer doppelt zugestelltes Event.
  Dieses Repo ist an einer Webhook-Race bereits aufgelaufen.
- **ENTSCHAERFT (4):** GAP-04 wird als **Reihenfolge-Umkehr** gebaut (Provisioning-Ergebnis vor
  Statuswechsel), nicht als nachtraegliche Kompensation - ein Rueckbau-Pfad waere die zweite
  Fehlerquelle. Dazwischen ein expliziter Wartezustand mit Alarm; der Retry-Pfad bleibt unberuehrt.
- **GETRAGEN:** ein Kunde steht zwischen Zahlung und Provisioning-Erfolg kurz in einem
  Wartezustand. Das ist einer bezahlten Aktivierung ohne Nummer vorzuziehen.

**Abnahme.** GAP-05, GAP-03, GAP-04 nicht mehr in der Rot-Liste (45 -> 42). `npm test` gruen. A3,
A6 erfuellt. Zusaetzlich: Stripe-Testmodus-Webhook-Replay je entschiedenem Ereignistyp gegen den
Live-Webhook (Signaturpruefung aktiv), Wirkung in der DB nachgewiesen; ein Onboarding-Lauf mit
erzwungenem Provisioning-Fehlschlag (`MAX_NUMBERS=0`) laesst den Tenant **nicht** aktiv zurueck.

**R5-Loeschpflichten.** Keine.

**Aufwand.** 2 Tage.

---

### P5 - Herkunfts-Achse der Tarifierung (Wurzel der Geld-Kette)

**IDs (3):** ORIG-01, ORIG-02, ORIG-03

**Ziel.** `tariffCentsPerMin()` kennt Herkunft **und** Ziel. Outbound von einer
Nicht-Heimatland-DID wird korrekt tarifiert; Inbound auf eine eigene DID wird nicht mehr mit dem
Auslands-Worst-Case gebucht.

**Position.** Tiefste Wurzel des Geld-Strangs: `src/telephony/outbound-gates.js:145` nimmt heute
nur `to`. Davon haengen ORIG-02, GAP-32 und - ueber die Reserve-Rechnung - GAP-33 (Teil a) ab.
Jede Zahlenkorrektur in P7 waere ohne diese Achse eine Korrektur auf falscher Grundlage und
muesste danach nochmal angefasst werden. ORIG-02 und ORIG-03 sind Platz 1 und 2 der
`brennt_heute`-Liste: aktive, sich mit **jedem** Anruf summierende Fehlbuchungen.

**Vorbedingung.** P1 live. O3 **und O3b** beantwortet (O3b klaert den Widerspruch bei ORIG-03,
siehe Owner-Tabelle - **ohne O3b darf ORIG-03 nicht gebaut werden**). O3 blockiert den **Codefix
nicht**, nur die Behandlung bereits gebuchter Perioden. Fachlich zwingend vor dem Edit: `grep`
ueber **alle** Aufrufer. Belegt sind `outbound-gates.js:670`, `metering.js:45`, `metering.js:68`
(Definition `outbound-gates.js:145`) plus die Referenzen in `cost-calibration.js` und
`cost-truing.js`. Der grep entscheidet, nicht diese Liste - Budget-Engine UND Realtime-Bridge
nutzen dieselben Werkzeuge. **Zusaetzlich bekannt:** drei heute gruene Einargument-Aufrufer/Tests
haengen an der heutigen Signatur und muessen beim Bau mitgezogen werden (siehe ENTSCHAERFT 1).

**Pre-Mortem.**
1. Die Signatur bekam eine zweite Positionsstelle mit Default. Ein Aufrufer im Realtime-/Bridge-Pfad
   wurde uebersehen und uebergab `undefined`. Weil der Code bei fehlender Herkunft auf den
   guenstigen Inlandssatz zurueckfiel, blieb der Verlust bestehen - nur stand jetzt eine gruene
   Testsuite daneben, die ihn fuer behoben erklaerte.
2. Reserve (`outbound-gates.js:670`) rechnete mit Herkunft, Buchung (`metering.js:45/68`) ohne. Die
   Decke wurde nie erreicht, ein Tenant telefonierte 40 Stunden, bevor es auffiel.
3. ORIG-03 wurde zu scharf gefixt: Inbound auf die eigene DID wurde mit 0 bepreist. Der
   Budget-Guard sah reale Inbound-Kosten nicht mehr; ein Tenant mit Dauer-Inbound erzeugte 300 EUR
   Provider-Kosten unter einer Decke, die nie ansprach.
4. Die Arity-Assertion aus `test/orig-01-05-cost-origin.test.js:64-72`
   (`tariffCentsPerMin.length === 2`) wurde mit einer Objekt-Signatur `({from, to})` angegangen -
   die hat `Function.length === 1`, der Test blieb rot. Unter Abnahmedruck wurde daraufhin der
   fail-closed-Default fallen gelassen, um irgendetwas gruen zu bekommen - genau die Sicherung aus
   Pre-Mortem 1 wurde dabei geopfert.

**Gegenmassnahme.**
- **ENTSCHAERFT (1) doppelt, strukturell UND zur Laufzeit:** die Herkunft wird **Pflicht-Argument
  ohne Default**, umgesetzt als **zwei Positionsparameter `(to, from)`** (`Function.length === 2`,
  passt zur Arity-Assertion in `test/orig-01-05-cost-origin.test.js:64-72` - eine Objekt-Signatur
  `{from, to}` hat `Function.length === 1` und macht diesen Test **nicht** gruen). Ein vergessener
  Aufrufer faellt beim Lesen und im Test auf. **Zusaetzlich** gilt zur Laufzeit ein
  **fail-closed-Default**: fehlt die Herkunft (z. B. weil sie aus einer DB-Zeile als `undefined`
  ankommt), gilt der **teuerste** Satz, nie der Inlandssatz. Ein Fehler erzeugt dann sichtbare
  Ueberbepreisung, nie stillen Verlust. **Bekannte Mitzieher (drei Testdateien, die heute mit
  einem Argument aufrufen und sonst am fail-closed-Default zerbrechen):**
  `test/cost-calibration.test.js:201-202` (assertiert Inlandssatz fuer
  `tariffCentsPerMin('+4915155512345')`), `test/metering-unit.test.js:91/116/122`,
  `test/pay-04-starter-reserve-charakterisierung.test.js:46` - alle drei werden im selben Commit
  auf die neue Zweiargument-Signatur umgestellt, **nicht** durch Aufweichen des fail-closed-Defaults.
- **ENTSCHAERFT (2):** ein Test pinnt Reserve und Buchung fuer dieselbe Konstellation auf denselben
  Satz. Der grep ueber alle Aufrufer ist **Abnahmekriterium, nicht Sorgfalt**: jeder Treffer wird
  im Merge-Kommentar mit `datei:zeile` und dem uebergebenen Herkunftswert aufgefuehrt.
- **ENTSCHAERFT (3), aufgeloest ueber O3b:** ORIG-03 bucht Inbound nicht mit 0, sondern mit dem
  **Inlandssatz des DID-Landes** - der Kostenpfad bleibt bepreist. **Achtung Widerspruch:**
  `test/orig-01-05-cost-origin.test.js:90-115` assertiert heute `voiceEvents.length === 0`
  (gar kein Event); diese Assertion wird nach R5 auf "Event zum Inlandssatz, nie zum
  Auslands-Worst-Case" korrigiert (siehe O3b) - der Sachverhalt der Testnachricht lebt weiter, nur
  die Assertion "kein Event" nicht.
- **Beachten:** die Kosten-Achse wird nicht pro Inkrement gerundet (bekannter P1-Safety-Blocker aus
  `PLAN-CLEAN-CODE`, sonst wird das Budget-Gate blind).
- **GETRAGEN:** die Korrektur **aendert die Abrechnung laufender Kunden** ab Deploy. Das ist die
  Absicht, kein Nebeneffekt. Ob rueckwirkend und ob informiert wird, entscheidet O3.

**Abnahme.** ORIG-01, ORIG-02, ORIG-03 nicht mehr in der Rot-Liste (42 -> 39). `npm test` gruen -
insbesondere `test/prod-config-smoke.test.js` zeigt fuer das Inlandsziel unveraendert 500 (keine
Regression an der Gate-Kette), UND die drei bekannten Mitzieher
(`cost-calibration.test.js`, `metering-unit.test.js`, `pay-04-starter-reserve-charakterisierung.test.js`)
laufen gegen die neue Zweiargument-Signatur. A3, A6 erfuellt. Zusaetzlich: der Merge-Kommentar
listet jeden Aufrufer mit `datei:zeile`; ein Kosten-Reconcile-Lauf gegen einen echten Telnyx-Beleg
bucht fuer einen US-DID -> DE-Anruf den Auslandssatz.

**R5-Loeschpflichten.**

| Datei:Zeile | Behandlung | Grund |
| --- | --- | --- |
| `test/orig-01-05-cost-origin.test.js:90-115` | **NACHZIEHEN, nicht loeschen**: Assertion von `voiceEvents.length === 0` auf "Event vorhanden, zum Inlandssatz des DID-Landes" umstellen - **nur** wenn O3b auf "Ja, Inlandssatz" entscheidet. | Der Sachverhalt ("kein Auslands-Worst-Case fuer Inbound") bleibt erhalten, nur die Assertion "gar kein Event" widerspricht der gewaehlten Gegenmassnahme (siehe O3b). |

**Aufwand.** 3 bis 4 Tage.

---

### P6 - Budget-Fenster und Gate-Fairness

**IDs (3):** GAP-01, GAP-07, GAP-10

**Ziel.** Die EUR-Gate-Achse haengt am Abrechnungszeitraum statt an der Lebenszeit; ein leerer
Alarmkanal bei scharfen Spend-Warnungen bricht den Start ab; das Stundenlimit trennt Tenant-Limit
von Plattform-Notbremse.

**Position.** Zweite Geld-Wurzel, zwingend **vor** P7: solange die Decke lebenslang zaehlt, ist
jede Anhebung von `DEFAULT_TENANT_BUDGET_CENTS` eine permanente Erhoehung fuer jeden Tenant - nach
der Umstellung auf ein Perioden-Fenster ist dieselbe Zahl eine periodische. Zwingend **nach** P5,
weil sonst ein falscher Verbrauch periodisiert wird.

**Zwei Korrekturen an der Klassifikation (beide am Code belegt).**
1. **GAP-01 ist KEIN `env-flip`.** `test/gap-01-period-budget-axis.test.js:47` assertiert
   `config.billing.budgetMonthEnabled === false` als **Vorbedingung** und verlangt danach, dass ein
   Stripe-Perioden-Wechsel die Achse zuruecksetzt. Ein Env-Flip macht den Test **nicht gruen** - er
   zerstoert dessen Vorbedingung. Der Fix ist ein Umbau in `state-ops.js` (Anker am
   Subscription-Zeitraum); das `<1h`-Etikett traegt nicht.
2. **Die Kante `GAP-01 -> GAP-07` existiert nicht.** GAP-01 beruehrt `state-ops.js`/Stripe-Perioden,
   GAP-07 `boot-guard.js`/`PLATFORM_ALERT_SMS_TO` - kein gemeinsamer Codepfad. Die Klassifikation
   markiert die Kante selbst als unbelegt; hier wird sie **verworfen**. GAP-07 bleibt in dieser
   Phase, weil es dieselbe Boot-/Gate-Nachbarschaft ist und der Deploy sonst zweimal faellt.

**Vorbedingung.** P5 live. O1 (Ablesung), O4, O5 beantwortet.

**Pre-Mortem.**
1. Der Perioden-Reset reaktivierte jeden gesperrten Tenant, darunter einen in laufender
   Dunning-Klaerung. Er telefonierte 400 EUR ab und zahlte nie - der Reset hatte den Zahlungsstatus
   nie geprueft, weil die Achse Budget hiess und nicht Zahlung.
2. GAP-07 wurde als hartes `fatal:true` gebaut. Ein halbes Jahr spaeter loeschte jemand
   `PLATFORM_ALERT_SMS_TO` im Dashboard versehentlich mit; der naechste Deploy startete nicht mehr.
3. Das globale Stundenlimit wurde durch das Pro-Tenant-Limit **ersetzt** statt ergaenzt. Ein
   kompromittierter Account fuhr 500 Anrufe in einer Stunde, jeder einzeln unter dem Tenant-Limit.
4. **Der stille Fall (A4):** der Perioden-Reset zog die **globale** Achse mit. Der geteilte
   Plattform-Topf loeste danach nie wieder aus - niemand merkte es, weil ein Gate, das nicht
   ausloest, wie ein Gate aussieht, das nicht ausloesen muss.
5. **Die Reset-Kante statt der Reaktivierungs-Kante:** die Reaktivierung heute gesperrter Tenants
   wurde sauber an den Zahlungsstatus gekoppelt (ENTSCHAERFT 1), der **Reset des
   Verbrauchszaehlers** bei jedem Periodenwechsel aber nicht. Stripe sendet `SUBSCRIPTION.UPDATED`
   (der Reset-Anker) auch bei `past_due`/`unpaid`. Ein nicht zahlender Tenant blieb zwar gesperrt,
   bekam aber bei jedem Periodenwechsel ein frisches Kontingent auf Plattformkosten - unbegrenzt
   oft, bis der geteilte Plattform-Topf griff. Derselbe Schaden wie Fall 1, nur ueber die andere
   Kante, und der GAP-01-Test faehrt `status:'active'` und bemerkt es nicht.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** Reaktivierung UND Reset des Verbrauchszaehlers sind an **denselben**
  Zustand gekoppelt, nicht an den Deploy und nicht nur die Reaktivierung: **beide** Kanten pruefen
  `subscription.status` aktiv/trialing UND bezahlte letzte Rechnung, bevor gesperrte Tenants
  reaktiviert oder ihr Zaehler zurueckgesetzt wird. Alle uebrigen bleiben gesperrt **und** ihr
  Zaehler bleibt stehen; sie erscheinen in einer Audit-Liste. Jede Reaktivierung schreibt Audit +
  Plattform-SMS. Ein eigener Test belegt, dass ein Periodenwechsel mit `status: 'past_due'` die
  Achse NICHT zuruecksetzt. Die Entscheidung darueber ist O4, nicht Implementiererwahl.
- **ENTSCHAERFT (2):** GAP-07 wird `fatal` **nur** unter der Bedingung des Tests (leerer Kanal UND
  aktive Spend-Warnung); ein Dienst ohne scharfe Warnschwellen bootet weiter. Die Abbruchmeldung
  nennt die Variable woertlich. Zusaetzlich zeigt der `configHash` aus P1 die Drift, bevor sie den
  Boot trifft - das ist der Grund, warum P1 vor P6 **deployed** wird.
- **ENTSCHAERFT (3):** das globale Limit **bleibt** und wirkt als **Schnittmenge** mit dem neuen
  Pro-Tenant-Limit (Absolute Regel 1: kein ersatzloser Wegfall). Ein Test pinnt beide Achsen
  gleichzeitig. Der Fehlertext nennt keinen Env-Namen mehr (Regel-4-Nachbarschaft).
- **ENTSCHAERFT (4), A4:** ein eigener Test belegt, dass der **globale Plattform-Topf** nach dem
  Umbau weiterhin greift, wenn viele Tenants je unter ihrer eigenen Periodendecke bleiben.
- **GETRAGEN:** steht `BUDGET_MONTH_ENABLED` laut O1 bereits live auf `true`, ist GAP-01 heute
  weniger dringlich als eingestuft. Der Fix bleibt trotzdem noetig, weil sein Test genau den
  `false`-Pfad verlangt.

**Abnahme.** GAP-01, GAP-07, GAP-10 nicht mehr in der Rot-Liste (39 -> 36). `npm test` gruen. A3,
A6 erfuellt. Zusaetzlich: ein Lauf, der einen Perioden-Wechsel ueber den Stripe-Webhook fuehrt und
die Gate-Achse zurueckgesetzt sieht **bei `status: 'active'`, aber unveraendert stehen bleibt bei
`status: 'past_due'`**; ein Boot mit leerem `PLATFORM_ALERT_SMS_TO` + scharfen Warnungen
(exit != 0) und einer mit unscharfen Warnungen (Boot ok); ein Gate-Lauf, der zeigt, dass zwei
Tenants sich nicht mehr gegenseitig aus dem Stundenlimit verdraengen **und** dass die globale
Bremse weiterhin greift, mit **eigenem, im Dashboard vor dem Deploy gesetztem** Env-Schluessel
(O5) und einem Profil mit `maxCallsPerHour: 0`, das nach dem Umbau weiterhin 0 hat.

**R5-Loeschpflichten.** Keine.

**Aufwand.** 4 bis 5 Tage.

---

### P7 - Boot-Kohaerenz und Startfaehigkeit des Blueprints

**IDs (3):** GAP-32, GAP-38, GAP-33

**Ziel.** Budget-, Tarif- und Dauer-Zahlen sind in sich kohaerent, der
`WORST_CASE_UNAFFORDABLE`-Befund bricht den Start ab, `render.yaml` ist wieder ein funktionierender
Wiederherstellungspfad, und Auslands-Outbound kommt unter ausgelieferter Konfiguration durch.

**Position.** Die drei haengen an derselben Zahlenbasis und derselben Boot-Sequenz - getrennt
gefahren erzeugen sie garantierten Rueckbau. Nach P5 (ohne Herkunfts-Achse ist jede Tarifzahl
geraten) und nach P6 (ohne Perioden-Fenster ist jede Deckenanhebung eine lebenslange).

**Der Widerspruch, der den Schnitt traegt (am Code belegt).**
`test/gap-32-worst-case-fatal.test.js:35-37` pinnt `render.yaml` auf
`DEFAULT_TENANT_BUDGET_CENTS=600`, `MAX_BUDGET_EUR=8` (800 ct) und `VOICE_TARIFF_DEFAULT_CENTS=300`
als **Vorbedingung**, verlangt in `:46-50`, dass der Befund **aus diesen Werten** entsteht, und
fordert dann `fatal:true`. `test/prod-config-smoke.test.js` verlangt gleichzeitig, dass genau
dieser Blueprint **startet**. Beides ist woertlich unmoeglich: `fatal:true` mit diesen Zahlen
bricht den Boot ab.

**Aufloesung:** die Zahlen in `render.yaml` werden kohaerent **und** startfaehig; GAP-32 prueft den
`fatal`-Charakter an **konstruierten** Eingaben. Das senkt keine Erwartung - `fatal:true` bleibt
woertlich stehen -, es korrigiert die **Fixture-Quelle**. Die drei render.yaml-IST-Pins werden nach
R5 **geloescht, nicht angepasst**: sie pinnen exakt die Inkohaerenz, die der Fix beseitigt.

**Vorbedingung.** P5 und P6 live. **O6 beantwortet - ohne sie darf diese Phase nicht starten.**
O1 abgelesen und in `test/prod-env.js` `LIVE_MEASURED` eingetragen.

**Pre-Mortem.**
1. `fatal:true` wurde geflippt, ohne zu pruefen, ob die LIVE-Env dieselben Zahlen traegt wie
   `render.yaml` - sie tat es nicht. Der naechste ganz normale Deploy startete nicht mehr, der
   Dienst nahm 40 Minuten keine Anrufe an, und der Rollback dauerte, weil niemand wusste, welcher
   Wert im Dashboard steht.
2. Die Kohaerenz wurde ueber ein Absenken von `VOICE_TARIFF_DEFAULT_CENTS` hergestellt. Die
   Budget-Reserve pro Anruf schrumpfte, ein teures internationales Ziel lief 20 Minuten und riss
   die Tenant-Decke um ein Vielfaches - der Guard hatte zu wenig reserviert.
3. Jemand machte GAP-32 gruen, indem er die `render.yaml`-Vorbedingungen im Test "anpasste". Der
   Test hiess weiter GAP-32 und bewies nichts mehr.
4. Die In-Prozess-Bootstrap-Heilung sprang an, weil die Postgres-Verbindung beim Boot kurz
   fehlschlug und der Store dadurch **leer aussah**. Sie legte einen neuen Tenant an und kaufte
   eine neue DID - exakt die Nummern-Proliferation vom Juni 2026, diesmal automatisiert und bei
   jedem Neustart.

**Gegenmassnahme.**
- **ENTSCHAERFT (1/3) durch Zerlegung in ZWEI Deploys innerhalb der Phase.**
  **Deploy 7a:** Zahlen-Kohaerenz nach dem in O6 gewaehlten Hebel, ausgeliefert **und im Dashboard
  gesetzt**, verifiziert ueber `configHash` und Boot-Banner aus P1. Erst wenn der Fingerabdruck den
  erwarteten Wert zeigt:
  **Deploy 7b:** der `fatal`-Flip als **eigener, einzeiliger, revert-barer** Commit. Rollback ist
  ein `git revert` oder ein Env-Wert, kein neuer Umbau. **Die `WORST_CASE_UNAFFORDABLE`-Abbruchmeldung
  nennt woertlich `DEFAULT_TENANT_BUDGET_CENTS`, `VOICE_TARIFF_DEFAULT_CENTS`, die berechnete
  Reserve und den erwarteten Zielwert** (dieselbe Auflage wie bei GAP-07, hier auf GAP-32
  uebertragen) - Zahlen der Betreiber-Achse, keine Tenant-Daten, kein Secret (Regel 4 bleibt
  gewahrt). Auf dem Render-Free-Tier (kein `preDeployCommand`, keine Shell, keine Jobs; Deploy nur
  ueber das Upstream-Remote) ist das Aendern der Werte im Dashboard der einzige schnelle
  Erholungsweg - ohne benannte Werte muesste der Betreuer im Notfall raten (genau Pre-Mortem 1).
- **ENTSCHAERFT (2), Guardrail aus O6:** der Hebel darf **nicht** ueber ein Senken von
  `VOICE_TARIFF_DEFAULT_CENTS` laufen. Der Tarif ist die Messgroesse, mit der das Gate rechnet;
  ihn kleinzurechnen macht das Gate blind - faktisch eine Aufweichung von Absoluter Regel 1.
  Empfohlen: Reserve aus dem **echten Zieltarif** (den P5 liefert) plus Senken von
  `MAX_CALL_DURATION_CAP_S` **als Code-Konstante** (`src/store/defaults.js:250-253`) - sie bleibt
  eine Code-Konstante und wird in dieser Phase NICHT zur Env-Variable gemacht (O6, zweiter
  Guardrail). Konsequenz, die O6 bereits benennt: jeder Anruf jedes Bestandskunden endet dadurch
  frueher, und der Wert deckelt zusaetzlich `place_call.max_duration_s` im MCP-Schema.
- **ENTSCHAERFT (4):** die In-Prozess-Heilung greift **nur** bei erfolgreicher Store-Verbindung UND
  nachweislich leerem Ergebnis in allen relevanten Tabellen (keine aktive Nummer UND kein Tenant),
  laeuft genau **einmal**, ist idempotent, schreibt Audit und loest eine Plattform-SMS aus. Jeder
  Verbindungsfehler fuehrt zum **Abbruch**, nie zur Heilung - Test mit werfendem Store-Doppel, der
  beweist, dass NICHT geheilt wird. Existenzberechtigung dieses Pfades: Render Free-Tier kann kein
  `preDeployCommand`, keine Shell, keine Jobs.
- Vor GAP-38 gegenpruefen, ob eine In-Prozess-Heilung mit der Owner-Removal-Entscheidung
  kollidiert (kein Owner-Konzept mehr, Admin ueber `account.role`).
- **GETRAGEN:** GAP-33 Teil (a) - dass internationaler Outbound bis zum Provider durchkommt - wurde
  unter Live-Env nie durch einen echten Testlauf verifiziert; der vermutete 402 bleibt eine
  Vermutung, bis ein Probe-Anruf ihn belegt.
- **GETRAGEN:** war die Dashboard-Ablesung aus O1 falsch, trifft der Deploy den Dienst. Dagegen
  hilft nur der zweistufige Deploy, keine weitere Sicherung.

**Abnahme.** GAP-32, GAP-38, GAP-33 (beide Teile) nicht mehr in der Rot-Liste (36 -> 33).
`npm test` gruen. A3, A6 erfuellt. Zusaetzlich: ein Boot mit den korrigierten Blueprint-Werten
laeuft durch und liefert `/healthz`=200; ein Boot mit absichtlich inkohaerenten Werten bricht ab
(beides als Test); ein Spawn mit leerem Store + `BOOTSTRAP_E164` heilt sich in-prozess; nach dem
Deploy zeigt `/healthz` den erwarteten `configHash`.

**R5-Loeschpflichten und Pin-Nachzug.**

| Datei:Zeile | Behandlung | Grund |
| --- | --- | --- |
| `test/gap-32-worst-case-fatal.test.js:35-37` | **LOESCHEN** (die drei render.yaml-IST-Pins 600/800/300) | R1/R5: sie pinnen die zu behebende Inkohaerenz. Die SOLL-Assertion `fatal:true` (`:52-54`) bleibt **woertlich** stehen und faehrt gegen synthetische Zahlen. |
| `test/gap-32-worst-case-fatal.test.js:46-50` | **LOESCHEN** (Vorbedingung "render.yaml muss den Befund ausloesen" + `/1500 Cent/`) | derselbe R5-Grund; die Reserve-Zahl ist eine Ist-Messung, kein Sollzustand. |
| `test/env-docs-spend-cap-coherence.test.js:117, 127, 137` | **NACHZIEHEN, nicht loeschen**: die Assertion auf `false` drehen - **nur** fuer die Quellen, die tatsaechlich geaendert wurden (`.env.example` / `render.yaml` / `src/config.js`-Fallback). | Diese drei Tests pinnen `plan_cap_inert` bewusst als bekannte Luecke und tragen die Aufhebungsanleitung in der eigenen Assertion-Message ("MUSS auf false gedreht werden, sobald ... MAX_BUDGET_EUR>=10"). Das ist ein vom Testautor gelieferter Freigabemechanismus, kein Absenken einer Erwartung. Kein Vorentwurf nannte alle drei; sie bleiben sonst als stale Pins stehen. |
| `test/orig-01-05-cost-origin.test.js:120-121` (`reserveCents === 1500`) | **NACHZIEHEN**: Wert auf die neue Reserve (nach O6-Hebel, Richtwert 120 s statt 300 s) umstellen. | Mitziehender Pin an `MAX_CALL_DURATION_CAP_S=300`; wird durch den O6-Hebel falsch, nicht durch einen eigenen Fehler. In keinem Vorentwurf genannt, am Code gefunden. |
| `test/pay-04-starter-reserve-charakterisierung.test.js:46` | **NACHZIEHEN**: dieselbe Umstellung. | Derselbe Grund. |
| `test/boot-failclosed.test.js:118` (Kommentar "600 < 300*5=1500") | **NACHZIEHEN**: Kommentar und Rechnung auf den neuen Wert umstellen. | Derselbe Grund; hier zusaetzlich ein Kommentar, der bei falscher Nachziehung die Inkohaerenz woertlich weiter behauptet. |

**Aufwand.** 3 Tage (zwei Deploys).

---

### P8 - Geo-Identitaet am Eintritt (verhaltensneutraler Vorbau)

**IDs (4):** LANG-02, FMT-11, FMT-28, E2E-01

**Ziel.** Jeder Tenant traegt Land und Zeitzone, das Onboarding blockiert Nicht-DE-Nummern nicht
mehr am `+49`-Gate, und ein Landwechsel hat eine definierte Semantik - **ohne** dass sich fuer
einen einzigen Bestandskunden die gesprochene Sprache aendert.

**Position.** Vorbedingung des Weltdefault-Flips, als eigene Phase geschnitten, damit der Flip
danach ein Einzeiler mit einer Zeile Rollback ist. Die Klassifikation nennt LANG-02 als
Soft-Order vor WORLD-01; faktisch ist es eine **harte** Vorbedingung: flippt man zuerst, bekommt
jeder neue **deutsche** Web-Login-Kunde ab dem Deploy-Tag Englisch, weil der Login-Pfad kein Land
setzt. FMT-28 teilt sich mit LANG-02 exakt den Mechanismus "beim Eintritt aus dem Land ableiten"
und wird deshalb hier mitgebaut, nicht ein zweites Mal. FMT-11 ist cross-bundle-Vorbedingung von
E2E-05 (P10).

**Diese Phase schreibt bewusst KEINE neue Sprachsemantik.** Der Weltdefault bleibt bis P10 `de`.

**Vorbedingung.** P1 live. O8, O9, O10 beantwortet.

**Pre-Mortem.**
1. Das Land wurde per IP-Geolokation bestimmt. Ein deutscher Kunde war im Urlaub bzw. hinter einem
   VPN, bekam `country=US`, und nach dem Flip in P10 sprach sein Agent Englisch mit seinen
   deutschen Anrufern - ein Fehler, den niemand zurueckverfolgen konnte, weil das Feld wie eine
   Kundenangabe aussah.
2. FMT-11 wurde geloest, indem das Praefix-Gate der privaten Summary-Nummer gelockert wurde
   ("beliebiges Land erlaubt"). Damit war der Toll-Fraud-Schutz weg, und ein Angreifer liess sich
   Summary-SMS auf eine Premium-Nummer schicken.
3. Das `timezone`-Feld wurde ein halbes Jahr spaeter als Grundlage fuer ein Anrufzeitfenster
   benutzt - genau das Gate, das der Owner in 7.6 ausdruecklich abgelehnt hatte. Nutzer konnten
   abends nicht mehr telefonieren.
4. E2E-01 erlaubte den Landwechsel und kaufte still eine zweite DID; die Miete lief doppelt weiter,
   weil die alte nie freigegeben wurde.
5. Das Pflichtfeld "Land" beim Login halbierte den Neukunden-Funnel - niemand bemerkte es, weil
   die Funnel-Sicht fehlte.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** das Land wird ausschliesslich aus Belegen abgeleitet, die dem Kunden
  gehoeren - DID-Vorwahl (E2) oder ausdrueckliche Eingabe. **Kein IP-Geo als stille Uebernahme.**
  Ohne ableitbares Land bleibt das Feld leer und der bestehende Pfad greift.
- **ENTSCHAERFT (2):** das Praefix-Gate **bleibt Allowlist**; landabhaengig wird nur die
  **Herleitung** des erlaubten Praefixes aus dem Tenant-Land, nie die Existenz des Gates. Zwei
  Tests: (a) eine nicht zum Tenant-Land passende Nummer wird weiterhin abgelehnt; (b)
  Premium-Praefixe werden auch im neuen Land abgelehnt.
- **ENTSCHAERFT (3):** FMT-28 kommt mit einem Test, der belegt, dass **kein** Gate-Pfad das
  `timezone`-Feld liest (grep-Pin auf die Konsumenten). Die Zusicherung aus O10 wird strukturell
  gehalten, nicht per Kommentar.
- **ENTSCHAERFT (4):** E2E-01 loest nur die in O9 gewaehlte Semantik ein. Empfehlung: Wechsel im
  Self-Service ablehnen (409, stabiler Code) statt stillem 200-OK-No-Op; kein automatischer
  Zweitkauf, "strikt 1 Nummer pro Tenant" bleibt.
- **ENTSCHAERFT (5):** die Denial-/Funnel-Metrik aus P1 wird in der ersten Woche nach dem Deploy
  taeglich gelesen.
- **GETRAGEN:** wird "Wechsel verbieten" gewaehlt, bleibt ein Kunde mit falschem Land in einem
  manuellen Support-Pfad.

**Abnahme.** LANG-02, FMT-11, FMT-28, E2E-01 nicht mehr in der Rot-Liste (33 -> 29). `npm test`
gruen. A3, A6 erfuellt. Zusaetzlich: ein Onboarding-Lauf mit `country=US` und US-Privatnummer geht
durch; ein Login-Lauf legt einen Tenant mit gesetztem `country` + `timezone` an; **und die
psql-Messung fuer P10 wird hier erhoben** (siehe P10 Vorbedingung).

**R5-Loeschpflichten.** Keine.

**Aufwand.** 4 bis 5 Tage.

---

### P9 - Web-Textoberflaechen und Fehler-Vertrag

**IDs (4):** WEB-01, WEB-09, WEB-11, WEB-12

**Ziel.** Fehlerantworten der Web-Pfade sind stabile Codes statt deutschem Klartext, und das
Dashboard traegt die Sprache des Tenants statt hart `lang="de"`.

**Position.** Nach P8, weil `WEB-01` die in P8 eingefuehrte Tenant-Sprache braucht. Bewusst
**getrennt** von P8 (anders als im Siegerentwurf): P8 aendert das Datenmodell, P9 nur Text und
Frontend-Vertrag - zwei verschiedene Rollback-Risikoklassen gehoeren nicht in einen Deploy.

**Vorbedingung.** P8 live.

**Pre-Mortem.**
1. Die Klartext-Fehlermeldungen wurden durch stabile Codes ersetzt, aber `public/tenant.html`
   parste den alten deutschen Text. Die Fehleranzeige im Dashboard war fuer alle Kunden leer - der
   Nutzer sah gar keine Fehlermeldung mehr und wiederholte den fehlschlagenden Vorgang.
2. `WEB-01` wurde als voller `data-i18n`-Textmechanismus gebaut statt als
   `document.documentElement.lang`-Write. Der Umbau zog sich, die Phase blockierte P10, und ein
   halb uebersetztes Dashboard ging live.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** WEB-09/11/12 ziehen den **Frontend-Vertrag im selben Commit** mit
  (`public/tenant.html`); ein Test pinnt, dass der Konsument den neuen Code versteht.
- **ENTSCHAERFT (2):** WEB-01 wird zunaechst als reines Sprach-Attribut umgesetzt (was der Test
  verlangt), nicht als vollstaendiger Textmechanismus. Ein groesserer i18n-Umbau des Dashboards ist
  **nicht Teil dieser Phase** und braeuchte eine eigene Entscheidung.
- **GETRAGEN:** die Klassifikation ist sich bei WEB-01 selbst unsicher, ob "Umbau" oder
  "Einzeiler". Zeigt sich beim Bau, dass der Test mehr verlangt als das Attribut, wird die Phase
  gestoppt und der Umfang neu bewertet - nicht heimlich vergroessert.

**Abnahme.** WEB-01, WEB-09, WEB-11, WEB-12 nicht mehr in der Rot-Liste (29 -> 25). `npm test`
gruen. A3, A6 erfuellt.

**R5-Loeschpflichten.** Keine.

**Aufwand.** 1 bis 1,5 Tage.

---

### P10 - Schreibpfad-Korrektur, Backfill und Weltdefault-Flip

**IDs (7):** WORLD-01, WORLD-03, DID-01, DID-02, DID-03, E2E-04, E2E-05

**Ziel.** `DEFAULT_LANGUAGE` wechselt von `de` auf `en`; DE/AT/CH bleiben `de`, FR bleibt `fr`;
Laender ohne eigenes Bundle bekommen Englisch - und **kein Bestandskunde kippt dabei um**.

**Position.** Der eigentliche Eingriff ist eine Konstante plus Tabelleneintraege und damit in einer
Zeile rueckrollbar - vorausgesetzt, alles andere steht (P8). Fuenf der sieben IDs brauchen
ueberhaupt keinen eigenen Fix: DID-01/02/03 fallen laut kanonischer Liste automatisch mit WORLD-01,
WORLD-03 ist dieselbe Konstante, E2E-04/E2E-05 sind Aggregate aus LANG-02 + WORLD-01 bzw.
FMT-11 + WORLD-01. Eine Wurzel, sechs Blaetter - das ist der Beleg, dass der Schnitt richtig sitzt.

**Vorbedingung.** P8 und P9 live. **O11 beantwortet.** Und zwingend: die **psql-Zaehlabfrage gegen
`hermes-db`**, wie viele Tenants/Nummern tatsaechlich NULL in `tenant.default_language` bzw.
`number.language` tragen. Das gesamte Migrationsargument haengt an dieser bis heute ungemessenen
Zahl.

**Diese Phase besteht aus DREI Schritten in fester Reihenfolge:**

**Schritt 1 - Schreibpfad (A1 + A2), eigener Commit, VOR allem anderen.**
`src/store/state-ops.js:674` (`seedBootstrapNumber`) und `:1257` (`requestNumber`) tragen
`language = DEFAULT_LANGUAGE` als Default-**Parameter**. Beide werden auf eine Ableitung aus dem
Land umgestellt, mit Test je Pfad. Im selben Commit werden die vier Assertions aus A2
(`test/f1-geo-onboard.test.js:69,91`, `test/f1-geo-store.test.js:161,178`) von `DEFAULT_LANGUAGE`
auf ihr eigenes im Testnamen genanntes Subjekt (`"de"`) umgehaengt. **Danach muessen alle vier
gruen sein und beim Flip gruen bleiben.** Sie sind der Alarm.

**Schritt 2 - Backfill, eigener Lauf, mit Messung vorher und nachher.**
Deckt **BEIDE** Tabellen: `tenant.default_language` **und** `number.language`. Zaehlung vor und
nach dem Lauf, dokumentiert im Phasenreport. **FORCE-RLS-Auflage im Runbook:** unter Force-RLS
liefert ein naives `SELECT` **0 Zeilen** und taeuscht "ist doch alles leer" vor - die Rolle muss
gesetzt werden, sonst luegt die Messung, die hier das Freigabekriterium ist. Ein Rollback des
Backfills ist nicht noetig: er schreibt nur explizit, was heute implizit gilt.

**Schritt 3 - der Flip, eigener Commit.**
Beruehrt ausschliesslich die Konstante und die Landtabelle, damit `git revert` genuegt. Geht erst
raus, wenn die Zaehlung aus Schritt 2 den erwarteten Rest zeigt.

**Pre-Mortem.**
1. Am Tag des Flips begruesste Hermes Bestandskunden aus Bayern auf Englisch. Ursache: der Backfill
   war als "machen wir gleich danach" eingeplant, der Flip ging zuerst raus, und weil
   `DEFAULT_LANGUAGE` gleichzeitig der Fallback fuer NULL-Datensaetze ist, kippte der Bestand in
   derselben Sekunde. Zwei Kunden kuendigten, einer schrieb oeffentlich darueber.
2. Der Backfill lief nur ueber `tenant.default_language`; `number.language` wurde vergessen - zwei
   Tabellen, eine uebersehen, weil beide Felder additiv-NULLABLE eingefuehrt wurden. Die Reparatur
   dauerte laenger als der Flip, weil unter RLS ein naives `SELECT` null Zeilen lieferte und der
   Betreuer daraus faelschlich "ist doch alles leer" schloss.
3. **Der Fall, den kein Backfill faengt (A1):** ab dem Flip materialisierte jede neu angelegte
   Nummer `en` **in den Datensatz** - non-NULL, also unsichtbar fuer jede NULL-Zaehlung. Ein halbes
   Jahr spaeter war der Bestand durchmischt und niemand wusste mehr, welcher Wert Absicht war.
4. Der Alt-Test `f1-geo-port.test.js:61` wurde nicht geloescht, sondern "angepasst". Er hiess
   weiter "unbekanntes Land -> DEFAULT_LANGUAGE" und behauptete seither das Gegenteil seines Namens.
5. Jemand nutzte den Anlass, die ASCII-Transliteration der gesprochenen DE-Strings "aufzuraeumen".
   Sieben gepinnte Tests fielen, und die Sprachausgabe aenderte sich hoerbar.

**Gegenmassnahme.**
- **ENTSCHAERFT (1/2/3):** die Drei-Schritt-Zerlegung oben ist die Gegenmassnahme, nicht eine
  Beschreibung. Schritt 1 vor Schritt 2 vor Schritt 3, je eigener Commit, je eigene Verifikation.
- **ENTSCHAERFT (1):** der Flip haengt zusaetzlich an einem Env-Schalter - Rueckflip ohne Deploy in
  Minuten.
- **ENTSCHAERFT (2):** Backfill deckt beide Tabellen; FORCE-RLS-Auflage steht im Runbook.
- **ENTSCHAERFT (3):** die vier A2-Tests sind der stehende Alarm gegen den Schreibpfad-Fehler.
- **ENTSCHAERFT (4):** die Alt-Pins werden nach R5 **geloescht**, nicht umgeschrieben (Tabelle
  unten).
- **ENTSCHAERFT (5), A2 Auflage 3 - Absolute Regel 2 gegen den Flip selbst:** fuer jeden
  Bestandstenant, dessen Sprache nach dem Flip weiterhin `de` aufloest (per Schritt 1/2
  sichergestellt), bleiben Offenlegungssatz UND Gather-/Say-Locale byte-/attribut-identisch zum
  Vor-Flip-Zustand. Das ist keine neue Sicherung, sondern die Feststellung, dass A1/A2 nur den
  Schreibpfad fuer NEUE Datensaetze abdecken - der Offenlegungssatz und die TTS-/STT-Locale werden
  zur Laufzeit aus der aufgeloesten Sprache gerendert und muessen deshalb Teil **derselben**
  Abnahme sein, nicht einer spaeteren Phase (siehe A2, gemessene Testliste).
- **NICHT ANTASTEN:** die ASCII-Transliteration der gesprochenen DE-Strings (`src/i18n/locales.js`)
  und `de-DE` als Gather-/STT-Locale. Beides ist empirisch begruendet und wird in dieser Phase
  weder aufgeraeumt noch angefasst.
- **GETRAGEN:** Laender ohne eigenes Bundle bekommen Englisch, inklusive Offenlegungssatz
  (`PLAN-I18N-TESTS.md` 7.13 Punkt 4).
- **GETRAGEN:** ergibt die psql-Zaehlung, dass es gar keine NULL-Zeilen gibt, entfaellt Schritt 2.
  Das ist dann ein **Messergebnis**, keine Annahme.

**Aktivierungsfenster (S2, quer zu P10-P13).** Nach diesem Deploy spricht ein neuer Nicht-DE/FR-
Tenant sofort Englisch in STT/TTS und Offenlegungssatz (P10-Wirkung), aber weiterhin mit
deutschem Systemprompt, deutschen Tool-Beschreibungen, deutscher Greeting-Vorlage,
deutscher Abschluss-SMS (P11), deutschen MCP-Texten (P12) und deutschem Widget (P13) - der Zustand,
den P11 als "wirkt kaputt" beschreibt. Deshalb gilt: **der Env-Schalter aus ENTSCHAERFT (1) bleibt
nach diesem Deploy AUS und wird erst nach der Abnahme von P13 eingeschaltet.** P10-P13 werden
gemergt und live deployt (Rot-Liste sinkt planmaessig mit jeder Phase), aber der Weltdefault-Flip
selbst wird erst mit P13 fertig **aktiviert**. Damit gilt "einzeln deploybar" fuer P10-P13
weiterhin, "einzeln aktivierbar" ausdruecklich nicht - diese vier Phasen bilden ein gemeinsames
Aktivierungsfenster.

**Abnahme.** WORLD-01, WORLD-03, DID-01, DID-02, DID-03, E2E-04, E2E-05 nicht mehr in der Rot-Liste
(25 -> 18). `npm test` gruen - **insbesondere** die vier A2-Tests, die Regressionsachse WORLD-02
(DE/AT/CH bleiben `de`, FR bleibt `fr`, heute gruen) und die R3-Mechanismus-Tests. A3, A6 erfuellt.
Zusaetzlich: psql-Beleg vor/nach Backfill; ein Inbound-Smoke gegen einen DE-Bestandstenant prueft
das **gerenderte TwiML/TeXML** (`Gather language`, `Say voice`), nicht nur den Greeting-Text, und
zeigt unveraendert deutsche Werte; ein Outbound-Smoke belegt, dass der Offenlegungssatz desselben
DE-Bestandstenants deutsch bleibt (`test/disclosure-regression.test.js`-Aequivalent gegen den
Live-Pfad); ein neuer US-Tenant wird mit `en` nachgewiesen (Locale bewusst `en-GB` bis zur
en-US-Frage aus Abschnitt 7).

**R5-Loeschpflichten.**

| Datei:Zeile | Behandlung | Grund |
| --- | --- | --- |
| `test/f1-geo-port.test.js:60-65` | **LOESCHEN** | Pinnt `languageForCountry("US") === DEFAULT_LANGUAGE` unter der Ueberschrift "unbekanntes Land". Wird durch den Flip zufaellig richtig bei unveraendert irrefuehrender Begruendung. R1/R5: loeschen, nicht anpassen - der Sachverhalt lebt als DID-01/WORLD-01 weiter. |
| `test/f1-i18n-locale.test.js:51` | **LOESCHEN (nur diese Zeile)**, Testtitel entkoppeln | `assert.equal(DEFAULT_LANGUAGE, "de")` ist der IST-Pin. Die Zeilen 46-50 pruefen den **Mechanismus** (fail-safe Fallback von `localeFor`) und bleiben nach **R3** als Regressionsschutz gruen bestehen - anders als von zwei Vorentwuerfen vorgeschlagen, die den ganzen Block loeschen wollten. Der Titel traegt heute "(heute 'de', R7)"; diese Wertbehauptung faellt mit, sonst behaelt der Test einen irrefuehrenden Namen. |
| `test/f1-geo-store.test.js:64` | **LOESCHEN (nur diese Zeile)** | Literaler `assert.equal(DEFAULT_LANGUAGE, "de")` innerhalb eines Tests, dessen Subjekt `defaultSettings().language` ist und weiter gilt. In der Klassifikation **nicht erfasst**, am Code gefunden. |
| `test/f1-geo-onboard.test.js:69,91` und `test/f1-geo-store.test.js:161,178` | **NICHT loeschen** - siehe A2, Schritt 1 | Sie sind die Regressionsanzeige fuer den Schreibpfad. Wer sie loescht oder am Flip-Tag "anpasst", schaltet den Alarm ab. |

**Aufwand.** 3 bis 4 Tage (davon rund ein Tag Backfill und DB-Verifikation).

---

### P11 - Die gesprochene Sprache (bewusst ein Block)

**IDs (8):** PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-14, GAP-28, WEB-14, E2E-02, E2E-06

**Ziel.** Systemprompt, Tool-Beschreibungen, Kontroll-Marker, Inbound-Greeting und die
SMS-/Notification-Rahmentexte folgen der Sprache des Tenants. `germanLeakCount` ueber alle acht
Kanaele ist 0 fuer einen EN-Tenant.

**Position.** Nach P10, weil jede Sprachverzweigung hier den dort festgelegten Default und Backfill
voraussetzt - vorher gebaut, muss die Migrationsfrage ein zweites Mal beantwortet werden. Innerhalb
der Phase zuerst PROMPT-01 (strukturelle Wurzel fuer PROMPT-02/14/GAP-28/E2E-06), dann PROMPT-03,
dann WEB-14/E2E-02; PROMPT-14 und E2E-06 sind reine Aggregatbeweise ohne eigenen Mechanismus.

**Warum hier ausnahmsweise KEINE feinere Deploy-Granularitaet.** Halb uebersetzt ist schlechter als
gar nicht: ein Anruf, der englisch beginnt und deutsch endet, wirkt **kaputt**, waehrend ein
durchgehend deutscher Anruf nur fremdsprachig wirkt. Deshalb ist E2E-06 (`germanLeakCount` ueber
8 Kanaele) hier das **Abnahmekriterium** und nicht Beiwerk. Der Preis ist ausdruecklich benannt:
ein Bench-Regress blockiert die gesamte Sprachlieferung dieser Phase.

**Vorbedingung.** P10 live. **Zwingend VOR der ersten Prompt-Zeile zu klaeren, nicht zu
unterstellen:** welcher Gespraechspfad ist im Live-Call aktiv - die turn-basierte Budget-Engine
(`src/claude.js`) oder der Telnyx-Assistant-Pfad? Ein Fix an `claude.js` wirkt **nicht**
automatisch auf beiden, und das Assistant-Flag stand zuletzt live an. Die Antwort steht im
Phasenkopf, sonst startet die Phase nicht (A5). `convo-bench`-Baseline je Sprache (n >= 5) vor
Beginn erhoben.

**Pre-Mortem.**
1. Der Prompt-Umbau machte den EN-Agenten korrekt und den DE-Agenten schlechter: Sektions-
   ueberschriften und Verbote verloren beim Uebersetzen ihre Schaerfe, `take_message` wurde
   unzuverlaessig gezogen, Nachrichten von Anrufern gingen verloren. Aufgefallen ist es ueber
   Kuendigungen, weil nur die Suite gruen war und niemand `convo-bench` gefahren hat.
2. Die vier Kontroll-Marker wurden mituebersetzt. Haiku erkannte den Bootstrap-Marker in der neuen
   Sprache nicht mehr zuverlaessig, und jeder EN-Call begann mit Stille; in einem anderen Fall
   sprach das Modell den Marker laut aus.
3. Der Offenlegungssatz wurde beim Sprach-Umbau zu einem uebersetzbaren Template mit Fallback - und
   ein fehlendes FR-Template liess ihn stillschweigend leer. Ergebnis: ein Outbound-Anruf **ohne
   Offenlegung**, Verstoss gegen Absolute Regel 2.
4. Ein Fix an `claude.js` wurde gebaut, waehrend der Live-Call ueber den Assistant lief. Die Suite
   war gruen, der echte Anruf unveraendert deutsch - und niemand merkte es bis zum ersten
   Kundengespraech.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** `npm run convo-bench` mit **n >= 5 je Sprache** vor und nach jedem
  Prompt-Commit. Das **DE-Ergebnis ist die Abnahmeschwelle**, nicht das EN-Ergebnis: verschlechtert
  sich DE, wird zurueckgerollt. **Die Suite allein ist ausdruecklich KEIN Abnahmekriterium fuer
  Prompt-Aenderungen.** Enge Verbote am Tool-Entscheidungspunkt bleiben woertlich erhalten.
- **ENTSCHAERFT (2):** die vier Kontroll-Marker werden **neutralisiert** (sprachfreie Token), nicht
  uebersetzt - ein Steuerzeichen hat keine Sprache. Wird gegen diese Empfehlung doch uebersetzt,
  braucht jede Sprache einen eigenen Test am Marker.
- **ENTSCHAERFT (3):** der Offenlegungssatz bleibt **fest verdrahtet**, je Sprache **hart**
  hinterlegt, **ohne Fallback auf leer**. Ein Test pro unterstuetzter Sprache beweist, dass er der
  erste Satz ist; fehlt eine Sprache, faellt der Outbound **fail-closed** aus, statt ohne
  Offenlegung zu starten. Das ist die einzige Stelle im Plan, an der Absolute Regel 2 gegen den
  i18n-Umbau selbst abgesichert wird - `localeFor()` faellt heute auf `LOCALES[DEFAULT_LANGUAGE]`
  zurueck, ein Template mit stillem Leerfall waere genau die Falle.
- **ENTSCHAERFT (4):** die Pfad-Frage wird beantwortet, bevor die Phase startet (A5); ist der
  Assistant aktiv, gilt fuer den Provisioner dieselbe Auflage wie in P3.
- **ENTSCHAERFT:** der Default bei fehlender Tenant-Sprache bleibt exakt der, den P10 festgelegt hat
  - keine zweite, abweichende Fallback-Regel.
- **NICHT ANTASTEN:** ASCII-Transliteration der gesprochenen DE-Strings; FR behaelt Akzente;
  `de-DE` als Gather-/STT-Locale.
- **GETRAGEN:** ob GAP-28 die Marker neutralisiert oder entfernt, entscheidet der Bench, nicht die
  Suite.

**Abnahme.** PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-14, GAP-28, WEB-14, E2E-02, E2E-06 nicht mehr
in der Rot-Liste (18 -> 10). `npm test` gruen. A3, A6 erfuellt. Zusaetzlich: `convo-bench` n >= 5
je Sprache ohne Verschlechterung gegen die Baseline; ein Inbound-Smoke je Sprache (de/en/fr) ueber
`curl` gegen `/voice/incoming` mit `SKIP_TWILIO_SIGNATURE_CHECK`; **ein echter Probe-Anruf auf dem
live aktiven Gespraechspfad**, bei dem Greeting, Prompt und Abschluss-SMS dieselbe Sprache tragen.

**R5-Loeschpflichten.**

| Datei:Zeile | Behandlung | Grund |
| --- | --- | --- |
| `test/personal-assistant-characterization.test.js:215-221` | **LOESCHEN** | Byte-genauer IST-Pin des heutigen **deutschen** Systemprompts fuer den EN-Fall. Nach PROMPT-01/02/03/14 widersprechen sich sonst zwei Tests dauerhaft. R5: loeschen, nicht anpassen - sonst behaelt der Test seinen irrefuehrenden Namen. |
| `test/personal-assistant-characterization.test.js:333-346` | **LOESCHEN** | Zweiter byte-genauer IST-Pin derselben Klasse, selbe R5-Loeschpflicht. |

**Aufwand.** 5 bis 6 Tage inkl. Bench-Laeufen.

---

### P12 - MCP-Textkanal

**IDs (5):** PROMPT-09, FMT-03, MCP-04, MCP-06, MCP-08

**Ziel.** MCP-Tools bekommen ueberhaupt erst eine Sprachverzweigung; Datumsformat, Fehlermeldungen
und Transkript-Praefix folgen der Tenant-Sprache, und die Waehrungsanzeige folgt der
Belastungswaehrung.

**Position.** PROMPT-09 ist die Wurzel (`src/mcp-tools.js` hat heute **keine** Sprachverzweigung),
FMT-03/MCP-04/MCP-06 sind ihre Blaetter. Nach P10, weil sonst die Verzweigung gegen einen Default
geschrieben wird, der sich danach aendert. MCP-08 haengt hier an, weil es dieselbe Datei betrifft.

**Vorbedingung.** P10 live. **O12 beantwortet** - lautet die Antwort "usd-Zweig abschaffen", ist
MCP-08 kein Fix, sondern eine Testloeschung (siehe unten), und niemand darf Code dafuer schreiben.

**Pre-Mortem.**
1. Die neue Sprachverzweigung loeste fuer Bestandstenants ohne explizites Sprachfeld auf `en` auf.
   Der Claude-Connector deutscher Kunden war ueber Nacht englisch - ausgerechnet bei denen, die P10
   gerade sorgfaeltig verschont hatte. Ursache: eine **zweite** Aufloesungsregel neben der aus P10.
2. Ein deutscher Klartext in einer Fehlerantwort wurde durch einen stabilen Code ersetzt, aber der
   Konsument parste den alten Text - der Nutzer sah gar keine Fehlermeldung mehr.
3. Die Anzeige wurde auf `$` umgestellt, waehrend `EUR` gebucht wurde - in den USA FTC-relevant, in
   der EU PAngV-widrig.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** **EINE** Aufloesungsfunktion fuer die Sprache, dieselbe wie im Anrufpfad.
  Quelle ist das Tenant-Feld, nie ein Request-Header oder Client-Locale. **Praezisierung:** nach
  vollstaendigem Backfill (P10) gibt es per Definition keinen Tenant mehr ohne Feld - "Tenant ohne
  Feld -> de" ist deshalb kein moeglicher Testfall mehr. Gemeint und zu testen ist: ein
  Bestandstenant, dessen Feld der Backfill auf `de` gesetzt hat, bekommt im MCP-Kanal Deutsch -
  ueber dieselbe Aufloesungsfunktion wie im Anrufpfad, kein zweiter, abweichender Fallback.
- **ENTSCHAERFT (2):** Fehler-Klartexte werden durch stabile Codes ersetzt **und** der Konsument im
  selben Commit umgestellt.
- **ENTSCHAERFT (3):** MCP-08 setzt **Waehrungs-Treue** um (Anzeige folgt der konfigurierten
  Belastungswaehrung) - genau die Invariante aus Entscheidung 7.1. EUR bleibt der ueberall
  konfigurierte Wert.
- **Absolute Regel 5 bleibt unberuehrt:** hier wandert Text durch MCP, nie Audio.

**Abnahme.** PROMPT-09, FMT-03, MCP-04, MCP-06, MCP-08 nicht mehr in der Rot-Liste (10 -> 5).
`npm test` gruen. A3, A6 erfuellt. Zusaetzlich: ein MCP-Tool-Aufruf je Sprache mit korrektem
Datumsformat.

**R5-Loeschpflichten.** Keine - **es sei denn**, O12 entscheidet auf Abschaffung des usd-Zweigs.
Dann wird der MCP-08-Katalogtest **geloescht**, nicht umgeschrieben, und die ID faellt nachtraeglich
unter `test-falsch`.

**Aufwand.** 3 bis 4 Tage.

---

### P13 - Widget und Kanarienvogel

**IDs (4):** MCP-09, UI-14, UI-18, MCP-12

**Ziel.** Das servergerenderte Widget folgt der Agentensprache (E4), und die drei
Bestandstestdateien tragen echte EN-Faelle.

**Position.** Nach P12, weil MCP-09 auf der Sprachverzweigung aus PROMPT-09 aufsetzt. UI-14 vor
UI-18. MCP-12 zuletzt: es haengt per `abhaengt_von` an MCP-04/06/08/09 und ist der
Kanarienvogel-Test ueber die Testabdeckung.

**Vorbedingung.** P12 live.

**Pre-Mortem.**
1. `permissionsSummary` bekam neue Feldnamen, der gruene Pin `test/mcp-ui.test.js:682` wurde
   "passend gemacht", aber `ui/widget-bind.js` nicht mitgezogen. Das Live-Widget blieb bei
   Bestandskunden **stumm leer** - und weil es im Doppel-Iframe des claude.ai-Hosts laeuft, sah man
   im Server-Log nichts.
2. Das Widget wurde sprachabhaengig serverseitig gerendert, der Cache-Key vergass die Sprache -
   deutsche Kunden bekamen englische Widgets.
3. MCP-12 wurde "gruen gemacht", indem seine Erwartung gesenkt wurde, statt den drei Bestandsdateien
   EN-Faelle hinzuzufuegen. Der Test hiess weiter MCP-12 und mass nichts mehr.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** MCP-09 aendert `src/mcp-tools.js`, `test/mcp-ui.test.js:682` **und**
  `ui/widget-bind.js` im **selben Commit**; zusaetzlich ein Widget-Smoke im echten claude.ai
  (postMessage-Trace, wie in der Widget-Kette etabliert). Die Suite allein ist hier kein Beweis.
- **ENTSCHAERFT (2):** die Sprache ist Teil des Widget-**Cache-Keys**, mit Test dagegen.
- **ENTSCHAERFT (3):** MCP-12 wird gruen, indem den drei Bestandstestdateien **echte EN-Faelle
  hinzugefuegt** werden - **nicht** durch Produktionscode und **nicht** durch Absenken der
  Erwartung. Das ist die ausdrueckliche Absicht des Testautors (Kopfkommentar) und wird als solche
  im Phasenreport dokumentiert.
- **ENTSCHAERFT:** dieselbe Praezisierung wie in P12 ENTSCHAERFT (1) - nach dem Backfill gibt es
  keinen Tenant "ohne Feld" mehr; die Aufloesungsfunktion fuer das Widget ist **dieselbe** wie in
  P10/P12, kein zweiter Fallback.

**Abnahme.** MCP-09, UI-14, UI-18, MCP-12 nicht mehr in der Rot-Liste (5 -> 1). `npm test` gruen -
**inklusive** des vorher gruenen Pins `test/mcp-ui.test.js:682` in mitgezogener Form. A3, A6
erfuellt. Zusaetzlich: Widget-Smoke im echten claude.ai je Sprache (de/en/fr).

**R5-Loeschpflichten.** Keine. `test/mcp-ui.test.js:682` ist **kein** R5-Fall: der Pin haelt einen
gueltigen Vertrag und wird mitgezogen, nicht geloescht.

**Aufwand.** 2 bis 3 Tage.

---

### P14 - Rechtstexte

**IDs (1):** GAP-15

**Ziel.** AGB, Datenschutz und Impressum sind echte Texte statt Platzhalter, mit einer definierten
EN-Behandlung.

**Position.** Zuletzt, weil es kein Technikproblem ist - der Blocker ist die externe Textlieferung.
**Aber bestellt wird in P1** (O13): das ist das einzige Element des Plans mit externem Vorlauf, den
keine Codearbeit verkuerzt.

**Vorbedingung.** O13 beantwortet **und der Text geliefert**. Website-Arbeit laeuft ueber
`staging` / `hermes-web-staging`; live geht es nur ueber Merge auf `master` plus manuellen Deploy
(`docs/RUNBOOK-LAB-LIVE.md`).

**Pre-Mortem.**
1. Am Launch-Tag standen immer noch Platzhalter auf der weltweit verkaufenden Website, weil der Text
   nie bestellt wurde. Der erste Abmahnbrief kam vor dem ersten zahlenden Auslandskunden.
2. Die EN-Seiten gingen mit maschineller Uebersetzung live und enthielten Zusicherungen, die so nie
   gemeint waren - und wurden als bindend gelesen.

**Gegenmassnahme.**
- **ENTSCHAERFT (1):** Bestellung in P1, technische Vorbereitung (Route, Routing, noindex-Regeln)
  parallel; nur der Text wartet.
- **ENTSCHAERFT (2):** DE bleibt die **verbindliche** Fassung (Festlegung EN-Marketing/DE-Legal), EN
  ausdruecklich informativ mit Vorrangklausel. Bis freigegebener Text vorliegt liefert die
  EN-Route **404** statt eines Platzhalters - eine fehlende Seite ist besser als eine falsche
  Zusicherung.
- **GETRAGEN:** die Phase kann technisch fertig, aber nicht abgenommen sein. Bis zur Textlieferung
  bleibt GAP-15 als **einzige** ID in der Rot-Liste und wird dort ausdruecklich als "wartet auf
  Textlieferung" gefuehrt, nicht als offener Codedefekt.

**Abnahme.** GAP-15 nicht mehr in der Rot-Liste (1 -> 0). `npm test` gruen. A3, A6 erfuellt.
Zusaetzlich: Sichtpruefung auf `staging` vor dem Live-Deploy; die drei Rechtsseiten tragen keinen
Platzhalter-Marker mehr.

**R5-Loeschpflichten.** Keine.

**Aufwand.** 0,5 Tage Technik plus externe Lieferzeit.

---

## 6. Uebersichtstabelle: alle 53 IDs -> Phase

| Phase | Titel | IDs | Anzahl |
| --- | --- | --- | --- |
| P1 | Sicht und Deploy-Wahrheit | GAP-36, GAP-35 | 2 |
| P2 | Wahl-Sicherheit und Anruf-Mechanik | GAP-18, GAP-25, GAP-22, GAP-21 | 4 |
| P3 | Inbound-Pflichtsatz | WEB-04, GAP-14 | 2 |
| P4 | Abo-Lebenszyklus | GAP-05, GAP-03, GAP-04 | 3 |
| P5 | Herkunfts-Achse der Tarifierung | ORIG-01, ORIG-02, ORIG-03 | 3 |
| P6 | Budget-Fenster und Gate-Fairness | GAP-01, GAP-07, GAP-10 | 3 |
| P7 | Boot-Kohaerenz und Blueprint | GAP-32, GAP-38, GAP-33 | 3 |
| P8 | Geo-Identitaet am Eintritt | LANG-02, FMT-11, FMT-28, E2E-01 | 4 |
| P9 | Web-Textoberflaechen | WEB-01, WEB-09, WEB-11, WEB-12 | 4 |
| P10 | Schreibpfad, Backfill, Weltdefault-Flip | WORLD-01, WORLD-03, DID-01, DID-02, DID-03, E2E-04, E2E-05 | 7 |
| P11 | Die gesprochene Sprache | PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-14, GAP-28, WEB-14, E2E-02, E2E-06 | 8 |
| P12 | MCP-Textkanal | PROMPT-09, FMT-03, MCP-04, MCP-06, MCP-08 | 5 |
| P13 | Widget und Kanarienvogel | MCP-09, UI-14, UI-18, MCP-12 | 4 |
| P14 | Rechtstexte | GAP-15 | 1 |

**Nachzaehlung:** 2 + 4 + 2 + 3 + 3 + 3 + 3 + 4 + 4 + 7 + 8 + 5 + 4 + 1 = **53**.

Gegenprobe gegen die Buendel der Klassifikation:

- **B1 (9):** WORLD-01 P10, WORLD-03 P10, DID-01 P10, DID-02 P10, DID-03 P10, LANG-02 P8,
  E2E-01 P8, E2E-04 P10, E2E-05 P10
- **B2 (9):** PROMPT-01 P11, PROMPT-02 P11, PROMPT-03 P11, PROMPT-14 P11, GAP-28 P11,
  GAP-14 P3, WEB-04 P3, E2E-02 P11, E2E-06 P11
- **B3 (9):** PROMPT-09 P12, FMT-03 P12, MCP-04 P12, MCP-06 P12, MCP-08 P12, MCP-09 P13,
  MCP-12 P13, UI-14 P13, UI-18 P13
- **B4 (7):** GAP-18 P2, GAP-21 P2, GAP-22 P2, GAP-25 P2, GAP-10 P6, FMT-11 P8, GAP-33 P7
- **B5 (9):** GAP-01 P6, GAP-03 P4, GAP-04 P4, GAP-05 P4, GAP-07 P6, GAP-32 P7, ORIG-01 P5,
  ORIG-02 P5, ORIG-03 P5
- **B6 (10):** WEB-01 P9, WEB-09 P9, WEB-11 P9, WEB-12 P9, WEB-14 P11, GAP-15 P14, GAP-35 P1,
  GAP-36 P1, GAP-38 P7, FMT-28 P8

9 + 9 + 9 + 7 + 9 + 10 = **53**. Keine ID doppelt, keine fehlt.

**Rot-Liste-Verlauf:** 53 -> 51 (P1) -> 47 (P2) -> 45 (P3) -> 42 (P4) -> 39 (P5) -> 36 (P6) ->
33 (P7) -> 29 (P8) -> 25 (P9) -> 18 (P10) -> 10 (P11) -> 5 (P12) -> 1 (P13) -> 0 (P14).

**Gesamtaufwand:** rund 33 bis 40 Arbeitstage reine Umsetzung, ohne Wartezeiten auf
Owner-Entscheidungen und ohne die externe Rechtstext-Lieferung.

---

## 7. Was ausdruecklich NICHT Teil ist

Diese Punkte sind **zurueckgestellt und das Risiko wird getragen** - sie sind nicht geloest, nicht
entschaerft und nicht erledigt. Wer diesen Plan vollstaendig umsetzt, hat sie unveraendert offen.

### GAP-02 - Umsatzsteuer, Registrierungen (Owner-Entscheidung 7.2)

Steuerberater-Frage, keine Codefrage. `createSubscriptionCheckoutSession` setzt weder
`automatic_tax` noch eine Adresserfassung.

**Restschaden im Ernstfall:** bei weltweitem Verkauf entstehen ab dem ersten Auslandsumsatz
Registrierungs- und Abfuehrungspflichten (EU-OSS, US-Sales-Tax je Bundesstaat, UK-VAT). Sundartha
schuldet die Steuer rueckwirkend inklusive Zinsen und Saeumniszuschlaegen; die Rechnungen an
Bestandskunden sind formal fehlerhaft und muessten korrigiert werden. Der Schaden waechst still mit
jedem Abo und ist genau dann am groessten, wenn das Produkt erfolgreich ist - er faellt heute nur
deshalb nicht auf, weil kaum Umsatz da ist.

### LAW-06 - Rechtsgrundlage fuer die Verarbeitung des Angerufenen (7.4)

**Restschaden:** der Angerufene ist eine betroffene Person ohne Einwilligung, sein Gespraech wird
transkribiert und gespeichert. Eine Beschwerde bei einer Aufsichtsbehoerde trifft nicht ein
Feature, sondern das Produktprinzip; im schlimmsten Fall eine Untersagungsverfuegung fuer den
Outbound-Betrieb im betroffenen Land.

### GAP-12 - Einwilligungs-/TCPA-Gate fuer US-Outbound (7.4)

**Restschaden:** das Land-Gate steht **live auf `*`**, die Gate-Kette enthaelt kein Consent-Glied.
TCPA sieht in den USA pauschalierten Schadenersatz je Anruf vor (Groessenordnung 500 bis 1500 USD),
sammelklagefaehig; PECR in UK und die kanadischen Robocall-Regeln greifen ab dem ersten Anruf. Ein
einziger Kunde, der Hermes fuer Kaltakquise in den USA benutzt, kann Forderungen ausloesen, die den
Jahresumsatz um Groessenordnungen uebersteigen - und Hermes hat heute keinen technischen Beleg,
dass er es nicht getan hat. **Das ist das groesste getragene Einzelrisiko dieses Plans.**

Die einzigen verbleibenden Schutzschichten sind der fest verdrahtete Offenlegungssatz (Absolute
Regel 2), die Denylist und die Beschraenkung auf verifizierte Subscriber. **Diese drei Schichten
duerfen in KEINER Phase dieses Plans angetastet werden** - P11 sichert die erste ausdruecklich ab.

### GAP-13 - DNC-/Robinsonlisten-Pruefung (7.4)

**Restschaden:** kein Glied der Gate-Kette erkennt eine gesperrte Nummer. Ein Anruf auf eine
DNC-gelistete Nummer ist in den USA und Kanada eigenstaendig bussgeldbewehrt, unabhaengig von der
Einwilligungsfrage - die Bussgelder addieren sich zu GAP-12, sie ersetzen es nicht.

### LAW-07 - Anrufzeitfenster in Zielortszeit (7.6, ausdruecklich ABGELEHNT)

Der Owner will Nutzer nicht in ihren Anrufzeiten beschraenken. Nur die **Anzeige** wird ueber
FMT-28 (P8) korrigiert.

**Restschaden:** Hermes ruft weltweit zu jeder Uhrzeit an; ein Nutzer in Berlin laesst mittags
einen Termin in Kalifornien vereinbaren und weckt den Angerufenen um 3 Uhr morgens. In den USA ist
das zusaetzlich TCPA-relevant (Fenster 8-21 Uhr Ortszeit) und verstaerkt GAP-12. Nachtanrufe eines
KI-Agenten sind ausserdem eine Geschichte, die sich von selbst verbreitet.

**Auflage fuer jeden kuenftigen Umbau:** das in P8 eingefuehrte `timezone`-Feld ist
**ausschliesslich Anzeige**. Ein Test muss belegen, dass kein Gate-Pfad es liest - sonst entsteht
dieses abgelehnte Gate versehentlich durch die Hintertuer.

### 7.5 - `en-US` als eigenes Locale-Bundle (Owner-Entscheidung 7.5, bereits gefallen - hier ohne Phase)

Die Owner-Entscheidung 7.5 ("`en-US` wird eigenes Locale-Bundle") ist gefallen, hat in diesem Plan
aber **keine Phase**. Am Code verifiziert: das `en`-Bundle traegt `sttLocale: 'en-GB'`,
`dateLocale: 'en-GB'` und ein `voiceProfile`, das in beiden Adaptern auf britische Stimmen mappt
(`telnyx/render.js:24` -> `Azure.en-GB-SoniaNeural`, `twilio/render.js:17` -> `Polly.Amy-Neural`,
beide mit `language: 'en-GB'`). Nach P10 (Flip) und nach DID-01 ("US -> en") bekommt damit jeder
US-Kunde britische Spracherkennung und eine britische Stimme.

**Restschaden:** US-Kunden - genau die Zielgruppe des Weltstarts - laufen bis auf Weiteres auf
en-GB-STT/TTS statt auf amerikanischem Englisch. Das ist zusaetzlich eine
Erkennungsqualitaets-Achse (britisches STT gegen amerikanisches Englisch), nicht nur eine
Geschmacksfrage bei der Stimme.

**Auflage fuer jeden kuenftigen Umbau:** eine eigene, kleine Phase "en-US-Bundle" (Bundle-Eintrag +
Land-zu-Sprache-Mapping fuer US + eigenes `voiceProfile` in beiden Adaptern) ist der naheliegende
naechste Schritt nach P10, ist aber **nicht** Teil dieses Plans und braucht eine eigene Freigabe.
Bis dahin gilt: 7.5 ist entschieden, aber nicht umgesetzt - das steht hier bewusst sichtbar, statt
unsichtbar zu bleiben.

### `test/voice-status-lifecycle.test.js:137` - kein Befund

Voll-Last-Flake, isoliert gruen, bekannter Seed-vor-Boot-Race. Keine Katalog-ID. Gehoert in die
Suite-Trennung (Aufgabe 1), nicht in diesen Fix-Vorrat.

**Restschaden:** wird er nicht als Flake markiert, verwaessert er das Gate-Protokoll. Es bleibt
dabei: **rot ist nur echt rot, wenn der Test isoliert rot ist.**

### Track B - Infra-/URL-Cutover (`vodafone-agent` -> Hermes/Sundartha)

Kein Katalog-Befund, laut `CLAUDE.md` nicht Teil normaler Tasks. Ebenso der Single-Origin-Cutover.

**Restschaden:** Repo-Verzeichnis, Render-Service und einige Env-/Pfadnamen tragen weiter den alten
Namen; Deploy-Wege bleiben verwirrend (`git push origin` macht nichts live). Genau die Fehlerklasse,
gegen die P1 den `/healthz`-Fingerabdruck einfuehrt.

---

## 8. Offene Punkte und Unsicherheiten

Hier steht, wo die Datenlage duenn ist. Nichts davon wird in diesem Plan als geklaert behandelt.

| # | Unsicherheit | Warum sie zaehlt | Aufloesung |
| --- | --- | --- | --- |
| U1 | **DB-Realzustand fuer den Sprach-Backfill.** Ob Bestandsdatensaetze tatsaechlich NULL in `tenant.default_language` / `number.language` tragen, ist **nicht** gegen die echte DB geprueft - belegt ist nur das additiv-nullable Schema. | Traegt das **gesamte** Migrationsrisiko-Argument von P10. Ist die Zahl 0, entfaellt Schritt 2 der Phase. Ist sie hoch, ist sie der teuerste Einzelposten des Plans. | psql-Zaehlabfrage gegen `hermes-db`, erhoben in P8, Freigabekriterium in P10. **Force-RLS beachten** - ohne gesetzte Rolle liefert ein naives `SELECT` 0 Zeilen und luegt. |
| U2 | **`render.yaml` != Live.** Der Live-Service ist Dashboard-managed. Zwei Divergenzen sind belegt (`ALLOWED_COUNTRY_CODES` live `*`, `MAX_BUDGET_EUR` live `30`); fuer weitere Achsen ist der Live-Wert schlicht unbekannt (`test/prod-env.js` `LIVE_UNMEASURED`). | Jede Einstufung, die `render.yaml`-Werte als Live-Werte nimmt, ist unsicher - die Klassifikation markiert das bei GAP-01 und GAP-32 selbst als offene Annahme. P7 kann den Dienst toeten, wenn die Annahme falsch ist. | O1 (Ablesung im Dashboard), Eintrag in `LIVE_MEASURED`, plus der `configHash` aus P1 als dauerhafte Antwort. |
| U3 | **`BUDGET_MONTH_ENABLED` ist strittig.** Das Projektgedaechtnis notiert das Flag seit 2026-07-25 als live AN; der GAP-33-Bericht fuehrt dieselbe Achse als nicht belegt. Genau eine der beiden Aussagen ist falsch. | Steht das Flag AN, faellt `brennt_heute` von GAP-01 weg - die Notwendigkeit des Codefixes bleibt (der Test verlangt genau den `false`-Pfad), nur die Dringlichkeit von P6 sinkt. | **Ablesefrage O1**, keine Codefrage. Danach in den Boot-Banner (P1), damit sie nie wieder eine DB-Messung erfordert. |
| U4 | **Welcher Gespraechspfad ist im Live-Call aktiv?** Budget-Engine (`src/claude.js`) oder Telnyx-Assistant. Das Assistant-Flag stand zuletzt live an. | Ein Fix an `claude.js` wirkt **nicht** automatisch auf beiden Pfaden. Betrifft P3 (Pflichtsatz-Auslieferung) und P11 (Prompts). Wird sie uebersprungen, ist die Suite gruen und der echte Anruf unveraendert. | Feststellen **vor** P3, erneut bestaetigen vor P11. Antwort gehoert in den Phasenkopf. Siehe auch A5 (Provisioner-Falle). |
| U5 | **GAP-33 Teil (a): der vermutete 402.** Der tatsaechliche Statuscode eines Auslands-Calls unter Live-Env wurde nie durch einen Testlauf verifiziert. | Ein Teil der GAP-33-Begruendung stuetzt sich auf eine Vermutung. Der Fix bleibt richtig, der **Beleg** fehlt. | Probe-Anruf nach P7 Deploy 7a. Bis dahin: getragen und als Vermutung benannt. |
| U6 | **GAP-14 Pflicht-Wortlaut.** Ob ein exakter Marker-Wortlaut bereits Owner-Entscheidung ist oder Platzhalter des Testautors, wurde nicht geklaert. | Blockiert P3. | O7. |
| U7 | **GAP-28 Zielrichtung.** Ob die vier Kontroll-Marker uebersetzt, neutralisiert oder aus der Modell-Kette entfernt werden, ist offen. | Betrifft die Gespraechsqualitaet, nicht die Korrektheit. | Entscheidet der `convo-bench` in P11, nicht die Suite. Empfehlung des Plans: neutralisieren. |
| U8 | **MCP-08 Einordnung.** Setzt voraus, dass 7.1 auf `paymentCurrency=usd` anwendbar sein soll; denkbar ist auch die komplette Abschaffung des usd-Zweigs. | Entscheidet, ob MCP-08 ein Fix oder eine Testloeschung ist. | O12, **vor** P12. |
| U9 | **WEB-01 Umsetzungstiefe.** Ob ein `document.documentElement.lang`-Write reicht oder ein echter Textmechanismus noetig ist - als "Umbau" eingestuft, aber nicht sicher. | Kann P9 unbemerkt aufblaehen. | In P9 gegen den Test pruefen; verlangt er mehr, wird die Phase gestoppt und der Umfang neu bewertet, nicht heimlich vergroessert. |
| U10 | **GAP-38 Kollision mit der Owner-Removal-Entscheidung.** Ob eine In-Prozess-Bootstrap-Heilung mit dem entfernten Owner-Konzept (Admin ueber `account.role`) kollidiert, wurde nicht gegengeprueft. | Betrifft P7. | Vor dem Bau von GAP-38 gegenpruefen. |
| U11 | **Kostenfolgen von `METRICS_ENABLED=true`.** Ob das Aktivieren produktrelevante Log-Last erzeugt, ist ungeklaert. | Betrifft P1. | Getragen; nach einer Woche am Render-Log-Volumen nachmessen. |
| U12 | **FMT-28 Aufwandsrealismus.** Ob "mehrere Tage" traegt oder eine schlankere Variante (NULL-faehiges Feld ohne Ableitungslogik) reicht, wurde nicht gegen die Postgres-Migrationsmechanik dieses Repos geprueft. | Betrifft die Aufwandsschaetzung von P8. | Beim Bau messen; die Phase hat Puffer. |
| U13 | **Die ORIG-Kette als Vorbedingung von P7 gilt nur fuer den empfohlenen Hebel.** Waehlt der Owner in O6 "Max-Dauer senken", waere P7 auch ohne die Herkunfts-Achse loesbar gewesen. | Die ORIG-Kette bleibt fachlich richtig und brennt heute - aber die Behauptung "P5 ist Vorbedingung von P7" waere dann fuer diese Phase falsch. | Ehrlich benannt, nicht wegargumentiert. Aendert die Reihenfolge nicht, weil ORIG-02/03 unabhaengig davon Platz 1 und 2 der `brennt_heute`-Liste sind. |
| U14 | **`npm run test:gates` existiert noch nicht.** Die Lauf-Trennung wird parallel gebaut (Aufgabe 1); `package.json` kennt heute nur `test`. | Die gesamte Abnahme-Mechanik dieses Plans setzt sie voraus. | Vorbedingung fuer P1. Ist sie nicht fertig, verschiebt sich der Start - der Plan wird nicht ohne sie gefahren. |

### Bekannte Schwaeche dieses Schnitts

Zwei Dinge, die dieser Plan nicht loest und die man wissen sollte, bevor man ihn startet:

1. **Der Weltstart kommt spaet.** Die Sprachkette beginnt erst mit P8, also nach sieben Phasen und
   rund zwei bis drei Wochen. Wer eine harte Startterminvorgabe hat, wird versucht sein, in der
   Mitte abzubrechen - dann hat er die teuren Geld-Umbauten bezahlt und die Sprache trotzdem nicht.
   Der Plan ist bewusst so geschnitten, weil die Sprachkette echte, teilweise ungemessene
   Vorbedingungen hat (U1) und die Geld-Ketten nicht.
2. **P11 ist mit 8 IDs die groesste Phase und verletzt das eigene Granularitaets-Kriterium.** Das
   ist eine bewusste Ausnahme mit inhaltlicher Begruendung (halb uebersetzt ist schlechter als gar
   nicht), aber der Preis ist real: ein Bench-Regress oder ein schlechter String rollt acht Befunde
   gleichzeitig zurueck.

Und die ehrlichste Einschraenkung ueber allem: dieser Plan macht Hermes weltstartfaehig, korrekt
abgerechnet und compliance-naeher. Er macht ihn **nicht nuetzlicher**. Die in
`PLAN-I18N-TESTS.md` und im Projektgedaechtnis dokumentierte Todesursache dieses Produkts ist nicht
die Sprache und nicht die Qualitaet, sondern fehlender Nutzen - `book_appointment` ohne
Kalenderanbindung, null echte Auftraege. Kein Befund in diesem Vorrat adressiert das.
