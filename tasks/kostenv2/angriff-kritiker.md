# Angriff: Verifikations-Kritiker

Stand 2026-08-30. Einzige Frage an beide Entwuerfe: **worauf stuetzt sich das hier
eigentlich?** Geprueft wurde satzweise gegen den echten Code (nur lesend), nicht gegen die
Befund-Dokumente — ein Entwurf, der eine Befund-Datei korrekt zitiert, die ihrerseits
falsch liegt, ist trotzdem falsch.

Kennzeichnung: **BELEGT** = ich habe die Stelle selbst gelesen und nenne Datei:Zeile.
**BEHAUPTET** = tragende Aussage ohne nachpruefbare Quelle, oder Quelle vorhanden aber
Aussage geht darueber hinaus. **WIDERLEGT** = am Code das Gegenteil belegt.

---

## Teil 1 — Stichproben am echten Code (14 Stueck, beide Entwuerfe)

Auftrag verlangte mindestens 6. Ergebnis vorweg, weil es das Urteil traegt:
**KEIN Entwurf erfindet eine Funktion, eine Datei oder ein Feld.** Jede stichprobenartig
gepruefte Bezeichnung existiert. Die Zeilennummern liegen durchweg im Bereich +/- 2. Das
ist ein ungewoehnlich sauberer Befund und er soll ausdruecklich gesagt sein, bevor die
Kritik kommt.

| # | Zitat (Entwurf) | Befund | Bewertung |
|---|---|---|---|
| S1 | A+B: `providerLegIdOf`, `cost-truing.js:138` | exakt: `const providerLegIdOf = (call) => call.twilioSid \|\| call.callControlId \|\| null;` | BELEGT |
| S2 | A: `applyCostCorrectionCents` verwirft negatives Delta ohne `dataComplete`, `state-ops.js:3798/3813` | exakt, inkl. Kommentar "verworfen wird VOR jeder Mutation" | BELEGT |
| S3 | A+B: `persistProviderResult` `outbound.js:1283`, `recordSipCallId` `:1312` | exakt; die Funktion liegt bei :1283, `store.recordSipCallId` bei :1312 | BELEGT |
| S4 | B: `meldeBetreiberAlarm`, `outage-report.js:111` | exakt, Signatur `{store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs}` | BELEGT |
| S5 | B: `flushableMeterEvents` "(`meter.js:65`)" | Funktion liegt in `state-ops.js:4241`, nach `meter.js` nur importiert (`meter.js:15`), Aufruf bei `:67` | BELEGT mit falscher Ortsangabe |
| S6 | B: Boden-Waechter `voiceTariffFloorFindings`, `boot-guard.js:249` | existiert bei :249 — feuert aber nur bei `belowFloor && thinCoverage` (:252) | BELEGT, Aussage unvollstaendig |
| S7 | A: `actualCostMicroCentsForMonth`, `state-ops.js:4544` | existiert — filtert `c.provider === PROVIDER.TELNYX` | BELEGT, Folge uebersehen |
| S8 | A: EL-Zweig hinter der Gate-Kette, `api-calls.js:362`, Cap `:372` | exakt: `if (config.voice.elevenLabsOutbound.enabled)` bei :362, `armMaxDurationTimer(call, null)` bei :372 | BELEGT |
| S9 | A: `fetchConversation`, `convai.js:235` | exakt; liefert die ROHE Anbieter-Antwort (kein Mapping) — die Annahme "das ganze Objekt liegt im Speicher" traegt | BELEGT |
| S10 | B: Stichprobenregel `cost-calibration.js:59` | exakt in `isDriftSample`; zusaetzlich Praefix an BEIDEN Enden noetig | BELEGT |
| S11 | B: `config.billing.providerCurrency` | existiert, `config.js:1022`, Default USD; Adapter prueft dagegen (`adapters/telnyx/voice.js:444`) | BELEGT |
| S12 | A+B: `makeAuditStore(runner).record` -> `audit_log`, `audit-store.js:3` | exakt; einzige Verdrahtung heute `wiring/web-login.js:176` ueber `portalRunner` | BELEGT |
| S13 | B: durabler Marker `outage_alert`, `schema.sql:789-800` | exakt, inkl. `first_seen_at`/`last_attempt_at`/`delivered_channels` und Unique-Index auf offene Zeilen | BELEGT |
| S14 | A: "jede Stelle, die einen Anruf erzeugt" | es gibt genau ZWEI: `routes/api-calls.js:321` (outbound) und `routes/voice.js:320` (inbound) | BELEGT — und genau daran zerbricht A's Kernmechanismus, s. K1 |

Weitere gepruefte, unauffaellige Stellen: `util.js:60` (`audit` = reines `console.log`,
BELEGT), `cost-truing.js:119/375-380/410-421/452-458/475/581/716` (alle exakt),
`state-ops.js:326/334/804/3609/3687/3705/3756/4096/4112/4464` (alle exakt),
`cost-ledger-map.js:32-41` Import-Validierung und `:143` Top-Level-Lauf (exakt),
`call-finish.js:263` (`reconcileVoiceBudget` IMMER) und `:353` (SMS-Ledger, exakt),
`metering.js:166` (`recordNumberMonthMeter`, exakt), `schema.sql:855-862`
(`cost_micro_cents` NULLABLE, "eine 0 waere eine erfundene Messung" — beide Entwuerfe
zitieren diese Regel korrekt), `test/fixtures/elevenlabs-conversations.js` (existiert,
20 KB).

---

## Teil 2 — Die tragenden Behauptungen, sortiert

### K1 (Entwurf A, BLOCKER) — die zentrale Struktur-Behauptung ist am Code WIDERLEGT

A's Kernmechanismus ist das set-once-Feld `costProfile`, gesetzt "an der Stelle, die den
Anruf erzeugt" (§3.1), plus ein Inventar-Test "jede Stelle in `src/`, die einen Anruf
erzeugt, nennt ein Registry-Profil". Die tragende Werbeaussage lautet woertlich:

> "Am 19.08. haette dieser Test den ConvAI-Umstieg gestoppt, weil der neue Zweig ein
> Profil haette nennen muessen, das es noch nicht gab."

**WIDERLEGT.** Es gibt genau zwei Anruf-Erzeugungsstellen (`api-calls.js:321`,
`voice.js:320`, BELEGT). Der ConvAI-Umstieg hat KEINE davon angefasst: der Anruf wird bei
:321 erzeugt, die Engine-Weiche faellt erst 41 Zeilen spaeter bei :362 an einem
Config-Flag (`config.voice.elevenLabsOutbound.enabled`, BELEGT), und der Kommentar dort
sagt es selbst — "Der PROVIDER des Anrufs bleibt telnyx ... deshalb keine Provider-Abfrage,
sondern ein Engine-Schalter". Ein Profil, das bei :321 gesetzt wird, kann den Traeger nicht
kennen, ueber den der Anruf gleich laufen wird. Der Inventar-Test waere am 19.08. GRUEN
geblieben, und der EL-Anruf haette das Profil `telnyx_budget` getragen — mit der
Pflicht-Traegerliste `telnyx_callcontrol`, die dieser Anruf nie erfuellen kann. Ergebnis
waere nicht "laut unfertig", sondern "still falsch mit Profil".

Das ist deshalb ein Blocker und nicht ein Hinweis: Auftragspunkt 1 verlangt, dass eine
fehlende Kostenart STRUKTURELL auffaellt. A liefert dafuer genau diesen Mechanismus, und
seine Wirksamkeit ist mit einem Beispiel begruendet, das am Code nicht stimmt. Auch die
Pre-Mortem-Entschaerfung R4 ("Ein neuer Anbieter kam dazu") haengt allein daran. Gebaut wie
beschrieben, entsteht eine Sicherung, die genau den Fall nicht faengt, gegen den sie
beworben wird.

*Abhilfe, konkret:* das Profil (oder ein `engine`-Feld, aus dem es abgeleitet wird) wird an
der ENGINE-WEICHE gesetzt — also im EL-Zweig `api-calls.js:362`, im
Telnyx-Assistant-Zweig und im TeXML-Zweig je einmal —, set-once und fail-closed, und der
Inventar-Test bindet die WEICHEN-ZWEIGE, nicht die Erzeugungsstellen. Zusaetzlich braucht
das Settlement einen Riegel gegen Anrufe, die eine Weiche ohne Profil passiert haben.
Die dafuer noetige Messung ist trivial und ohne Anruf machbar: `grep` auf
`store.createCall(` und auf die Zweige unter `api-calls.js:360-400`, plus ein
node:test, der einen Call ueber jeden Zweig faehrt und `costProfile` prueft.

### K2 (Entwurf B, BLOCKER) — das Vollstaendigkeitspraedikat leitet die Route aus Beweisdaten ab

B §3.1: "Die Route wird aus dem Anruf abgeleitet (EL-Outbound: `call.sipCallId !== null`;
Telnyx-Outbound: `call.callControlId !== null`; Inbound: `direction`), **nicht aus einem
Flag, das jemand setzen kann**." Die Begruendung klingt richtig und ist an dieser Stelle
genau verkehrt herum.

**BELEGT** (`outbound.js:1300-1312`, Bestandskommentar woertlich): `sip_call_id` hat GENAU
EINE Quelle, `persistProviderResult`, und der Kommentar benennt den Preis selbst — "kommt
nie ein Ergebnis (Anbieter stumm, Prozess vorher weg), bleibt der Schluessel leer".
**BELEGT** (`api-calls.js:365-372`, Kommentar): der EL-Zweig setzt bewusst KEINEN
`callControlId` ("providerCallSid=null ist Absicht ... ohne callControlId").

Daraus folgt fuer einen EL-Anruf, dessen Ergebnisabruf nie ankommt: `sipCallId === null`
UND `callControlId === null`. B's Routen-Ableitung hat fuer diesen Zustand keine Antwort.
Zwei Auswege, beide schlecht:

- Sie faellt auf "Telnyx-Outbound" -> Pflichtmenge `telnyx_call_control_leg`, die nie
  kommt -> dauerhaft unvollstaendig. Sicher, aber die Zuordnung ist falsch und der
  `unbelegt`-Zaehler zeigt auf die falsche Kostenart.
- Sie liefert "keine Route" -> die Pflichtmenge ist LEER -> `postenVollstaendig` ist
  **vakuaer wahr** -> Postensumme 0 gegen Schaetzung 30 ct -> negatives Delta MIT
  `dataComplete: true` -> `applyCostCorrectionCents` bucht die Gutschrift
  (`state-ops.js:3813` laesst sie durch, BELEGT). Die Schaetzung wird auf null gesetzt,
  fuer einen Anruf, fuer den kein einziger Beleg existiert.

Der zweite Fall ist B6 durch eine andere Tuer, und B's eigener B6-Test (P5, Faelle 1-3)
faengt ihn nicht: alle drei Faelle setzen voraus, dass mindestens ein Posten existiert und
die Route bekannt ist. Ein Praedikat, das ueber Geldrueckgabe entscheidet, darf nie
vakuaer wahr werden koennen.

*Abhilfe:* Route/Profil ist ein persistiertes, set-once gesetztes Feld an der Engine-Weiche
(also A's Idee, an der richtigen Stelle angebracht); `postenVollstaendig` wirft oder
liefert `false`, wenn die Pflichtmenge leer ist ODER die Route unbekannt ist; und der
Testkatalog bekommt den Fall "EL-Anruf ohne jeden Posten" ausdruecklich als
Nicht-Erstattungs-Fall.

### K3 (Entwurf B, ERNST) — die inkrementelle Buchung vergiftet den Rest-Uebertrag

B §3.2 ruft `applyCostCorrectionCents` mehrfach je Anruf, jedes Mal mit der KUMULIERTEN
Postensumme und der Basis `estimatedCostCents + trueUpBookedCents`. Die Delta-Arithmetik
selbst ist nachgerechnet korrekt. Der Uebertrag ist es nicht.

**BELEGT** (`state-ops.js:3806-3818`): `convertProviderMicroToBucketCents` bekommt
`usage.costCorrectionMicroCentsRem` — einen **tenant-weiten** Rest-Uebertrag — und die
Funktion schreibt ihn bei jeder gebuchten Korrektur fort (`:3818`, Kommentar "NUR zusammen
mit der Buchung"). Wird derselbe Betrag zweimal umgerechnet (erst X1, dann X1+X2), fliesst
der Bruchteil von X1 ein zweites Mal in den Uebertragsstrom. Folge: bis zu 1 Cent
Abweichung je Zuwachs, in der Richtung "zu viel gebucht", und die Abweichung sammelt sich
auf einer tenant-weiten Achse ueber alle Anrufe. Die Fehlrichtung ist die sichere — die
Zahl ist trotzdem falsch, und der Bestand hat diese Mechanik ausdruecklich fuer EINEN
Umrechnungsvorgang je Korrektur gebaut.

B's eigenes Abnahmekriterium faengt es nicht: "`costCorrectionMicroCentsRem` bit-gleich"
wird nur fuer den NICHT gebuchten Fall geprueft (P5, Faelle 1-2). Fall 4 (Reihenfolge-Test)
vergleicht zwei Reihenfolgen miteinander, nicht gegen die einmalige Umrechnung der
Endsumme.

*Abhilfe:* entweder A's Weg (genau ein Settlement je Anruf, gegen die Endsumme), oder B
rechnet den Zuwachs (`Summe_neu - Summe_alt`) um statt der Gesamtsumme und uebergibt
`estimatedCostCents: 0` — dann bleibt der Uebertrag konsistent. Nachweis ohne Anruf: ein
Test, der (a) zwei Zuwaechse und (b) eine Einmal-Buchung derselben Endsumme faehrt und
`usage.costCents` UND `costCorrectionMicroCentsRem` beider Wege vergleicht.

### K4 (beide, ERNST) — die Herkunftsangabe des Ist-Werts ist eine fail-closed Enum und kommt in keinem Entwurf vor

**BELEGT**: `COST_TRUING_SOURCE` (`defaults.js:185-190`) kennt genau vier Werte
(`telnyx_detail_records`, `incomplete`, `no_estimate`, `unavailable`), und
`recordCallCostTruingResult` (`state-ops.js:804-807`) weist jeden anderen Wert ab.
Gleichzeitig haengen drei geld-relevante Leser an DETAIL_RECORDS: `refundProven`
(`cost-truing.js:452-458`), `truedSourceOf` (`:466-472`) und `isDriftSample`
(`cost-calibration.js:59`).

Beide Entwuerfe setzen im Settlement `costTruedAt` (A §3.4, B §4 Punkt 3) und beide
sprechen ueber die Stichprobenmenge des Drift-Waechters — aber **keiner sagt, welchen
Herkunftswert ein Mehr-Traeger-Settlement schreibt.** Die Frage ist nicht kosmetisch:
schreibt man `telnyx_detail_records`, behauptet ein EL-Anruf, seine Telnyx-Belege seien
vollstaendig, und er wandert in die Praefix-Stichprobe des Tarif-Waechters. Schreibt man
etwas Neues, muss die Enum wachsen und alle drei Leser muessen mitentscheiden.

*Abhilfe:* die Enum bekommt einen benannten Wert je Beleglage (z.B. "alle Pflicht-Traeger
belegt" vs. "Frist abgelaufen"), und die drei Leser werden im selben Commit explizit
umgestellt. Pruefbar ohne Anruf: ein Test, der jeden Enum-Wert einmal durch `refundProven`,
`truedSourceOf` und `isDriftSample` schickt.

### K5 (beide, ERNST; A schwerer) — die Monats-Gegenprobe wird falsch, bevor sie repariert wird

**BELEGT**: `actualCostMicroCentsForMonth` (`state-ops.js:4544`) summiert nur Calls mit
`provider === PROVIDER.TELNYX`, und `PROVIDER` kennt ueberhaupt nur `telnyx`
(`defaults.js:42`). EL-Anrufe tragen `provider: telnyx` (`api-calls.js:335` +
Kommentar :360). Die Monats-Gegenprobe `cost-cross-check.js` stellt diese Summe gegen die
Telnyx-Rechnung (`cost-cross-check.js:56`, `:82`).

Sobald `actualCostMicroCents` die Summe ueber MEHRERE Traeger ist, vergleicht diese
Gegenprobe EL-Kosten mit einer Telnyx-Rechnung. Beide Entwuerfe kennen den Bruch (A nennt
ihn in KV2-10, B in P7) — beide reparieren ihn aber ERST NACH der Phase, die den Bruch
erzeugt: A schaltet in KV2-6 um und repariert in KV2-10 (vier Phasen spaeter, letzte der
Kette), B schaltet in P5 um und repariert in P7. Zwischendurch laeuft eine Beobachtung,
die falsch statt nur unvollstaendig ist — und das ist der Zustand, in dem eine Kette gerne
liegen bleibt (B benennt das Risiko in R8 selbst und zieht daraus nur die Konsequenz
"P7 vor P8").

*Abhilfe:* die Gegenprobe wird im SELBEN Commit traeger-getrennt, in dem das Settlement die
Bedeutung des Feldes aendert — oder sie wird fuer Mehr-Traeger-Anrufe bis zur Reparatur
ausdruecklich stillgelegt (mit benanntem Grund im Log, nicht durch Weglassen).

### K6 (Entwurf B, ERNST) — der Boden-Waechter verstummt genau dann, wenn die Kette wirkt

B §6.3: "Der Boden bleibt: `voiceTariffFloorFindings` (`src/boot-guard.js:249`) meldet, wenn
der Inlandssatz unter `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` liegt."

**BELEGT, Aussage unvollstaendig** (`boot-guard.js:249-252`): die Funktion liefert nur dann
einen Befund, wenn `belowFloor` UND `thinCoverage` — also der Tarif unter dem Boden liegt
UND die Abgleich-Deckung unter `COST_TRUING_MIN_COVERAGE_PERCENT`. Der Meldetext sagt es
selbst: der gesenkte Tarif ist "der Buchungswert jedes NICHT abgeglichenen Calls". Die
ganze Kette hat als Ziel, die Deckung von 0 % auf ueber die Schwelle zu heben. In dem
Moment, in dem sie das erreicht, ist `thinCoverage` falsch und der Boden-Waechter schweigt —
auch bei einem Tarif unter Vollkosten. B verlaesst sich auf eine Sicherung, die die eigene
Kette abschaltet.

A ist hier besser: A §6.3 baut einen EIGENEN Boot-Waechter gegen den zuletzt gemessenen
p95-Vollkostensatz und uebernimmt die Kopplung an die Deckung nicht.

*Abhilfe fuer B:* der Boden bekommt eine zweite, deckungs-unabhaengige Bedingung — Tarif
unter gemessenen p95-Vollkosten meldet IMMER. Pruefbar ohne Anruf: Fixture mit Deckung
100 % und Tarif unter Boden muss einen Befund erzeugen.

### K7 (Entwurf B, ERNST) — der Stripe-Riegel laesst die neuen Belege ewig "pending" stehen

**BELEGT**: `flushableMeterEvents` (`state-ops.js:4241-4249`) filtert AUSSCHLIESSLICH nach
Flush-Epoche; `flushMeters` (`meter.js:67-85`) meldet, was sie liefert, und
`markMeterEventsSent` (`state-ops.js:4253`) markiert genau diese Events als gesendet.
A's Praemisse "es gibt keinen kind-Filter" ist damit BELEGT und richtig.

B's Riegel (§2.4, P9) setzt den kind-Filter genau in `flushableMeterEvents`. Folge: die
neuen kinds `provider_conversation`/`provider_telephony` werden nie geliefert, also nie
markiert, also bleiben sie dauerhaft in `pendingMeterEvents` — eine unbegrenzt wachsende
Pending-Menge, und die `skipped`-Zahl der Flush-Logzeile zaehlt kuenftig einen Normalzustand
als Rueckstand. Das ist kein Geldschaden, aber es macht eine Betriebskennzahl blind, und
zwar in genau dem Modul, in dem man spaeter einen echten Rueckstand erkennen will.

*Abhilfe:* nicht-meterbare kinds beim Schreiben sofort als `stripeMeterSent` markieren
(oder gar nicht erst in `pendingMeterEvents` fuehren), statt sie im Flush auszufiltern.
Pruefbar: nach dem Schreiben eines Lieferanten-Belegs ist `pendingMeterEvents` unveraendert.

### K8 (Entwurf A, ERNST) — "binnen Stunden" wird nicht erfuellt

Auftragspunkt 3 verlangt einen Alarmweg, der einen Ausfall dieser Art **binnen Stunden**
sichtbar macht. A rechnet es selbst vor (§5, Absatz "Der Zeitanspruch"): Sweep stuendlich
plus Frist 24 h = "spaetestens ~25 h nach dem ersten betroffenen Anruf eine Mail". Grund
ist strukturell: A's Deckungsquote je Traeger zaehlt nur FAELLIGE Anrufe, und faellig wird
ein Anruf erst nach `COST_SETTLE_DEADLINE_HOURS`. Der einzige Regler ist die Frist, und
sie zu senken erhoeht laut A die Zahl unvollstaendiger Settlements.

B loest genau das mit der dritten Alarmklasse `kosten:erfassung-tot:<art>` (§5 Punkt 3):
"in den letzten N Stunden Anrufe auf einer Route, fuer die der Katalog diese Kostenart als
`pflicht` fuehrt, und **kein einziger Posten** dieser Art" — Fenster 6 h, eigene
Entprellung. Das ist unabhaengig von jeder Faelligkeit und faengt den Zustand vom 19.08.
ohne dass jemand vorher an ihn gedacht haben muss. Es ist der staerkste einzelne Baustein
in beiden Entwuerfen.

*Abhilfe fuer A:* eine faelligkeits-unabhaengige Herzschlag-Pruefung uebernehmen ("Anrufe
mit Profil X in den letzten N Stunden, davon 0 mit Beleg des Pflicht-Traegers Y").

### K9 (beide, HINWEIS) — der Alarmweg ist an der Kostennaht nicht verdrahtet

**BELEGT** (`server.js:114`): `makeCostTruing({ store, config, voiceControl, audit, messaging })`
— kein `mailer`. **BELEGT** (`outage-report.js:111`): `meldeBetreiberAlarm` braucht
`mailer`. **BELEGT** (`audit-store.js:3`, einzige Verdrahtung `wiring/web-login.js:176`):
`makeAuditStore` braucht einen pg-Runner; im JSON-Backend gibt es keinen.

Beide Entwuerfe setzen Mail als primaeren Kanal und einen durablen Audit-Eintrag voraus,
keiner nennt die Verdrahtung. Das ist kein Denkfehler, aber es ist Arbeit, die in keiner
Phase steht — und die Frage "was passiert im JSON-Backend" ist unbeantwortet
(fail-soft No-Op ist vermutlich die richtige Antwort, aber sie muss entschieden sein).

Nebenbei: A's Tabelle in §5 nennt den Audit-Eintrag der bestehenden Kette "durabel". Am
Code ist das **BEHAUPTET**: `meldeBetreiberAlarm` ruft das injizierte `audit`, und das ist
heute `util.js:60` — reines `console.log` (BELEGT). Der bestehende Meldeweg hat denselben
Defekt B3 wie der Kostenpfad; er wird von A nur nicht mitgemeldet. B beschreibt es richtig
(§5 Punkt 5: Sink injizieren).

### K10 (beide, ERNST — Vollstaendigkeit) — "kein Preis-Parameter im Repo" wird als "keine Kosten" behandelt

A #11 und B `play_tts_zeichen` legen den Eigen-Synthese-Pfad als unbepreisbar ab. A: "KEIN
Weg, es existiert kein Preis". B: "Ohne Preis gibt es keinen Betrag, den man buchen
koennte; eine erfundene Zahl waere schlechter als keine."

Der Schluss ist derselbe Fehlschluss, der Befund B2 ueberhaupt erzeugt hat: **die Kosten
entstehen beim Anbieter, ob unser Repo den Satz kennt oder nicht.** Die Zeichen des
`<Play>`-Pfads werden von demselben ElevenLabs-Konto abgerechnet, dessen Abo-Endpunkt beide
Entwuerfe an anderer Stelle als Quelle akzeptieren (`GET /v1/user/subscription`,
`next_invoice.subtotal_cents`, Kontingent 30.000 Credits). Ein Satz je Zeichen ist daraus
ableitbar (Abo-Betrag / Kontingent, oder der Ueberschreitungspreis). Der Zaehler existiert
bereits tenant-genau (`recordTtsCharacters`, `state-ops.js:4464`, BELEGT).

Das ist eine Vollstaendigkeitsluecke, keine Entscheidung — beide Entwuerfe nennen sie
"bewusst nicht", aber die Begruendung ist die Abwesenheit einer Konfigurationszeile, nicht
die Abwesenheit von Kosten. **Geforderte Messung:** ein GET auf den Abo-Endpunkt (lesend,
kein Schreibaufruf) und die Frage, ob `<Play>`-Zeichen und ConvAI aus DEMSELBEN Kontingent
gehen. Ist die Antwort ja, gehoert eine Preiszeile in den Katalog; ist sie nein, gehoert
die Begruendung darauf gestuetzt und nicht auf `grep`.

### K11 (beide, ERNST — Vollstaendigkeit) — Zahlungsabwicklung kommt in KEINEM Entwurf vor

Das Ziel lautet "alle Kosten, die er in diesen zwei Minuten verursacht hat". Beide
Entwuerfe fuehren Anbieter-Kostenarten (EL, Telnyx, eigene KI, Recherche, SMS, DID) —
**keiner nennt die Stripe-Transaktionsgebuehr.** Sie ist:

- real und nicht klein (uebliche Groessenordnung: prozentualer Anteil plus Fixbetrag je
  Zahlung — bei einem 4,99-Betrag ist der Fixanteil zweistellig prozentual),
- eindeutig einem Tenant zuzuordnen (die Zahlung gehoert einem Kunden),
- anbieterbelegt (Stripe fuehrt je Buchung eine Gebuehrenzeile),
- und sie ist der einzige Posten, der WAECHST, wenn das Produkt erfolgreich ist.

Sie gehoert nicht auf die Gespraechs-Gate-Achse (sie entsteht nicht im Anruf), aber sie
gehoert in den Katalog — sonst ist der Katalog nicht "alle Kosten", sondern "alle Kosten,
an die wir gedacht haben", und genau das ist der Zustand, den der Auftrag abstellen will.
Beide Entwuerfe haben dafuer den richtigen Ort (A: die Tabelle in §2.1 inkl. der Zeilen
"KEIN Weg, bewusst"; B: `tenantUmlage: false`-Zeilen in §2.3).

### K12 (Entwurf B, HINWEIS — Vollstaendigkeit) — der Einkaufspreis einer Nummer fehlt

A benennt ihn ausdruecklich als Zeile #12 mit der richtigen Praezisierung:
`numberSetupFeeCents` ist der Preis, den WIR NEHMEN, nicht der, den WIR ZAHLEN. B hat dazu
keine Zeile — weder unter "faellt an" noch unter "bewusst nicht umgelegt". In einem
Entwurf, dessen Katalog gerade beweisen soll, dass nichts vergessen wurde, ist eine
fehlende Zeile mehr als ein Schoenheitsfehler.

### K13 (Entwurf B, HINWEIS) — die Aussage "auf dem EL-Weg entstehen keine eigenen Kosten" ist zu stark

B's Katalog (§2.1) markiert `ai_token` als "**NICHT** EL-Outbound (dort laeuft unsere
Schleife gar nicht)" und `research_fee` mit `pflicht: keine`.

**BELEGT dagegen**: `routes/webhooks-elevenlabs.js:33` importiert `bookLookupSearchFee`,
und der EL-Lookup-Webhook bucht die Recherche-Gebuehr waehrend eines EL-Gespraechs auf die
Tenant-Achse (`llm-usage.js:122-130` -> `store.addResearchFeeCostCents`,
`state-ops.js:3687`). Auf dem EL-Weg entstehen also sehr wohl EIGENE, live gebuchte Kosten.
Fuer die Geldrechnung ist das folgenlos (sie laufen ohnehin live auf die Gate-Achse und
sind kein Pflicht-Posten), fuer die Katalog-Aussage nicht: die Zeile "unsere Schleife laeuft
dort gar nicht" ist die Begruendung, mit der B eigene Kosten aus der EL-Route
herausdefiniert, und sie stimmt nur fuer die Turn-Schleife, nicht fuer die
Werkzeug-Webhooks. A ist hier neutral formuliert und damit nicht angreifbar.

### K14 (beide, HINWEIS) — die Pflicht-Belegtypen des EL-Wegs sind ungemessen, und A misst sie nicht dort, wo sie gebraucht werden

Beide benennen O1-Rest korrekt als offen: ob der EL-Weg je einen `call-control`-Beleg
liefert, ist ungeprueft, waehrend `COST_TRUING_REQUIRED_RECORD_TYPES` live beide Typen als
Pflicht fuehrt. Beide sagen auch die Konsequenz richtig: ist die Pflichtmenge falsch, ist
`dataComplete` fuer EL NIE wahr und es gibt nie eine Erstattung.

Unterschied: B schreibt "fuer die EL-Route muss die Pflicht-Typmenge **vor P4** gemessen
werden". A schreibt "das ist in KV2-4 zu messen, bevor KV2-6 gebaut wird" — aber A's
KV2-4-Abnahmekriterium enthaelt diese Messung nicht (es prueft nur, dass nichts gebucht
wird). Eine Pflicht, die in keinem Abnahmekriterium steht, ist eine Bitte.

---

## Teil 3 — Was in KEINEM der beiden Entwuerfe vorkommt

Sortiert nach Geldrelevanz. K10-K12 oben gehoeren ebenfalls hierher und sind dort begruendet.

1. **Stripe-Transaktionsgebuehren je Zahlung** (K11). Fehlt vollstaendig in beiden.
2. **Der Zustand "EL-Anruf ohne jeden Ergebnisabruf".** Beide bauen auf
   `persistProviderResult` als Angelpunkt — A holt dort den EL-Beleg, B legt dort ZUSAETZLICH
   den erwarteten Telnyx-Posten an. **BELEGT** (`outbound.js:1300-1312`) ist aber, dass
   genau dieser Aufruf ausbleiben kann. Bei A bleibt immerhin das Profil stehen (wenn es,
   anders als beschrieben, an der Weiche gesetzt wird); bei B entsteht in diesem Zustand
   ueberhaupt kein Posten und keine Erwartung — der Anruf ist fuer die Postenwelt
   unsichtbar, und nur B's Herzschlag-Alarm (Anrufe auf der Route ohne Posten) faengt ihn.
   Das ist Glueck, keine Konstruktion: die Erwartung gehoert an den Wahlvorgang, nicht an
   den Ergebnisabruf.
3. **Telnyx-Belege ohne zugehoerigen Anruf.** Beide benennen den 13. Beleg vom 19.08. als
   ungeklaert, keiner macht daraus eine Kostenart. Eine anrufbezogene Struktur kann sie
   grundsaetzlich nicht fassen — das ist ein Argument fuer eine Monatsdifferenz je Traeger
   (A's KV2-10 kommt dem am naechsten), nicht gegen ihre Erwaehnung.
4. **Kosten nach dem Ende der Beziehung**: was passiert mit offenen Posten, wenn ein Tenant
   in der Frist geloescht oder suspendiert wird? B's Tabelle haengt `call_cost_item` an
   `tenant_id` mit FK+RLS; ein Loeschen nimmt die Belege mit, waehrend die Anbieter-Rechnung
   bleibt. In keinem Entwurf erwaehnt.
5. **Die Frage, was "vom Guthaben abgebucht" im Eigentuemer-Satz heisst.** Beide Entwuerfe
   lesen den Auftrag als "unsere Ist-Kosten auf die Gate-Achse", nicht als "der Kunde zahlt
   die Ist-Kosten". A macht daraus ausdruecklich Owner-Entscheidung 1 (Erloes-Buch vs.
   Kosten-Buch) — B entscheidet sie still, indem es Lieferantenkosten in `usage_event`
   schreibt und per zweiter Liste vom Stripe-Meter fernhaelt. B's Weg ist technisch
   sauberer beschrieben (K7 ausgenommen), aber die Frage gehoert dem Eigentuemer, und B
   stellt sie in §11 nicht.
6. **Der Inbound-Kanal ueber ElevenLabs.** Beide stuetzen sich darauf, dass Inbound heute
   nie ueber EL laeuft. Das ist plausibel und in den Befunden belegt; **VERMUTET** bleibt
   aber, dass es so bleibt. A hat dafuer wenigstens ein `telnyx_inbound`-Profil, B schliesst
   Inbound ausdruecklich aus der Kette aus (§8 Punkt 5) — B's Katalogtest (P1: jede zur
   Laufzeit erreichbare Route braucht eine Pflichtzeile) faengt den Schwenk allerdings, das
   ist die bessere Sicherung.

---

## Teil 4 — Urteil

**Beide Entwuerfe sind ehrlich gearbeitet.** In 14 Stichproben ueber beide Dokumente ist
keine einzige erfundene Funktion, Datei oder Konstante aufgetaucht; die Zeilenangaben
stimmen auf +/- 2. Die Kennzeichnung BELEGT/VERMUTET wird in beiden Dokumenten
ueberwiegend korrekt gefuehrt, und beide benennen ihre offenen Punkte (O3, Rate-Limits,
`call-control` fuer EL) statt sie zu verstecken.

**Der Unterschied liegt in genau zwei Stellen, und sie zeigen in verschiedene Richtungen:**

- A's Struktur-Idee (deklariertes Profil, gegen das Vollstaendigkeit geprueft wird) ist die
  RICHTIGE Antwort auf Auftragspunkt 1 — aber A haengt sie an die falsche Codestelle und
  begruendet ihre Wirksamkeit mit einem Beispiel, das am Code widerlegt ist (K1).
- B's Praedikat-Idee ist an derselben Stelle schwaecher (Route aus Beweisdaten, K2) und
  oeffnet damit die B6-Falle wieder — aber B's Alarmweg (durabler `outage_alert`-Marker,
  Herzschlag-Klasse mit eigenem 6-h-Fenster) erfuellt Auftragspunkt 3, den A verfehlt (K8).

Die tragfaehige Loesung ist keine der beiden allein: **A's Profil, gesetzt an der
Engine-Weiche (nicht an der Anruf-Erzeugung), plus B's Herzschlag-Alarm und B's durabler
Marker.** Dazu die Einmal-Buchung aus A (K3 macht B's Inkrement teuer) und die
traeger-getrennte Gegenprobe im selben Commit wie die Bedeutungsaenderung (K5).

Was beide noch schulden: die Zahlungsabwicklungs-Gebuehr im Katalog, eine gemessene statt
einer ge-grep-ten Begruendung fuer den Eigen-TTS-Pfad, und einen benannten Herkunftswert
fuer das Mehr-Traeger-Settlement.
