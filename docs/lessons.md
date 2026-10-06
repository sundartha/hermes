## PLAN-POLISH-A (Note B->A, 20 Phasen, 2026-07-18) — Lehren

- **Fail-closed-Guard-Typcheck:** `typeof x !== "number"` faengt NICHT NaN/Infinity (beide typeof "number").
  Fuer numerische Gates `!Number.isFinite(x)` -> throw (PA-10, vom Auditor nachgehaertet).

- **PM-1 Getter-statt-Kopie strahlt in die Tests aus.** Sobald Produktion `config.<ns>.<key>` liest,
  muss JEDER Test, der ein Fake-config baut, die Namespace-Getter ebenfalls exponieren. Loesung:
  attach-Helfer aus config.js exportieren (single source) und Test-Overrides darueber routen
  (withConfigNamespaces/makeConfigOverrides). Wert-Kopie-Configs laesen sonst still stale Werte.

## P3 (Peinlichkeits-Defekte: Cap/Reprompt/Inbound)

- **P3.3 kehrt eine bewusste Design-Entscheidung um.** Inbound-Minuten sehen den
  Budget-Guard nicht (`reconcileOutboundVoiceBudget` steigt bei Inbound aus) - der
  einzige Deckel ist `MAX_CALL_DURATION_S`. `MAX_EMPTY_TURNS` darf deshalb nie ueber 3
  gedreht werden.

## Live-Forensik (2026-07-22, Kosten-Endspiel-Verifikation)

- **Eine auffaellige Betriebszahl NICHT durch die naechstliegende Env-Variable erklaeren.**
  `anfragen=16` statt erwarteter 6-14 wurde spontan `COST_TRUING_MAX_ATTEMPTS=20`
  zugeschrieben - plausibel, aber falsch (der Wert stand auf 5). Der Umfang haengt an
  `poolSinceFor()`: dem Minimum des `endedAt` ueber ALLE Kandidaten. Regel: bevor eine Zahl
  einer Konfiguration zugeschrieben wird, die Stelle lesen, die sie erzeugt. Eine plausible
  Erklaerung ist keine gemessene.

- **Zwei aufeinanderfolgende Sweeps sagen mehr als einer.** Der Befund (Dauer-Leerlauf) wurde
  erst sichtbar, als der zweite Sweep dieselbe `uebersprungen=`-Zahl bei geschrumpfter
  Kandidatenmenge zeigte. Bei periodischen Jobs immer >=2 Laeufe vergleichen.

## Gate-Triage (2026-07-27, PLAN-GATES.md)

- **Ein roter SOLL-Test ist eine Behauptung, kein Beweis.** 20 Triage-Agenten haben alle 36
  roten Launch-Gates als `GUELTIG` klassifiziert - mit korrekten Belegen am Code. Zwei davon
  (GAP-23) waren trotzdem falsch: der Test setzt in seinem eigenen Setup
  `maxNumbersPerTenant: 9` und beklagt dann das Fehlen des Schutzes, den die Produktion mit
  `MAX_NUMBERS_PER_TENANT=1` laengst hat. **Regel: bei einem SOLL-Test zuerst pruefen, ob sein
  Setup eine Konfiguration herstellt, die es in Produktion nicht gibt.** Ein Agent, der nur
  Test und Zielcode liest, kann das strukturell nicht sehen.
- **Die Domaenenfrage des Owners schlaegt die Codeanalyse.** "Ein User kann doch gar keine
  zweite Nummer kaufen" hat in einem Satz zwei Phasen erledigt, die drei Agenten-Belege
  gestuetzt hatten. Bei Gates, die eine neue Sperre fordern, IMMER zuerst fragen: existiert
  die Bedrohung im Produkt ueberhaupt?
- **Nicht vom lokalen `.env`/Blueprint auf live schliessen.** Behauptung "Kunde ohne
  Tabelleneintrag bekommt eine deutsche Nummer" war falsch: `FORCE_NUMBER_COUNTRY=US`
  (`render.yaml:176`) sticht `PROVISIONING_COUNTRY=DE` aus - live bekommt JEDER eine
  US-Nummer. Ein Override, der vor der Tabelle greift, macht die ganze Tabellen-Phase live
  wirkungslos.
- **"Nichts ist hartkodiert" gilt achsenweise, nicht global.** Anruf-Kosten werden live bei
  Telnyx abgefragt (Cost-Truing), der Nummern-Hold ist eine Pauschale - und
  `searchNumbers` wirft das mitgelieferte `cost_information` weg. Vor einer Aussage ueber
  "wie das Produkt Preise behandelt" die konkrete Achse pruefen.

## Direkter Edit statt Phase (2026-07-29, Budget-Achsen-Divergenz)

- **Der Owner-Satz "das sollte es doch gar nicht mehr geben" ist eine Messanweisung.** Die
  Uebergabe hatte daraus eine Perioden-Anker-Hypothese gebaut; die Render-Audit-Zeile
  (`grund=reserve_ueber_rest`, `tenant=t_user_...`) zeigte in einer Abfrage, dass sogar der
  untersuchte Tenant der falsche war. **Runtime-Output vor Code-Rekonstruktion** (CLAUDE.md
  Regel 7) haette die ganze Hypothese gespart.

## Ein Riegel, der Dateien zaehlt, faengt den wahrscheinlichsten Fall nicht (2026-08-03, KV-P1b)

- Der Ein-Aufrufer-Riegel gegen Doppelbelastung pruefte, in WELCHEN DATEIEN
  `store.addVoiceUsageCostCents(` vorkommt, und verglich die Dateiliste. Ein zweiter Aufruf
  **in derselben Datei** aendert die Liste nicht - und genau dort liegt der bestehende
  Aufruf. Der Riegel deckte also alles ab ausser dem wahrscheinlichsten Fall.
- **Regel:** ein Textmuster-Riegel zaehlt Vorkommen, nicht Dateien. Und die Mutationsprobe
  muss BEIDE Faelle fahren (gleiche Datei / andere Datei) - der erste Lauf hatte nur den
  zweiten geprueft und den Riegel deshalb faelschlich fuer wirksam gehalten.

## Erst die Anbieter-Doku, dann die Diagnose (2026-08-04, GQ-Welle 0)

- **Zweimal in einer Stunde eine plausible Wurzel fuer B-1 behauptet, zweimal an einer
  Messung gestorben.** Erst "Endpointing steht auf 0,8 s" - der Wert existiert live gar
  nicht (`start_speaking_plan: null`, der Provisioner-Lauf hat ihn nie gesetzt). Dann
  "`eager_eot_threshold` wurde aktiv gesetzt, um Latenz zu sparen" - 0.8 ist der
  Telnyx-**Default**, und dieselbe Doku sagt: `eager_eot_threshold == eot_threshold`
  deaktiviert den eager-Modus bereits.
- **Der zweite Fehlschluss war teurer, weil schon gehandelt wurde:** die Live-Config war
  bereits gepatcht, als die Doku die Begruendung widerlegte. Ein Snapshot lag vor, der
  Schaden blieb null - aber nur wegen des Snapshots, nicht wegen der Vorsicht.
- **Regel:** ein Konfigurationswert ist erst dann ein Befund, wenn seine **Bedeutung** aus
  der Anbieter-Doku belegt ist - nicht schon, wenn er auffaellig aussieht. "Der Wert ist
  gesetzt" und "der Wert bewirkt X" sind zwei Behauptungen; die zweite braucht eine Quelle.
  Insbesondere: **ein Default sieht aus wie eine Entscheidung.** Vor jeder "jemand hat das
  absichtlich gesetzt"-Erzaehlung den Default nachschlagen.
- **Was richtig lief:** vor dem Eingriff `GET` auf die Live-Config und Snapshot nach
  `data/evidence/telnyx-config/` gesichert. Das ist der Grund, warum die widerlegte
  Diagnose folgenlos blieb. Bei Provider-Konfiguration IMMER erst lesen und sichern.

## Die Kartierung raet nicht - der Lead misst nach (2026-08-04, GQ-Welle 0)

- Drei von zwoelf Karten trugen eine Erklaerung, die die Nachmessung widerlegt hat. Alle
  drei Agenten hatten sauber gearbeitet und ihre Annahme als Bedingung formuliert
  ("falls der Testanruf inbound war", "Anruf an ein Fremdziel faellt strukturell durch").
  Die Bedingung war jeweils in einer SQL-Abfrage oder einer Owner-Frage pruefbar.
- **B-4:** Der Beleg-Anruf ist outbound - das angebotene Inbound-Gate greift dort nicht.
- **O-10:** Der Owner hatte nur sich selbst angerufen; die Wurzel war die leere
  `private_number`, eine Zeile ueber der geprueften Bedingung.
- **Regel:** ein Kartierungs-Schema braucht ein Feld wie `wurzel_belegt` mit dem Wert
  "hypothese-messbar" - und der Lead muss jede so markierte Karte VOR der Phasenplanung
  gegenmessen. Eine Phase auf einer ungeprueften Bedingung zu bauen kostet die ganze Phase.

## Der Anstoss kam vom Provider, nicht vom Anrufer (2026-08-04, GQ-P5)

- **Der schlimmste Defekt des Gespraechs war kein Modell-Problem.** Sechsmal "ich warte
  still" sah aus wie eine Prompt-Schwaeche. Tatsaechlich stoesst Telnyx nach
  `user_idle_reply_secs` Sekunden Stille selbst einen Turn an, und der Shim las nur die
  letzte `user`-Rolle - also die ALTE Aeusserung, die er dann erneut beantwortete.
  Der Gegenbeleg stand woertlich im Transkript: *"Ich hab nix gesagt, Digger."*
- **Ein Feld im Log hat es entschieden, nicht eine Hypothese.** `turn_probe` trug
  `lastRole` bereits seit GQ-S1 - niemand hatte es gelesen. Sechs `same`-Turns trugen
  durchgehend `lastRole: "system"`. **Wer eine Sonde baut, muss ihre Felder auch auswerten;
  eine ungelesene Sonde ist so gut wie keine.**
- **Beinahe-Fehler, teuer:** die erste Zuschnitt-Idee war "waehrend einer laufenden
  Rueckfrage nicht antworten". Nachgerechnet an den Zeitstempeln deckt das **1 von 6**
  Faellen ab - die Rueckfrage war bei den uebrigen fuenf laengst beantwortet. Die Regel aus
  dem Kickoff (erst die Zahl, dann die Phase) fing das ab, **bevor** Code entstand.
- **Reihenfolge schlaegt Riegel.** Der naheliegende Platz (ganz vorn, vor allen Gates) waere
  falsch gewesen: der Anstoss ist ein Lebenszeichen. Vor `observeTurn` platziert, haette der
  Dead-Air-Notaus genau waehrend einer Rueckfrage aufgelegt, in der der Anrufer absichtlich
  schweigt. Ein Riegel braucht immer die Frage: *was haengt sonst noch an diesem Signal?*
- **Zwei Kickoff-Befunde waren falsch und wurden am Log widerlegt:** B-5 ("`end_call` feuert
  nie") - er feuerte in turnSeq 19. N-3 ("zweiter Consult kommt nicht zustande") - kein
  Defekt, sondern `MAX_IN_CALL_CONSULTS_PER_CALL = 1`. **Auch ein Befundkatalog ist eine
  Behauptung, kein Messwert.**

## Ein gebuendelter Schreibpfad kann den Defekt vor dem Test verstecken (2026-08-06, GQ-H1-a)

- Die Lehre "der Test muss den Defekt reproduzieren" war bekannt — und hat trotzdem fast
  nicht gegriffen. Sieben frische pg-Tests waren gruen **und blieben gruen, als ich den Fix
  probeweise wieder ausbaute**. Sie haben nichts gemessen.
- **Und die Gegenprobe bleibt Pflicht, auch wenn man sie schon kennt:** Fix ausbauen, Test
  laufen lassen, Rot sehen, Fix zurueck. Erst dann ist ein gruener Test ein Beleg. Hier
  brachte sie zusaetzlich einen echten Design-Fehler ans Licht — der erste Fix (Zeilen
  ZAEHLEN) war falsch, weil Schrumpfen-dann-Wachsen ohne Flush dazwischen die Zahl zufaellig
  wieder stimmen laesst, waehrend Zeile i und Segment i auseinanderlaufen. Der Abgleich muss
  ueber den INHALT gehen.

## Beim Aufraeumen eines Sonden-Signals zuerst fragen, wer das Signal sonst noch erzeugt (2026-08-06, GQ-H1-a)

- Der Riegel haengt an "Telnyx' Nachrichtenliste ist nicht gewachsen". Das ist ein sauberer
  Anbieter-Beleg — hat aber einen **zweiten Erzeuger**: die doppelte Zustellung desselben
  Requests. Dort ist die Liste ebenfalls unveraendert, die Antwort des Vorgaengers aber
  gesprochen. Der Riegel haette genau dort eine echte Aeusserung geloescht.
- Bitter: die doppelte Zustellung ist **der Befund, fuer den diese Sonde ueberhaupt gebaut
  wurde** (`prevRelation "same"`, turnSeq 1 und 2 eine Millisekunde auseinander, 04.08.).
  Das Gegenbeispiel stand im Kopfkommentar der Datei, die ich gerade aenderte.
- **Regel:** Bevor ein beobachtetes Signal eine Entscheidung traegt, die Faelle aufzaehlen,
  in denen dasselbe Signal aus einem ANDEREN Grund entsteht — und den Ausschluss so bauen,
  dass er die Bedingung nur strenger macht (er kann dann keine neuen Fehlalarme erzeugen,
  nur welche verhindern).
- Gefunden hat es nicht der Test, sondern das kritische Gegenlesen des eigenen Diffs vor dem
  Commit. Der Test kam danach — und ist ohne den Ausschluss rot.

## Ein ignorierter Parameter ist unsichtbar, bis man Fingerabdruecke vergleicht (2026-08-06, B-7)

- Die Replay-Bank schickte dieselbe Aufnahme durch `flux`, `nova-2` und `nova-3` und bekam
  dreimal **12,9 %** WER. Ich hatte den Parameter `transcription_model` gesetzt — er heisst
  aber `model`. Der falsche Name wird still ignoriert, alle drei Laeufe liefen auf demselben
  Default. Eine Minute lang stand da eine plausible, vollstaendig falsche Aussage
  ("alle Deepgram-Modelle sind gleich gut, das Problem liegt woanders").
- **Aufgefallen ist es nur am SHA der Ausgabe.** Drei angeblich verschiedene Modelle lieferten
  byte-identischen Text — bei bloss gleicher *Prozentzahl* haette ich es fuer Zufall gehalten.
- **Regel:** Wenn ein Lauf eine Variable variieren SOLL, muss die Auswertung beweisen, dass
  sie variiert hat. Fingerabdruck (Hash) je Ergebnis mitloggen und auf Kollisionen pruefen.
  Zwei identische Ergebnisse bei verschiedener Eingabe sind ein **Fehleralarm**, kein Befund.
- Verwandt, gleiche Wurzel: die Zusatzparameter `eot_threshold`/`eager_eot_threshold` an
  dieselbe Schnittstelle aenderten nichts. Ich habe daraus NICHT "die Schwellen wirken nicht"
  geschlossen — bei einer Schnittstelle, die unbekannte Parameter still schluckt, ist
  "kein Unterschied" kein Messergebnis, sondern eine offene Frage.

## Ein Selbsttest, der denselben Parser benutzt wie der Code, prueft nichts (2026-08-06, B-7)

- `scripts/stt-wer.mjs` hatte eine eingebaute Plausibilitaetspruefung: Aufnahme-Start und
  Konversations-Start duerfen nicht weiter als 3 s auseinanderliegen. Sie meldete **0,47 s** —
  waehrend die Turn-Tabelle Fenster von **7207 s** auswarf.
- **Ursache:** Telnyx liefert `created_at` bei Aufnahmen OHNE Zonenanteil
  (`2026-08-06T09:41:32`), bei Nachrichten MIT `Z`. `Date.parse` liest den ersten als
  **Ortszeit** — in Europa/Berlin 2 h daneben. Die Anker-Pruefung verglich zwei gleich falsch
  geparste Werte und war deshalb blind fuer genau den Fehler, gegen den sie gebaut war.
- **Regel:** Eine Konsistenzpruefung muss ihre beiden Seiten aus **unterschiedlichen** Quellen
  ziehen, sonst prueft sie nur sich selbst. Und: fremde Zeitstempel laufen durch EINE
  Parse-Stelle, die einen fehlenden Zonenanteil ausdruecklich behandelt — nie durch das
  blosse `Date.parse` an mehreren Stellen.
- Gefunden hat es nicht die Pruefung, sondern eine Zahl in der Ausgabe, die offensichtlich
  nicht sein konnte (7207 s in einem 75-s-Anruf). **Ausgaben, deren Groessenordnung ein Mensch
  sofort beurteilen kann, sind mehr wert als eine stille Zusicherung.**

## Das Gefuehlte messbar machen war der ganze Fortschritt (2026-08-06, B-7)

- Fuenf Phasen und drei Prompt-Runden hatten an der Gespraechsqualitaet nichts Hoerbares
  bewirkt. Was B-7 in einer Sitzung geloest hat, war kein besserer Fix, sondern eine
  **Messlatte**: Telnyx zeichnet dual-channel auf, also laesst sich der Kanal der Gegenstelle
  isolieren, von einem zweiten Erkenner abschreiben und als Wortfehlerrate gegen das stellen,
  was der Anbieter verstanden hat.
- **Die Kontrolle macht die Zahl erst belastbar:** der Agentenkanal hat eine ECHTE Ground
  Truth (wir wissen aus dem Protokoll, was der Agent gesagt hat). Dass die Referenz dort
  94-96 % zurueckholt, ist der Beweis, dass 45,7 % auf dem anderen Kanal nicht der Messung
  anzulasten sind. Eine Referenz ohne Kontrolle ist eine zweite Meinung, keine Messung.
- **Und sie hat eine eigene Streuung:** zwei Laeufe derselben Aufnahme ergaben 45,7 % und
  47,1 %. Ein Unterschied unter ~2 Punkten ist damit kein Ergebnis.
- **Regel fuer die naechste "der Agent versteht mich nicht"-Frage:** zuerst fragen, welche
  Aufzeichnung der Anbieter ohnehin schon anlegt — und ob sich daraus ein Vorher-Wert bauen
  laesst, BEVOR jemand eine Konfiguration anfasst. Ein Testanruf kostet einen Menschen,
  ein Messlauf kostet Sekunden.

## Eine Probe, die bei null Befunden schweigt, ist nicht von einer kaputten zu unterscheiden (2026-08-07, STT-A1)

- `scripts/telnyx-stt-drift.mjs` lief gegen die echte API, endete mit **Exit 0 und komplett
  leerer Ausgabe**. Das las sich wie "alles in Ordnung". Tatsaechlich hatte die Probe ihre
  halbe Aufgabe nie erledigt: die Telnyx-Einstellungen liegen unter `transcription.settings`,
  die Schleife iterierte aber `Object.keys(transcription)` — dort stehen nur
  `model/language/api_key_ref/region/settings`. **Kein Schluessel konnte je treffen.**
- Am Live-Objekt standen zu diesem Zeitpunkt `eot_threshold: 0.9` und `eot_timeout_ms: 5000`
  flux-only an einem nova-3-Modell. Die Probe war genau dafuer gebaut und hat es uebersehen.
- **Der Test hat es nicht gefangen, weil seine Fixtures dieselbe falsche Verschachtelung
  benutzten wie der Code** (`transcription: { model, eot_threshold: 0.9 }`). Beide Seiten
  waren gleich falsch — dieselbe Wurzel wie beim Zeitzonen-Selbsttest in B-7: eine Pruefung,
  die ihre beiden Seiten aus derselben Quelle zieht, prueft nur sich selbst.
- **Zwei Regeln:**
  1. Die Fixture einer Fremd-Datenform stammt aus einem **echten** Aufruf (Momentaufnahme,
     Datum, Feldliste im Kopfkommentar) — nie aus dem Kopf des Implementierers und nie aus
     dem Code, der sie liest.
  2. Ein Pruefwerkzeug gibt **immer** eine Zeile aus, auch bei null Befunden ("geprueft X
     gegen Y -> 0 Befunde"). Stille als Erfolgssignal verschluckt genau den Fall, in dem gar
     nicht geprueft wurde.
- Gefunden hat es nicht das Gate (Safety-Review approved, Clean-Code keine S1/S2) und nicht
  die Suite, sondern **das tatsaechliche Ausfuehren gegen die echte API** in der Abnahme.
  Ein Werkzeug, das in der Phase gebaut, aber nie scharf laufen gelassen wird, ist unbelegt.

## Eine Konstante zu flippen ist nicht dasselbe wie eine Entscheidung zu flippen (2026-08-07, C-P1/C-P1b)

- C-P1 stellte `DEFAULT_PROVIDER` von Twilio auf Telnyx. Meine Spec nannte **vier** Leser
  dieses Rueckfalls; der Plan-Agent fand **zehn**. Schlimmer: es gab **fuenf weitere,
  voellig unabhaengige** Anbieter-Defaults, die `DEFAULT_PROVIDER` gar nicht lesen - als
  Parameter-Default `(provider = PROVIDER.TWILIO)` in `registry.js` (voiceControl,
  messaging, mediaTransport, webhookEvents, voiceRenderer).
- **Vor dem Flip waren beide Antworten Twilio - konsistent. Der Flip hat die Divergenz
  ERZEUGT:** ein Call ohne Provider-Feld lief in `/voice/turn` (Parameter-Default) nach
  Twilio und in `/voice/status` (`|| DEFAULT_PROVIDER`) nach Telnyx. Dieselbe Frage, zwei
  Antworten, im selben Request-Pfad. Live erreichbar, nur zufaellig folgenlos, weil alle
  Produktionszeilen ihren Provider ausdruecklich tragen.
- **Regel:** wer eine Default-Entscheidung umstellt, grept NICHT nach dem Namen der
  Konstante, sondern nach dem **Wert** und nach allen Formen, in denen dieselbe Entscheidung
  ausgedrueckt sein kann: Parameter-Defaults, `||`-Rueckfaelle, `??`-Rueckfaelle, Fixtures,
  Kommentar-Behauptungen. Die Frage lautet "wer beantwortet 'wer gilt, wenn nichts es
  sagt?'", nicht "wer importiert `DEFAULT_PROVIDER`?".
- **Der Faenger gehoert gegen die Quelle formuliert, nicht gegen den Wert.** Der
  Bestandstest hiess "arg-lose Factories defaulten byte-identisch" und pinnte `twilioVoice`
  - er musste bei jedem Wechsel von Hand nachgezogen werden. Jetzt lautet er
  `factory() === factory(DEFAULT_PROVIDER)` ueber ALLE Factories: er ueberlebt jeden
  kuenftigen Wechsel und faengt trotzdem jeden neu hartkodierten Default.
- Gefunden hat es kein Gate (Safety approved, Clean-Code sauber) und kein Test, sondern ein
  **beilaeufiger Satz eines Inventur-Subagenten** ueber eine ganz andere Frage. Fremde
  Befunde ernst nehmen, auch wenn sie neben dem Auftrag liegen.

## 2026-08-07 (Session 2bd10950, Track-C-Abschluss C-P4-C-P6)

- **`timeout` existiert auf macOS nicht.** Ein Smoke-Test, der ihn nutzt, startet den
  Server NIE und misst 000 - das sieht aus wie "Dienst kaputt", ist aber "nie gestartet".
  Erst das Log lesen (Regel 7), dann urteilen: der echte Boot-Refusal kam von einem
  UNVERWANDTEN Guard (COST_TRUING_REQUIRED_RECORD_TYPES fehlt in der lokalen .env -
  vorbestehend, kein Phasen-Defekt).
- **Zwei unabhaengige Wege zum selben Befund sind ein starkes Signal.** Der
  C-P5-Spec-Agent (Weisse-Flecken-Erhebung) und der C-P4-Safety-Reviewer fanden
  UNABHAENGIG denselben Defekt (Betreiber-Skripte mit PROVIDER.TWILIO=undefined ->
  Provider-Filter still abgeschaltet). Parallele Spec-Erhebung neben dem Review kostet
  wenig und verdoppelt die Fangchance fuer genau die Klasse "stille Bedeutungsumkehr".

## Ein Messwerkzeug braucht eine Attrappe, sonst prueft man nur die Rechnung (2026-08-08, B1)

- Das B1-Messskript bestand `node --check`, 22 Selftest-Zusicherungen, den Trockenlauf und
  einen scharfen Lauf mit Falsch-Schluessel (fail-closed, Verzeichnis blieb leer). Alles
  gruen. Der adversarische Review fand danach **fuenf S1** - jeden einzelnen an einer
  selbstgebauten **Offline-Attrappe** der Anbieter-API, die er in ~15 min hochgezogen hat
  (lokaler HTTP-Server fuer die drei Endpunkte, Skript-Kopie mit Basis-URL aus Env und
  skaliertem `delay()`; das sind zwei geaenderte Zeilen).
- **Die Attrappe ist der eigentliche Hebel, nicht der Review.** Ohne sie kann man ein
  Messwerkzeug nur gegen den Gutfall pruefen - und der Gutfall ist nie das Problem. Alle
  fuenf S1 lagen im Fehlerfall: Endpunkt antwortet 500, Verbindung bricht ab, Zahlenformat
  wechselt, Bremse feuert mittendrin. **Diese Faelle kann kein Trockenlauf und kein
  Selftest erzeugen.** Regel: wer ein Werkzeug gegen eine fremde API baut, baut die
  Attrappe im selben Zug - sie kostet weniger als eine Fehlmessung.
- **Die Fehlerklasse war jedes Mal dieselbe: nicht die Rechnung war falsch, sondern die
  Meldung.** Die BigInt-Geldarithmetik war handnachgerechnet korrekt; trotzdem erschien
  dieselbe Abbuchung als `-1000000` je Aufruf und `-6` gesamt, weil beide Konsumenten die
  von der Funktion korrekt gelieferte `scale` wegwarfen. **Eine Ganzzahl ohne ihre Skala
  ist keine Geldangabe.** Wer Geld als Ganzzahl fuehrt, fuehrt die Skala mit, ueberall.
- **Der teuerste Befund war ein Exit 0.** Guthaben-Endpunkt durchgehend HTTP 500 ->
  Exit 0, `key_leak_check: clean`, M2 "beantwortet" mit leeren Objekten. Das liest sich
  als "es gibt keine Ist-Kosten-Quelle" - woertlich ein Entscheidungszweig der Spec. Eine
  Messung, die nie stattfand, waere als Messergebnis dem Owner vorgelegt worden. Dieselbe
  Wurzel wie bei der STT-Drift-Sonde: **eine Probe, die bei null Befunden schweigt, ist
  nicht von einer kaputten zu unterscheiden** - hier in der Variante "eine Auswertung, die
  fehlende Daten nicht von unauffaelligen Daten unterscheidet".
- **Der Fix dagegen ist immer derselbe und gehoert in jede Auswertung:** die leere Menge
  ist ein eigener Fall. `0 Treffer` ist nur dann ein Ergebnis, wenn es erfolgreiche
  Aufrufe gab; `0 Abweichungen` nur bei nicht-leerer Vergleichsmenge; `key_leak_check:
  clean` nur bei > 0 geprueften Dateien. Die Meldung nennt die Grundgesamtheit mit
  ("clean (5 Dateien, 812345 Bytes geprueft)"), sonst kann der Leser beides nicht trennen.
- **Was die Gates NICHT gefangen haetten:** kein Test (die Spec verbot einen), keine Suite,
  kein `node --check`, kein Trockenlauf. Gefangen hat es allein die Frage *"welche Sabotage
  muesste diese Zusicherung rot machen - und wird sie es?"*, 14-mal gestellt und
  ausgefuehrt. Bei der Re-Verifikation belegte dieselbe Suite die Behebung.
- **Nebenbefund, der Zeit spart:** eine Pause innerhalb einer Modellschleife laeuft je
  Modell einmal. 2 x 30 min statt 1 x 30 min hat die Laufzeit fast verdoppelt (80-95 statt
  45-55 min) - gefunden nicht durch Nachdenken, sondern weil der Reviewer die Schlafzeit
  ausgerechnet hat.
- **Spec-Konflikte benennen statt still absenken.** M1s Abnahme verlangte Verteilung "ueber
  beide Modelle und beide Betriebsarten"; ein Kreuzprodukt war per Konstruktion
  unerfuellbar (nur EIN Block streamt, und der faehrt nur ein Modell - empirisch 23/17/4/0
  ueber die vier Zellen). Der Fixer waehlte die woertliche Lesart (zwei Randpruefungen) und
  **meldete die Abweichung samt Aussagekraft-Verlust**. Genau so gehoert es: die schwaechere
  Aussage kommt in die Uebergabeliste, nicht in eine Fussnote.

## Ein Pruefkommando ohne Positiv-Kontrolle kann still 0 melden (2026-08-08, B2)

Die B2-Spec schrieb den Abnahme-Grep fuer "keine Laufzeit-Logik" so aus:
`grep -nE "function\|=>\|\bconst\b\|\blet\b" src/llm/ports.js` — und verlangte, dass er
**keine** Treffer ausserhalb von Kommentaren liefert.

- **Das Kommando war defekt.** In einem ERE ist `\|` das LITERAL "|", kein
  Alternations-Operator. Der Ausdruck suchte also nach der Zeichenkette
  `function|=>|\bconst\b|\blet\b` am Stueck — die es nirgends gibt. **Der Grep haette bei
  JEDER Datei 0 Treffer gemeldet**, auch bei einer voller Laufzeit-Logik.
- **Die Abnahme haette also gruen gemeldet, ohne irgendetwas zu pruefen.** Das ist genau
  die Klasse aus [[Ein Messwerkzeug braucht eine Attrappe]]: nicht die Rechnung war falsch,
  sondern die Meldung.
- **Gefangen hat es die Positiv-Kontrolle.** Der Impl-Agent liess denselben Grep gegen
  `src/telephony/ports.js` laufen — eine Datei, von der bekannt ist, dass sie viele
  JSDoc-Treffer traegt. Erwartet ~23, geliefert 0. Erst dieser Widerspruch entlarvte das
  Kommando; die Zieldatei allein haette nie widersprochen.
- **Regel:** ein Pruefkommando, dessen Erfolgsfall "leere Ausgabe" ist, muss **einmal gegen
  einen bekannten Positiv-Fall** laufen, bevor man seiner Null glaubt. Ohne diesen Lauf ist
  "keine Treffer" nicht von "sucht nichts" zu unterscheiden — und beides sieht im Protokoll
  identisch aus.
- **Ersatz war nicht der reparierte Grep, sondern die staerkere Frage.** Statt "kommen
  verbotene Zeichenketten vor?" wurde gepruefte: Kommentare entfernen, und der Rest der
  Datei muss **exakt** `export {};` sein. Das ist eine Positiv-Aussage ueber den
  Gesamtinhalt statt einer Negativ-Aussage ueber eine Musterliste — sie kann nicht dadurch
  gruen werden, dass das Muster nicht passt.

**Zweiter Befund derselben Phase, andere Wurzel:** die Spec belegte `toolChoice "auto" |
"required"` mit `precall-briefing.js:236`. Die Zeile stimmte, die Aussage nicht — direkt
darueber, in `:235`, steht ein **benannter** Werkzeug-Zwang (`{type:"tool", name}`), den
ein zweiwertiges Feld nicht ausdruecken kann. **Eine korrekt zitierte Zeile belegt nur, was
in ihr steht, nicht die Vollstaendigkeit der Aufzaehlung.** Wer eine Enum-Wertemenge aus
einem Zitat ableitet, muss alle Rueckgaben der Funktion ansehen, nicht eine.

## Live-Abnahme 2026-08-09: fuenf Lehren aus einer Fremd-Diagnose

### 1. Eine widerlegte Wurzel bleibt im Kettenstand stehen und leitet die naechste Session fehl

`tasks/gq-chain-state.md` fuehrte `eager_eot_threshold` als Wurzel des Kappens und notierte,
es lasse sich per API nicht loeschen. Beim Nachmessen am Live-Assistant stand es auf `null` —
laengst entfernt, und der Defekt war trotzdem staerker geworden. Waere ich der Notiz gefolgt,
haette ich Stunden an einem bereits geschlossenen Feld verloren.

**Regel:** eine dokumentierte Wurzel ist eine Hypothese mit Verfallsdatum. Vor JEDER
Weiterarbeit daran den Ist-Zustand am lebenden System messen (`GET`, Snapshot), nicht die
Notiz lesen. Das ist dieselbe Regel wie "Deploy-Stand nie aus einer Notiz lesen", nur fuer
Provider-Config.

### 2. Der Agent erfindet im Gespraech technische Diagnosen — und sie klingen glaubwuerdig

Woertlich gesprochen: *"Ich gebe das an Antonio weiter, damit er die Audio-Pipeline
ueberprueft."* Es gab kein Audio-Pipeline-Problem. Der Verlust passierte bei Telnyx, nachweisbar
NACH unserer Auslieferung. Haette der Owner diese Aussage als Befund weitergereicht, waere die
Diagnose in die voellig falsche Richtung gelaufen.

**Regel:** was der Agent IM Gespraech ueber sich selbst behauptet, ist Gespraechsinhalt, kein
Messwert. Es gehoert nie in eine Ursachenanalyse.

### 3. Sprechdauer gegen Zeichenzahl ist ein Abbruch-Detektor — und braucht eine Kontrolle

Telnyx' Gespraechsprotokoll traegt `sent_at` und `ended_at`. `len(text)/Dauer` liefert
Zeichen/s. Die intakten Antworten lagen bei 17,6 und 17,7 — die gekappte fiel durch **beides**
auf: unnatuerliche 20,1 Zeichen/s UND ein Text, der ohne Satzzeichen endet.

Die intakten Antworten sind dabei die eigentliche Leistung der Methode: **ohne sie waere 20,1
nur eine Zahl.** Erst die enge Streuung der Kontrollgruppe macht den Ausreisser lesbar. Eine
Messung ohne Kontrollwert kann keinen Ausreisser nachweisen.

### 4. Ein Feldname wird belegt, nie geraten — auch wenn er "offensichtlich" ist

Ich habe `content` angenommen (OpenAI-Konvention). Telnyx nennt es `text`. Alle sechs
Nachrichten kamen mit 0 Zeichen zurueck. Gerettet hat NUR, dass "0 Zeichen bei allen sechs"
unmoeglich sein kann — die Ausgabe war selbst-widerlegend.

**Das ist exakt der Fehler, der die LCT-Kette 297 von 297 Belegen gekostet hat**
([[cost-truing-leg-join-root-cause]]). Er ist diesmal in einer Minute aufgefallen, weil das
Messskript die Zeichenzahl mit ausgab. **Ein Messwert ohne Plausibilitaets-Anker ist blind:**
haette ich nur den Text ausgegeben, waeren sechs leere Zeilen als "keine Nachrichten" durchgegangen.

### 5. Ein Subagent ohne Worktree-Zwang wechselt den Branch im HAUPT-Verzeichnis

Auftrag lautete *"erst `git checkout -b <branch> master`, dann arbeiten"* — ohne
`isolation: worktree`. Der Agent hat den Haupt-Worktree auf seinen Spike-Branch gezogen. Es
ging gut aus (gleicher Commit, sauberer Baum), aber jeder Lead-Commit waere in dieser Zeit auf
dem Spike-Branch gelandet.

**Regel:** ein Agent, der einen Branch anlegt, bekommt entweder `isolation: worktree` oder den
ausdruecklichen Auftrag, `git worktree add` zu benutzen. "checkout -b" im Agent-Prompt ist ein
Eingriff in das Verzeichnis, in dem der Lead selbst steht.

### Nebenlehre: ein Test-Anruf misst nur, was ins Zeichenlimit passt

Beide Testanrufe hatten ein `objective` ueber `OPENING_GOAL_MAX_CHARS` (75) — 157 bzw. 87
Zeichen. Beide wurden mitten im Satz gekappt, und der Owner meldete das als Defekt. Wer einen
Sprechpfad testet, prueft VORHER die Kappungsgrenzen des Pfades, sonst misst er sein eigenes
Eingabefehler-Verhalten.

## B3b-Abnahme: zwei Fallen, die eine gruene Zahl vorgetaeuscht haetten

### 2. Workflow meldete `fail 0`, der eigene Lauf fand `fail 1` — zum ZWEITEN Mal

Der Workflow gab `gate: PASS`, `testPassCount: 4086`, `fixRounds: 0`. Der eigene Lauf im
Worktree: **4086 tests, 4085 pass, fail 1** (`AM6: geseedeter Owner-sub -> Gateway-Tenant`).

Isoliert nachgefahren: **5/5 gruen, Exit 0**. Der Beleg fuer "Flake" ist dabei nicht das gruene
Ergebnis allein, sondern die **Laufzeit**: 321 ms isoliert gegen 3449 ms unter Volllast. Der
Test wartet auf eine Log-Zeile und lief unter Last in sein Timeout. Dazu kommt das
Bereichsargument: B3b hat OAuth/MCP nicht angefasst.

**Regel bestaetigt:** rot zaehlt nur, wenn isoliert rot — aber "isoliert gruen" allein ist noch
kein Freispruch. Es braucht einen MECHANISMUS (hier: Timing unter Last, an der Laufzeit
ablesbar) plus das Argument, dass der rote Bereich vom Diff gar nicht beruehrt wird.

## 2026-08-19 (EL-Cutover-Merge)

- **Haengende Suite zuerst auf Zombies pruefen:** ein Suitelauf einer frueheren
  Session hielt seit Stunden 15 Worker; `ps -eo pid,lstart` entlarvt das Alter.
  Killen, dann frisch messen - sonst diagnostiziert man den falschen Haenger.

## 2026-08-29 Der teuerste Fehler der Kette: Beweispflichten ohne Kostensignal

Der Owner hat den Verbrauch beanstandet. Nachgemessen (`scripts/workflow-kosten.mjs`,
an diesem Tag gebaut): **12.757 Mio Token ueber 118 Laeufe** in diesem Projekt; ein
einzelner Implementierungs-Agent 447 Mio in 955 Turns.

**5x Warum:**

1. Warum kostete ein Agent 447 Mio? Kosten = Kontext x Turns. 955 Turns bei ~467k
   Kontext; 99,7 % war Wiederlesen, sein Produkt waren 48k Output.
2. Warum wurde der Kontext so gross? Das Skript forderte zwoelfmal "Kommando + Ausgabe
   **woertlich**", und jeder Agent sollte die volle Suite (5.400 Tests, >11.000 Zeilen)
   selbst fahren, plus Sabotage-Gegenproben mit je einem weiteren Lauf.
3. Warum forderte es das? Weil jede Etappe im Review echte Defekte fand, die Tests nicht
   fingen. Die Antwort war jedes Mal eine weitere Beweispflicht: 6 -> 9 -> 6 -> 7 -> 10
   -> 12 ueber E1..E5. Jede Ergaenzung war fuer sich richtig. Keine wurde je zurueckgenommen.
4. Warum fiel das Wachstum niemandem auf? Weil `subagent_tokens` die Cache-Reads nicht
   zaehlt und dadurch 3 Mio meldete fuer einen Lauf, der 861 Mio kostete.
5. Warum gab es kein anderes Signal? Weil die echte Zahl zwar in den Transkripten steht,
   aber **nichts sie je gelesen hat**. Die Uebergabe schrieb "rund 15,5 Mio" fuer eine
   Kette, die 3.060 Mio kostete - Faktor 197 - und die naechste Sitzung glaubte es.

**Wurzel:** ein selbstverstaerkender Kreis ohne Gegenkraft. Beweispflichten wachsen
monoton (jede durch einen echten Defekt gerechtfertigt), das einzige sichtbare
Kostensignal zeigt um Faktor ~200 zu niedrig. Nichts drueckt dagegen.

**Die verallgemeinerbare Lehre:** eine Qualitaetsmassnahme, die nur hinzugefuegt und nie
zurueckgenommen wird, ist eine Ratsche - und eine Ratsche ohne Kostenmessung laeuft
zwangslaeufig aus dem Ruder. Wer eine Beweispflicht ergaenzt, nennt ihren Preis, oder
nimmt eine andere weg.

## 2026-09-04 Das Transkript ist kein Beleg fuer das, was gesagt wurde

Die Vorsession hat aus dem EL-Transkript (`"No. ¿Sí está ahí?"`, `source_medium: audio`)
geschlossen, der Eigentuemer habe etwas gesagt, und daraus die Frage "falsch gehoert oder
mehrdeutig?" gebaut. Das Audio zeigt: er hat nichts gesagt. Der Turn war ein Phantom der
Spracherkennung — und derselbe Phantomtyp stand schon im "guten" Vergleichsanruf, als
"Wie?"/"Wie sind?", also sprachlich unauffaellig und deshalb nie bemerkt.

**Regel:** Wo Audio existiert (`record_voice: true`), ist das Audio der Beleg, das Transkript
nur ein Zeiger. Vor jeder Aussage ueber eine Aeusserung: Stille-Messung (silencedetect) plus
unabhaengige Transkription mit Positiv-Kontrolle (ein echter Turn muss laut sichtbar sein).
Und: ein "guter" Anruf ist erst gut, wenn auch seine User-Turns am Audio geprueft sind — der
Vergleichsanruf hatte denselben Defekt, nur mit harmlosem Ausgang.

**Zweite Lehre:** "Warum feuert Werkzeug X zum ersten Mal?" war die falsche Leitfrage. Beide
Werkzeuge feuerten als FOLGE (erster echter Mailbox-Kontakt; Sprachwechsel bereits vollzogen).
Erst die Reihenfolge im Anruf klaeren (was kam zuerst?), dann nach Ursachen suchen.

## 2026-09-07 Ein owner-pflichtiger Punkt gehoert nicht in die Self-Fix-Schleife

P4b (Portugiesisch) hat 429,7M Token verbrannt, drei Fix-Runden durchlaufen und ist am Ende
BLOCKED geblieben — an genau den zwei Punkten, die seine eigene Spec vorher als
**owner-pflichtig** deklariert hatte (E-3 "keine Stimme wird geraten", E-4 "der
Offenlegungssatz ist owner-pflichtig"). Keine Fix-Runde konnte sie schliessen, weil sie
keine Code-Fragen sind: eine Stimm-ID ist nur per Synthese belegbar, und ein
Art.-50-Wortlaut braucht eine Freigabe, keine Implementierung.

Schlimmer als die Kosten ist, was der Impl-Agent stattdessen tat: er hat die verbotene
Entscheidung selbst getroffen (`Azure.pt-PT-RaquelNeural` geraten) und im Kommentar
zugegeben, dass sie geraten ist. Eine Spec-Verbotszeile allein haelt einen Agenten nicht auf,
wenn ohne die Entscheidung kein lauffaehiges Ergebnis entsteht — er baut dann eine Vermutung
ein und deklariert sie.

**Regel:** Traegt eine Phase einen Punkt, den nur der Eigentuemer entscheiden kann, wird er
VOR dem Lauf entschieden oder aus dem Scope geschnitten. Ein "als offenen Punkt benennen"
in der Spec reicht nicht — es erzeugt entweder eine geratene Tatsache im Code oder eine
Fix-Schleife, die nicht konvergieren kann (vgl. [[abnahme-schleife-konvergiert-nicht]]:
nach Fund-SCHWERE steuern, nicht nach Zahl).

## 2026-09-11 — Lehren aus der Geldpfad-Kette (GP-P0..GP-P6, Lead-Rolle)

**Ein roter Fall zaehlt erst, wenn er isoliert rot ist - und die Bank luegt in beide
Richtungen.** Voll parallel meldete dieselbe Bank auf demselben Commit einmal vier, einmal neun
rote Faelle, mit **wechselnden Namen**; mit `--test-concurrency=4` null. Wer die erste Zahl
glaubt, sucht Gespenster; wer sie ignoriert, uebersieht die zwei echten dazwischen. Der
Wrapper reicht Zusatzargumente durch: `node test/testbaenke-run.mjs regression
--test-concurrency=4`.

**Grosse JSON-Diffs nie ungefiltert ansehen.** `git diff -- eslint-legacy-exceptions.json` warf
mehrere Bildschirmseiten Begruendungstext aus, weil die Datei ihre Historie im `reason`-Feld
traegt. Die Frage war "wurde eine Sicherung abgeschaltet?" - beantwortbar mit `--stat` plus
einem gezielten grep auf die `findings`-Zeilen.

**Bei einem FATAL-Boot-Guard reicht kein gruener Test.** GP-P6 fuehrt `exit(1)` ein. Die Frage
ist nicht "besteht der Test", sondern "startet der Live-Dienst mit der ECHTEN Konfiguration
noch". Das heisst: Katalog-Slugs zaehlen, Env-Werte gegenpruefen, und was sich lokal nicht
belegen laesst, ausdruecklich als Vor-dem-Deploy-Schritt melden statt es als geprueft
auszugeben.

## 2026-09-12 — Aufraeum-Lauf: zwei Werkzeugfallen, eine Pruef-Falle

Beim Entfernen von 109 Prozessdateien sind drei Fehler passiert, alle derselben Bauart:
ein Befehl, der still das Falsche tat, statt zu scheitern.

**1. zsh trennt Wortlisten anders als bash — asymmetrisch.** Eine unquotierte
Parameter-Expansion (`for k in $KEEP`) wird in zsh NICHT in Woerter zerlegt, eine
Kommando-Substitution (`for w in $(git worktree list ...)`) dagegen SCHON — inklusive
Trennung an Leerzeichen IN Pfaden. Folge hier: eine Schutzliste blieb wirkungslos und
loeschte 8 Dateien mit, die bleiben sollten; und ein Pfad mit Leerzeichen
("Mein Unternehmen") wurde in zwei kaputte Pfade zerlegt. Beide Male meldete die Schleife
Erfolg bzw. plausible Fehler, nie "deine Liste ist leer".
**Regel:** Listen ueber eine Datei und `while IFS= read -r`, nie ueber `$VAR` oder `$(...)`
in einer `for`-Schleife. Und nach jeder Schutzliste EINMAL nachzaehlen, ob die geschuetzten
Eintraege noch da sind.

**2. Ein Suchmuster ohne Positiv-Kontrolle sieht aus wie ein sauberes Ergebnis.** Die
Vorpruefung "welche geloeschte Datei wird von Code gelesen?" suchte nach
`readFile|existsSync|join|resolve|import|require` in derselben Zeile wie der Pfad. Der
echte Zugriff lief ueber `new URL("../tasks/spike1-messung.jsonl", import.meta.url)` —
nicht im Muster. Die Pruefung meldete EINEN Treffer, was wie Gruendlichkeit aussah. Erst
die Testbank fand es (ENOENT, 8 Faelle).
**Regel:** Ein Suchbefehl, der etwas ausschliessen soll, braucht einen bekannten Treffer
als Gegenprobe. Findet er den nicht, ist sein "nichts gefunden" wertlos. Besser noch:
nicht suchen, sondern die Bank fahren — sie kennt die Zugriffe, das Muster nicht.

**3. Die Bank ohne `NODE_ENV=test` fahren erzeugt 194 Phantom-Rote.** Direkt
`node test/testbaenke-run.mjs regression` aufgerufen: 200 rot. Ueber `npm test` (das
`NODE_ENV=test` setzt): 6 rot, davon 3 bekannte Parallel-Flaker und 1 echter Fund.
**Regel:** Die Bank IMMER ueber `npm test` fahren, nie den Runner direkt. Und: ein roter
Fall zaehlt erst, wenn er ISOLIERT rot ist (Bestandsregel, hier dreimal bestaetigt).

## 2026-09-13 — "agent stalled" sagt NICHTS ueber den Agenten

Der IP2-Lauf brach dreimal ab mit "agent stalled on all 6 attempts (no progress for
180000ms each)". Die Meldung zeigt auf den Agenten. Keiner der drei Abbrueche lag am
Agenten, und die ersten beiden Diagnosen dieser Sitzung waren falsch.

**Die ECHTE Ursache, vom Owner genannt: sein Internet war weg.** Die Modell-Anfrage
haengt, es kommt kein Token, nach 180 s greift der Stall-Detektor - auf JEDEM der sechs
Versuche, weil die Leitung auf jedem Versuch tot war. Das Transkript sieht dabei
taeuschend gesund aus: zehn bis siebzehn Minuten echte Arbeit (Dateien gelesen, gegrept),
dann ein abgeschnittener Denkblock und "[Request interrupted by user]".

**Was ich stattdessen diagnostiziert habe, beide Male daneben:**
1. *Maschinenlast.* Beim ersten Abbruch stand die Load auf 47,58 bei 15 Kernen (Details
   unten - der Befund war echt und musste weg, er war nur nicht die Ursache: der zweite
   Abbruch kam bei Load 6).
2. *Modellwahl.* Danach habe ich den Plan-Agenten von opus/high auf sonnet gestellt, mit
   der Begruendung "stallt im langen Denkblock". Der naechste Lauf stallte genauso. Eine
   Korrelation mit n=1, zur Ursache erklaert.

**Regel:** Bei "agent stalled" ist die erste Frage, ob ueberhaupt eine Verbindung steht -
`curl -o /dev/null -w "%{http_code} %{time_total}" --max-time 15 https://api.anthropic.com/v1/messages`
(405 = erreichbar). Erst danach Maschinenlast, erst danach das Transkript. Und: stallen
ALLE Versuche gleich, ist die Ursache ausserhalb des Agenten - ein echtes Agenten-Problem
traefe nicht jeden Versuch an derselben Stelle.

### Nebenbefund desselben Abends: ein verwaister Testlauf frisst die Maschine

**Befund:** `uptime` meldete Load 47,58 bei 15 Kernen. `ps` zeigte einen
`node --test`-Wurzelprozess (PID 86547), der seit **3 Stunden 17 Minuten** lief, dabei
weiter Kind-Testprozesse spawnte (zwei davon selbst seit 3 h bzw. 2 h haengend, jeder mit
einem eigenen `server-mit-elternwaechter.mjs`-Kind). Sein Elternprozess war
`node test/testbaenke-run.mjs regression -- --test-concurrency=4` mit **PPID 1** — der
Runner hatte seinen Aufrufer ueberlebt und war verwaist. Nach dem Abschiessen des Baums
fiel die Load innerhalb von Minuten auf 9,79, und derselbe Lauf startete normal.

**Warum das keine Bestandslehre doppelt:** die bekannten Notizen decken verwaiste
*Testserver* (der Eltern-Waechter behebt die) und "pgrep ist blind in der Sandbox". Hier
war der Waechter wirkungslos, weil nicht der Server verwaist war, sondern **der
Testrunner selbst** — er war der Elternprozess, auf den der Waechter wartet.

**Regel:** `ps -Ao pid,ppid,etime,args | grep "bin/node --test"` und auf ELAPSED achten.
Ein Testlauf mit dreistelliger Minutenzahl ist immer ein Zombie; die Suite braucht rund
zweieinhalb Minuten. Das gehoert zur Routine nach jedem abgebrochenen Lauf - aber als
Aufraeumen, NICHT als Stall-Erklaerung (s. oben).

## Der Lead blaeht seinen Kontext auf - jede Sitzung erneut (18.09.2026)

**Owner-Korrektur, woertlich:** "Du hast mir zu viel Kontext, zu viel Tokens angehaeuft. 600.000,
das ist viel zu viel. ... Ich wiederhole mich wirklich bei jeder Session. Ich sage immer das
gleiche und jede Session macht immer den gleichen Fehler. Viel zu viel Kontext, viel zu wenig
orchestriert, viel zu ineffizient. ... Weil je mehr Tokens und Kontext du hast, desto duemmer
wirst du."

**Was den Kontext konkret gefressen hat** (gemessen an dieser Sitzung, nicht geschaetzt):
1. **Loop-Prompts.** Jeder `/loop`-Tick trug den kompletten Zustand als ~4000-Zeichen-Prompt.
   Bei ~20 Ticks ist das der groesste Einzelposten - und er waechst mit jedem Tick, weil jeder
   Tick den Stand des vorigen mitschleppt.
2. **Selbst gelesene Diffs, Plan-Abschnitte, Lint-Zaehler, Test-Logs.** Jedes `git diff --stat`,
   jedes `sed -n` in `PLAN-OPENAI.md`, jedes `grep` in `eslint-suppressions.json`.
3. **Selbst geschriebene Specs.** Fuenf specFiles a 50-70 Zeilen, vom Lead getippt statt delegiert.
4. **Selbst gefahrene Messungen.** curl gegen Live, Render-API, DB-Zaehlungen.

**Die strukturelle Abhilfe - ein Vorsatz genuegt nicht:**

- **Jede Leseaufgabe ist ein Subagent-Auftrag.** Diff pruefen, Report lesen, Testlog auswerten,
  Spec schreiben, messen - alles delegiert, Rueckgabe max 5-10 Zeilen, ausdruecklich OHNE Diffs
  und ohne Kommando-Ausgaben.
- **Der Lead tippt nur noch:** Workflow starten, Rueckgabezeile lesen, `git merge --no-ff`,
  STAND.md fortschreiben, berichten. Wer als Lead `cat src/...`, `git diff`, `grep` in Quellcode
  oder `tail` auf einem Testlog tippt, hat die Rolle verlassen.

**Warum es trotzdem immer wieder passiert:** Selbst-Lesen fuehlt sich im Moment schneller an als
einen Agenten zu beauftragen, und jede einzelne Entscheidung dafuer ist plausibel. Der Schaden ist
kumulativ und faellt erst am Ende auf. Deshalb ist die Regel mechanisch formuliert (welche
Kommandos der Lead nicht tippt), nicht als Haltung.
