# Angriff + Pre-Mortem auf die Entwuerfe A und B

Stand 2026-08-30. Gegenstand: `tasks/kostenv2/entwurf-a.md` ("Beleg je Kostentraeger") und
`tasks/kostenv2/entwurf-b.md` ("Anbieter-Kosten als erste Klasse"), gemessen an
`tasks/kostenv2/AUFTRAG.md`. Beide Entwuerfe sind noch nicht gebaut.

**Kennzeichnung:** `BELEGT` = Datei:Zeile aus dem Repo, in dieser Sitzung gelesen, oder ein
Wert aus AUFTRAG.md. `VERMUTET` = Schlussfolgerung dieses Dokuments. `NICHT GEMESSEN` = mit
Grund, warum es hier nicht messbar war.

Dieser Lauf hat KEINEN Produktivcode geaendert und keine Testsuite gefahren.

---

## 0. Kurzurteil

Die zwei Entwuerfe sind an unterschiedlichen Stellen stark, und beide haben je einen Defekt,
der genau die Fehlrichtung erzeugt, gegen die der Auftrag geschrieben wurde.

- **A ist im Datenmodell staerker.** Das Kostenprofil wird beim Anlegen des Anrufs
  festgeschrieben; die Vollstaendigkeit misst sich an einer Deklaration, nicht an Daten, die
  ausgerechnet im Stoerfall fehlen. Das eine Settlement je Anruf haelt den Rundungspfad
  sauber.
- **B ist im Betrieb staerker.** Der Alarmweg ist der vorhandene (`meldeBetreiberAlarm`),
  der Stillstands-Zaehler wird durch einen durablen Marker ersetzt, und der 0-Betrag wird
  ausdruecklich gegen die Anrufdauer geprueft.
- **A hat zwei Befunde, die so nicht gebaut werden duerfen**: der 0-Beleg als Vollbeleg
  (Erstattung der kompletten Schaetzung) und die Anker-Symmetrie der positiven Nachbuchung
  (Wirkungsverlust der pro-Tenant-Kostendecke, ohne Owner-Entscheidung).
- **B hat einen**: die aus Daten abgeleitete Route faellt fuer genau die Anrufe aus, um die
  es geht, und laeuft dort in die leere Pflichtmenge — Erstattung ohne Beleg.

---

## 1. Die schwersten Befunde, jeweils mit Ablauf

### 1.1 A: der 0-Betrag ist bei A ein Vollbeleg (BLOCKER)

`entwurf-a.md` §3.2 legt fest: *"eine Zeile mit `microCents: 0` bedeutet 'der Anbieter sagt:
kostenlos' ... und ist ein vollwertiger Beleg."* Begruendet wird das mit den vier nicht
angenommenen Anrufen (`cost=0.0`).

Ablauf, 12. Maerz 2027: ElevenLabs stellt das Konto auf eine andere Plan-Stufe um, oder
erweitert das Freikontingent, oder benennt in der Antwort ein Feld um, sodass
`metadata.cost_fiat` fuer angenommene Gespraeche `0` traegt (O5 ist NICHT GEMESSEN — der
Auftrag fuehrt ihn selbst als offen). A legt daraufhin je Anruf eine Belegzeile mit
`microCents: 0`, Reife `belegt` an. Der Telnyx-SIP-Beleg kommt regulaer. Damit sind ALLE
Pflicht-Traeger des Profils `el_convai_sip` belegt, `dataComplete` ist wahr, die Summe liegt
weit unter der 30-ct-Schaetzung — und `applyCostCorrectionCents` gibt die Differenz als
Gutschrift zurueck (`state-ops.js:3811-3818`, BELEGT: der negative Delta wird nur ohne
`dataComplete` verworfen). Ergebnis: jeder Anruf kostet den Tenant faktisch nur noch den
SIP-Anteil, waehrend wir die EL-Rechnung weiter zahlen. Das ist exakt die Fehlrichtung "ein
Tenant verbraucht monatelang mehr, als er bezahlt", und sie faellt nicht auf, weil die
Deckungsquote bei 100 % steht: es ist ja alles belegt.

B hat diesen Riegel: KV2-P3 verlangt ausdruecklich, dass `0` bei
`call_duration_secs > 0` KEINEN Posten erzeugt, sondern eine WARN-Zeile.

**Abhilfe fuer A:** die 0 ist nur dann ein Beleg, wenn die Mengenangabe des Belegs selbst 0
ist (nicht angenommen, Dauer 0). Anderenfalls: kein Beleg, Befund. Der Bestand kennt die
Regel bereits an zwei Stellen — `sumRecordMicroCents` liefert `null` statt 0 bei
Datenfehlern (`cost-truing.js:297-306`, BELEGT) und `refundProven` verlangt
`billedSecTotal > 0` (`cost-truing.js:452-457`, BELEGT).

### 1.2 A: KV2-5 senkt die Wirkung der pro-Tenant-Kostendecke (BLOCKER)

`entwurf-a.md` KV2-5 liefert als Abnahmekriterium: *"Nachbuchung eines Calls aus der
VORPERIODE erhoeht den Verbrauch der LAUFENDEN Periode nicht."*

Das ist keine Symmetrie-Korrektur, das ist eine Aenderung an der Wirkung eines geschuetzten
Gates. Die Gate-Frage `budgetExceeded` liest `gateUsageCents` (`state-ops.js:4011` ->
`:3966-3975`, BELEGT), also die aufgeloeste PERIODEN-Groesse, nicht die Lebenszeit. Eine
positive Korrektur, die die Periodenachse nicht mehr erreicht, ist Verbrauch, den die Decke
nie sieht.

Ablauf, 1. Juli 2027: der Tarif liegt unter den Vollkosten (genau der Fall, den A's
Waechter melden soll). Jeder Anruf wird am Monatsende geschaetzt gebucht, die Unterdeckung
kommt als positive Nachbuchung — und faellt, wenn sie ueber die Periodengrenze rutscht, nur
noch auf die Lebenszeit-Achse. Ein Tenant, der schwerpunktmaessig am Periodenende
telefoniert, verschiebt einen wachsenden Teil seines Ueberverbrauchs dauerhaft aus dem
Sperrbereich. Die Decke sperrt spaeter, als sie soll.

Die Groessenordnung ist begrenzt (die Schaetzung selbst wird beim Anrufende in der richtigen
Periode gebucht, `call-finish.js` -> `reconcileVoiceBudget`, BELEGT ueber AUFTRAG B4 — es
wandert nur der Korrektur-Delta). Aber die Richtung ist die falsche, und CLAUDE.md Regel 1
laesst fuer die pro-Tenant-Kostendecke keine stillschweigende Abschwaechung zu.

B behandelt dieselbe Frage richtig: KV2-P5b beschreibt beide Varianten und legt sie
ausdruecklich dem Eigentuemer vor (`entwurf-b.md` §11.2).

**Abhilfe fuer A:** die Phase behaelt ihren Platz in der Reihenfolge, aber ihr
Abnahmekriterium wird zur Owner-Entscheidung mit Default = heutiges Verhalten (die laufende
Periode wird belastet). Erst wenn der Eigentuemer entscheidet, wird die Symmetrie gebaut.

### 1.3 B: die aus Daten abgeleitete Route hat ein Loch, und es fuehrt in die leere Pflichtmenge (BLOCKER)

`entwurf-b.md` §3.1: *"Die Route wird aus dem Anruf abgeleitet (EL-Outbound:
`call.sipCallId !== null`; Telnyx-Outbound: `call.callControlId !== null`; Inbound:
`direction`), nicht aus einem Flag, das jemand setzen kann."*

`sipCallId` wird an genau EINER Stelle geschrieben: `persistProviderResult`
(`src/elevenlabs/outbound.js:1312`, BELEGT), und der Kommentar direkt darueber nennt den
Preis selbst: *"kommt nie ein Ergebnis (Anbieter stumm, Prozess vorher weg), bleibt der
Schluessel leer"* (`outbound.js:1305-1311`, BELEGT). Ein EL-Anruf hat ausserdem nie eine
`call_control_id` (AUFTRAG B1, DB-Messung: 12 Anrufe, 0 mit `call_control_id`).

Ablauf: ein EL-Anruf, dessen Ergebnisabruf nie durchlief (Deploy waehrend des Gespraechs,
Anbieter-Fehler mit permanentem Status, Zombie-Terminalisierung beim Boot — s. 2.4), traegt
weder `sipCallId` noch `callControlId`. Er ist Outbound, also greift auch der
Inbound-Zweig nicht. Die Route ist **keine**. `postenVollstaendig` prueft dann "jede
`pflicht`-Zeile dieser Route hat einen `gemessen`-Posten" ueber einer LEEREN Menge — und das
ist allquantifiziert wahr. `dataComplete = true` bei null Belegen. Die Ist-Summe ist 0, die
Schaetzung 30 ct, der Delta negativ: **volle Erstattung ohne einen einzigen Beleg.**

Das ist nicht hypothetisch, es ist die Falle, die im Bestand woertlich dokumentiert ist:
*"ueber der LEEREN Menge ist 'jeder Typ ist vertreten' allquantifiziert wahr und damit fuer
JEDEN Call erfuellt — der Vollstaendigkeits- faellt still auf den Anwesenheitsbeweis
zurueck"* (`cost-truing.js:318-323`, BELEGT). Der Bestand loest sie mit
`requiredRecordTypes.length > 0` als hartem Riegel. B uebernimmt die Falle, nicht den
Riegel.

**Abhilfe fuer B:** (a) unbekannte Route ist fail-closed — nie vollstaendig, eigener Befund;
(b) leere Pflichtmenge ist niemals Vollstaendigkeit; (c) besser noch: die Route beim Anlegen
des Anrufs festschreiben, so wie A es tut. B's Begruendung gegen ein Flag ("das jemand
setzen kann") wiegt weniger als der Fehlerfall, den die Ableitung erzeugt: ein set-once-Feld
mit fail-closed-Enum kann man vergessen zu setzen — und dann entsteht gar kein Anruf. Ein
abgeleitetes Praedikat kann still das Falsche sagen.

---

## 2. Pre-Mortem: 30. August 2027, die Kostenerfassung ist gescheitert

Jede Achse mit einem Ablauf, der aus DIESEN Entwuerfen folgt.

### 2.1 Der Anbieter aendert etwas

**Feldname / Plan-Stufe (ElevenLabs).** Siehe 1.1: bei A wird eine 0 zum Vollbeleg und
erzeugt Erstattungen. Bei B entsteht kein Posten, die Menge bleibt unvollstaendig, es wird
nichts erstattet — die sichere Richtung; sichtbar wird es ueber `kosten:erfassung-tot`.
Beide lesen dabei bewusst `metadata.cost_fiat` als Summe statt der Teilsummen; das ist
richtig, weil es auch Bestandteile deckt, die wir heute nicht kennen (`charging.analysis`
stand in allen acht gemessenen Anrufen auf 0, AUFTRAG B2).

**Rate-Limit.** A's Reifung (KV2-7) macht je EL-Anruf und Sweep einen Abruf, ohne
Kandidatenobergrenze und ohne Ruecklauf-Erkennung; A raeumt selbst ein, dass die Grenze nur
als untere Schranke bekannt ist (VERMUTET, s. `entwurf-a.md` §10). Bei 500 EL-Anrufen pro
Stunde sind das 500 Anfragen je Sweep. Faellt der Reifungs-Abruf in 429, bleibt jede EL-Zeile
`vorlaeufig`, und die einzige Bedingung, unter der A ueberhaupt erstatten darf, wird
volumenabhaengig: je erfolgreicher das Produkt, desto seltener stimmt die Abrechnung. B
braucht fuer den tragenden Posten NULL zusaetzliche Anfragen (der Wert liegt im Speicher) und
nur fuer die Bestaetigung einen — das ist die robustere Bauform.

**Pflicht-Belegtypen (Telnyx).** `COST_TRUING_REQUIRED_RECORD_TYPES` steht live auf
`sip-trunking,call-control` (AUFTRAG O1) und entscheidet global ueber
`source = DETAIL_RECORDS` (`cost-truing.js:322-330`, BELEGT). Ob der EL-Weg je einen
`call-control`-Beleg liefert, ist NICHT GEMESSEN — beide Entwuerfe fuehren das selbst als
offenen Punkt. Beide setzen aber voraus, dass die Pflichtmenge je Route gilt, und KEINE
Phase in KEINER der beiden Ketten macht sie route-spezifisch. Bleibt sie global und liefert
der EL-Weg nie `call-control`, ist jeder EL-Anruf dauerhaft unvollstaendig: nie eine
Erstattung, Deckung strukturell unter der Schwelle, Dauer-Alarm — und dann geht der Alarm
unter (s. 2.7).

**Endpunkt/Preis bei Telnyx.** Die 60-Sekunden-Aufrundung ist BELEGT (AUFTRAG,
befund-telnyx O2). Beide Entwuerfe leiten daraus richtig ab, dass ein reiner Minutensatz die
Kurvenform verfehlt; nur B baut daraus tatsaechlich einen zweiteiligen Satz (KV2-P8), A
fuehrt den Zweiteiler als Owner-Frage und misst vorerst nur zusaetzlich den p95 je ANRUF.
Beides ist vertretbar; A's Variante ist die kleinere Aenderung, B's die richtigere.

### 2.2 Ein Beleg kommt verspaetet, doppelt oder nach einem Periodenwechsel

**Verspaetet.** Beide Ketten haengen am bestehenden Kandidaten-Riegel:
`isTruingCandidate` verlangt `costTruedAt === null` UND
`nextCostTruingAttempt(call) <= COST_TRUING_MAX_ATTEMPTS` (5)
(`cost-truing.js:288-294`, BELEGT). B's Frist `KOSTENPOSTEN_MAX_ALTER_H = 72` und A's
`COST_SETTLE_DEADLINE_HOURS = 24` sind damit beide dekorativ: der Versuchszaehler
erschoepft frueher. A's Zwangs-Settlement nach 24 h hat, wenn nichts anderes geaendert wird,
gar kein Vehikel mehr — der Anruf ist laengst kein Kandidat, also feuert auch der Befund
`settle_deadline_expired` nie. Ein Alarm, der eine Bedingung meldet, die der Kandidatenfilter
vorher aussortiert, ist ein Alarm ins Leere.

**Doppelt / neu bewertet.** Keiner der beiden Entwuerfe sagt, was passiert, wenn derselbe
Traeger ein ZWEITES Mal mit einem ANDEREN Betrag gemessen wird (Telnyx re-rated einen
Record, EL korrigiert nach). B verbietet nur `gemessen -> erwartet`; der Fall
`gemessen -> gemessen mit neuem Wert` ist unspezifiziert (KV2-P2). A regelt es fuer den
EL-Traeger ("der HOEHERE gilt", §3.3), fuer den Telnyx-Traeger gar nicht. Beide brauchen
eine Regel, und die einzige sichere lautet: nach oben immer, nach unten nur mit
vollstaendiger Menge.

**Periodenwechsel.** Siehe 1.2. Zusaetzlich gilt fuer beide: die Gutschrift ist bereits
anker-gebunden (`applyCreditCents`, `state-ops.js:3756-3768`, BELEGT); eine Erstattung, die
erst nach dem Periodenwechsel bewiesen wird, wirkt nur noch auf der Lebenszeit-Achse. Das ist
Bestandsverhalten und in beiden Entwuerfen korrekt uebernommen.

### 2.3 Zwei Server-Instanzen laufen gleichzeitig

Die Voraussetzung steht woertlich im Code: *"Warum der Laufriegel PROZESS-LOKAL ist: Render
laeuft mit EINER Instanz ... DIESE VORAUSSETZUNG FAELLT BEIM ERSTEN SKALIERUNGSSCHRITT (2.
Instanz) — dann ist der Riegel wirkungslos und muss ersetzt werden"* (`cost-truing.js:21-24`,
BELEGT). Auch `withStoreLock` ist ausdruecklich prozesslokal (`store.js:376-386`, BELEGT).

**A:** stuetzt die Einmaligkeit des Settlements allein auf `costTruedAt` als set-once-Riegel
(R6). Zwei Instanzen lesen beide `costTruedAt === null`, beide rechnen
`delta = bucketCents - estimatedCostCents`, beide buchen. Die Schaetzung wird zweimal
herausgerechnet — bei Ueberschaetzung also die doppelte Gutschrift.

**B:** behauptet in R3 ausdruecklich Konvergenz: *"zwei gleichzeitige Laeufe koennen nur
denselben Endstand erreichen, nie den doppelten."* Das stimmt nicht.
`trueUpBookedCents` ist ein read-modify-write ohne Vergleichs-und-Setze-Schritt: beide
Instanzen lesen 0, beide buchen `+X`, beide schreiben `X`. Auf der Achse stehen `2X`, im Feld
`X` — und die naechste Buchung rechnet gegen den falschen Stand weiter. B's Bauform ist hier
sogar exponierter als A's, weil sie MEHRERE Buchungen je Anruf vorsieht.

Der Auftrag verlangt eine Architektur fuer Millionen Nutzer; "eine Instanz" ist dann keine
Voraussetzung mehr, sondern eine Wette. Beide Entwuerfe muessen die Annahme wenigstens
ausdruecklich benennen und einen Weg nennen (Vergleichs-und-Setze auf `costTruedAt` bzw. auf
`trueUpBookedCents` in derselben Anweisung, in der gebucht wird).

### 2.4 Ein Anruf endet unsauber

**Deploy mitten im Gespraech.** Der EL-Ergebnisabruf ist ein In-Prozess-Timer; er wird beim
Boot wieder scharf gemacht — aber nur fuer Anrufe mit Status `active`
(`outbound.js:1237-1241`, BELEGT). Die Boot-Reihenfolge ist:
`lifecycle.rearmActiveCallTimers()` (`boot.js:1180`) VOR
`elevenLabsOutbound.rearmActiveConversationPolls()` (`boot.js:1207`) — beides BELEGT. Der
erste Schritt terminalisiert jeden aktiven Anruf, dessen Restzeit abgelaufen ist
("Zombie", `call-lifecycle.js:209-223`, BELEGT). War die Ausfallzeit laenger als die
Max-Gespraechsdauer, ist der EL-Anruf danach nicht mehr `active`, und der Ergebnisabruf wird
NICHT mehr scharf gemacht. Folge: kein `cost_fiat`, kein `sip_call_id` — **beide** Traeger
fehlen dauerhaft. Das Bild ist ununterscheidbar vom Ausfall des 19.08.

Fuer A heisst das: eine Belegzeile, die nie entsteht, plus ein Profil, das zwei Traeger
verlangt -> `unvollstaendig_final`, Alarm. Fuer B: Route unbestimmt -> siehe 1.3, also im
schlimmsten Fall Erstattung ohne Beleg.

**Abbruchweg (`endConversation`-DELETE).** BELEGT und von beiden erkannt: auf dem Abbruchweg
ist der synchrone Griff die einzige Chance. A macht daraus eine Struktur (`vorlaeufig`,
niemals erstattungsfaehig), B ein benanntes Restrisiko. A's Loesung ist sauberer — hat aber
eine Nebenwirkung, die A nicht benennt: die vom Max-Dauer-Cap beendeten Anrufe (die
teuersten) bleiben dauerhaft `vorlaeufig` und zaehlen damit dauerhaft als "nicht belegt".
Steigt ihr Anteil ueber 20 %, liegt A's Deckungsquote je Traeger dauerhaft unter der
80-%-Schwelle. Ein Alarm, der immer an ist, ist keiner.

**Verlorener Webhook / Zombie-Leg.** Ein Anruf, der nie `endedAt` bekommt, ist fuer beide
Ketten unsichtbar: `isEndedCall` ist false (`cost-truing.js:137`, BELEGT), er zaehlt nicht
einmal im Nenner der Deckungsquote (`coverageBucketOf` setzt `answeredAt` und
`estimatedCostCents` voraus, `cost-truing.js:161-170`, BELEGT). Beide Entwuerfe messen
Vollstaendigkeit nur ueber beendete Anrufe; ein Anruf, der nie beendet wird, verschwindet aus
beiden Buechern UND aus der Kennzahl. Keiner der beiden Entwuerfe hat dafuer eine Zeile.

### 2.5 Waehrungskurs, Rundung, Vorzeichen

**Kurs.** Beide stuetzen sich zu Recht auf einen einzigen Kurs-Pfad
(`convertProviderMicroToBucketCents`), und beide begruenden das mit `currency=USD` auf beiden
Quellen (BELEGT). Der Kurs selbst ist aber ein statischer Env-Wert
(`PROVIDER_TO_BUCKET_RATE_MICRO=920000`, `.env.example:545`, BELEGT) ohne
Aktualisierungspfad; der Boot-Guard prueft nur ein Toleranzband gegen den Tippfehler
"920 statt 920000" (`config.js:1036-1039`, BELEGT), nicht die Aktualitaet. Nach dieser
Umstellung haengen an genau diesem Wert: die Gate-Buchung, der neu hergeleitete Tarif, der
Vollkosten-Boden und die Drift-Befunde. Ein um 10 % veralteter Kurs verschiebt alle vier
gleichzeitig in dieselbe Richtung — und weil sie sich gegenseitig bestaetigen, sieht das
Ergebnis konsistent aus. Keiner der Entwuerfe erwaehnt es.

**Rundung, und das ist B's teuerster technischer Defekt.**
`convertProviderMicroToBucketCents` fuehrt einen TENANT-weiten Rest-Uebertrag
(`usage.costCorrectionMicroCentsRem`), der ausschliesslich zusammen mit der Buchung
fortgeschrieben wird (`state-ops.js:3805-3820`, BELEGT). Die Mechanik setzt voraus, dass
jeder Ist-Betrag GENAU EINMAL durch die Umrechnung laeuft. B schickt bei jedem Postenzuwachs
die VOLLE Summe erneut hindurch (§3.2: *"actualCostMicroCents = postenSummeMikroCents(posten)
(ALLE Posten, nicht nur der neue)"*). Wurde der erste Zuwachs gebucht, ist der Rest bereits um
den Bruchteil dieses Betrages fortgeschrieben; der zweite Durchlauf addiert denselben Betrag
noch einmal in den Rest. Ergebnis: je Zusatzbuchung bis zu 1 Cent Aufwaerts-Abweichung, und
ein Tenant-Rest, der nicht mehr die Summe seiner Anrufe beschreibt. Bei Anrufkosten von 11
bis 30 Cent sind das mehrere Prozent, systematisch in eine Richtung. A hat das Problem nicht,
weil A genau einmal settelt — und A begruendet die Einmaligkeit in §3.4 auch richtig.

**Vorzeichen.** B prueft ausdruecklich auf negativ und auf Nicht-Float (KV2-P3). A nicht;
A verlaesst sich auf die Bestandszusage "der Aufrufer garantiert
`actualCostMicroCents >= 0`" (`state-ops.js:3703`, BELEGT) — der Aufrufer waere hier aber
neu, und die Zusage ist genau das, was neu zu erfuellen ist.

### 2.6 Ein neuer Kanal kommt dazu

**Inbound ueber EL.** Beide setzen (BELEGT) darauf, dass Inbound heute nie ueber EL laeuft.
Wenn es sich aendert: A verlangt ein Profil und wuerde beim naechsten Wahlpfad fail-closed
werfen — ABER nur, wenn jemand ein NEUES Profil braucht; wer den bestehenden Wert
`telnyx_inbound` weiterreicht, kommt durch, und die Traegerliste ist dann falsch. A benennt
genau das als Restrisiko R4. B's Ableitung aus Daten waere hier zufaellig besser (ein
EL-Inbound-Anruf traegt `sipCallId` und faellt automatisch in die EL-Pflichtmenge) — dafuer
kaufen sie sich das Loch aus 1.3 ein.

**WhatsApp / ein zweiter Anbieter ohne eigene Route.** Beide Strukturen haengen daran, dass
eine Kostenart an einem `call`-Datensatz haengt. Ein Kanal, der keinen Anruf erzeugt, faellt
durch beide Netze. A sagt das nicht, B sagt es (R5, "ehrliche Grenze"). Der 13. Telnyx-Beleg
ohne zugehoerigen Anruf (AUFTRAG/befund-telnyx) ist der bereits existierende Prototyp dieses
Falls — A will ihn wenigstens zaehlen (KV2-10), B laesst ihn offen.

### 2.7 Der Alarm feuert, aber ins Leere — schon einmal passiert (B3)

Drei unabhaengige Wege, auf denen sich B3 wiederholt:

1. **Kein Empfaenger, und das System meldet trotzdem Erfolg.** In `sendeUeberBeideKanaele`
   gilt `delivered = mailResult.delivered || !mailResult.hasTarget`
   (`outage-report.js:84`, BELEGT): ist kein Mail-Ziel konfiguriert, wird der Marker als
   zugestellt fortgeschrieben. `PLATFORM_ALERT_MAIL_TO` und `PLATFORM_ALERT_SMS_TO` sind in
   `.env.example` beide LEER vorbelegt (`:640`, `:677`, BELEGT), und der Boot-Guard erzeugt
   bei fehlenden Zielen einen Befund, keinen Startabbruch (`boot-guard.js:481-487`, BELEGT).
   Ob in der Produktion Ziele gesetzt sind, ist in diesem Lauf NICHT GEMESSEN (das haette
   einen Blick in die Render-Umgebung erfordert; Secrets-Regel). Keine Phase in KEINER der
   beiden Ketten pinnt den Empfaenger als harte Vorbedingung. Beide Entwuerfe bauen ihren
   neuen Alarm auf einen Kanal, dessen Zustellbarkeit sie nicht pruefen.
2. **A baut den Meldeweg ein zweites Mal.** A listet die Bausteine einzeln auf
   (`auditStore.record`, `mailer.sendMail`, `sendBootstrapAlertSms`) statt
   `meldeBetreiberAlarm` (`outage-report.js:111`, BELEGT) zu rufen — und ersetzt den durablen
   Marker `outage_alert` (`schema.sql:789-801`, BELEGT) durch einen selbstgebauten
   persistierten Zaehler. Damit gibt es zwei Formulierungen desselben Meldewegs und zwei
   Wahrheiten darueber, ob schon alarmiert wurde. Der Bestandskommentar nennt genau das den
   Fehler, den PM-4 beschreibt (`outage-report.js:105-108`, BELEGT). B macht es richtig.
3. **B erbt eine Entprellung, die es nicht gibt.** B schreibt: *"Drei Alarmklassen, alle mit
   eigenem `code` und damit eigener Entprellung."* `meldeBetreiberAlarm` sendet aber IMMER;
   die Reservierung liegt ausdruecklich beim Aufrufer (`outage-report.js:105-110`, BELEGT),
   und `claimOutageAlert` entscheidet nichts, es fuehrt nur den Marker fort
   (`state-ops.js:2645-2671`, BELEGT). Ohne eigenen Reservierungsschritt bekommt B entweder
   stuendlich eine Alarm-SMS (echte Kosten, Ermuedung — und Ermuedung ist die Bauform von
   B3) oder, bei der naheliegenden Notloesung "Marker offen -> nicht senden", **genau eine**
   Meldung fuer einen monatelangen Ausfall.

Zusaetzlich fuer beide: der Alarm unterscheidet nicht zwischen "Erfassung kaputt" und
"Beleg strukturell unbeschaffbar" (2.4). Nach jedem Deploy waehrend eines Gespraechs und nach
jedem vom Cap beendeten Anruf entsteht eine Luecke, die niemand schliessen kann. Beide Ketten
melden sie wie einen Defekt. Nach dem dritten Fehlalarm ist der Kanal wieder tot — nicht
technisch, sondern beim Empfaenger.

---

## 3. Was beide Entwuerfe richtig machen (und nicht verwaessert werden darf)

- **Die B6-Falle ist in beiden geschlossen**, und zwar durch dieselbe Bauform: die
  Vollstaendigkeit misst sich am SOLL (Profil bzw. Pflichtmenge), nicht am eingetroffenen
  Beleg. Beide verankern das mit einem Abnahmekriterium, das genau die Abkuerzung rot macht
  (A: KV2-4; B: KV2-P5 Faelle 1 und 2). Das ist der wichtigste Teil beider Entwuerfe.
- **Keiner legt Lieferantenkosten als neue `USAGE_EVENT_KIND` ohne Riegel an.** Der Befund
  ist in beiden korrekt: `flushMeters` meldet jedes `kind` an Stripe
  (`meter.js:65-80`, BELEGT), ein neues `kind` waere eine Kundenrechnung. A weicht mit einem
  eigenen Kosten-Buch aus, B baut einen Filter. A's Weg ist hier der sicherere: B's Filter
  laesst die Zeilen fuer immer `stripeMeterSent = false` (`state-ops.js:4213`, BELEGT), die
  `pending`-Menge waechst monoton, jeder Flush iteriert die gesamte Historie, und die
  Kennzahl `skipped` — die einen Riegel-Nullerfolg von einem leeren Ledger unterscheidbar
  machen soll — wird zu einer grossen konstanten Zahl ohne Aussage. Ausserdem ist
  `usage_event.cost_cents` `BIGINT NOT NULL` (`schema.sql:844`, BELEGT), also GANZZAHL Cent
  je Posten, ohne Rest-Uebertrag: B's "zwei Projektionen derselben Menge" laufen um bis zu
  einen Cent je Posten auseinander. Die Spalte `cost_micro_cents` existiert und ist nullable
  (`schema.sql:856`, BELEGT) — B's KV2-P9 nennt sie nicht.
- **Beide halten die Fixkosten aus der Tenant-Achse heraus** und begruenden es. B's
  Begruendung ist die staerkere (die Decke eines Tenants haenge sonst am Verhalten anderer)
  und trifft den Eigentuemer-Wortlaut direkt.
- **Beide fassen die Safety-Gates nicht an** — mit der Ausnahme aus 1.2, die A nicht als
  solche erkennt.

---

## 4. Die Schliessregel, die beide uebersehen (gemeinsamer Befund)

`trueOneCall` setzt `closed = measured !== null || attempt >= maxAttempts` und schreibt damit
`costTruedAt`, sobald EINE Messung vorliegt (`cost-truing.js:~665-676`, BELEGT); danach ist
der Anruf nie wieder Kandidat (`isTruingCandidate`, `cost-truing.js:288-294`, BELEGT). Der
Bestandskommentar sagt es ausdruecklich: *"RIEGEL GEGEN DOPPELZAEHLUNG ist costTruedAt und
sonst nichts."*

Beide Entwuerfe brauchen das Gegenteil: der Anruf muss ueber mehrere Sweeps hinweg Kandidat
bleiben, bis die Traegermenge vollstaendig ist.

- **A** erwaehnt die Schliessregel nirgends. KV2-4 sammelt den Telnyx-Beleg ueber genau
  diesen Pfad ein; damit latcht die erste Telnyx-Messung den Anruf zu, bevor KV2-7 die
  EL-Zeile je auf `belegt` heben kann. In der gebauten Kette waere `dataComplete` fuer
  EL-Anrufe **nie** wahr — es gaebe nie eine Erstattung, und die Phase KV2-7 waere toter Code
  mit gruenen Tests (sie testet gegen Attrappen, nicht gegen den Kandidatenfilter).
- **B** stellt die Regel um, aber erst in KV2-P6 — drei Phasen nach KV2-P4, das die Belege
  ueber denselben Pfad einsammelt. Zwischen P4 und P6 gilt die alte Regel. Da jede Phase
  einzeln mergebar sein soll, ist das ein realer Zwischenzustand, kein theoretischer.

**Abhilfe (beide):** die Schliessregel wandert in dieselbe Phase, die die Postenmenge
einfuehrt. Sie lautet dann: geschlossen wird, wenn die Pflichtmenge vollstaendig ist ODER
Frist/Versuche erschoepft sind — nie bei der ersten Teilmessung.

---

## 5. Empfehlung

Keiner der beiden Entwuerfe ist in der vorliegenden Fassung baureif, und keiner ist
verwerflich. Die tragfaehige Kombination ist:

1. **A's Datenmodell**: Kostenprofil beim Anlegen des Anrufs, set-once, fail-closed-Enum;
   Vollstaendigkeit gegen die Deklaration; EIN Settlement je Anruf (haelt den Rest-Uebertrag
   sauber, s. 2.5) — mit A's Blockern behoben (0-Beleg, Anker-Frage als Owner-Entscheidung).
2. **B's Betriebsteil**: `meldeBetreiberAlarm` als einziger Meldeweg, `outage_alert.first_seen_at`
   statt eines eigenen Zaehlers, die Herzschlag-Klasse `erfassung-tot` (sie ist der eine
   Baustein, der den 19.08. wirklich gemeldet haette), der 0-Riegel gegen `call_duration_secs`,
   der zweiteilige Tarif.
3. **Beides gemeinsam ergaenzen um**: die Schliessregel aus Abschnitt 4, einen eigenen
   Endzustand fuer strukturell unbeschaffbare Belege (2.4), die route-spezifische
   Pflicht-Belegtypmenge (2.1) und eine Phase, die den Alarm-Empfaenger als harte
   Vorbedingung pinnt (2.7).
4. **Ausdruecklich als akzeptiertes Risiko notieren**, wenn nicht behoben: die
   Ein-Instanz-Annahme (2.3) und die Aktualitaet des Umrechnungskurses (2.5).

---

## 6. Was dieser Lauf NICHT messen konnte (mit Grund)

- **O3 (Endgueltigkeit von `cost_fiat` in den ersten Minuten)** — unveraendert offen; ein
  Testanruf ist in diesem Lauf verboten, und schreibende Anbieter-Aufrufe ebenso.
- **Ob in der Produktion ein Alarm-Empfaenger gesetzt ist** — haette einen Blick in die
  Render-Umgebung erfordert; die Secrets-Regel dieses Laufs schliesst das aus. Der Befund aus
  2.7 steht deshalb als Struktur-Aussage, nicht als Messung.
- **Ob der EL-Weg `record_type=call-control` liefert** — NICHT GEMESSEN, in beiden Entwuerfen
  ebenfalls offen; der Telnyx-MCP-Zugang ist in dieser Sitzung mit HTTP 401 ausgefallen.
- **Die reale Latenz der `sip-trunking`-Belege** — nur ihre Existenz ist belegt (12/12), nicht
  wie schnell sie erscheinen. Bei 5 Versuchen im Stundentakt entscheidet genau diese Zahl
  darueber, ob je ein EL-Anruf vollstaendig wird. Beide Entwuerfe setzen sie voraus, keiner
  misst sie.
