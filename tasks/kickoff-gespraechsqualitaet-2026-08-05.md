# Kickoff: Das Telefonat brauchbar machen — zweiter Anlauf

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

---

## Prompt

Du uebernimmst die Gespraechsqualitaet des Telefon-KI-Agenten Hermes. Der Owner hat am Abend
des 2026-08-04, nach einem Tag mit fuenf gebauten Phasen, gesagt: **"Im Prinzip hat
eigentlich gar nichts funktioniert. Das Gespraech ist immer noch eine Katastrophe."** Das
ist die Messlatte, nicht die Testsuite.

Der Vorgaenger hat an diesem Tag **~3,5 Millionen Token in fuenf Workflow-Phasen** gesteckt.
Ergebnis am Telefon: **zwei bestaetigte Verbesserungen — und beide kamen aus vier
Provider-Parametern, die in Sekunden gesetzt waren, ohne einen einzigen Agenten.** Eine
Phase hat sogar den Inbound-Kanal zerstoert. Lies deshalb den Abschnitt "Arbeitsweise" ZUERST
und nimm ihn ernst; er ist der eigentliche Auftrag.

### Der Stand in fuenf Saetzen

Hermes nimmt Anrufe an und fuehrt Anrufe im Auftrag des Owners. Outbound laeuft ueber den
Telnyx-Assistant mit unserem LLM-Shim, Inbound ueber die aeltere Budget-Engine
(TeXML-Gather + STT). Alles Gebaute ist live; `npm test` ist gruen (3942). **Trotzdem ist das
Telefonat unbrauchbar:** der Agent versteht schlecht, wiederholt sich, verrennt sich ins
Warten, recherchiert nie im Internet und braucht fuer eine Rueckfrage an den Assistenten des
Owners eine gefuehlte Ewigkeit. Der Live-Stand ist per `/healthz` zu pruefen, nie aus einer
Notiz.

---

## Teil 1 — Was am 2026-08-04 gebaut wurde und was es gebracht hat

**Diese Tabelle ist die wichtigste im Dokument.** Sie zeigt, welche Art von Eingriff sich
gelohnt hat.

| Eingriff | Art | Aufwand | Wirkung am Telefon |
|---|---|---:|---|
| `disable_greeting_interruption: true` | Provider-Config | Sekunden | **WIRKT** (owner-bestaetigt): Offenlegung nicht mehr wegdrueckbar |
| `interrupt_prediction_threshold: 0.4 -> 0.2` | Provider-Config | Sekunden | **WIRKT** (owner-bestaetigt): Unterbrechen reagiert schneller |
| `language: multi -> de` | Provider-Config | Sekunden | keine — Kauderwelsch unveraendert |
| `eot_threshold: 0.8 -> 0.9` | Provider-Config | Sekunden | unklar |
| **GQ-S1** Sonden (Turn-Herkunft, Inbound-Feldname) | Code, 5 Agenten | 610k Token | **GROSS** — loeste zwei seit Wochen offene Raetsel |
| **GQ-P1** Verdraengungs-Riegel bei `extends` | Code, 5 Agenten | 753k Token | **KEINE** — 6 von 6 Faellen `no_inflight` |
| **GQ-P2** Consult: zwei Fristen statt einer | Code, 5 Agenten | 756k Token | **WIRKT** — gemessen, s.u. |
| **GQ-P3** Inbound auf den Assistant-Pfad | Code, 5 Agenten | 632k Token | **HAT INBOUND ZERSTOERT** — Default zurueck auf AUS |
| **GQ-P4** Stummes Scheitern + Nachrichten-Dedup | Code, 5 Agenten | 1 025k Token | Teil A ungemessen, **Teil B wirkungslos** |

### Die drei Lehren daraus, in absteigender Wichtigkeit

**L1 — Eine Aenderung am Anrufpfad wird SOFORT nach dem Deploy mit einem echten Anruf
geprueft, bevor die naechste Phase startet.** GQ-P3 lief Stunden lang live und machte
Inbound unbrauchbar (der Anrufer hoerte nur "Technischer Fehler, Entschuldigung"). Aufgefallen
ist es erst, weil der Owner selbst anrief. Ein einziger Testanruf direkt nach dem Deploy
haette das in 30 Sekunden gezeigt.

**L2 — Provider-Konfiguration vor Code.** Der Telnyx-Assistant hat ein Dutzend Stellschrauben,
die sofort wirken, keinen Deploy brauchen und per Snapshot reversibel sind. Die beiden
einzigen bestaetigten Gewinne des Tages kamen von dort. Der Vorgaenger hat stattdessen zuerst
Code geschrieben.

**L3 — Keine Phase ohne vorher benannte Zahl.** Bevor ein Workflow startet, muss beantwortbar
sein: *welcher Wert in den BEREITS vorliegenden Daten belegt, dass dieser Fix wirkt?* Bei
GQ-P1 war die Antwort in den Zeitstempeln sichtbar (der Agent antwortet nach ~1 s, die
Fortsetzung kommt nach 1,4-5,5 s -> die Turns ueberlappen NIE -> ein Verdraengungs-Riegel
kann nichts verdraengen). Das haette 30 Sekunden Rechnen gekostet statt 45 Minuten Bauen.

---

## Teil 2 — Die offenen Befunde, alle am echten Anruf belegt

Beleg-Anruf: `call_msf0epenyv9g` (2026-08-04, outbound). Rohtranskripte liegen nur befristet
in der Prod-DB (`EVIDENCE_RETENTION_DAYS=7`) — **zieh sie dir als Erstes und sichere sie
lokal**, siehe §Betrieb.

### N-1 — Der Agent verrennt sich ins Warten (NEU, gravierend)

Nachdem er eine Rueckfrage gestellt hat, sagt er sechsmal hintereinander sinngemaess
"ich warte still", waehrend die Gegenstelle zunehmend genervt fragt, wann er denn mal etwas
sage:

```
18:47:34  "Gerne, ich warte geduldig."
18:47:41  "Gerne, ich warte."
18:47:48  "Sie haben recht, entschuldigen Sie - ich warte auf die Antwort zum Fahrzeugmodell."
18:47:59  "Ich bleibe einfach still und warte, bis Sie zurueck sind."
18:48:09  "Ich bin still und warte auf die Auskunft zum Fahrzeugmodell."
18:48:17  "Sie haben recht - ich sage nichts mehr, bis Sie zurueck sind."
18:48:26  "Ich warte still."
```

Der Witz: **die Antwort lag ab 18:47:37 im Store** (`answeredAt` gesetzt, `answeredFacts: 1`).
Er hat sie ab 18:48:33 auch inhaltlich benutzt. Die 55 Sekunden dazwischen hat er verplempert.
**Das ist der teuerste einzelne Defekt im Gespraech** und zahlt direkt gegen die Kuerze-Vorgabe.

### N-2 — `take_message` legt drei Eintraege fuer einen Sachverhalt an

GQ-P4 dedupliziert nur **inhaltsgleiche** Nachrichten. Das Modell formuliert aber jedes Mal
neu, also greift die Regel nie:

```
1) "Antonio soll den Fahrzeugschein zur Inspektion mitbringen."
2) "Die Werkstatt bittet Antonio, den Fahrzeugschein zur Inspektion mitzubringen. …"
3) "Die Werkstatt braucht das genaue Fahrzeugmodell und Baujahr, um … einplanen zu koennen."
```

Die konservative Wahl war bewusst und begruendet (Datenverlust waere schlimmer als ein
Duplikat) — **aber das Problem des Owners ist ungeloest.** Die Loesung liegt vermutlich nicht
in einer Aehnlichkeitsregel, sondern darin, dem Modell den bereits notierten Stand im
laufenden Gespraech SICHTBAR zu machen. Heute erfaehrt es nie, was schon notiert ist.

### N-3 — Ein zweiter Consult kommt nicht zustande

Um 18:49:08 kuendigt der Agent an nachzufragen, um 18:49:20 sagt er, er erreiche den Owner
nicht. Im Datensatz steht aber nur `c0` — **die zweite Rueckfrage wurde nie gestellt.**
Ursache ungeklaert. Am Code beginnen: `consultAvailableFor` / `inCallConsults` und das
In-Call-Kontingent.

### B-4 — `look_up` (Internetrecherche) feuert nie

In 19 von 19 Turns angeboten, **0 mal gefeuert**. Zweimal ueber Prompts angegangen (AL-P14,
AL-D3), zweimal wirkungslos. Der Owner verlangt die Recherche ausdruecklich und bekommt sie
nicht. **Eine dritte Formulierungsrunde ist der falsche Weg** — die Mechanik ist geprueft und
korrekt verdrahtet.

Wichtig: das Bench-Szenario feuerte `look_up` **5 von 5 Mal**, waehrend es live 0 von 12 Mal
feuerte. Ein Szenario, das den Defekt nicht reproduziert, kann keinen Fix belegen.

### B-5 — `end_call` feuert nie

0 von 19 Turns. Der Anrufer muss selbst auflegen. Mechanik ebenfalls korrekt verdrahtet.

### B-7 — STT-Kauderwelsch (vorbestehend, ungeloest)

*"Eva, Du stoppst zum Kanisch."* · *"Das ist superverwuerfend."* · *"Add smaller."*
`language: multi -> de` hat **nichts** gebracht. Naechste Kandidaten, beide
Provider-Konfiguration: `keyterm` (Fachbegriffe boosten) oder ein anderes STT-Modell
(`deepgram/nova-3`, `assemblyai/universal-streaming`, `soniox/stt-rt-v4` stehen zur Wahl).

### GQ-P3-Rest — der Inbound-Handoff feuert zu frueh

**Der Feldname ist richtig und gemessen:** der TeXML-Body traegt `CallSid` (nicht
`CallControlId`), und `GET /v2/calls/<CallSid>` antwortet HTTP 200 — es ist eine gueltige
Call-Control-ID. Der Pfad wurde erstmals ueberhaupt betreten (`path=assistant` statt
`budget`).

**Was fehlt, ist die Reihenfolge:**

```
[telnyx-inbound] inbound_path {"path":"assistant"}                        18:55:22.825
[incoming] Telnyx speak fehlgeschlagen: HTTP 422 (90034 Call not answered yet)  18:55:23.191
```

Die Call-Control-API verlangt einen **bereits angenommenen** Anruf; TeXML nimmt beim Inbound
implizit an. Der Handoff muss auf das `answered`-Ereignis warten. Bis dahin steht
`TELNYX_INBOUND_HANDOFF_ENABLED` auf **false** (Default im Code), Inbound laeuft auf der
Budget-Engine.

**Wenn der Handoff repariert ist, ist er der groesste bekannte Hebel** — Inbound hat heute
`tools: []` (kein einziges Werkzeug), `stt_gap` von **13 049 / 14 633 ms** bei Modell-Latenzen
von ~1 000 ms, kein Streaming, kein echtes Barge-in. **Kostenfolge beachten:** der
Assistant-Pfad kostet ~5 statt 1,87 US-Cent je angefangener Minute (Owner hat zugestimmt);
danach ist KV-M1 zu wiederholen und der Tarif neu zu kalibrieren.

### Owner-Hypothese, ungeprueft: "Vielleicht hat er zu wenig Kontext"

Der Owner vermutet, dem Agenten fehle Gespraechskontext. **Das ist noch niemand nachgegangen
und es ist billig zu pruefen:** was genau steht im Systemprompt und in der Nachrichtenliste
eines Turns? Wie viele vorherige Turns sieht das Modell? Wird die Historie gekuerzt? Ein
einziger Log-Punkt mit `messagesCount` und der Zeichenzahl des Prompts beantwortet das.
Im Live-Log steht `messagesCount` bereits (Werte 2 bis 18 im Beleg-Anruf) — **das reicht als
Startpunkt, aber der INHALT ist ungeprueft.**

---

## Teil 3 — Arbeitsweise (das ist der eigentliche Auftrag)

### Die Reihenfolge, in der du vorgehst

**Schritt 0 — Messen, selbst, in Minuten.** Die vier entscheidenden Befunde des Vortags kamen
alle aus `psql` und Render-Logs, nicht aus Agenten. Der Engpass in diesem Projekt ist
**Diagnose, nicht Code-Produktion**. Bevor du irgendetwas startest: Prod-DB abfragen, Logs
lesen, Provider-Config per `GET` holen.

**Schritt 1 — Konfiguration probieren, bevor du Code schreibst.** Fuer jeden Befund die Frage:
*Gibt es dafuer einen Provider-Parameter?* Der Telnyx-Assistant wird per
`PATCH /v2/ai/assistants/<id>` geaendert, wirkt sofort, braucht keinen Deploy.
**Immer vorher `GET` und Snapshot sichern** (`data/evidence/telnyx-config/`, gitignored).
Achtung: Telnyx-`PATCH` merged **tief** — ein weggelassenes Feld bleibt stehen, und `null`
heisst "nicht aendern", nicht "loeschen".

**Schritt 2 — Erst dann eine Phase, und nur mit benannter Zahl.** Schreib in die Spec, welcher
Wert aus den vorliegenden Daten belegt, dass der Fix wirkt. Kannst du das nicht, ist die Phase
nicht reif.

**Schritt 3 — Nach JEDEM Deploy am Anrufpfad sofort ein Testanruf.** Kein "ich baue erst die
naechste Phase". Das ist die Lehre aus dem zerstoerten Inbound.

### Groesse und Zuschnitt

- **Fuenf Agenten mit Plan/Review/Audit fuer 60 Zeilen Code ist unverhaeltnismaessig.** Fuer
  einen belegten Ein-Stellen-Fix reicht ein Agent — oder du selbst.
- **Ein Workflow-Lauf zur Zeit.** Zwei gleichzeitige Laeufe erzeugten ~35 parallele
  `node --test`-Prozesse und Systemlast 32 auf 15 Kernen; die Maschine stand.
- **Waehrend ein Lauf laeuft, NICHT nach `master` committen** — auch keine Doku. Jeder
  `master`-Commit erzeugt im laufenden Branch einen falsch-positiven Stale-Base-Blocker.
  (Der Vorgaenger hat genau das getan. Rettung ohne Rebase: `git diff master...<branch>` mit
  DREI Punkten vergleicht gegen den gemeinsamen Vorfahren.)

### Merge-Disziplin (jede Zeile hier wurde einmal bezahlt)

1. **Vor JEDEM Merge `git diff --stat master...<branch>`.** Ein PASS des Workflows ist keine
   Merge-Freigabe — ein toter Impl-Agent hinterlaesst einen leeren Branch und meldet PASS.
2. **`git merge-base --is-ancestor master <branch>`** vor dem Merge.
3. **Niemals `git add -A`** (untrackte Dateien mit Kundendaten im Repo), **niemals
   `git stash`** (`refs/stash` ist zwischen Worktrees geteilt).
4. Die Suite hat ein dokumentiertes **Spawn-Flake unter Volllast** (~12%). Ein roter Test
   zaehlt erst, wenn er **isoliert** rot ist: `node --test test/<datei>.test.js`.

### Haltung

**Behaupte keinen Gewinn, den du nicht gemessen hast.** Sagt die Messung, dass deine Arbeit
nichts gebracht hat, schreib genau das hin — das ist am 2026-08-04 dreimal passiert und war
jedes Mal wertvoller als eine gruene Suite. **Und wenn du eine Diagnose stellst, pruef sie
gegen die Anbieter-Doku, bevor du handelst:** ein Default sieht im Config-Dump exakt aus wie
eine bewusste Entscheidung. Zwei Diagnosen sind am Vortag genau daran gestorben.

---

## Teil 4 — Owner-Entscheidungen (bindend, nicht neu aufrollen)

- **O-1** Inbound und Outbound werden vereinheitlicht, ueber den Assistant-Pfad. Der
  Feldname ist gemessen; es fehlt das Warten auf `answered`. **Der stille Rueckfall bleibt
  verboten** — faellt der Handoff aus, muss das im Log sichtbar sein (ist gebaut).
- **O-2** Die Twilio-Abstraktion faellt, als **eigene** Phase (gemessen: 43/43 Anrufe und
  3/3 Nummern sind Telnyx; Twilio hatte live nie Verkehr). Blockiert O-1 nicht.
- **O-3** "So kurz wie moeglich" ist eine **Messgroesse, keine Kappe**. Keine harte Turn-
  oder Sekundengrenze; die Max-Dauer-Notbremse als Safety-Gate bleibt unberuehrt.
- **O-4** Der Modellwechsel Haiku -> Sonnet wird **gemessen, nicht geraten**: A/B-Lauf,
  Entscheidung an Qualitaet UND Preis. **Fuer B-4 und B-5 ist das der einzige verbliebene
  Hebel** — beide sind korrekt verdrahtet und zweimal erfolglos ueber Prompts angegangen.
- **O-5** Token-Streaming bleibt AN.
- **`get_consult` ist Assistent-zu-Assistent**, nicht Agent-zu-Mensch: der persoenliche
  KI-Assistent des Users (Claude/ChatGPT/Gemini) loest den Anruf ueber MCP aus und haelt die
  `await_call_event`-Schleife offen; Hermes fragt **ihn**, weil er Kalender und Kontext hat.
  Weiss der nicht weiter, fragt er den Menschen — das ist nicht Hermes' Sache. **Kein
  Redesign zu einem Postfach**, ausdruecklich verworfen.
- **B-10-Alarm** als hochsichtbare **Logzeile**, keine Alarm-SMS (kostet Geld, kann schleifen).
- **Die US-Nummer ist gewollt** (`FORCE_NUMBER_COUNTRY=US`) — Randbedingung, kein Befund.
  Die sporadische Zustellung von US-DID nach DE ist bekannt und akzeptiert.
- **Zurueckgestellt:** die Datenschutzerklaerung. Nicht anfassen, nicht erneut vorlegen.

---

## Teil 5 — Betrieb

- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen. `git push origin` macht
  **nichts** live. Live-Stand IMMER per `/healthz` pruefen.
- **Prod-DB:** `psql "$(cat ~/.config/hermes/db-url)"`. RLS ist FORCE — ein naives `SELECT`
  liefert 0 Zeilen. Erst `SELECT set_config('app.current_tenant','<tenant>',false);` in
  **derselben** Sitzung. Relevanter Tenant: `t_user_01KX600834GCJFV9GTZQKWZMTH`.
  **`started_at` ist TEXT**, nicht timestamp — `to_char()` schlaegt fehl, `substr()` benutzen.
- **Ein direktes DB-`UPDATE` auf `tenant` ueberlebt nicht.** Der pg-Store haelt den Zustand im
  Speicher und schreibt ihn zurueck; die private Nummer war nach einem Anruf wieder `NULL`.
  **Solche Werte ueber das Dashboard setzen.**
- **Offener Owner-Handgriff:** private Nummer hinterlegen. Ohne sie ist `diagnostic` **immer**
  false (Rohtranskripte werden nach der Zusammenfassung geloescht) und **keine** per
  `take_message` aufgenommene Nachricht erreicht den Owner.
- **Turn-Diagnostik im Live-Log:** `[telnyx-shim] turn_ok` mit `toolNames` (gefeuert) gegen
  `offeredToolNames` (angeboten), dazu `streamChunks`, `consultPollFresh`, `latencyMs`,
  `messagesCount`. Ausserdem `turn_probe` (Turn-Herkunft: `first`/`same`/`extends`/`other`),
  `supersede` (Riegel-Entscheidung) und `inbound_path` (welche Engine ein Inbound-Anruf fuhr).
- **ElevenLabs-TTS ist seit dem 2026-08-03 kaputt:** `http_403` mit Cloudflare-Challenge, bei
  **jedem** Satz, Fallback auf Azure. Der Schluessel ist gueltig und das Konto hat Guthaben
  (von einer Entwicklermaschine aus antwortet dieselbe Anfrage mit HTTP 200) — es liegt an der
  Herkunft der Anfrage aus Render. **Ungeloest.**
- Nach vollen Testlaeufen `ps -eo pid,command | grep "[n]ode src/server.js"` pruefen.

### Pflichtlektuere, in dieser Reihenfolge

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md`
3. `tasks/gq-chain-state.md` — der Kettenstand mit allen Messungen des 2026-08-04
4. `tasks/lessons.md`, die letzten vier Abschnitte

**Token-Disziplin:** die Plan- und Kettenstand-Dateien sind Nachschlagewerke. Greif mit
`grep -n` hinein, lies nicht am Stueck.
