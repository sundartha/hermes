# Kickoff: das Kauderwelsch entwirren (B-7)

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

**Regel: nur Gemessenes.** Jede Aussage traegt einen Beleg (Call-ID, Log-Zeile, Datei:Zeile,
Anbieter-Doku, Audio-Zeitmarke) oder ist ausdruecklich als **unbelegt** markiert.

---

## Auftrag

Du uebernimmst die Gespraechsqualitaet des Telefon-KI-Agenten Hermes. **Der Auftrag dieser
Session ist B-7: der Agent versteht den Menschen am Telefon nicht.** Der Owner ist fuer
Testanrufe jederzeit erreichbar.

Danach warten zwei weitere Punkte, in dieser Reihenfolge — **nicht vorziehen**, beide messen
Rauschen, solange die Spracherkennung Wortsalat liefert:

| | Punkt | Stand |
|---|---|---|
| **1** | **B-7 Kauderwelsch** | **dein Auftrag** |
| 2 | **P2 — Modellwechsel Haiku -> Sonnet** (Owner-Entscheidung O-4, bindend) als A/B mit Messung | entblockt, Vorher-Zahl steht |
| 3 | **P3 — Persona und Identitaet** | offen, Vorher-Zahl steht |

**Punkt 3 ist P3 (Persona/Identitaet)** — falls unklar war, welcher der "dritte Punkt" ist:
Der Agent nennt gegenueber der Gegenstelle den Auftraggeber als Auskunftsquelle und fragt sie
ueber ihn aus; im Beleg-Anruf hielt er die Werkstatt sogar fuer den Auftraggeber
(*"Jetzt bin ich am Telefon mit dir, Antonio."*). Die Owner-Vorgabe dazu steht in
`tasks/gq-chain-state.md`. **Nicht als vierte Prompt-Runde bauen** — drei sind gescheitert.

---

## Stand

- Live und `master`: per `/healthz` gegenpruefen, **nie** aus einer Notiz lesen.
  Beim Schreiben dieses Textes: live `14073ff`, `master` `004c783` (Differenz = reine Doku).
- `npm test`: 4034 gruen. `npm run test:gates`: 129 Tests, 125 gruen — die roten sind
  bekannte SOLL-rot-Katalogbefunde (GAP-05, GAP-15) und **kein** Regressionssignal.
- **Gerade gelandet (GQ-H1-a, live abgenommen):** von Telnyx verworfene, nie gesprochene
  Antworten fliegen wieder aus dem Transkript. Neue Log-Zeile `discarded_answer`.
  Das ist fuer dich vor allem als **Messhygiene** wichtig: unser Transkript enthaelt seitdem
  keine Antworten mehr, die der Anrufer nie gehoert hat.
- `DIAGNOSTIC_RETENTION_DAYS=7` steht live: Anrufe an die Owner-Nummer behalten ihr
  **Rohtranskript 7 Tage**.
- **Telnyx-Aufnahmen existieren, als DUAL-CHANNEL-MP3** — die Stimme der Gegenstelle liegt auf
  einem eigenen Kanal. Das ist dein wichtigstes Werkzeug (s. u.).

---

## Der Befund, am Beleg

Wortsalat statt Sprache. Aus `call_mshb9v7btbsp` und `call_mshbrhnc7nfp` (2026-08-06,
Owner-Nummer, beide mit Aufnahme):

> *"Es geht dich in Schwesterkanne. Kannst Du im Internet mal bitte recherchieren?"*
> *"Weiss ich jetzt an Nile? What the fuck?"*
> *"Wer sieht ihn als gescheitert? Du sagst, manche sehr sagen das, andere das, Sachen ueber
> bitte Name und allem."*

**Neue Eskalationsstufe, und der Grund, warum das vor P2/P3 kommt:** der Agent hat aus dem
Kauderwelsch einen **Namen erfunden** und die Gegenstelle danach so angesprochen — aus einem
verstuemmelten *"Du bist..."* wurde *"Vielen Dank. Hat der Fix beim ersten Anruf fuer Sie
funktioniert, **Anil**?"*. Ein Agent, der halluzinierte Namen ausspricht, ist nicht nur
unverstaendlich, er ist peinlich.

### Zwei Fehlerbilder, die NICHT dasselbe sind

Halte sie ab der ersten Messung auseinander, sonst misst du zwei Dinge auf einer Achse
(wiederkehrender Fehler in diesem Repo):

| | Fehlerbild | Vermutlicher Ort |
|---|---|---|
| **(a)** | **Fragmentierung** — halbe Saetze, der Agent antwortet auf ein Bruchstueck | Endpointing (Eager-EOT) |
| **(b)** | **Wortsalat** — falsche Woerter, erfundene Namen ("Schwesterkanne") | Audio-Weg oder STT-Modell/-Konfiguration |

B-7 ist **(b)**. (a) ist weitgehend erklaert und teilweise entschaerft.

---

## Die Weggabelung, die ZUERST beantwortet wird

**Ist das Audio kaputt, oder ist die Spracherkennung kaputt?** Solange das offen ist, ist
jede Konfigurationsaenderung geraten. Die Dual-Channel-Aufnahme entscheidet es:

1. Aufnahme des betreffenden Anrufs ueber die Telnyx-API holen
   (`GET /v2/recordings`, Feld `download_urls.mp3`, `channels: "dual"`).
   Zuordnung ueber `call_session_id` bzw. die Zeitmarke.
2. **Den Kanal der Gegenstelle isolieren.**
3. Ihn gegen unser Transkript stellen (`transcript_segment`, 7 Tage vorhanden) und gegen
   Telnyx' eigenes Gespraechsprotokoll
   (`GET /v2/ai/conversations/<uuid>/messages`, UUID steht am Call).

Daraus folgen genau zwei Welten:

- **Die Aufnahme klingt sauber, das Transkript ist Salat** -> die Spracherkennung ist die
  Wurzel. Modell/Konfiguration sind der Hebel.
- **Die Aufnahme ist selbst verstuemmelt** -> der Audio-Weg ist die Wurzel. Dann hilft
  **keine** STT-Einstellung, und die Suche geht Richtung Leitung/Transcoding/Paketverlust.

**Zum Anhoeren brauchst du den Owner** (oder eine zweite, unabhaengige Transkription als
Referenz — dann ist die Bewertung sogar zahlenmaessig statt gefuehlt). Frag ihn, statt zu
raten.

> **Absolute Regel 5 bleibt bindend: Audio laeuft NIEMALS durch MCP** — nur Transkripte und
> Status. Aufnahmen sind echte Gespraeche mit echten Menschen: **niemals committen**, nicht
> in Logs, nicht in Tool-Ausgaben. Ausserhalb des Repos ablegen und nach Gebrauch loeschen.

---

## Die Hypothesen-Landkarte — keine weissen Flecken

Der Auftrag lautet ausdruecklich: **keine weissen Flecken.** Jede Hypothese bekommt am Ende
ein Urteil — **bestaetigt / widerlegt / ungemessen (mit Grund)**. Keine darf unbetrachtet
bleiben, und "ungemessen" ist ein zulaessiges, aber zu benennendes Ergebnis.

| # | Hypothese | Erster Messschritt |
|---|---|---|
| H1 | Audio-Weg verstuemmelt (US-DID -> DE, Transcoding, Paketverlust) | Aufnahme anhoeren (s. o.); `+49`-DID gegenprobe |
| H2 | STT-Modell ungeeignet fuer Deutsch (live: `deepgram/flux`) | Anbieter-Doku: welche Modelle bietet Telnyx, welche koennen `de`? |
| H3 | STT-Konfiguration unvollstaendig (`keyterm`, `smart_format`, `numerals` stehen alle auf `null`) | GET + Snapshot, dann EINE Aenderung pro Messung |
| H4 | Eager-EOT schneidet Aeusserungen ab und liefert Fragmente an die Erkennung | `turn_probe`: `prevRelation`/`chars`-Verlauf gegen die Aufnahme |
| H5 | Sprachmischung (deutsche Rede mit englischen Fachwoertern) kippt das Modell | Belegstellen im Transkript suchen ("What the fuck" stand woertlich drin) |
| H6 | Aufnahmesituation der Gegenstelle (Freisprecher, Umgebung, Mikrofon) | Owner fragen, wie er telefoniert hat |

Ergaenze die Liste, wenn du etwas findest — aber **streiche nichts ohne Messung**.

### Live-Konfiguration (Stand 2026-08-06), damit du nicht raetst

`transcription`: `model: "deepgram/flux"`, `language: "de"` · `settings`:
`eot_threshold 0.9`, `eot_timeout_ms 5000`, `eager_eot_threshold 0.9` — **alles Uebrige
`null`**, also Anbieter-Default: `smart_format`, `numerals`, `keyterm`,
`end_of_turn_confidence_threshold`, `min_turn_silence`, `max_turn_silence`,
`interim_results`, `enable_endpoint_detection`, `max_endpoint_delay_ms`.

Snapshot: `data/evidence/telnyx-config/assistant-snapshot-2026-08-06-gq-h1.json`.

---

## Nicht nochmal untersuchen (widerlegt oder erledigt)

- **`language: "multi" -> "de"`**: umgestellt, **Kauderwelsch unveraendert**. Kein Hebel.
- **`interim_results` als Ursache**: Default `false`, der Shim sieht nur finale Transkripte.
- **"Der Anrufer hoert zwei Antworten"**: widerlegt. Telnyx verwirft die ueberzaehligen
  Antworten selbst; die Zahl stammte aus unserem Transkript (durch GQ-H1-a behoben).
- **"Eager-EOT ist aus, weil beide Schwellen gleich sind"**: Telnyx' Doku behauptet das, aber
  live stehen beide auf `0.9` **und Eager feuert trotzdem** (belegt an drei verworfenen Turns).
  Anbieter-Aussage und Anbieter-Verhalten widersprechen sich. Per API laesst sich
  `eager_eot_threshold` **nicht loeschen** (`PATCH` mit `null` = "nicht aendern", tiefes
  Merge) — nur ueber das Mission-Control-Portal oder den Support.
- **`eot_threshold` hat keinen Spielraum**: Deepgram-Bereich 0.5-0.9, live steht das Maximum.

---

## Arbeitsweise

### 1. Erst der Feedback-Loop, dann der Fix

**Baue die Messung, bevor du irgendetwas aenderst.** Ein Testanruf kostet einen Menschen,
der eine Rolle spielt; ein Messlauf kostet Sekunden. Testanrufe sind zur **Verifikation** da,
nicht zum Iterieren.

Die naheliegende Messung hier: **aufgezeichnetes Audio gegen eine Referenz-Abschrift.** Damit
wird "besser verstanden" von einem Gefuehl zu einer Zahl (z. B. Wortfehlerrate) — und
Kandidaten-Konfigurationen sind vergleichbar, ohne jedes Mal zu telefonieren.

**Eine Messung ohne Vorher-Wert ist wertlos.** Erhebe die Zahl am Ist-Zustand, bevor du
etwas aenderst — sonst kannst du keinen Gewinn belegen (Lehre `tasks/lessons.md`:
ein Szenario, das im Vorher-Stand schon gruen ist, kann keinen Fix beweisen).

### 2. Diagnose mit Subagenten, Umsetzung als Phase

- **Diagnose breit, parallel, nur lesend:** mehrere Subagenten, je eine Hypothese aus der
  Landkarte, jeder mit klarem Auftrag und Belegpflicht. Das haelt deinen Kontext sauber.
- **Umsetzung schmal:** ein Fix = eine Phase ueber `phase-impl-lean` (Plan -> Implementierung
  im Worktree -> dualer Review -> Self-Fix bis PASS). **Clean-Code ist hartes Gate**
  (`.claude/refs/clean-code.md`, S1/S2 = Blocker).
- **Dynamischer Workflow, wo er traegt:** wenn der Loesungsraum offen ist (welche
  STT-Konfiguration?), lohnt ein Panel mehrerer unabhaengiger Ansaetze mit anschliessender
  Bewertung. Wenn das Problem eng ist, ist ein Fan-out nur Token.
- **Anbieter-Konfiguration ist die erste Adresse, nicht die letzte.** Die einzigen zwei
  owner-bestaetigten Verbesserungen dieser Kette waren Telnyx-Parameter, in Sekunden gesetzt
  — waehrend fuenf Workflow-Phasen nichts Hoerbares lieferten.

### 3. Gegen Halluzination — die Arbeit muss sich selbst pruefen

Diese Punkte sind aus konkreten Schaeden in diesem Repo entstanden:

- **Agenten-Befunde adversarisch pruefen.** Ein Befund gilt erst, wenn ein unabhaengiger
  Pruefer ihn zu **widerlegen** versucht hat und gescheitert ist. Sammeln allein reicht nicht.
- **Ergebnisse NIE ueber ein modell-formuliertes Feld joinen** (Titel, Freitext). Nur ueber
  einen vom Skript vergebenen Schluessel (Index/ID). Ein Freitext-Join ist schon einmal still
  gescheitert und hat 5 belegte Befunde unsichtbar gemacht — er faellt in die falsche
  Richtung ("nicht gefunden" = "nicht bestaetigt"). Trefferquote immer mitloggen.
- **Ein gruener Test ist erst ein Beleg, wenn er ohne den Fix rot ist.** Bau den Fix
  probeweise aus, sieh Rot, bau ihn zurueck. Ohne diese Gegenprobe misst du womoeglich nichts.
- **Vorsicht mit Test-Doubles:** zuletzt konnte ein `fakeStore` **mehr als der echte Store**
  (Boolean statt `undefined`) — der Fehler kam erst am Telefon heraus. Zusicherungen ueber
  Rueckgabewerte gehoeren an das **echte** Backend.
- **Behaupte keinen Gewinn, den du nicht gemessen hast.** Am 2026-08-05 wurden vier Phasen als
  Fortschritt praesentiert, von denen keine am Telefon belegt war.
- **Eine Messung gilt nur fuer die Konfiguration, in der sie erhoben wurde.** Aenderst du
  Modell, Sprache oder Nummer, ist die alte Zahl keine Vergleichsgroesse mehr.

### 4. Pre-Mortem vor jeder Entscheidung (CLAUDE.md verlangt es)

Versetz dich ein Jahr in die Zukunft und nimm an, die Entscheidung war falsch: *Was ist
passiert?* Fuer diese Session die naheliegenden Antworten vorweg:

- *"Wir haben am STT geschraubt, bis die Testsaetze sassen — und im echten Gespraech ist es
  unveraendert."* -> Deshalb misst du gegen **echte Aufnahmen**, nicht gegen selbst
  gesprochene Idealsaetze.
- *"Wir haben ein halbes Jahr die Erkennung optimiert, und die Wurzel war die Leitung."*
  -> Deshalb steht die Weggabelung Audio/STT **vor** allem anderen.
- *"Wir haben `keyterm` mit Begriffen gefuellt und damit das Modell auf unseren Testfall
  ueberangepasst."* -> Gegenprobe mit Gespraechen, die diese Begriffe nicht enthalten.

---

## Betrieb

- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen. `git push origin` macht
  **nichts** live. Live-Stand IMMER per `/healthz`.
- **Prod-DB:** `psql "$(cat ~/.config/hermes/db-url)"` — Achtung, der Zugang haengt an einer
  **IP-Allowlist**; "SSL connection has been closed unexpectedly" heisst meist Firewall, nicht
  TLS. RLS ist FORCE: erst
  `select set_config('app.current_tenant','t_user_01KX600834GCJFV9GTZQKWZMTH',false);` in
  **derselben** Sitzung. `started_at` ist TEXT.
- **Rohtranskripte:** `select at, role, text from transcript_segment where call_id='...' order by at;`
- **Render-Logs** sind ueber das Render-MCP abfragbar (Filter nach Call-ID) — dort stehen
  `turn_probe` (`prevRelation`, `gapMs`, `chars`, `messagesCount`, `providerMessagesGrew`),
  `turn_ok` (`toolNames` vs. `offeredToolNames`, `latencyMs`), `supersede`,
  `discarded_answer`, `gate`.
- **Telnyx-Konfiguration:** **erst `GET` + Snapshot nach `data/evidence/telnyx-config/`, dann
  patchen.** `PATCH` merged tief, `null` heisst "nicht aendern". Ein Default sieht aus wie
  eine Entscheidung — belegen, bevor du ihn interpretierst.
- **ElevenLabs-TTS** liefert seit 2026-08-03 `http_403` von Render aus (Cloudflare), Fallback
  Azure. Ungeloest, nicht Teil dieses Auftrags.
- Nach vollen Testlaeufen `ps -eo pid,command | grep "[n]ode src/server.js"` pruefen und
  verwaiste Testserver beenden. **Nur EINE Testbahn zur Zeit** — zwei parallele Laeufe haben
  sich hier schon gegenseitig blockiert.

### Beim Testanruf beachten

Der Agent stellt vor dem Anruf Rueckfragen. **Eine Consult-Antwort ist Prompt-Inhalt, kein
Formular** — sie muss so formuliert sein, wie der Agent sie der Gegenstelle gegenueber
verwenden koennte. Eine unbedachte Antwort ("Antonio meldet sich selbst.") ist am 2026-08-05
als Fakt in den Kontext gegangen und hat eine Gespraechsschleife mitverursacht. Im Zweifel den
Owner fragen, statt etwas zu erfinden.

---

## Pflichtlektuere

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md`
3. `tasks/gq-chain-state.md` — der laufende Kettenstand; mit `grep -n` hineingreifen, nicht am
   Stueck lesen. Besonders: "GQ-H1", "Live-Abnahme", die Owner-Vorgabe zu P3
4. `tasks/lessons.md`, die letzten sechs Abschnitte
