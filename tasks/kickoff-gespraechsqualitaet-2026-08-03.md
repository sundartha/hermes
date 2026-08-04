# Kickoff: Das Telefonat gut machen — Neustart nach 17 Phasen ohne Wirkung

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

---

## Prompt

Du uebernimmst die Gespraechsqualitaet des Telefon-Agenten Hermes. Der Owner hat gerade,
nach einem Testanruf gegen den frisch deployten Stand, gesagt: **"eine absolute Katastrophe,
von vorne bis hinten stimmt absolut gar nichts."** Das ist die Messlatte, nicht die
Testsuite.

### Der Stand in fuenf Saetzen

Die Kette `PLAN-ASSISTANT-LEAP.md` (17 Phasen) ist gebaut, 16 davon gemergt, die
Diagnosen AL-D1/D2/D3 dazu. Alle Faehigkeitsflags sind an, alle per-Tenant-Rechte gesetzt,
`npm test` ist gruen. **Trotzdem ist das Telefonat unbrauchbar.** Der Live-Stand ist
`ce4df1d` (per `/healthz` gepruefte Tatsache, nicht aus einer Notiz gelesen). Der lokale
`master` traegt zusaetzlich AL-D3 und eine fremde, **nicht deploy-fertige** auth-gate-Kette
— nicht blind deployen, s. §Betrieb.

### Die Befunde, alle am echten Anruf belegt

Beleg-Anruf `call_msczdf1aadbw` (2026-08-03, 19 Turns, 196 s, Rohtranskript in der
Prod-DB). Vergleichsanruf **vor** dem letzten Deploy: `call_msahzky8m8p9` (2026-08-01).

**B-1 — Der Agent schneidet sich selbst das Wort ab. Ursache gefunden, Wurzel offen.**
Aeusserungen der Gegenstelle kommen **doppelt** an: einmal angefangen, einmal vollstaendig
(Zwischenergebnis + Endergebnis der Spracherkennung). **Beide** loesen einen eigenen
Agenten-Turn aus. Der Agent beginnt zu sprechen, ~1,5 s spaeter startet die zweite Runde
und ueberschreibt ihn. Belegt an Transkript-Segmenten 09/10 -> Agenten-Antworten 11/12
(zwei Antworten am Stueck), und im Log an `turnSeq` 5/6 bzw. 11/12 mit 1,5-1,7 s Abstand.
**Existiert schon am 01.08., ist also NICHT vom Streaming verursacht** (dort Segmente 09/10
-> 11/12, dasselbe Muster). Das Streaming macht es vermutlich nur hoerbarer, weil der Agent
frueher zu sprechen beginnt — Hypothese, nicht belegt. **Dieser Befund vergiftet alles
andere: jede zweite Antwort ist die Reaktion auf einen halben Satz.**

**B-2 — `get_consult` erkennt seinen eigenen Anlass nicht.** Es feuerte in diesem Anruf
genau einmal — **erst nachdem die Gegenstelle woertlich sagte "Du kannst mit der Funktion
get consult deinen Boss fragen"** (Segment 15/17). Der Owner dazu: *"Das geht ja ueberhaupt
nicht, dass ich sowas mache. Er soll das selbststaendig und autonom machen und merken, wenn
er eine Information nicht weiss."* Ein Agent, den die Gegenstelle bedienen muss, ist kaputt.
Zwei Prompt-Anlaeufe (AL-P14, AL-D3) haben daran nichts geaendert — **eine dritte
Formulierungsrunde ist der falsche Weg.**

**B-3 — Der Consult-Rueckkanal versagte, und der Agent leugnete daraufhin seine Faehigkeit.**
Die Antwort ueber `answer_consult` kam mit `accepted:false, merged_facts:0` zurueck. Zwei
Segmente spaeter sagt der Agent: *"Ich habe leider keine Funktion, um Antonio direkt zu
konsultieren – das geht technisch nicht."* (Segment 18) — nachdem er sie benutzt hatte.
**Warum die Antwort abgelehnt wurde, ist ungeklaert und muss zuerst gemessen werden.**

**B-4 — `look_up` feuert nie.** In **19 von 19** Turns angeboten, **0 mal** gefeuert. Auf
"Wann wurde Fiat gegruendet?" antwortete er *"Fiat wurde 1899 gegruendet"* aus dem
Gedaechtnis und sagte danach *"das wusste ich einfach"* (Segmente 31-34). Der Owner hat
zweimal ausdruecklich eine Internetrecherche verlangt und keine bekommen.

**B-5 — Der Agent legt nicht auf.** `end_call` wurde in **19 von 19** Turns nicht
aufgerufen. Nach *"Gut, dann gebe ich Antonio Bescheid"* (Segment 36) redet er weiter
(Segment 38).

**B-6 — Pathologische Wiederholung.** `take_message` feuerte **8 mal**, immer mit derselben
Nachricht. Die Segmente 18, 23, 24, 26, 30, 32, 34, 38 tragen im Kern denselben Satz.

**B-8 — Inbound und Outbound sind ZWEI VERSCHIEDENE MASCHINEN. Am Log belegt.**
Der Owner hat am 03.08. zusaetzlich die eigene Nummer angerufen (`call_msczw0irl06s`,
inbound, 79 s, 4 Turns) und berichtet: *"es war die gleiche Stimme, hat sich aber ganz
anders angehoert, auch ganz anders gesprochen ... als wuerde ich mit einem anderen Agenten
reden."* Er hat recht, woertlich:

- **Outbound** laeuft ueber den Telnyx-Assistant/LLM-Shim: `assistant_id` und
  `telnyx_conversation_id` sind gesetzt, im Log stehen `[telnyx-shim] turn_ok`-Zeilen mit
  `streamArmedRounds`, `streamChunks`, `offeredToolNames`.
- **Inbound** laeuft ueber die **Budget-Engine** (TeXML-Gather + STT): `assistant_id` und
  `telnyx_conversation_id` sind **NULL**, im Log stehen ausschliesslich
  `[metrics] speech_result` / `stt_gap` / `turn`. **Keine einzige `turn_ok`-Zeile.**

**Folge 1: das Token-Streaming aus AL-P17 wirkt inbound ueberhaupt nicht.** Die Boot-Sonde
meldet "Token-Streaming: AKTIV" — das gilt nur fuer den Shim-Pfad. Jede Aussage ueber
Gespraechsqualitaet muss ab sofort die Richtung nennen.

**Folge 2, und das ist die eigentliche Zahl:** die gemessenen `stt_gap`-Werte dieses
Anrufs lauten **10827 ms, 17839 ms, 12671 ms**. Zehn bis achtzehn Sekunden Stille zwischen
dem Ende der Agenten-Antwort und dem Erkennen der naechsten Aeusserung. Die LLM-Latenzen
desselben Anrufs lagen bei 1036, 1247, 1340 und 2846 ms. **Die Pausen kommen nicht vom
Modell, sondern aus der Gather-/STT-Schicht** — und sie sind inbound eine Groessenordnung
schlimmer als outbound.

**Folge 3:** inbound gibt es **kein** `get_consult` und **kein** `look_up` (Richtungs-Gate),
und der Anrufer bekam keine Zusammenfassung (`sms_summary_skipped reason=no_private_number`).
Der Owner hat aufgelegt (`hangupSource: caller`).

**Folge 4:** fuer inbound existiert **kein Rohtranskript** mehr — `transcript_segment` ist
fuer diesen Anruf leer, nur `summary` und `result` blieben. Forensik ist dort also nur
moeglich, wenn man sie VOR der Zusammenfassung sichert.

**B-9 — Die Zweiteilung ist keine Architektur, sondern ein stiller Rueckfall. Wurzel am
Code belegt.** Der Inbound-Assistant-Pfad EXISTIERT (`inboundAssistantHandoffXml` in
`src/routes/voice.js`, `startInboundAiAssistant` in `src/telnyx-inbound.js`) und das Flag
ist live an (Boot-Banner: `Assistant-Pfad: AKTIV`). Er feuert trotzdem nie. Sein Waechter:

```js
// Telnyx-TeXML-Inbound-Body-Feld mit der call_control_id des Inbound-Legs. Doku-Stand,
// live unbestaetigt ... Fehlt es -> null: der Aufrufer faellt fail-safe auf den
// bestehenden TeXML-Greeting-Pfad zurueck (byte-identisch), kein kaputter Assistant-Pfad.
const INBOUND_CALL_CONTROL_ID_FIELD = "CallControlId";
```

Ein **geratener Feldname**, vom Autor selbst als "live unbestaetigt" markiert, mit einem
**stillen** Rueckfall auf die alte Engine. Kein Log, keine Boot-Sonde, kein Test faengt den
Fall — der Dienst meldet `Assistant-Pfad: AKTIV` und laeuft inbound trotzdem seit Wochen
ueber die Budget-Engine. Beleg: fuer den Outbound-Anruf steht
`[telnyx/voice] startAssistant ok status=200 ccid=true` im Log, fuer den Inbound-Anruf
**keine einzige** solche Zeile.

**Das ist dieselbe Fehlerklasse, die dieses Repo schon einmal teuer bezahlt hat**
(geratene Feldnamen in der Kosten-Kette: 297 von 297 Belegen wertlos). Die Lehre lautet
nicht "besser raten", sondern: **ein Pfad, dessen Aktivierung von einem unbestaetigten
Feldnamen abhaengt, braucht eine Sonde, die sein Ausbleiben SICHTBAR macht.**

**Die Owner-Entscheidung dazu ist gefallen (03.08.):** *"Es ergibt natuerlich ueberhaupt
keinen Sinn, zwei verschiedene Pfade zu haben. Guter Code ist simpel."* Zu klaeren ist
also nicht OB vereinheitlicht wird, sondern wie:

- **Weg A:** den Feldnamen am echten Inbound-Webhook messen (ein Log-Griff, kein Umbau),
  den Handoff fertigstellen — dann laeuft beides ueber den Assistant-Pfad.
- **Weg B:** den Inbound-Assistant-Stub loeschen und bewusst auf die Budget-Engine setzen,
  dann aber fuer BEIDE Richtungen.

**Twilio ist KEIN Gegenargument — an der Prod-DB gemessen (03.08.):** ueber alle drei
Tenants sind **43 von 43 Anrufen und 3 von 3 Nummern `provider=telnyx`**. Twilio hat live
nie einen Anruf gefuehrt. Der Capability-Waechter `providerSupports(provider,
CAPABILITY.AI_ASSISTANT)`, der die Budget-Engine formal noch rechtfertigt, schuetzt also
einen Provider, der nie benutzt wurde. Wer die Vereinheitlichung mit "aber Twilio kann das
nicht" abwehrt, argumentiert gegen Verkehr, den es nicht gibt. **Ob die Twilio-Abstraktion
insgesamt bleibt, ist eine EIGENE Owner-Entscheidung** (Anbieter-Unabhaengigkeit gegen
Einfachheit) und gehoert nicht nebenbei in diese Kette entschieden — sie blockiert die
Vereinheitlichung von Inbound/Outbound aber nicht.

Was sachlich bleibt: echtes Barge-in gibt es nur ueber den Streaming-/Assistant-Pfad,
TeXML-Gather kann es prinzipiell nicht (`barge-in-telnyx-texml-limitation`). Das ist der
Grund, warum der Assistant-Pfad gebaut wurde — und ein Argument DAFUER, ihn auch inbound
scharf zu bekommen, nicht dagegen.

**Das gehoert VOR die Befund-Phasen B-1..B-7 in die Reihenfolge**, mindestens als Messung:
solange inbound und outbound verschiedene Maschinen sind, gilt jeder Befund oben nur fuer
eine Richtung, und der Pruefstand aus Schritt 1 misst nur die halbe Wahrheit.

**B-10 — Der Agent scheitert STUMM und niemand merkt es. Live erlebt am 2026-08-04.**
Ursache des Ausfalls war **kein Code**: das Anthropic-Guthaben war leer, jeder Modell-Turn
kam mit `400 "Your credit balance is too low"` zurueck. Der Owner hoerte nur die
Offenlegung (deterministischer Speak-Node, kein Modell) und danach nichts — inbound wie
outbound. Vier Anrufe, **null** Zusammenfassungen; der Outbound-Anruf lief **52 s mit
sieben** aufeinanderfolgenden `agentTurn fehlgeschlagen`, waehrend der Owner weitersprach
und Carrier-Minuten liefen.

Drei eigenstaendige Defekte, die dieser Vorfall freigelegt hat — **alle drei gehoeren in
die Kette, unabhaengig vom Guthaben:**

1. **Der Degradations-Satz erreicht den Anrufer nicht.** Er ist verdrahtet
   (`degradedSpeechFor(err, locale)` im Shim-Catch, `src/telnyx-llm-shim.js`, trennt
   transient -> `llmDegradedSpeech` von 4xx -> `turnErrorSpeech`). Trotzdem hoerte der
   Owner ueber sieben gescheiterte Turns hinweg **nichts**. Ob der Satz gar nicht auf den
   Draht ging oder nur nicht gesprochen wurde, ist **ungemessen** — genau die
   "gesetzt ist nicht wirkt"-Klasse wie D-1. **Zuerst messen, dann fixen.**
2. **Der Bezahl-Fall ist in der eigenen Telemetrie unsichtbar.** Der Shim prueft
   `vendorStatusOf(err) === HTTP_PAYMENT_REQUIRED` (402) und loggt dann `vendor_402`.
   Anthropic liefert fuer leeres Guthaben aber **400** mit `invalid_request_error`. Der
   Sonderfall "uns ist das Geld ausgegangen" faellt damit in den generischen Fehlerpfad und
   ist von einem beliebigen technischen Fehler nicht zu unterscheiden.
3. **Es gibt keine Alarmierung.** Der Dienst war stundenlang stumm; entdeckt wurde es
   dadurch, dass der Owner selbst anrief. Ein Telefon-Agent, der bei Modell-Ausfall
   weiterlaeuft, Minuten verbrennt und niemanden benachrichtigt, ist schlimmer als einer,
   der gar nicht erst abhebt.

**Der Agent soll bei anhaltendem Modell-Ausfall hoerbar und wuerdevoll beenden, statt stumm
weiterzulaufen** — das zahlt zugleich auf O-3 (Kuerze/Minutenkosten) ein.

**Wichtig fuer die Zuordnung:** dieser Vorfall ist **nicht** der KV-Kette anzulasten. Jeder
einzelne Fehler im Log ist das Guthaben, kein anderer Fehlertyp trat auf. Ob KV daneben
etwas gebrochen hat, ist **erst nach dem Aufladen beurteilbar** — bis dahin weder behaupten
noch ausschliessen.

**B-7 — STT-Kauderwelsch (vorbestehend).** *"Hast Du das im Internet tress passiert?"*,
*"Bis zum behindert, man."* Nicht von dieser Kette verursacht, nie behoben.

**Was NACHWEISLICH funktioniert:** das Token-Streaming aus AL-P17. `streamArmedRounds:1` und
`streamChunks:1-3` in **allen 19** Turns (vorher: 0 in allen 21). Der Owner hat entschieden:
**bleibt an.**

### Zwei Owner-Vorgaben

1. **Autonomie.** Der Agent muss selbst merken, dass ihm etwas fehlt. Kein Coaching durch die
   Gegenstelle.
2. **Kuerze ist ein Ziel, kein Nebeneffekt.** Der Agent soll das Gespraech so kurz wie
   moeglich halten — telefonierte Minuten sind der groesste Kostenblock (Tarif 30 ct/min).
   Das ist eine **neue** Anforderung und noch nirgends umgesetzt.

### Owner-Entscheidungen vom 2026-08-03 (bindend, nicht neu aufrollen)

**O-1 — Inbound und Outbound werden vereinheitlicht, ueber Weg A.** Den echten
TeXML-Feldnamen am Live-Webhook **messen** (`INBOUND_CALL_CONTROL_ID_FIELD` steht heute auf
dem geratenen `"CallControlId"`), dann den Inbound-Handoff scharf schalten. Danach laufen
beide Richtungen ueber den Assistant-Pfad. **Zusatzauflage: der stille Rueckfall verschwindet.**
Faellt der Handoff aus, muss das im Log und in einer Boot-/Turn-Sonde SICHTBAR sein — ein
Pfad, der lautlos auf die alte Engine zurueckfaellt, ist der eigentliche Defekt (B-9).

**O-2 — Die Twilio-Abstraktion wird entfernt, als EIGENE Phase** mit eigener Spec und
eigenem Review, nicht nebenbei. Gemessene Grundlage: 43 von 43 Anrufen und 3 von 3 Nummern
sind Telnyx, Twilio hat live nie einen Anruf gefuehrt. Die Phase beruehrt
`src/telephony/` (Ports, Registry, Adapter) und die Capability-Weichen. **Sie blockiert O-1
nicht und laeuft nicht parallel dazu.**

**O-3 — "So kurz wie moeglich" ist eine MESSGROESSE, keine Kappe.** Turns und Dauer je
**erledigtem** Auftrag werden gemessen und als Ziel im Prompt verankert. **Keine harte
Turn- oder Sekundengrenze** — eine Kappe schneidet Gespraeche mitten durch. (Die bestehende
Max-Dauer-Notbremse als Safety-Gate bleibt davon unberuehrt.)

**O-4 — Der Modellwechsel Haiku -> Sonnet wird gemessen, nicht geraten.** A/B-Lauf auf dem
Pruefstand, **erst nachdem** dieser die Befunde reproduziert. Der Bench weist Kosten je
Gespraech aus; die Entscheidung faellt an Qualitaet UND Preis. Vorher wird das Modell nicht
angefasst.

**O-5 — Token-Streaming bleibt AN.** Es ist die einzige nachweislich funktionierende
Verbesserung der letzten Kette (19/19 Runden armiert).

### Weitere Owner-Entscheidungen vom 2026-08-03 (bindend)

**O-6 — AL-D3 bleibt.** Gemergt, gemessen wirkungslos, aber es entfernt eine Falschaussage
(`take_message` behauptete, Nachschlagen sei eine fehlende Faehigkeit — seit AL-P10b unwahr)
und bringt den Sprach-Paritaetstest, den es vorher nicht gab. Kein Rueckbau.

**O-7 — Der auth-gate-Blocker wird geschlossen, BEVOR wieder von `master` deployt wird.**
Auf `master` liegt eine fremde Kette, die das Basic-Auth-Gate entfernt (`b111927`), waehrend
kein Account `role='admin'` traegt. Ein Deploy von dort sperrt den Owner aus seinem eigenen
Dienst aus. **Diese Kette gehoert nicht dieser Session — nicht selbst reparieren, sondern
den Zustand pruefen und melden, bevor irgendetwas nach `master` deployt wird.** Der Deploy
am 03.08. lief bewusst gegen `upstream/master` (`ce4df1d`), nicht gegen den lokalen Stand.

**O-8 — Die US-Nummer ist GEWOLLT und bleibt.** Owner-Klarstellung 03.08.: derzeit sind nur
US-Nummern kaufbar, und das ist so beabsichtigt (`FORCE_NUMBER_COUNTRY=US` bei Plattform-Land
DE, das Boot-Banner warnt darueber). **Das ist eine Randbedingung, keine offene Frage und
kein Befund.** Die dokumentierte Folge bleibt bestehen und ist akzeptiert: die Zustellung
von einer US-DID nach DE ist sporadisch (`telnyx-fresh-did-no-de-routing`) — wer einen
fehlgeschlagenen Waehlversuch sieht, sucht den Fehler **nicht** hier und baut auch keine
+49-Beschaffung ein.

**O-9 — Zugestellte Nachrichten: der Owner hinterlegt eine private Nummer.**
Beleg: `[audit] sms_summary_skipped ip=system call=call_msczw0irl06s reason=no_private_number`
— die im Inbound-Anruf aufgenommene Nachricht hat den Owner nie erreicht. **Solange das so
ist, ist `take_message` wirkungslos, egal wie oft es feuert** — und jede Messung von
"Nachricht korrekt aufgenommen" misst nur die halbe Kette. **Owner-Handgriff, kein
Code-Thema.**

**O-10 — `diagnostic: true` wird repariert.** Der Server ignoriert das Feld: beim Testanruf
am 03.08. gesetzt, in der DB steht `diagnostic=false`. Das Rohtranskript ueberlebte nur,
weil die Loeschung noch nicht gelaufen war. Ohne Fix ist jede Anruf-Forensik Glueckssache.

**O-11 — Gezielter Diagnosemodus statt hoeherer Aufbewahrung.** Fuer Inbound existiert
heute **kein** Rohtranskript (`transcript_segment` leer, nur `summary`/`result`). Die
Aufbewahrung wird NICHT generell hochgedreht — es kommt ein Modus, der gezielt mitschneidet.

**O-12 — Eine Session je Kette.** Am 03.08. hat eine parallele Session dreimal waehrend
einer laufenden Welle nach `master` gemergt. Kuenftig: eine Session je Kette oder getrennte
Integrationszweige.

**O-13 — Der Pruefstand startet mit Outbound.** Inbound wird nachgezogen, sobald O-10/O-11
stehen (vorher gibt es dort kein Rohmaterial).

**Ausdruecklich ZURUECKGESTELLT (Owner, 03.08.):** die Datenschutzerklaerung
(`EVIDENCE_RETENTION_DAYS=7`, `allow_call_memory=true` seit 01.08. live, in `apps/web` nicht
genannt). Begruendung des Owners: hat mit der Optimierung des Agenten nichts zu tun.
**Nicht in dieser Kette anfassen und nicht erneut vorlegen.**

### O-14 — Diese Kette startet NACH der KV-Kette (Owner, 2026-08-03)

Parallel laeuft die Kette **KV (Kosten-Vollstaendigkeit)**,
`tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md`. Sie geht vor. **Nicht parallel starten** — zwei
Worktree-Workflows ueberlasten die Maschine, und jeder `master`-Commit der einen Kette
erzeugt in der anderen einen falsch-positiven Stale-Base-Blocker (am 03.08. dreimal
passiert).

Der Grund ist aber nicht nur Betrieb, sondern Sachlage: **KV schliesst ein offenes
Kostenleck auf einer oeffentlich waehlbaren Nummer** (Inbound ist heute weder vom
Kosten-Gate noch vom Minuten-Kontingent gebremst), und **diese Kette wuerde das Leck vorher
vergroessern**. Kosten-Gates haben Vorrang (CLAUDE.md).

**Drei Uebergabepunkte, die beim Start dieser Kette zu pruefen sind:**

1. **O-1 macht eine KV-Messung ungueltig.** KV-M1 hat den Inbound-Ist-Satz an genau dem
   Anruf gemessen, der auch B-8 belegt (`call_msczw0irl06s`), unter der ausdruecklich
   festgehaltenen Konfiguration `VOICE_ENGINE=budget`: **1,87 US-Cent je angefangener
   Minute.** Der Assistant-Pfad kostet laut demselben Plan **~5 US-Cent je angefangener
   Minute**. Verschiebt O-1 den Inbound-Verkehr dorthin, **verdreifacht sich der
   Inbound-Minutenpreis** und KV-P2s Tarif samt Decken-Rechnung stimmt nicht mehr.
   **Pflicht: KV-M1 nach O-1 auf dem Assistant-Pfad wiederholen** und den Tarif neu
   kalibrieren. KV-P2 hat dafuer EINE Tarif-Quelle mit fail-closed-Rueckfall — es ist eine
   Messung, kein Umbau. **Im Kettenstand ankuendigen, nicht stillschweigend tun.**

2. **O-2 (Twilio raus) darf `twilioSid` NICHT anfassen.** Das Feld traegt trotz seines
   Namens den **Telnyx**-TeXML-Leg-Token:
   `const providerLegIdOf = (call) => call.twilioSid || call.callControlId || null;`
   (`src/billing/cost-truing.js:77`, Kommentar dazu in
   `src/telephony/adapters/telnyx/voice.js:112`). Die gesamte Ist-Kosten-Zuordnung haengt
   daran — KV-M1 hat ueber genau diesen Anker zugeordnet (`v3:zkVIbQTK…`). Im Quellcode
   haengen ~39 Stellen am Namen. **Ein Rebrand oder eine Entfernung dieses Feldes ist eine
   EIGENE Phase mit Datenmigration, nicht Teil der Twilio-Aufraeumung.** Wer das
   uebersieht, koepft die Kostenzuordnung.

3. **ERLEDIGT am 2026-08-04: die KV-Kette ist durch, die Befunde stehen.** Geprueft
   `ce4df1d..master` auf den gemeinsamen Dateien: KVs Eingriff in `src/claude.js` ist
   **reiner Kommentar, keine Logik**; funktional geaendert hat KV nur Kosten-Klempnerei
   (`telephony/adapters/telnyx/voice.js`, `ports.js`, `call-finish.js`). Der Turn-Pfad ist
   unberuehrt. Empirische Gegenprobe: ein Testanruf am 04.08. (`call_mseip2888klk`)
   reproduziert **B-1 in Reinform** — `turnSeq 1` und `turnSeq 2` liegen **eine
   Millisekunde** auseinander (10:31:12.580 / .581). Kein Mensch spricht zweimal in einer
   Millisekunde.

   **ZWEI NEUE RANDBEDINGUNGEN aus der KV-Kette, die kein Gespraechsdefekt sind:**
   (a) **Inbound ist seit KV-P2 kosten-gegatet.** Ein Inbound-Anruf kann jetzt mitten im
   Gespraech abbrechen, wenn die Tenant-Decke erreicht ist — das war vorher unmoeglich.
   Wer das bei einem Testanruf sieht, sucht den Fehler **nicht** in dieser Kette.
   (b) **Die Befunde B-1..B-10 wurden auf `ce4df1d` erhoben, also OHNE AL-D3.** `master`
   traegt AL-D3, die Tool-Beschreibungen sind dort andere. Fuer B-4 (`look_up` feuert nie)
   ist das gemessen folgenlos (AL-D3-Messung vom 02.08.), fuer die uebrigen ungeprueft —
   **der Pruefstand misst gegen den aktuellen `master`, nicht gegen `ce4df1d`.**

4. **Gemeinsame Dateien.** KV fasst `src/billing/metering.js`, `src/billing/cost-truing.js`,
   `src/telephony/adapters/telnyx/voice.js` und die Budget-Achsen-Pruefung in
   `src/claude.js` / `src/telnyx-llm-shim.js` an. Diese Kette fasst `src/routes/voice.js`,
   `src/telnyx-inbound.js`, `src/telephony/**`, `src/claude.js` und
   `src/i18n/prompts/*.js` an. **Ueberschneidung: `src/claude.js`, `src/telnyx-llm-shim.js`
   und `src/telephony/**`.** Vor dem Start dieser Kette: `git log --oneline` gegen den
   Stand pruefen, auf dem die Befunde B-1..B-9 erhoben wurden — aendert KV dort etwas, sind
   die Befunde **neu zu messen**, bevor eine Phase darauf gebaut wird.

### Warum 17 gruene Phasen nichts gebracht haben — lies das, bevor du planst

**Der Feedback-Loop war kaputt, nicht der Arbeitsablauf.** Jede Phase wurde gegen `npm test`
und den Conversation-Bench abgenommen. Beide waren gruen, waehrend das Telefonat kaputt war:

- Der Bench simuliert die Gegenstelle mit einem sauberen Modell. **Er erzeugt keine
  doppelten Turns, kein Kauderwelsch, keine Halbsaetze** — also genau die Bedingungen nicht,
  unter denen der Agent scheitert.
- Am 02.08. gemessen und dokumentiert: das eigens gebaute Bench-Szenario feuerte `look_up`
  **schon mit den alten Beschreibungen 5/5**, waehrend es live 0/12 feuerte. Ein Szenario,
  das den Defekt nicht reproduziert, kann keinen Fix belegen.

**Deshalb ist der erste Schritt kein Feature und keine Phasenkette, sondern ein Messstand.**

### Auftrag

**Erst messen koennen, dann planen, dann bauen.** In dieser Reihenfolge.

**Schritt 1 — Der Wiederholungs-Pruefstand (bevor irgendetwas anderes passiert).**
Baue einen Harness, der **echte Anrufe aus der Prod-DB abspielt**: die tatsaechlichen
Gegenstellen-Turns in ihrer tatsaechlichen Reihenfolge, **inklusive der Doppel-Zustellungen
und des Kauderwelschs**, gegen den echten Agenten-Turn-Pfad. Ausgabe: welche Werkzeuge
angeboten/gefeuert wurden, wie viele Turns, wie viele Wiederholungen, ob `end_call` kam.
Rohmaterial liegt bereit: `call_msczdf1aadbw`, `call_msahzky8m8p9`, `call_msabz9975sph`.
**Abnahme dieses Schritts: der Pruefstand reproduziert B-1, B-4, B-5 und B-6 ROT.**
Reproduziert er sie nicht, ist er wertlos — nachschaerfen, nicht weitergehen.

**Schritt 2 — Strategiedokument mit Phasen.** Erst wenn Schritt 1 rot ist. Jede Phase nennt
ihren Befund (B-x), ihre Messgroesse auf dem Pruefstand und ihren Rueckweg. Reihenfolge nach
Wurzeltiefe, nicht nach Bequemlichkeit — **B-1 (Doppel-Turns) ist die Wurzel und kommt
zuerst**: solange jede zweite Antwort auf einen halben Satz reagiert, misst du bei allen
anderen Befunden Rauschen. Danach B-5/B-6 (sie zahlen direkt auf die Kuerze-Vorgabe ein),
dann B-2/B-3, dann B-4.

**Schritt 3 — Umsetzung je Phase, als LEANER LEAD.** Ausfuehrliche Betriebsanleitung
unten im Abschnitt "Arbeitsweise des Leads". Kurz: du liest keinen Code, du spezifizierst,
startest, pruefst das Diff und merged.

**Schritt 4 — Die Modellfrage.** Wenn der Pruefstand steht, ist Haiku vs. Sonnet ein
A/B-Lauf, keine Phasenkette. Vorher nicht anfassen.

### Harte Grenzen

- **Token-Streaming bleibt AN** (Owner-Entscheidung 03.08.). Die Armierung bleibt eine
  **Allowlist** — eine Denylist faellt bei jedem kuenftigen Werkzeug fail-open.
- **Safety-Gates, Offenlegungssatz, Auth, Kostendecken** bleiben unberuehrt. Neue Endpunkte,
  die Calls/SMS ausloesen koennen, brauchen dieselben Gates.
- **Keine Phasenkette vor dem Pruefstand.** Das ist der Fehler, der 17 Phasen gekostet hat.
- **Kein Modellwechsel als Schnellschuss**, s. Schritt 4.

### Betrieb — was dich sonst Zeit oder Schaden kostet

- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen. `git push origin`
  macht **nichts** live. Live-Stand IMMER per `/healthz` pruefen, nie aus einer Notiz.
- **Lokaler `master` ist NICHT deploy-fertig:** er traegt eine fremde auth-gate-Kette
  (`b111927` entfernt das Basic-Auth-Gate, das heute als einziges 17 Routen schuetzt) mit
  einem dokumentierten offenen Blocker (kein Account hat `role='admin'`). **Nicht mitdeployen**
  ohne Ruecksprache. Parallel arbeitet moeglicherweise eine zweite Session am selben `master`.
- **Prod-DB-Forensik:** `psql "$(cat ~/.config/hermes/db-url)"`. RLS ist FORCE — ein naives
  `SELECT` liefert 0 Zeilen. Erst `SELECT set_config('app.current_tenant','<tenant>',false);`
  in **derselben** Sitzung. Die Tenant-Tabelle ist ohne das lesbar, `call` und
  `transcript_segment` nicht. Der relevante Tenant ist
  `t_user_01KX600834GCJFV9GTZQKWZMTH`. Rohtranskripte existieren nur befristet
  (`EVIDENCE_RETENTION_DAYS=7`) — **zieh sie dir als Erstes und sichere sie lokal.**
- **Turn-Diagnostik live:** Render-Logs, Zeilen `[telnyx-shim] turn_ok` mit `toolNames`
  (gefeuert) gegen `offeredToolNames` (angeboten), dazu `streamArmedRounds`, `streamChunks`,
  `thinkingSignal`, `consultPollFresh`, `latencyMs`, `roundtrips`.
- **`place_call` verlangt E.164** (`+49...`), obwohl die Werkzeugbeschreibung eine
  Aufloesung der fuehrenden 0 ueber das Heimatland behauptet. Kleiner eigener Befund.
- **Niemals `git stash`** (zwischen Worktrees geteilt), **niemals `git add -A`** (untrackte
  Dateien mit Kundendaten im Repo), Dateien einzeln adden.
- Nach vollen Testlaeufen `ps -eo pid,command | grep "[n]ode src/server.js"` pruefen.

### Pflichtlektuere, in dieser Reihenfolge

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md`
3. `tasks/al-chain-state.md`, **nur der Abschnitt 2026-08-03** (die Messung von AL-D3 und
   warum der Bench nichts belegt)

**Token-Disziplin:** `PLAN-ASSISTANT-LEAP.md` und die aelteren Kettenstaende sind
Nachschlagewerke. Greif mit `grep -n` hinein, lies nicht am Stueck.

### Haltung

Der Owner hat 17 gruene Phasen und ein kaputtes Telefonat. Er braucht keine weitere Phase,
die gruen abnimmt und nichts aendert. **Miss zuerst, dass du den Defekt reproduzieren
kannst. Behaupte keinen Gewinn, den du nicht gemessen hast. Und wenn eine Messung sagt, dass
deine Arbeit nichts gebracht hat, schreib genau das hin.**

Bei Unklarheit fragen, nicht raten — eine Annahme ist hier immer schlechter als eine
Rueckfrage.

---

## Beweismaterial ist bereits gesichert

Die Rohtranskripte der vier relevanten Anrufe liegen als Textdateien unter
`data/evidence/` (gitignored, also nicht im Repo — lokal auf der Maschine des Owners):

| Datei | Segmente | wozu |
|---|---:|---|
| `call_msczdf1aadbw.txt` | 38 | Beleg-Anruf 03.08. fuer B-1 bis B-7 |
| `call_msahzky8m8p9.txt` | 24 | 01.08., belegt B-1 **vor** dem Streaming-Deploy |
| `call_msabz9975sph.txt` | 17 | 01.08., zweiter Anruf |
| `call_msahy6o4y3ip.txt` | 0 | Waehlversuch ohne Gespraech |

Damit ist der Pruefstand aus Schritt 1 auch dann noch baubar, wenn die
`EVIDENCE_RETENTION_DAYS=7` in der DB abgelaufen sind. **Zieh dir trotzdem am Anfang
frische Kopien, falls seither weitere Anrufe stattgefunden haben.**


---

## Arbeitsweise des Leads — token-effizient und parallel, wo es geht

### Deine Rolle

**Du liest keinen Produktionscode.** Du schreibst Specs, startest Workflows, pruefst Diffs,
merged und berichtest. Jede Zeile Code, die du selbst liest, ist Kontext, der dir spaeter
fuer die Entscheidungen fehlt, die nur du treffen kannst.

**Konkret verboten:** ganze Plan-Dateien am Stueck lesen (`PLAN-*.md`, Kettenstaende sind
40-80 KB), Datei-Inhalte zusammenfassen, die du gerade gelesen hast, Optionen aufzaehlen,
die du nicht verfolgst, Agenten-Rueckgaben woertlich in den Chat kippen.

**Erlaubt und erwuenscht:** `grep -n` mit engem Muster, `git diff --stat`, strukturierte
Agenten-Rueckgaben (`schema`), Berichte in Dateien statt im Chat.

### Der Ablauf in drei Wellen

**Welle 0 — Kartierung (billig, parallel, NUR LESEND).**
EIN Workflow-Lauf mit einem Plan-Agenten **je Befund**, alle parallel. Jeder bekommt genau
einen Befund (B-1 … B-10 bzw. O-1/O-2/O-10) und liefert per `schema` zurueck:

```
{ phase, befund, dateien[], abhaengt_von[], risiko, messgroesse_am_pruefstand, aufwand }
```

**`dateien[]` ist der Zweck dieser Welle.** Daraus — nicht aus Bauchgefuehl — berechnest du,
welche Phasen parallel laufen duerfen: **disjunkte Dateimengen = parallel, jede
Ueberschneidung = seriell.** Diese Welle kostet fast nichts (kein Test-Lauf, kein Worktree)
und ersetzt das Raten.

**Welle 1 — Der Pruefstand, allein.**
Er blockiert alles andere und laeuft deshalb als einzige Phase. Abnahme: er reproduziert
B-1, B-4, B-5 und B-6 **ROT**. Parallel dazu darf **O-10** laufen (`diagnostic:true`
reparieren) — andere Dateien, und ohne O-10 ist jeder kuenftige Testanruf forensisch
wertlos, weil das Rohtranskript nach der Zusammenfassung geloescht wird.

**Welle 2+ — Die Befund-Phasen, gruppenweise parallel.**
Nach der Dateimenge aus Welle 0 gruppiert. **B-1 (Doppel-Turns) kommt zuerst und allein** —
solange jede zweite Antwort auf einen halben Satz reagiert, misst du bei allen anderen
Befunden Rauschen.

### Die Parallelitaets-Regel, die dieses Repo teuer bezahlt hat

**Parallelisiere INNERHALB eines Workflow-Laufs, niemals zwei Laeufe nebeneinander.**

Zwei gleichzeitige Workflow-Laeufe erzeugten ~35 gleichzeitige `node --test`-Prozesse und
Systemlast 32 auf 15 Kernen — die Maschine stand. Ein einzelner Lauf deckelt seine
Nebenlaeufigkeit selbst (`min(16, Kerne-2)`); mehrere Phasen in **einem** `parallel()`- oder
`pipeline()`-Aufruf sind deshalb sicher, zwei `Workflow`-Aufrufe nicht.

Zweiter Grund: jeder `master`-Commit waehrend eines laufenden Laufs erzeugt im anderen einen
**falsch-positiven Stale-Base-Blocker**. Also: **waehrend eine Welle laeuft, nicht nach
`master` mergen.**

### Token-Disziplin im Workflow-Skript

- **Per-Run-Skript** unter `.claude/workflows/runs/<kette>.js`, Phase **hart gepinnt**
  (`PHASE`, `BRANCH`, `SPEC_FILE`, `REPORT_PATH`) — **nicht** ueber `args`. Args-Misfires
  sind eine dokumentierte Falle. Vorlage: `.claude/workflows/runs/al-d3.js`.
- **Modellpolitik, explizit pro `agent()` gepinnt, nie erben lassen:** Plan und Safety-Review
  auf `opus`, Impl/Audit/Fix/Report auf `sonnet`. Kartierungs-Agenten (Welle 0) auf `sonnet`
  mit `effort: "low"` — sie lesen und listen, sie entscheiden nicht.
- **`schema` bei jedem Agenten**, der etwas zurueckgibt, das du auswertest. Freitext-
  Rueckgaben zwingen dich zum Lesen; ein Schema laesst dich rechnen.
- **Berichte gehen in Dateien**, nicht in die Rueckgabe. Die Rueckgabe traegt Zahlen und
  Pfade.

### Merge-Disziplin (jede Zeile hier wurde einmal bezahlt)

1. **Vor JEDEM Merge `git diff --stat master..<branch>`.** Ein PASS des Workflows ist keine
   Merge-Freigabe — ein toter Impl-Agent hinterlaesst einen leeren Branch und meldet
   trotzdem PASS.
2. **`git merge-base --is-ancestor master <branch>`** vor dem Merge. Schlaegt es fehl, ist
   der Branch auf veralteter Basis — und das Diff gegen `master` zeigt dir dann fremde
   Aenderungen als vermeintliche Loeschungen.
3. **Niemals `git add -A`** (untrackte Dateien mit Kundendaten im Repo), **niemals
   `git stash`** (`refs/stash` ist zwischen Worktrees geteilt).
4. Nach vollen Laeufen `ps -eo pid,command | grep "[n]ode src/server.js"` — Spawn-Tests
   lassen Server zurueck.

### Abnahme je Phase

`npm test` gruen ist die **Vorbedingung**, nicht das Ergebnis. Das Ergebnis ist die
**Messung auf dem Pruefstand**. Und die Kette endet mit einem echten Testanruf, den der
Owner beurteilt — er ist der einzige Messwert, der bisher immer recht hatte.

**Behaupte keinen Gewinn, den du nicht gemessen hast.** Sagt die Messung, dass deine Arbeit
nichts gebracht hat, schreib genau das hin. Das ist am 02.08. einmal passiert und war
wertvoller als jede gruene Suite.
