# Kickoff: Gespraechsqualitaet — dritter Anlauf

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

**Regel fuer dieses Dokument: nur Gemessenes.** Jede Aussage traegt entweder einen Beleg
(Call-ID, Log-Zeile, Datei:Zeile, Anbieter-Doku) oder ist ausdruecklich als **unbelegt**
markiert. Wo nichts gemessen wurde, steht das da.

---

## Prompt

Du uebernimmst die Gespraechsqualitaet des Telefon-KI-Agenten Hermes.

Der Owner arbeitet seit Tagen daran. Am 2026-08-05 wurden sechs Phasen gebaut und live
gestellt. **Sein Urteil am Ende des Tages: kein Unterschied, es wird schlimmer.** Das ist die
Messlatte, nicht die Testsuite (3970/3970 gruen).

Lies **Teil 0** zuerst und vollstaendig. Er raeumt einen kaputten Git-Zustand auf und nennt
die zwei Fehler, die der Vorgaenger gemacht hat. Ohne das arbeitest du auf einem Trugbild.

---

## Teil 0 — Zuerst: Zustand geradeziehen

### Git ist in einem Zwischenzustand (Stand 2026-08-05 abends)

| Ref | Commit | Bedeutung |
|---|---|---|
| live (`/healthz`) | `7670ff1` | GQ-P5..P10, **ohne** die zwei Review-Fixes |
| `review/gq-2026-08-05` | `3a7b8f6` | alles + Review-Fixes, auf beiden Remotes |
| `base/pre-gq-2026-08-05` | `2429d38` | kuenstlicher Diff-Anker fuer den Code-Review |
| lokaler `master` | `2429d38` | **kuenstlich zurueckgesetzt**, NICHT der echte Stand |
| `origin/master`, `upstream/master` | `8fb7804` | echter Stand ohne die Review-Fixes |
| Tag `backup/master-vor-review-2026-08-05` | `8fb7804` | Sicherung |
| PR #1 (Antonio20045-Fork) | — | nur Diff-Anker, **nicht mergen**, kann zu |

**Erster Arbeitsschritt:** lokalen `master` auf `upstream/master` zurueckholen, den Fix-Commit
`3a7b8f6` regulaer mergen, deployen, PR #1 schliessen, die beiden Hilfs-Branches loeschen.
Danach ist der Stand wieder eindeutig.

### Zwei Prozessfehler des Vorgaengers — nicht wiederholen

1. **Sechs Phasen ohne Review gemergt und deployt.** CLAUDE.md ist eindeutig: alles, was
   Calls beruehrt, ist nicht-trivial, und nicht-trivial heisst Plan Mode + Phasen-Workflow
   mit dualem Review VOR dem Merge. Der Vorgaenger hat 25 Dateien / ~1290 Zeilen selbst
   gebaut, selbst gemergt, selbst deployt. Der nachtraegliche Code-Review fand zwei echte
   Defekte (ein falsch kopiertes `\n` im Prompt, zwei fehlende `render.yaml`-Eintraege).
   **Ein Diff-Review kann aber nicht sehen, dass vier der sechs Phasen nie am Telefon
   gemessen wurden.** Genau das ist der eigentliche Mangel.
2. **Eine Prompt-Runde gedreht, obwohl O-4 das ausschliesst** (Begruendung s. Teil 3, B-4).
   Sie hat den Fall nachweislich verschlimmert.

---

## Teil 1 — Der Owner-Auftrag zur Persona (NEU, bindend, 2026-08-05)

**Hermes ist der persoenliche Assistent des Users. Punkt.** Er redet nie ueber seine eigene
Konstruktion.

**Verboten:** jede Formulierung wie „ich frage mal meine Seite", „ich klaere das auf meiner
Seite", „ich frage bei meinem Auftraggeber nach". Fuer die Gegenstelle ist das sinnlos — sie
weiss nicht, was „meine Seite" ist, und es ist auch keine ehrliche Auskunft.

**Vorgeschrieben:**

| Situation | Was Hermes sagt |
|---|---|
| Er weiss etwas nicht und klaert es | „Warten Sie kurz, ich schaue einmal nach." |
| Er findet es nicht | „Tut mir leid, ich kann die Information momentan nicht finden." |

Gilt in **de, en, fr**. Sinngemaess uebersetzen, nicht woertlich.

**Herkunft des Defekts, am Code belegt:** der Satzbaustein
`boundaries.noAskingCounterpartAboutOwner` (`src/i18n/prompts/de.js`, GQ-P9, gebaut am
2026-08-05) enthaelt woertlich *„Du klaerst das auf deiner Seite"*. Der Agent hat das
uebernommen. **Derselbe Baustein bietet im selben Satz `take_message` als Alternative an** —
und genau dorthin ist das Modell ausgewichen, statt `get_consult` zu rufen (Beleg unten).
Diese Zeile ist zu korrigieren, nicht zu erweitern.

---

## Teil 2 — Was am 2026-08-05 gebaut wurde und was davon belegt ist

Alle sechs Phasen sind live. **Zwei sind gemessen, vier nicht.**

| Phase | Inhalt | Beleg |
|---|---|---|
| GQ-P5 | Provider-Anstoss-Riegel | **GEMESSEN WIRKSAM** (s.u.) |
| GQ-P6 | Klingelfrist 30 -> 60 s | **ungemessen** (Problem belegt, Wirkung nicht) |
| GQ-P7 | Zustellfenster der Rueckfrage-Antwort | **mechanisch belegt** (s.u.) |
| GQ-P8 | Ankunfts-Signal der Antwort | **ungemessen** — Testanruf erreichte den Pfad nie |
| GQ-P9 | „nicht die Gegenstelle fragen" | **ungemessen, vermutlich schaedlich** (Teil 1) |
| GQ-P10 | Prompt-Block „SCHON NOTIERT" | **ungemessen, moeglicherweise am falschen Pfad** |

### GQ-P5 — der einzige belegte Gewinn des Tages

Telnyx stoesst nach `telephony_settings.user_idle_reply_secs` Sekunden Anrufer-Stille selbst
einen Turn an. Anbieter-OpenAPI woertlich: *"Duration in seconds of end user silence before
the assistant checks in on the user. When this limit is reached the assistant will prompt the
user to respond."*, **Default 10**. Live steht **4** (nicht von uns gesetzt —
`grep -rn "user_idle" src/` ist leer; kommt aus dem Telnyx-Dashboard).

Dieser POST traegt **keine neue Aeusserung**: seine letzte Nachricht ist eine System-Nachricht.
`lastUserText` (`src/telnyx-llm-shim.js`) las nur die letzte `user`-Rolle und lieferte deshalb
die ALTE Aeusserung — der Shim beantwortete sie erneut und sprach sie aus. Die eigene
Sprechzeit ist aus Anrufersicht wieder Stille, also folgte der naechste Anstoss.

**Messung `call_msf0epenyv9g` (vorher):** sechs Runden „Gerne, ich warte." / „Ich warte still."
waehrend die Gegenstelle woertlich sagte *„Ich hab nix gesagt, Digger. Was laberst Du?"*

**Messung `call_msfqk80elik1` (nachher):** elf Anstoesse, Abstaende **4047–4058 ms**,
**11 von 11** per `gate reason=provider_nudge` abgefangen, **0 gesprochene Saetze**.
Struktureller Gegenbeleg: `messagesCount` waechst je Anstoss um **1** statt um 2 — es wird
keine Antwort mehr angehaengt.

Erkennungsmerkmal fuer die Zukunft: `turn_probe` mit `prevRelation:"same"` UND
`lastRole:"system"`.

### GQ-P7 — mechanisch belegt

`call_msfx9pruzjvc`: Antwort 10:07:21 eingetroffen, Zustellfenster 10:07:25 geoeffnet
(kein Gate), `deliveredAt` 10:07:27 gesetzt, danach **sieben** Anstoesse wieder blockiert.
Genau ein Fenster. **Was der Agent im Fenster sagte, ist unbelegt** — er rief `take_message`
und kuendigte laut Owner einen Rueckruf an, das Rohtranskript fehlt (s. Teil 3, D-1).

### GQ-P6 — Problem belegt, Wirkung nicht

Wir setzten `timeout_secs` beim Waehlen nie. Anbieter-Doku: min 5, max 600, **Default 30**.

Alle nie angenommenen Outbound-Anrufe, Gesamtdauer: **31,3 / 30,8 / 30,9 / 31,6 / 31,7 s**
(19.07. bis 05.08.). Fuenf unabhaengige Anrufe, kein Streuen. Gegenprobe: die laengste
Klingelzeit unter allen ANGENOMMENEN Anrufen ist **30,7 s**, keine darueber. Die Verteilung
ist bei 30–31 s abgeschnitten.

**Einordnung, wichtig:** das ist ein Randfall, keine Dauerbremse. Von rund 45 Anrufen sind
fuenf hineingelaufen (~11 %); der Rest klingelt nach 5–6 Sekunden. Zustellzeiten schwanken
zwischen 4,8 und 30,7 s. Ursache der Schwankung ist die US-Absendernummer
(`FORCE_NUMBER_COUNTRY=US`, bewusste Owner-Einstellung); eine +49-DID waere die Wurzel.

---

## Teil 3 — Die offenen Befunde, jeder mit Beleg

### B-4 — das Modell waehlt angebotene Werkzeuge nicht (DREI Belege)

Der wichtigste Befund. Dreimal gemessen, drei verschiedene Werkzeuge:

| Werkzeug | Beleg | angeboten | gefeuert |
|---|---|---:|---:|
| `look_up` | `call_msf0epenyv9g` | 19/19 Turns | **0** |
| `get_consult` | `call_msg0swwfhe5e` | 4/4 Turns (`offeredToolNames`) | **0** (`consults = NULL`) |
| `end_call` | `call_msf0epenyv9g` | 19/19 | 1 (turnSeq 19) — **feuert doch**, Kickoff-Behauptung widerlegt |

Bei `call_msg0swwfhe5e` rief das Modell in Turn 4 stattdessen `take_message`. Der Verdacht,
dass die GQ-P9-Zeile den Ausweg oeffnet (sie nennt `take_message` ausdruecklich als
Alternative), ist **plausibel, aber nicht bewiesen** — es gibt keinen Vorher-Nachher-Vergleich
mit derselben Gespraechsfuehrung.

**Owner-Entscheidung O-4 (bindend):** dagegen hilft der Modellwechsel Haiku -> Sonnet als
**A/B-Lauf mit Messung**, nicht die naechste Prompt-Runde. Prompt-Runden wurden dreimal
versucht (AL-P14, AL-D3, GQ-P9) und haben nie gewirkt; GQ-P9 hat es verschlimmert.

### D-1 — `diagnostic` greift nicht, obwohl die Vorbedingung erfuellt ist

**Gemessen am 2026-08-05, `call_msg0swwfhe5e`:**

```
tenant.private_number = [+491737252163]
call.to_e164          = [+491737252163]     <- identisch
call.diagnostic       = false               <- trotzdem
transcript_segment    = 0 Zeilen
```

Der Owner hat die private Nummer im Dashboard gesetzt, der Dienst ist danach neu gestartet
(Deploy 10:35), der Anruf war um 11:45. Die bisherige Erklaerung (O-10: leere private Nummer)
**trifft nicht mehr zu**. Ursache unbekannt.

**Das blockiert alles andere:** ohne Rohtranskript laesst sich nur messen, WELCHE Werkzeuge
feuerten — nie, WAS gesagt wurde. Jede Aussage ueber Gespraechsqualitaet bleibt damit
unbelegt. **Das gehoert zuerst repariert.**
Einstieg: `diagnosticRetentionGranted` und der Ort, an dem `call.diagnostic` gesetzt wird.

### D-2 — `await_call_event` meldet `done`, waehrend der Anruf laeuft

`call_msg0swwfhe5e`: das MCP-Werkzeug lieferte `event:"done"`, obwohl der Anruf noch lief
(Server-Ende laut DB 11:47:04, Anstoesse im Log bis mindestens 11:46:44). Der Owner hat es
unabhaengig bemerkt: „der Anruf war ueberhaupt nicht zu Ende".

**Folge:** der MCP-Client hoert auf zu pollen. `consultAvailableFor` verlangt einen frischen
Poll (`consultClientIsPolling`) — ein vorzeitiges `done` kann also die Rueckfrage-Faehigkeit
mitten im Gespraech abschalten. Ursache unbekannt, Wirkung ungemessen.

### N-2 — mehrere Notizen fuer einen Sachverhalt, moeglicherweise falscher Pfad

`call_msg0swwfhe5e` hinterliess drei `action_item`:

```
1) "Werkstatt fragt nach dem Fahrzeugmodell fuer die faellige Inspektion. Bitte
    Fahrzeugmodell mitteilen, damit ich den Termin vereinbaren kann."
2) "Fahrzeugmodell von Antonio recherchieren und an Werkstatt mitteilen"
3) "Werkstatt erneut kontaktieren, um Inspektionstermin zu vereinbaren"
```

Im Log feuerte `take_message` **einmal** (turnSeq 4). Eintraege 2 und 3 lesen sich wie
Nachbereitung (`next_step`/`open_points` der Zusammenfassung). **Unbelegt** — nachzupruefen,
welcher Code sie anlegt. Falls es die Nachbereitung ist, greift GQ-P10 am falschen Pfad:
sein Prompt-Block deckt nur `take_message` im Gespraech ab.

### B-7 — STT-Kauderwelsch, unveraendert offen

*„Eva, Du stoppst zum Kanisch."* · *„Das ist superverwuerfend."* · *„Add smaller."*
`language: multi -> de` hat nichts gebracht (gemessen). Naechste Kandidaten, beide reine
Provider-Konfiguration: `keyterm` (Fachbegriffe boosten) oder ein anderes STT-Modell
(`deepgram/nova-3`, `assemblyai/universal-streaming`, `soniox/stt-rt-v4`).

### Weitere offene Befunde (alle unbelegt in ihrer Wirkung)

- **Inbound-Handoff feuert vor `answered`.** `TELNYX_INBOUND_HANDOFF_ENABLED=false`, Inbound
  laeuft auf der Budget-Engine. Gemessen: auf `inbound_path path=assistant` folgt 370 ms
  spaeter `HTTP 422 (90034 Call not answered yet)`.
- **`hangup_cause` wird nicht geloggt.** Der Call-Control-Webhook loggt nur `event_type` und
  `status`. Deshalb musste die GQ-P6-Diagnose ueber Zeitstempel erschlossen werden.
- **Fuenf stille Fehlanrufe ueber drei Wochen** sind niemandem aufgefallen. Ein Anruf, der nie
  ankommt, hinterlaesst keine sichtbare Spur.
- **Ein verlassener Anruf terminiert nie.** Der Provider-Anstoss zaehlt als Lebenszeichen und
  setzt den Dead-Air-Timer zurueck; der Call laeuft bis `time_limit_secs` (30 min) oder bis
  zur Tenant-Kostendecke. Bewusst in GQ-P7 nicht mitgeaendert (Begruendung im Code).
- **`get_consult`-Ablehnung landet als Ausrede beim Kunden.** `MAX_IN_CALL_CONSULTS_PER_CALL
  = 1` (`src/consult/in-call.js:43`). Nach dem ersten Consult faellt das Werkzeug aus dem
  Satz; das Modell ruft es trotzdem auf und sagt der Gegenstelle „Ich kann Antonio nicht
  erreichen". Der Riegel ist gewollt, seine Aussenwirkung nicht.
- **Fragilitaets-Analyse: nie angefangen.** Der Kickoff vom 2026-08-05 nannte sie den
  eigentlichen Auftrag.

---

## Teil 4 — Strategie fuer diese Session

Der Owner verlangt ausdruecklich: **erst ein Strategie-Dokument, dann ein Dynamic Workflow**,
statt sofortiger Einzelfixes. Er hat Workflows/Subagenten fuer diese Session **freigegeben**.

### Die Reihenfolge ergibt sich aus den Belegen, nicht aus Vorlieben

1. **D-1 zuerst (`diagnostic`).** Solange kein Rohtranskript entsteht, ist jede Aussage ueber
   Gespraechsqualitaet unbelegbar. Alles andere misst ins Leere. Kleiner, klar umrissener Fix.
2. **Teil 1 (Persona/Wortwahl).** Owner-Auftrag, belegte Fehlformulierung im Code, drei
   Sprachen. Der `take_message`-Ausweg in derselben Zeile faellt mit weg.
3. **D-2 (`await_call_event`).** Er kann die Rueckfrage-Faehigkeit mitten im Gespraech
   abschalten — jede Consult-Messung ist bis dahin unzuverlaessig.
4. **O-4 (Modellwechsel A/B).** Erst danach, weil ein A/B ohne Transkripte nicht auswertbar
   ist. Das ist der einzige noch nicht ausprobierte Hebel gegen B-4.
5. **Fragilitaets-Analyse.** Kandidat fuer den Workflow: dreimal am 2026-08-05 dieselbe
   Fehlerklasse an drei Stellen — ein Zustand wird korrekt gefuehrt, aber nie an den
   Entscheidungspunkt getragen (Rueckfrage-Ankunft, notierter Stand, Anstoss-Herkunft).
   Frage an den Code: **wo gibt es noch vorhandenen Zustand ohne Kante zur Stelle, die ihn
   braucht?**

### Arbeitsweise — was am 2026-08-05 nachweislich schiefging

- **Kein Merge ohne Review.** Phasen laufen ueber `phase-impl-lean` (Plan -> Worktree ->
  dualer Review, Clean-Code als hartes Gate, S1/S2 = Blocker). Der Vorgaenger hat sechs
  Phasen daran vorbei gebaut; der nachgeholte Review fand zwei echte Defekte.
- **Erst messen, dann bauen.** Der Engpass ist Diagnose, nicht Code-Produktion. Die
  wertvollsten Befunde des Tages kamen aus `psql`, Render-Logs und der Anbieter-Doku — nicht
  aus Agenten. `turn_probe` trug das entscheidende Feld `lastRole` seit Wochen; niemand hatte
  es gelesen. **Wer eine Sonde baut, muss ihre Felder auch auswerten.**
- **Keine Phase ohne vorher benannte Zahl.** Welcher Wert in den BEREITS vorliegenden Daten
  belegt, dass der Fix wirkt? Kannst du das nicht sagen, ist die Phase nicht reif.
- **Testanruf-Drehbuch gegen den Fix pruefen.** Der Vorgaenger baute eine Regel, die das
  Nachfragen verbietet, und entwarf dann einen Test, dessen Kern genau diese Situation ist.
- **Provider-Konfiguration vor Code.** Die zwei einzigen bestaetigten Gewinne des 2026-08-04
  waren Telnyx-Parameter, in Sekunden gesetzt. Immer erst `GET` + Snapshot nach
  `data/evidence/telnyx-config/`; Telnyx-`PATCH` merged **tief**, `null` heisst „nicht
  aendern".
- **Behaupte keinen Gewinn, den du nicht gemessen hast.** Am 2026-08-05 wurden vier Phasen
  als Fortschritt praesentiert, von denen keine am Telefon belegt war.

---

## Teil 5 — Betrieb

- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen. `git push origin` macht
  **nichts** live. Live-Stand IMMER per `/healthz` pruefen.
- **Prod-DB:** `psql "$(cat ~/.config/hermes/db-url)"`. RLS ist FORCE — erst
  `select set_config('app.current_tenant','<tenant>',false);` in **derselben** Sitzung.
  Tenant: `t_user_01KX600834GCJFV9GTZQKWZMTH`. **`started_at` ist TEXT**, nicht timestamp.
- **Rohtranskripte** verfallen nach `EVIDENCE_RETENTION_DAYS=7`. Gesichertes Material liegt
  unter `data/evidence/db-2026-08-04/` und `db-2026-08-04b/` (gitignored).
- **Turn-Diagnostik im Live-Log:** `[telnyx-shim] turn_ok` mit `toolNames` gegen
  `offeredToolNames`, dazu `streamChunks`, `consultPollFresh`, `latencyMs`, `messagesCount`.
  Ausserdem `turn_probe` (`prevRelation`, **`lastRole`**), `gate` (u.a. `provider_nudge`),
  `supersede`, `inbound_path`.
- **ElevenLabs-TTS ist seit 2026-08-03 kaputt:** `http_403` mit Cloudflare-Challenge bei jedem
  Satz, Fallback auf Azure. Schluessel gueltig, Konto mit Guthaben; von einer
  Entwicklermaschine antwortet dieselbe Anfrage mit HTTP 200. Es liegt an der Herkunft aus
  Render. **Ungeloest.**
- Nach vollen Testlaeufen `ps -eo pid,command | grep "[n]ode src/server.js"` pruefen.

### Pflichtlektuere, in dieser Reihenfolge

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md`
3. `tasks/gq-chain-state.md` — Kettenstand mit allen Messungen des 04./05.08.
4. `tasks/lessons.md`, die letzten fuenf Abschnitte

**Token-Disziplin:** Plan- und Kettenstand-Dateien sind Nachschlagewerke. Mit `grep -n`
hineingreifen, nicht am Stueck lesen.
