# Abschlussbericht: PLAN-LIVE-COST-TRACING (Schlussrunde)

Stand: 2026-07-20. Quelle: `PLAN-LIVE-COST-TRACING.md` (2307 Zeilen). Diese Fassung ersetzt
den Vorbericht vollstaendig (der Vorbericht war auf dem Stand "NICHT FERTIG" nach der
gemischten Runde 4 — inzwischen sind vier weitere Befunde gefunden, gefixt und in einer
Schlussrunde von drei unabhaengigen Reviews mit PASS abgenommen worden).

**Status: FERTIG als Arbeitsgrundlage.** Alle vier in der Schlussrunde gepruefte Befunde
(N1, N2, N3, Waehrungsmischung an `VOICE_TARIFF_FULL_COST_FLOOR_CENTS`) sind von allen drei
Reviewern unabhaengig als behoben abgenommen, gegen den Dokumenttext UND gegen den
tatsaechlichen Code (nicht nur gegen die Selbstauskunft des Fix-Agenten). Kein neuer S1 in
dieser Runde gemeldet.

---

## 1. Was entstanden ist (fuenf Zeilen)

`PLAN-LIVE-COST-TRACING.md` ist ein eigenstaendiger Umbau-Plan (10 Kapitel + Anhang: Lage,
Messung, Befunde, Begriffsmodell, "P0 bewusst leer", Phasen, Reihenfolge/Schutzniveau, offene
Owner-Entscheidungen, Pre-Mortem, explizit Ausgeschlossenes), 2307 Zeilen. Er spezifiziert
**9 Phasen** (P1, P2, P3, P4, P4b, P5, P6, P7, P8), davon P4b entgegen der urspruenglichen
Annahme NICHT code-frei, sondern mit eigenem Boot-Guard. Ziel: Anrufkosten werden heute
ausschliesslich als `minuten * konfigurierter_tarif` gebucht, nie gegen einen echten
Provider-Preis geprueft — der Plan fuehrt einen Ist-Kosten-Abgleich gegen Telnyx-
`detail_records` ein und macht die gebuchte Zahl schrittweise zu einer Messung. Der Plan hat
inzwischen sechs Review-Runden durchlaufen (drei im ersten Lauf, zwei im zweiten, eine
Schlussrunde) und liegt mit PASS vor.

---

## 2. Neu gemessene Fakten (bleibender Wert, unabhaengig vom Plan)

Quelle: Telnyx Usage Reports (`GET /v2/usage_reports`, Fenster 2026-06-19 bis 2026-07-20,
max. 31 Tage), ElevenLabs `GET /v1/user/subscription` (read-only), Prod-DB. Alle Werte sind
im Dokument konsequent gegen den Umrechnungskurs `PROVIDER_TO_BUCKET_RATE_MICRO` (0,92
EUR/USD) markiert — wo Kapitel 2 in USD-Cent misst und andere Kapitel in EUR-Cent rechnen,
steht der Kurs jeweils dabei.

- **Telefonie** (`sip-trunking` + `call-control`): 3,9 USD-ct/min. Zum Kurs 0,92 = 3,59
  EUR-ct/min; der bisherige Tarif (20 EUR-ct) lag damit um **Faktor 5,6** daneben, nicht
  Faktor 2,1 oder 5,1 wie in fruehen Notizen.
- **Speech-to-Text** (Deepgram im Gather): 0,6 ct/min — wird heute NICHT gebucht.
- **Text-to-Speech** (Telnyx): 0,6 ct/min — wird heute NICHT gebucht.
- **Recording + Inference**: 0,05 ct/min zusammen — wird heute NICHT gebucht.
- **Claude-Tokens**: 0,27 ct/min — wird bereits exakt gebucht (Mikro-Cent, `llm-usage.js`).
- **Variable Kosten gesamt (Budget-Engine, laufender Betrieb)**: 5,4 USD-ct/min = 4,968
  EUR-ct/min.
- **`ai-voice-assistant`** (eigenstaendige Provider-Produktposition, nur bei aktivem
  Telnyx-Assistant-Pfad, heute inaktiv): additiv ca. +5,0 USD-ct/min. Im Messfenster 0,95
  USD ueber 17 Calls / 19 Minuten, exakt 0,05 USD je angefangener Minute. Wuerde aktiviert
  die variablen Kosten fast verdoppeln (5,4 -> 10,4 USD-ct/min).
- **ElevenLabs**: 6,00 USD/Monat Fixpreis, belegt. Tarif "starter", Kontingent 39.981
  Zeichen/Monat, Verbrauch im Messfenster 2.805 Zeichen (7,0 %), Reset-Anker 2026-08-03
  (NICHT der Kalendermonat).
- **DID-Miete** (Aussage am 2026-07-20 nach Owner-Einspruch nachgemessen und
  **korrigiert** — die erste Fassung "nicht messbar" war zu stark): der
  **Rechnungsposten** ist per API nicht abrufbar, der **Listenpreis** sehr wohl.
  Ohne Kostendaten: `usage_reports/options` (kein Nummern-/Rent-Produkt),
  `GET /v2/phone_numbers` (nur `billing_group_id`), `GET /v2/number_orders`,
  `GET /v2/billing_groups` (leer); `ledger`, `account_transactions`, `monthly_charges`
  liefern 404. **Mit Kostendaten:
  `GET /v2/available_phone_numbers?filter[country_code]=US` ->
  `cost_information: { monthly_cost "1.00000", upfront_cost "1.00000", currency USD }`.**
  Bei 3 aktiven US-Local-Nummern also 3,00 USD/Monat Listenpreis; da pro Tenant strikt
  eine Nummer gilt, ist die Miete **pro Tenant zurechenbar**. Sie bleibt trotzdem aus
  `costCents` heraus — nicht mangels Messbarkeit, sondern weil eine feste Monatsgebuehr
  im Verbrauchszaehler 92 von 300 Cent der Starter-Decke frisst, bevor der erste Anruf
  laeuft, und das Abo die Nummer bereits deckt (Entscheidung 6).
- **Tenant-Decken im Code**: entgegen der Annahme "3 / 9 EUR" steht im Code ein flacher
  600-Cent-Default fuer ALLE Tenants, gesetzt vor jeder Plan-Wahl (`config.js:387`).
- **Plattform-Cap-Kollision**: `MAX_BUDGET_EUR=8` (800 ct) traegt einen einzelnen
  Business-Kunden (120 Inklusivminuten = 596 EUR-Cent Vollkosten zum Kurs 0,92, NICHT 648 —
  das waere der unmarkierte Kurs 1,0) nur knapp und keinen zweiten daneben. Jede diskutierte
  Business-Decke (900 wie 1080 ct) liegt ueber dem heutigen Plattform-Cap.
- **Vollkostenschwelle fuer P4b, in dieser Runde korrigiert**: die aktivierbare
  Maximalkonfiguration (Budget-Engine + `ai-voice-assistant`) kostet 10,4 USD-ct/min; zum
  Kurs 0,92 = 9,568, aufgerundet **10 EUR-Cent** — nicht 11, wie eine Zwischenfassung
  unmarkiert (Kurs 1,0) auswies.
- Widerlegt: Provider-Webhook traegt keine Kostendaten; `usage_reports` reicht nicht fuer
  Einzel-Call-Abrechnung; "83 Zeichen/Minute" ist keine gemessene Groesse.

---

## 3. Wo der Entwurf bewusst vom urspruenglichen Auftrag abweicht

- **Kein sofortiges Senken des Tarifs (P0 bleibt leer, Kapitel 5).** `tariffCentsPerMin`
  speist heute zwei Verbraucher — Reserve UND Buchung. Eine sofortige ENV-Senkung wuerde
  beide gleichzeitig senken und damit den Verbrauchszaehler verlangsamen, bevor irgendjemand
  weiss, was der Anruf wirklich gekostet hat — dieselbe Bewegung wie der urspruengliche
  Vorfall, nur mit umgekehrtem Vorzeichen. Die Senkung wandert auf **P4b**, NACH dem Punkt,
  an dem die Buchung ueberwiegend nicht mehr am Tarif haengt, mit zwei harten Vorbedingungen
  (Tarif deckt die teuerste AKTIVIERBARE Konfiguration inkl. `ai-voice-assistant`; gemessene
  Abgleich-Deckungsquote >= 80 %) statt einer unbedingten Senkung.
- **Keine rollende Selbstkalibrierung (Stufe 2 des Auftrags).** Statt eines sich selbst
  nachjustierenden Tarifs baut der Plan nur einen messenden Waechter (P5: WARN + Alarm mit
  Laufzeit-Ausloeser, keine automatische Anpassung). Begruendung: ein selbstjustierender Wert
  auf dem Geld-Pfad wuerde die im Pre-Mortem (PM-2) beschriebene Rueckkopplung einbauen —
  der Satz wird aus Anrufen gespeist, die das Gate selbst durchgelassen hat. Owner-
  Entscheidung offen (Frage 3), Empfehlung: nicht bauen.
- **DID-Miete als Fixkost, nicht als Gate-Groesse.** Da der Betrag nicht messbar ist
  (Abschnitt 2), fliesst er nur als vom Owner gepflegter Anzeigewert in P7 — bewusst NICHT in
  ein Budget-Gate, weil er dort Praezision vortaeuschen wuerde, die nicht existiert.
- **Reihenfolge P5 vor P4**, mit eigenem Laufzeit-Ausloeser (nicht nur Boot-Zeitpunkt) — P4
  benennt den Drift-Alarm selbst als Gegenmassnahme und braucht ihn deshalb vorher scharf,
  auch waehrend eines laufenden Prozesses ohne Neustart.
- **P6 (Tenant-Decken) und P7 (Fixkosten) haben laut Dokument KEINE Code-Abhaengigkeit** zur
  Kern-Kette — beide sind parallel startbar, haengen aber an Owner-Entscheidungen (P6 an
  Frage 2 UND der blockierenden Frage 8).
- **Twilio bekommt keine Ist-Kosten-Implementierung.** Twilios `price`-Feld deckt laut
  Provider-Doku nur Connectivity, nicht AMD/TTS/SIP-REFER. Live laeuft ohnehin Telnyx.
- **Kein Backfill der Ist-Kosten fuer Bestands-Calls.** Bestandszeilen ohne persistierten
  `estimatedCostCents` bleiben dauerhaft `'incomplete'`. Kein neuer DB-Index (D10 bleibt
  offen, als solcher gefuehrt, kein toter Code fuer einen Aufrufer, der noch nicht existiert).

---

## 4. Owner-Entscheidungen (Kapitel 8) — alle acht getroffen am 2026-07-20

Kapitel 8 ist damit kein Fragen-, sondern ein Entscheidungs-Kapitel. Die verworfenen
Optionen bleiben dort knapp erhalten, damit nachvollziehbar ist, wogegen entschieden wurde.

1. **Bis P4, Flip sofort** — statt der empfohlenen vier Wochen Beobachtung. Der Owner hat
   das Kalenderfenster gestrichen; an seine Stelle tritt eine gemessene
   Mindest-Deckungsquote (`COST_TRUING_MIN_COVERAGE_PERCENT`), die auch nach wenigen Tagen
   erreicht sein kann. **Gegen die Empfehlung** — im Dokument ausdruecklich so vermerkt,
   inklusive der aufgegebenen Sicherheit. Die Quote traegt seither allein, was vorher
   Quote UND Zeitfenster trugen; deshalb wurde sie in P3 verdrahtet (Berechnung, Meldung
   je Sweep, Terminierungsregel `COST_TRUING_COVERAGE_STALL_SWEEPS`) und in P4 mit einem
   WARN-Boot-Guard durchgesetzt.
2. **Tenant-Decken 300 / 900 Cent.** `planCapHeadroom` damit **5/3 und 5/4** — bewusst als
   ganzzahliger Bruch, weil `30 * 6 * 1,6667 = 300,006` waere. Gegenprobe geht exakt auf;
   die Tests pinnen das PRODUKT, nicht den Faktor.
3. **Keine rollende Selbstkalibrierung.** Nur der messende Waechter P5; das Nachziehen des
   Tarifs bleibt Owner-Handarbeit auf Basis der Waechter-Zahlen.
4. **Das dynamische Plattform-Cap ("P7b") wird in PLAN-BUDGET-AXES gebaut**, nach P6 dieses
   Plans. Der Owner will den Deckel ausdruecklich dynamisch (Summe der aktiven
   Tenant-Decken) — ein fester Deckel skaliert nicht mit wachsender Nutzerzahl. Nur der
   Bauort ist der andere Plan.
5. **Der Telnyx-Assistant-Pfad wird ganz verworfen** — nicht nur ausgeschaltet.
   **Gegen die Empfehlung**, aber in die sichere Richtung. Folge: die Vollkostenschwelle
   `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` darf erst von **10 auf 5 EUR-Cent** sinken, wenn
   der Pfad tatsaechlich aus dem Code entfernt ist — Ausloeser ist der gemergte Rueckbau,
   nicht die Absicht. Der Rueckbau selbst ist Folgearbeit ausserhalb dieses Plans
   (`src/telephony/adapters/telnyx/voice.js`, `config.js` `telnyxAssistant`).
6. **DID-Miete in die Anzeige, nie in ein Gate.** `NUMBER_MONTHLY_COST_CENTS` Default 92
   EUR-Cent, Quelle ist der belegte Listenpreis (s. Abschnitt 2), gepflegter Konfigwert
   statt Live-Abruf.
7. **Der Owner pflegt den USD/EUR-Kurs quartalsweise von Hand.** Kein automatischer Abruf
   (waere ein zweiter beweglicher Wert auf dem Geld-Pfad), kein 1:1-Kurs. Der Boot-Guard
   aus P2 bleibt die Sicherung gegen grobe Abweichungen.
8. **`MAX_BUDGET_EUR` wird angehoben, BEVOR P6 ausgeliefert wird** — Groessenordnung: Summe
   der aktiven Tenant-Decken plus Reserve. Die Anhebung selbst gehoert in
   PLAN-BUDGET-AXES (konsistent mit Entscheidung 4), ist aber harte Vorbedingung fuer P6.
   Bleibt sie aus, scheitert der Boot laut ueber `spendCapCoherence` — nicht der
   Zahlungspfad.

**Achtung, Bauort-Hinweis:** `PLAN-BUDGET-AXES.md` wurde am 2026-07-20 mit Commit
`a0431fa` aus dem Arbeitsbaum entfernt und liegt nur noch in der Historie
(`git show a0431fa~1:PLAN-BUDGET-AXES.md`). Die Entscheidungen 4 und 8 delegieren Arbeit
dorthin — die Kette ist entgegen der Commit-Nachricht nicht abgeschlossen (P7b und die
`MAX_BUDGET_EUR`-Anhebung sind offen). Das Plandokument traegt diesen Hinweis an vier
Stellen.

Zusaetzlich (Kapitel 7): Koordination mit PLAN-BUDGET-AXES ist geregelt — P4 dieses Plans und
der Monatsachsen-Flip von PLAN-BUDGET-AXES P7 duerfen nicht im selben Deploy live gehen;
Reihenfolge-Empfehlung: erst Monatsachse, dann Ist-Kosten.

---

## 5. Review-Bilanz ueber alle Runden

**Erster Lauf — Runde 1-3 (3 parallele Reviews in Runde 3):** alle drei FAIL, **9 benannte
Blocker (3x S1, 6x S2)**: P4bs Schutzzusage war am Code widerlegt (B1), Tarif-Praefixe wurden
unbelegt breit angewandt (B2), P6s Schreibkante konnte `budget_cents` NULL lassen und die
ganze Flush-Transaktion reissen (B3), Kurs-Boot-Guard war zu frueh unkonditional FATAL (B4),
Drift-Alarm hatte keinen Laufzeit-Ausloeser (B5), Waehrungs-Umrechnung nutzte Float vor der
einzigen deklarierten Rundung (B6), Boot-Guard-Eigentum war zwischen P3/P4 doppelt zugeordnet
(Clean-Code B1), Kurs-Band-Grenzen waren unbenannte Literale (Clean-Code B2), USD/EUR wurden
an drei Stellen unmarkiert vermischt (K1). Alle 9 sind in einer Fix-Runde bearbeitet und von
allen drei Reviewern der Folgerunde unabhaengig als behoben bestaetigt. **Transparenzhinweis:**
die einzige verfuegbare Quelle fuer diese Liste (der Vorbericht dieser Session-Kette) fuehrt
die 3-S1/6-S2-Aufteilung nur als Aggregatzahl, nicht mit Tag pro Einzelbefund — welche drei
der neun konkret als S1 gefuehrt wurden, ist aus den in diesem Repo erreichbaren Quellen nicht
mehr rekonstruierbar. Inhaltlich am eindeutigsten S1-artig ist B3 (NULL-Wert reisst eine
Buchungs-Transaktion — Geld-/Datenverlust auf dem Schreibpfad); B1 (falsche Schutzzusage) und
K1 (unmarkierte Waehrungsvermischung) sind nach Beschreibung ebenfalls plausible Kandidaten,
aber ohne verifizierte Einzel-Kennzeichnung wird das hier als Vermutung markiert, nicht als
Fakt behauptet.

**Zweiter Lauf — Runde 4 und 5:** Runde 4 (3 parallele Reviews nach der Runde-3-Fix-Runde) fiel
gemischt aus: zwei PASS, eine FAIL mit einem neuen **S1: N1** — P6 Kern Punkt 1 schrieb einen
**Wurf an der Schreibkante** `setTenantSubscription` vor, sobald eine abgeleitete Tenant-Decke
`>= platformSpendCapCents` lag. Mit der damaligen Konfiguration (`MAX_BUDGET_EUR=8` gegen
Business-Decken von 900/1080 ct) traf das auf **jeden** Business-Abschluss zu.
`setTenantSubscription` wird u.a. aus `billing/webhook.js:213` **vor** Karten-Bindung und
Nummern-Provisioning gerufen ("Race-Fix Abo-ohne-Nummer") — ein Wurf dort haette Anker, Karte
und Nummer verschluckt. Der als Gegenmittel vorgesehene Boot-Guard deckte das nicht: er pruefte
laut eigenem Wortlaut nur bereits **gesetzte** `tenant_budget`-Zeilen, nach einem frischen
Deploy existiert keine, der Boot liefe durch, und der erste zahlende Kunde loeste den Wurf aus.
Die eigene Direktpruefung dieser Session-Kette bestaetigte die FAIL-Lesart gegen die zwei PASS.
Zwei weitere S2 fielen in derselben Runde: unklar, ob der Mikro-Cent-Rest
(`costCorrectionMicroCentsRem`) bei verworfenen Korrekturen sauber mitfortgeschrieben wird
(N2), und die Kap.-7-Tabelle behauptete, P4bs Boot-Guard halte "beide Vorbedingungen" nach,
obwohl er nachweislich nur in der Konjunktion feuert (N3). Eine der PASS-Reviews fand
zusaetzlich einen eigenen S2: `VOICE_TARIFF_FULL_COST_FLOOR_CENTS=11` rundete die
USD-Cent-Messgroesse direkt auf eine EUR-Cent-Schwelle, ohne den sonst konsequent angewandten
Kurs 0,92. Diese vier Befunde (N1, N2, N3, P4B-WAEHRUNGSMISCHUNG-VOLLKOSTENSCHWELLE) wurden zum
verbindlichen Blocker-Katalog fuer die Schlussrunde konsolidiert.

**Schlussrunde (diese Session):** Fix-Agent hat alle vier Befunde bearbeitet. N1 strukturell
neu entworfen — der Wurf beim Setzen ist zurueckgenommen, ersetzt durch zwei Linien: (1) ein
**fataler** Boot-Guard (`spendCapCoherence`), der die abgeleiteten Decken ALLER Slugs aus
`plans.js` gegen `platformSpendCapCents` prueft, auch ohne jede gesetzte `tenant_budget`-Zeile
— greift also bereits beim allerersten Boot nach dem P6-Deploy; (2) an der Schreibkante nur
noch Clamp auf den Cap plus WARN, kein Wurf mehr. Der verbleibende Wurf ist ausdruecklich auf
"Slug gesetzt, aber unbekannt" begrenzt. N2: die Alles-oder-nichts-Regel fuer den
Rundungs-Uebertrag ist in einem eigenen Absatz verbindlich festgehalten (Muster
`discardCorruptWrite`), mit passendem Akzeptanz-Testfall. N3: Kern Punkt 3 und die
Kap.-7-Tabelle sprechen jetzt von der "gefaehrlichen Kombination" statt "beide Vorbedingungen"
und benennen die verbleibende Luecke (Vorbedingung 1 bei hoher Deckungsquote unueberwacht)
ausdruecklich statt sie zu verdecken. Waehrungsmischung: Schwelle korrekt auf 10,4 USD-ct/min *
0,92 = 9,568, aufgerundet 10 EUR-Cent gesetzt, an allen vier betroffenen Stellen, ohne
zusaetzliche unbezifferte Sicherheitsmarge (begruendet: die Aufrundung selbst ist bereits die
Marge). Drei unabhaengige Reviews haben alle vier Fixe **gegen den tatsaechlichen Code**
nachgeprueft (u.a. `plans.js:53` CATALOG_SLUGS, `boot-guard.js` TENANT_DEFAULT_INERT-Vorbild
mit `fatal:true`, `webhook.js:213`/`subscribe.js:111/175/193` als Aufrufer von
`setTenantSubscription`, `state-ops.js:1435` `discardCorruptWrite`) und alle drei kommen
unabhaengig zu **PASS**, keine meldet einen neuen S1. Eine Review haelt zwei Randnotizen fest
(kein Blocker): der Clamp auf `platformSpendCapCents` ist selbst bereits "inert" nach der Logik
des Bestands-Guards, gibt aber nichts preis, was nicht ohnehin die Plattform-Achse binden
wuerde; und `planSlugOf` im Webhook validiert den Stripe-Metadata-Slug nicht gegen den Katalog
(anders als `subscribe.js`) — ein vorbestehendes, nicht in dieser Runde eingefuehrtes Risiko,
fuer eine spaetere Runde vorgemerkt.

**Ueber alle sechs Runden zusammen:** 6 Review-Durchgaenge (3 + 3 parallele Einzelreviews im
ersten Lauf plus 3 in Runde 4 plus 3 in der Schlussrunde = 9 Einzelreviews auf 3 Runden mit
Konsolidierung dazwischen), 13 benannte Einzelbefunde ueber den ganzen Prozess (9 aus Runde 3,
4 aus Runde 4/5), alle nachweislich behoben. Kein einziger Fix wurde ungeprueft uebernommen —
jede Runde hat mindestens einen Reviewer, der gegen den Code nachgemessen hat, nicht nur gegen
den Dokumenttext. Keine Secrets, Kunden-IDs, Rufnummern, E-Mails oder Stripe-IDs in Dokument
oder Reviews gefunden.

---

## 6. Schlussaussage

**Ja, das Dokument ist als Arbeitsgrundlage fertig — und seit dem 2026-07-20 auch
entschieden.** Alle in der Schlussrunde geprueften Befunde sind von drei unabhaengigen
Reviews gegen Dokument UND Code bestaetigt behoben, keine Review meldet einen neuen S1, und
die Messgrundlage (Kapitel 2) ist eigenstaendig belegt und bleibt auch unabhaengig vom
weiteren Schicksal des Plans nuetzlich.

Die acht Owner-Entscheidungen sind getroffen und in die Phasen eingearbeitet (Abschnitt 4);
eine anschliessende Zahlen-Konsistenz-Pruefung ueber das ganze Dokument endete ohne Befund,
eine Safety-Pruefung fand zwei S2 (die allein tragende Deckungsquote war weder gerechnet
noch durchgesetzt noch sichtbar; die Delegation an ein aus dem Arbeitsbaum entferntes
Dokument war nicht als solche kenntlich) — beide behoben.

**Was jetzt noch beim Owner liegt, ist keine Entscheidung mehr, sondern eine Handlung:**
`MAX_BUDGET_EUR` anheben, bevor P6 ausgeliefert wird (Entscheidung 8). Das ist die einzige
echte Blockade in der Kette, und sie liegt ausserhalb dieses Plans.

**Naechster Schritt:** P1 kann sofort starten — schema-frei, keine DB-Abhaengigkeit, kein
Aufrufer, kein Gate beruehrt. P2 braucht zusaetzlich die `hermes-db`-Frist (2026-07-24) im
Blick. Der Rueckbau des Telnyx-Assistant-Pfads (Entscheidung 5) ist eine unabhaengige
Folgearbeit und blockiert nichts, senkt aber nach dem Merge die Vollkostenschwelle von
10 auf 5 EUR-Cent.
