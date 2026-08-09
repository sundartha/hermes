# Kettenstand: Gespraechsqualitaet (GQ)

Startet am 2026-08-04 nach `tasks/kickoff-gespraechsqualitaet-2026-08-03.md`.
Diese Datei ist der Kettenstand — hier steht, was gemessen wurde, nicht was geplant war.

## Ausgangslage, am 2026-08-04 nachgemessen

Vier Angaben des Kickoffs sind ueberholt. Das ist kein Fehler des Kickoffs — es ist
seither deployt worden.

### 1. Der Live-Stand ist `886a3b2`, nicht `ce4df1d`

`/healthz` liefert `886a3b2cc81e49dae959ef786e59b6d4af713a78`. Das sind **58 Commits**
mehr als `ce4df1d`, auf dem die Befunde B-1..B-10 erhoben wurden — die gesamte KV-Kette
ist live. Lokaler `master` (`6061b23`) ist `upstream/master` + drei reine Doku-Commits.
Es liegt also **keine unfertige fremde Kette** mehr auf `master`; sie ist gemergt.

### 2. Der O-7-Blocker ist eingetreten: das Basic-Auth-Gate ist LIVE entfernt

- `b111927` ist **nicht** Vorfahre von `ce4df1d` (Stand 03.08.), aber **Vorfahre von
  `886a3b2`** (heute live). Der Wegfall kam also mit dem juengsten Deploy.
- Live-Gegenprobe: eine Fehl-URL liefert `404` **ohne** `WWW-Authenticate: Basic`.
  Der Fingerabdruck des Gates fehlt — es ist nicht nur im Code weg, sondern im Dienst.

**Beurteilung: Aussperrung, kein Leck.** Live ohne Session gemessen:

| Route | Antwort | Bewertung |
|---|---|---|
| `/api/admin/tenants` | `401` | gesichert |
| `/api/calls`, `/api/settings`, `/api/usage` | `404` | Read-404-Politik greift |
| `/api/plans` | `200` | gewollt oeffentlich (`route-policy.js`) |
| `/v1/chat/completions` | Bearer-Vergleich im Handler | gewollt (Telnyx BYO-LLM) |

Kein Endpunkt steht offen. Aber die Betreiber-Routen sind fuer **niemanden** erreichbar:

```
user_01KX600834GCJFV9GTZQKWZMTH | antonio.fotiadis.francisco@gmail.com | member
user_01KXH2B75WJ75W3JYYXDPPSK3R | jonas@kroh-willich.de                | member
```

Kein Account traegt `role='admin'`. Der Fix ist ein `UPDATE account SET role='admin'`
plus **Dienst-Neustart** (der pg-Store haelt Zustand im Speicher, ein direktes UPDATE
ist sonst unsichtbar und wird evtl. ueberschrieben). Nach O-7 fasst diese Kette das
**nicht** an — Owner-Entscheidung.

### 3. B-1 ist im frisch gezogenen Rohmaterial glasklar belegt

`call_msczdf1aadbw`, mit Zeitstempeln (die aeltere `.txt`-Sicherung hatte keine):

```
09  caller 08:43:15.745  "...frag deinen besitzer welches automodell er hat damit ich weiss"
10  caller 08:43:17.880  dieselbe Aeusserung, vollstaendiger
11  agent  08:43:18.583  Antwort auf 09
12  agent  08:43:20.061  Antwort auf 10 — 1,478 s spaeter, ueberschreibt 11
```

Zwischenergebnis und Endergebnis der Spracherkennung loesen **je einen** Agenten-Turn aus.
Segment 7 traegt zusaetzlich das Kauderwelsch aus B-7 ("Bis zum behindert, man.").

### 4. Frisches Rohmaterial, das der Kickoff nicht kennt

Gezogen am 04.08. nach `data/evidence/db-2026-08-04/*.tsv`
(Spalten: `seq`, `rolle`, ISO-Zeit, `text` — die Zeit ist fuer B-1 der entscheidende Teil):

| Anruf | Richtung | Zeit | Engine | Segmente |
|---|---|---|---|---:|
| `call_mseip2888klk` | outbound | 04.08. 10:30 | assistant | **0** |
| `call_msehh15xn34h` | outbound | 04.08. 09:56 | assistant | 10 |
| `call_msegxsp9qucb` | outbound | 04.08. 09:41 | assistant | 7 |
| `call_mseguri8r6gp` | inbound | 04.08. 09:39 | budget | 2 |
| `call_msegtel31iqp` | inbound | 04.08. 09:38 | budget | 1 |
| `call_msegs822qyuo` | inbound | 04.08. 09:37 | budget | 1 |
| `call_msczw0irl06s` | inbound | 03.08. 08:56 | budget | **0** |
| `call_msczdf1aadbw` | outbound | 03.08. 08:42 | assistant | 38 |
| `call_msahzky8m8p9` | outbound | 01.08. 14:59 | assistant | 24 |
| `call_msabz9975sph` | outbound | 01.08. 12:11 | assistant | 17 |

Drei Beobachtungen daraus, jede fuer sich ein Beleg:

- **B-8 bestaetigt sich in der Spaltenbelegung**: jeder Inbound-Anruf laeuft ueber die
  Budget-Engine (`assistant_id` NULL), jeder Outbound ueber den Assistant-Pfad.
  Die Zweiteilung ist keine Momentaufnahme, sie ist der Normalzustand.
- **O-10 bestaetigt sich**: **alle zehn** Anrufe stehen auf `diagnostic=false`, auch die,
  bei denen das Feld gesetzt wurde. Der Server ignoriert es.
- **O-11 bestaetigt sich**: Inbound-Anrufe tragen 0-2 Segmente, Outbound bis zu 38.
  Fuer Inbound gibt es faktisch kein Rohmaterial.

Der Anruf mit **0 Segmenten von heute 10:30** ist derselbe, der in der KV-Gegenprobe
`turnSeq 1` und `2` eine Millisekunde auseinander zeigte — sein Rohtranskript ist bereits
weg. Genau der Grund, warum O-10/O-11 parallel zum Pruefstand laufen.

## Welle 0 — Kartierung, abgeschlossen 2026-08-04

12 Agenten, nur lesend, 0 Fehler, ~885k Token, 8 Minuten. Berichte: `tasks/gq-welle0/*.md`.
9 von 12 Wurzeln am Code belegt, 3 als messbare Hypothese markiert, **keine geraten**.

Geteilte Dateien (bestimmen die Reihenfolge — disjunkt = parallel):

| Datei | Befunde |
|---|---|
| `src/store/state-ops.js` | B-3, B-6, O-10 |
| `src/telnyx-llm-shim.js` | B-1, B-10 |
| `src/consult/in-call.js` | B-2, B-3 |
| `src/claude.js` | B-6, O-3 |
| `src/routes/voice.js` | B-9, O-10 |

### Drei Karten hat die Nachmessung des Leads widerlegt

Das ist der Zweck der Gegenprobe — die Agenten haben sauber gearbeitet und ihre Annahmen
als solche markiert; die Messung fiel gegen sie aus.

**B-4: nicht das Inbound-Gate.** Die Karte bot an, `lookupProviderFor` schliesse per
`direction !== "outbound"` jeden Inbound-Anruf aus — das erklaere die Bench/Live-Diskrepanz,
*falls der Testanruf inbound war*. Er war es nicht: `call_msczdf1aadbw` ist **outbound**
(von der US-DID auf die Privatnummer des Owners). `look_up` **wurde** angeboten und feuerte trotzdem
0 von 19 Mal. B-4 bleibt eine echte Modell-Entscheidungsluecke, wie B-5.

**O-10: nicht das fremde Ziel.** Die Karte fuehrte `diagnostic=false` darauf zurueck, dass
`diagnosticRetentionGranted` nur bei `to === ownNumber` greift und Testanrufe an Fremdziele
strukturell durchfallen. Owner-Korrektur: er hat **ausschliesslich sich selbst** angerufen.
Die echte Wurzel steht eine Zeile darueber:

```js
return Boolean(ownNumber) && to === ownNumber;   // ownNumber = store.tenantPrivateNumber
```

Gemessen: `private_number` ist fuer den Tenant **leer**. Damit ist `Boolean(ownNumber)`
immer falsch und `diagnostic` **immer** false — unabhaengig vom Ziel. **Derselbe fehlende
Wert ist O-9** (`sms_summary_skipped reason=no_private_number`). Ein Owner-Handgriff
schliesst beide Befunde; danach Dienst-Neustart (der pg-Store haelt Zustand im Speicher).

**B-2: das Werkzeug war sichtbar.** Die Karte fuehrte den Befund auf ein Poll-Frischefenster
zurueck (`get_consult` nur im Werkzeugsatz, wenn der MCP-Client gerade pollt). Am Beleg-Anruf
steht aber ein tatsaechlich gestellter Consult:

```
c0  askedAt 08:43:34.614  "Welches Automodell soll zur Inspektion in die Werkstatt?"
    status: timed_out     answeredAt: null     answeredFacts: 0
```

`get_consult` **hat gefeuert**, die Antwort kam nie an. Das bestaetigt **B-3** am Beleg und
laesst fuer B-2 nur die praezisere Frage offen, ob das Werkzeug in den *uebrigen* 18 Turns
im Satz war. Das misst der Pruefstand (`offeredToolNames`), es ist keine Designfrage.

**Owner-Klarstellung zu `get_consult` (2026-08-04, bindend):** Es ist ein Kanal
**Assistent-zu-Assistent**, nicht Agent-zu-Mensch. Der persoenliche Assistent des Users
(Claude/ChatGPT/Gemini) loest den Anruf ueber den MCP-Server aus und haelt den
`await_call_event`-Loop offen; Hermes fragt **ihn** — er hat Kalender und Kontext. Weiss
*der* nicht weiter, fragt er den Menschen; das ist nicht Hermes' Sache. Der aktive Poll
ist damit der **vorgesehene Normalzustand**, kein Konstruktionsfehler — die MCP-Instruktion
schreibt ihn ausdruecklich vor. Kein Redesign.

### B-1: die Wurzel steht, gemessen an der Live-Config und an der Anbieter-Doku

Der Owner hat "erst messen, was live steht" angeordnet. Die Messung
(`GET /v2/ai/assistants/assistant-dcf48d08-…`, Snapshot in
`data/evidence/telnyx-config/assistant-snapshot-2026-08-04.json`) widerlegt die
Provisioner-Hypothese und liefert die echte Ursache:

```
start_speaking_plan      : null          <- der Plan aus dem Provisioner existiert LIVE NICHT,
                                            ENDPOINTING_ON_NO_PUNCTUATION_SECONDS=0.8 ist wirkungslos
transcription.model      : deepgram/flux
transcription.language   : "multi"       <- kein Sprach-Hinweis
  eot_threshold          : 0.8
  eager_eot_threshold    : 0.8           <- HIER
  eot_timeout_ms         : 5000
```

`eager_eot_threshold` ist bei Flux **per Default nicht gesetzt** (eager mode aus). Er wurde
aktiv gesetzt. Ist er gesetzt, sendet Flux pro Aeusserung bis zu drei Ereignisse:
`EagerEndOfTurn` (mittlere Konfidenz) -> ggf. `TurnResumed` (der Mensch spricht doch weiter)
-> `EndOfTurn` (endgueltig). Die Deepgram-Doku schreibt den Umgang woertlich vor:
*"Avoid committing to a reply until EndOfTurn"*, *"Use EagerEndOfTurn outputs to draft, not
finalize"*, *"Treat TurnResumed as a cancellation signal."*

**Wir implementieren nichts davon** — der Shim behandelt jeden POST als eigenstaendigen Turn
(am Code belegt: kein `is_final`/`interim`-Feld wird gelesen, keine Serialisierung, kein
Abbruch) und spricht den Entwurf sofort aus. Wir zahlen also den vollen Preis des
eager-Modus (doppelte Modellaufrufe, doppelte Antworten) ohne einen seiner Vorteile.

Damit ist die urspruengliche Owner-Frage ("welcher Turn darf sprechen, wie viel Wartezeit")
gegenstandslos: **die Wartezeit existiert bereits, sie wird nur falsch genutzt.**

### B-7: dieselbe Messung, zweite Wurzel

`transcription.language = "multi"` ohne `language_hint`. Das Modell (`flux-general-multi`)
raet die Sprache je Turn neu. Genau daraus entsteht "Bis zum behindert, man." aus deutschem
Audio. Laut Doku ist `language_hint` ein **Bias, kein Ausschluss** — er bleibt also auch
fuer den weltweiten Betrieb tragfaehig, wenn er spaeter je Anruf gesetzt wird.

Beides ist **Provider-Konfiguration, kein Code.** Rueckweg ist der gesicherte Snapshot.
Achtung bei der Umsetzung: der Provisioner schreibt die GANZE Live-Config aus der lokalen
`.env` (dokumentierte Falle) — noetig ist ein gezielter Eingriff, kein Provisioner-Lauf.

## Owner-Entscheidungen vom 2026-08-04

- **B-1:** erst die Live-Konfiguration messen — erledigt, s.o.
- **B-10:** Alarm als hochsichtbare **Log-Zeile**, Alarmregel ausserhalb des Repos (Render).
  Keine Alarm-SMS: kostet Geld und kann in eine Schleife geraten.
- **`get_consult`:** Assistent-zu-Assistent, s.o. Kein Redesign.
- **O-10:** der Owner hat nur sich selbst angerufen -> Wurzel ist die fehlende private Nummer.

## Fortschritt

| Welle | Inhalt | Stand |
|---|---|---|
| 0 | Kartierung, 12 Agenten nur lesend | **fertig** |
| S1 | Sonden: Turn-Herkunft (B-1) + Inbound-Feldname (B-9/O-1) | **gemergt + deployt** |
| 1 | Pruefstand (allein) | offen |
| 2+ | Befund-Phasen, gruppiert nach Dateimengen aus Welle 0 | offen |

## GQ-S1 — Sonden, gemergt 2026-08-04 (`0d9a23c`)

PASS ohne Fix-Runde, 7 Dateien, +459/-9, 12 neue Tests. Rein additiv: kein Verhalten,
kein Gate, kein Datenmodell, keine Dependency. Vom Lead gegengeprueft — Basis aktuell,
Diff eng (kein `config.js`, keine `.env.example`), entfernte Zeilen sind Umbau, keine
gestrichenen Sicherungen.

**Sonde A** (`src/telnyx-turn-probe.js`, verdrahtet im Shim) merkt sich je Call **nur einen
Fingerabdruck** des letzten Turn-Textes — Zeichenzahl und Hash, **nie den Text**. Die
Praefix-Beziehung prueft sie, indem sie das gleich lange Anfangsstueck des *aktuellen*
Textes hasht. Damit entsteht kein zweiter PII-Speicher neben dem Transkript. Sie loggt
`turn_probe` mit vier unterscheidbaren Relationen:

| Relation | Bedeutung fuer B-1 |
|---|---|
| `same` | identischer Text -> **ein doppelt zugestellter Request** |
| `extends` | Vorgaenger ist echtes Praefix -> fortgeschriebene Erkennung, zwei Turns |
| `other` | unabhaengiger Text -> zwei echte Aeusserungen |
| `first` | erster Turn des Calls |

**Sonde B** protokolliert die **Schluesselnamen** des Inbound-TeXML-Bodys ohne Werte und
macht den bisher **stillen** Rueckfall auf die Budget-Engine laut (O-1-Auflage). Das
Scharfschalten des Handoffs ist bewusst nicht Teil dieser Phase — erst der belegte
Feldname, dann der Umbau.

**Testlauf-Hinweis:** der erste Lauf nach dem Merge meldete 2 rote Tests, zwei Folgelaeufe
3890/3890 gruen. Nicht reproduzierbar, also das dokumentierte Volllast-Flake
([[suite-flake-p5-gate-proof-spawn-race]]). Die Namen der beiden wurden nicht erfasst.

## Vier Testanrufe am 2026-08-04 — was wirkt und was nicht

Owner-Urteil ist der Massstab, nicht die Testsuite.

| Eingriff | Art | Ergebnis |
|---|---|---|
| `disable_greeting_interruption: true` | Provider-Config | **WIRKT** — Owner bestaetigt: Offenlegung laeuft vollstaendig durch, nicht mehr wegdrueckbar |
| `interrupt_prediction_threshold: 0.4 -> 0.2` | Provider-Config | **WIRKT** — Owner bestaetigt: Unterbrechen reagiert schneller |
| `language: multi -> de` | Provider-Config | **KEIN GEWINN** — Kauderwelsch unveraendert ("Eva, Du stoppst zum Kanisch") |
| `eot_threshold: 0.8 -> 0.9` | Provider-Config | unklar — Fragmente kommen weiter, die Antworten darauf sind aber sinnvolle Ueberbrueckungen |
| **GQ-P1 (Verdraengungs-Riegel)** | **Code** | **WIRKUNGSLOS** — ueber zwei Anrufe **6 von 6** `extends`-Faelle mit `refusal: no_inflight` |

**GQ-P1 ist die teuerste Lehre des Tages.** Der Riegel loest Ueberlappung; es gibt aber keine.
Der Agent antwortet nach ~1 s, die Fortsetzung der Aeusserung kommt nach 1,4-5,5 s — der
Vorgaenger-Turn ist also immer schon fertig. **Das war aus den vorliegenden Zeitstempeln
ablesbar, bevor die Phase startete.** 753k Token und 45 Minuten fuer einen Pfad, der nie
betreten wird. Der Code bleibt (er schadet nicht, der Pfad ist erreichbar), aber er zaehlt
nicht als Verbesserung.

**Zwischenbefund fuer die Arbeitsweise:** die beiden einzigen bestaetigten Verbesserungen des
Tages waren **Provider-Parameter, in Sekunden gesetzt, ohne einen einzigen Agenten**. Die
Assistant-Konfiguration ist die erste Adresse, nicht die letzte. Siehe
[[provider-config-needs-doc-before-diagnosis]].

**Neuer Befund aus Anruf 3 (`call_mseupp82iyqm`), noch offen:** Offenlegung und erster
Modell-Turn ueberlappen. Zwei `agent`-Segmente 380 ms auseinander (16:07:38.063 / .443), das
zweite voellig deplatziert ("warte auf den Anruf oder soll ich jetzt bei der Werkstatt
anrufen?" — mitten im Anruf). Der Greeting-Schutz verhindert die Unterbrechung des
Sprechens, nicht den parallelen Start eines Modell-Turns.

## Kettenstand am Ende des 2026-08-04

| Phase | Inhalt | Stand | Wirkung |
|---|---|---|---|
| GQ-S1 | Sonden: Turn-Herkunft + Inbound-Feldname | live | **gross** — loeste B-1 und B-9 |
| GQ-P1 | Verdraengungs-Riegel bei `extends` | live | **keine** — 6 von 6 `no_inflight` |
| GQ-P2 | Consult: zwei Fristen statt einer | live | ungemessen (braucht Testanruf) |
| GQ-P3 | Inbound auf den Assistant-Pfad | live | ungemessen (braucht Inbound-Anruf) |
| GQ-P4 | Stummes Scheitern + Nachrichten-Dedup | live | ungemessen (braucht Ausfall bzw. Anruf) |
| 4 Provider-Parameter | Offenlegung/Barge-in/Endpointing/Sprache | live | **2 von 4 owner-bestaetigt** |

**Nicht gebaut, mit Begruendung:** B-4 (`look_up` feuert nie) und B-5 (`end_call` feuert
nie). Beide sind verdrahtungsseitig korrekt und wurden zweimal erfolglos ueber Prompts
angegangen (AL-P14, AL-D3). Der richtige Hebel ist der Modellwechsel Haiku -> Sonnet als
A/B-Lauf (O-4), keine dritte Formulierungsrunde.

### Offene Punkte fuer die naechste Sitzung

1. **Abnahme durch Testanrufe.** GQ-P2/P3/P4 sind gruen und live, aber **keine** ihrer
   Wirkungen ist am Telefon gemessen. Konkret abzulesen:
   - GQ-P2: `answer_consult` liefert `accepted: true`, `answeredFacts >= 1`
   - GQ-P3: **Inbound**-Anruf traegt `assistant_id` und `telnyx_conversation_id`
     (heute NULL), Log zeigt `turn_ok`, `stt_gap` von 13-15 s verschwindet
   - GQ-P4: `take_message` legt bei Wiederholung nur EIN Item an
2. **KV-M1 auf dem Assistant-Pfad wiederholen** (Uebergabepunkt 1 des Kickoffs): Inbound
   kostet jetzt ~5 statt 1,87 US-Cent je angefangener Minute, der Tarif ist neu zu
   kalibrieren.
3. **Private Nummer erneut setzen** — ein direktes DB-`UPDATE` wurde vom pg-Store
   ueberschrieben (`>>WEG<<` nach dem Anruf). Muss ueber das Dashboard laufen. Ohne sie
   bleibt `diagnostic` false (O-10) und keine Nachricht erreicht den Owner (O-9).
4. **B-7 (Kauderwelsch) ist offen.** `language: multi -> de` hat **nichts** gebracht
   ("Eva, Du stoppst zum Kanisch"). Naechster Kandidat waere `keyterm` (Begriffe boosten)
   oder ein anderes STT-Modell — beides Provider-Konfiguration, kein Code.
5. **Offenlegung und erster Modell-Turn ueberlappen** (Anruf 3, 380 ms Abstand). Der
   Greeting-Schutz verhindert die Unterbrechung des Sprechens, nicht den parallelen Start
   eines Turns. Reproduzierbarkeit noch ungeprueft.

## Was jetzt gemessen werden muss

**Ein Testanruf des Owners** klaert drei Dinge auf einmal:

1. **B-1 an der Quelle:** sagt das Log `same`, ist es eine Doppel-Zustellung (Retry/
   Reconnect) — sagt es `extends`, sind es zwei echte Turns aus der Spracherkennung.
   Davon haengt ab, ob der Fix bei uns oder beim Provider sitzt.
2. **B-9/O-1:** wie das Inbound-Feld mit der `call_control_id` wirklich heisst — heute
   steht dort der geratene Name `"CallControlId"`.
3. **B-7:** ob das Kauderwelsch nach der Umstellung `language: multi -> de` zurueckgeht.

Voraussetzung fuer die Forensik ist erfuellt: private Nummer gesetzt, Dienst neu gestartet,
`diagnostic` kann jetzt greifen.

## Nebenbefunde, nicht Teil des Auftrags

- **~90 verwaiste Worktrees** unter `.claude/worktrees/` aus abgeschlossenen Ketten
  (AL, KS, KV, gates, auth). CLAUDE.md verlangt Aufraeumen im Merge-Commit; das ist
  nachzuholen, aber nicht in dieser Kette.
- `place_call` verlangt E.164 (`+49...`), obwohl die Werkzeugbeschreibung eine Aufloesung
  der fuehrenden 0 ueber das Heimatland behauptet (aus dem Kickoff uebernommen, hier nicht
  nachgemessen).

## GQ-P3 — Inbound auf den Assistant-Pfad (umgesetzt)

**Gemessener Feldname (Beleg):** Sonde B protokollierte am echten Inbound-Anruf
`call_mseqcvoh8bcx` die vollstaendige Schluesselliste des TeXML-Bodys — `"CallControlId"`
(der geratene Name aus B-9/O-1) kam darin **nicht** vor, `lookalikeFields` war leer. Telnyx
liefert die call_control_id im Feld `CallSid`. Gegenprobe: `GET /v2/calls/<CallSid>`
antwortete HTTP 200 mit `call_leg_id`/`call_session_id`, Format `v3:...` (57 Zeichen) —
identisch zur call_control_id eines Outbound-Legs. `INBOUND_CALL_CONTROL_ID_FIELD` in
`src/telnyx-inbound.js` steht jetzt auf `"CallSid"`.

**Pfadwahl benannt:** `inboundHandoffDecision` (`src/telnyx-inbound.js`) entscheidet je
Inbound-Leg zwischen `INBOUND_PATH.ASSISTANT` und `INBOUND_PATH.BUDGET` (mit einem der vier
`INBOUND_BUDGET_REASON`-Gruende) und wird ueber `logInboundPathDecision` **je Leg** geloggt
(`[telnyx-inbound] inbound_path {...}`) — das Boot-Banner allein hatte B-9 wochenlang
verdeckt ("Assistant-Pfad: AKTIV" im Banner, Budget-Engine an jedem Inbound-Leg).

**Rueckweg-Schalter:** `TELNYX_INBOUND_HANDOFF_ENABLED` (Default `true`, in
`config.telnyx.telnyxAssistant.inboundHandoffEnabled`). `false` stellt Inbound ohne Deploy
auf die Budget-Engine zurueck (Render-Dashboard). Boot-Banner traegt die eigene Zeile
`Inbound-Handoff: AKTIV/aus (...)`, getrennt vom Master-Schalter-Banner.

**Erwartetes Verhalten, kein neuer Defekt (Pre-Mortem 2):** ein Inbound-Gespraech kann jetzt
frueher an der Tenant-Kostendecke abbrechen als vorher — der Assistant-Pfad kostet nach
KV-M1 ~5 US-Cent/Minute gegen 1,87 auf der Budget-Engine (rund dreimal teurer). Beim
naechsten Testanruf nicht als neuen Bug fehldeuten.

**Uebergabepunkt:** KV-M1 ist nach dieser Phase **auf dem Assistant-Pfad** zu wiederholen und
der Tarif neu zu kalibrieren.

**Nebenbefund (kein Code-Eingriff, gepinnt in Test statt geaendert):** derselbe Wert, der
`call.twilioSid` fuellt, fuellt jetzt auch `call.callControlId` — `hangUpAction` verzweigt an
dessen Praesenz, der Cap-Hangup eines Inbound-Legs laeuft damit ueber
`endCallViaCallControl` statt `endCall` (Bestandsverhalten von `hangUpAction`, bereits von
`test/telnyx-p6-cap-callcontrol.test.js` gepinnt — hier entsteht nur ein neuer Erreicher).

---

## Messung 2026-08-04 abends: die Wurzel von N-1 ist ein Provider-Parameter

Gemessen am Beleg-Anruf `call_msf0epenyv9g` (Rohmaterial gesichert unter
`data/evidence/db-2026-08-04b/`, Live-Config unter
`data/evidence/telnyx-config/assistant-snapshot-2026-08-04-abend.json`).
Kein Agent, kein Workflow — `psql`, Render-Logs, ein `GET` auf die Assistant-Config.

### Der Befund

`turn_probe` zeigt fuer die sieben `same`-Turns durchgehend **`lastRole: "system"`**:

| turnSeq | prevRelation | lastRole | gesprochener Satz |
|---:|---|---|---|
| 4 | same | **system** | "Gerne, ich warte geduldig." |
| 5 | same | **system** | "Gerne, ich warte." |
| 8 | same | **system** | "Ich bin still und warte auf die Auskunft…" |
| 9 | same | **system** | "Sie haben recht - ich sage nichts mehr…" |
| 10 | same | **system** | "Ich warte still." |
| 17 | same | **system** | "Ich kann Antonio leider nicht erreichen…" |

Das sind **keine wiederholten Nutzer-Aeusserungen.** Telnyx schickt einen POST, dessen
letzte Nachricht eine **System**-Nachricht ist. Der Gegenbeleg steht im Transkript: um
18:47:47 sagt die Gegenstelle woertlich *"Ich hab nix gesagt, Digger. Was laberst Du?"*

### Die Ursache, an der Anbieter-Doku belegt

Live-Config: `telephony_settings.user_idle_reply_secs = 4`.
Telnyx-OpenAPI-Schema (`GET /api-reference/assistants/get-an-assistant`), woertlich:

> *"Duration in seconds of end user silence before the assistant checks in on the user.
> When this limit is reached the assistant will prompt the user to respond."* — **Default: 10**

**4 ist nicht der Default.** Der Wert wurde aktiv gesetzt (nicht von uns — `grep -rn
"user_idle" src/` ist leer, also ueber das Telnyx-Dashboard) und ist schaerfer als der Default.

Dazu kommt unsere Seite: `lastUserContent()` (`src/telnyx-llm-shim.js:88-95`) laeuft das
`messages`-Array rueckwaerts und nimmt die letzte Nachricht mit `role === "user"`. **Eine
System-Nachricht ist fuer den Shim unsichtbar.** Er beantwortet also die *alte* Aeusserung
noch einmal — mit vollem Modell-Roundtrip und gesprochenem Satz.

### Warum daraus eine Schleife wird

Der gesprochene Satz ist selbst wieder Stille aus Sicht des Nutzers -> nach 4 s der naechste
Anstoss -> naechster Satz. Gemessene Abstaende: 7,1 / 7,7 / 10,1 / 8,3 / 9,4 s
(4 s Stille + eigene TTS-Dauer). Die Schleife bricht erst, wenn der Mensch spricht.

### Warum genau bei der Rueckfrage

In den drei anderen Anrufen des Tages (`call_msetewtfmvpb`, `call_mseupp82iyqm`,
`call_mseuv52c7b0e`) gibt es **null** `lastRole: "system"`-Turns — dort hat die Gegenstelle
durchgehend geredet. Der Anstoss feuert nur bei echter Stille. Das ist exakt der Zustand, den
`get_consult` herstellt: der Agent bittet um Geduld und wartet. **Der 4-Sekunden-Anstoss und
die Rueckfrage-Wartezeit sind strukturell unvertraeglich.**

### Derselbe Mechanismus erklaert den offenen Punkt 5

`call_mseupp82iyqm` turnSeq 1: `chars: 0`, `lastRole: "system"`, `messagesCount: 2`. Der
allererste POST traegt **gar keine** Nutzer-Nachricht. Der Shim faehrt trotzdem einen
Modell-Turn und spricht ihn aus — das ist der deplatzierte zweite Agenten-Satz 380 ms nach
der Offenlegung. Kein zweiter Defekt, dieselbe Wurzel.

### Fehlerklasse: P10 (Learning Tests fuer Drittanbieter-Code)

Der Shim nimmt an, jeder POST auf `/v1/chat/completions` sei eine neue Nutzer-Aeusserung.
Diese Annahme steht nirgends als Test, nirgends als fail-closed Pruefung. Sie ist falsch, und
sie war es von Anfang an. Gleiche Klasse wie der geratene Feldname `"CallControlId"` und die
297 wertlosen Kostenbelege.

## Drei Korrekturen an den Kickoff-Befunden

- **B-5 ist falsch.** `end_call` **hat** gefeuert: turnSeq 19, `toolNames: ["end_call"]`.
  Die Aussage "0 von 19" stammt aus einem aelteren Anruf.
- **N-3 ist kein Defekt, sondern ein Riegel.** `MAX_IN_CALL_CONSULTS_PER_CALL = 1`
  (`src/consult/in-call.js:43`). Nach c0 faellt `get_consult` aus `offeredToolNames`
  (ab turnSeq 4 belegt). Das Modell ruft es in turnSeq 17 **trotzdem** auf, bekommt
  `consultDeclined` — und sagt der Gegenstelle "Ich kann Antonio nicht erreichen".
  Der Riegel ist gewollt; dass seine Ablehnung als Ausrede beim Kunden landet, ist es nicht.
- **B-4 bestaetigt sich.** `look_up` in 19 von 19 Turns angeboten, **0 mal** gefeuert.

## Ein vierter Befund: die Rueckfrage-Antwort hat kein Ankunfts-Signal

`c0` war um **18:47:37.346** beantwortet (`answeredFacts: 1`), die Antwort stand ab da als
vierter Eintrag in `call.context.key_facts` und damit im HINTERGRUND-Block des Systemprompts.
Benutzt hat das Modell sie erst um **18:48:33** — 56 Sekunden spaeter.

Grund am Code: `consultTurnMarker` (`src/claude.js:793-795`) kennt genau zwei Zustaende,
`consultPending` und `consultTimeout`. **Fuer "die Antwort ist JETZT da" gibt es keinen
Marker.** Der Fakt erscheint stumm in einer Hintergrund-Liste, waehrend der sichtbare
Turn-Text eine alte, wiederholte Aeusserung ist und der Anstoss aus einer System-Nachricht
kommt, die der Shim gar nicht liest.

---

## Tagesstand 2026-08-05 — drei Phasen, alle live, alle am Telefon gemessen

Kein Workflow, keine Agenten. `psql`, Render-Logs, Anbieter-Doku, drei echte Testanrufe.

| Phase | Inhalt | Live | Wirkung |
|---|---|---|---|
| GQ-P5 | Provider-Anstoss-Riegel | `53a8d4d` | **gemessen wirksam** — 11/11 Anstoesse abgefangen, 0 gesprochene Saetze |
| GQ-P6 | Klingelfrist 30 -> 60 s | `69a8ee8` | ungemessen (braucht einen langsam zugestellten Anruf) |
| GQ-P7 | Zustellfenster der Rueckfrage-Antwort | `62d2e0a` | ungemessen (braucht Testanruf mit Rueckfrage) |

### GQ-P5 — Beweis und Nebenwirkung in einem Anruf

`call_msfqk80elik1`: elf Anstoesse, Abstaende **4047–4058 ms** — das ist
`user_idle_reply_secs: 4` auf die Millisekunde. Alle elf per `gate reason=provider_nudge`
abgefangen. Struktureller Gegenbeleg: `messagesCount` wuchs je Anstoss um **1** statt um 2
wie am Vortag — es wird keine Antwort mehr angehaengt.

**Die Nebenwirkung kostete den naechsten Anruf.** `call_msfwfmf7thof`: Antwort um 09:44:24
eingetroffen, danach sieben blockierte Anstoesse, Ende 09:44:52, `objective_achieved=false`.
Der Agent hatte die Auskunft 28 Sekunden im Prompt und keinen Turn, um sie auszusprechen.
GQ-P7 loest genau das. **Lehre: "im Prompt" und "ausgeliefert" sind zwei Zustaende.**

### GQ-P6 — die Klippe, statistisch belegt

Alle nie angenommenen Outbound-Anrufe, Gesamtdauer: **31,3 / 30,8 / 30,9 / 31,6 / 31,7 s**
(19.07. bis 05.08.). Fuenf unabhaengige Anrufe, kein Streuen — ein Timer bei 30 s.
Gegenprobe: die laengste Klingelzeit unter allen ANGENOMMENEN Anrufen ist **30,7 s**, kein
einziger darueber. Die Verteilung ist sauber abgeschnitten.

Wichtig fuer die Einordnung: **das ist ein seltener Randfall, keine Dauerbremse.** Von rund
45 Anrufen sind fuenf hineingelaufen (~11 %); der Rest klingelt nach 5–6 Sekunden. Deshalb
hat es "wochenlang funktioniert" — es hat funktioniert, meistens. Die Ursache der
schwankenden Zustellung (4,8 bis 30,7 s) bleibt die US-Absendernummer.

## Neue offene Befunde aus diesem Tag

1. **Wir loggen `hangup_cause` nicht.** Der Call-Control-Webhook loggt nur `event_type` und
   `status`. Deshalb musste die Timeout-Diagnose ueber Zeitstempel erschlossen werden, wo ein
   Feld sie direkt beantwortet haette. Gleiche Fehlerklasse wie der geratene Feldname.
2. **Fuenf stille Fehlanrufe ueber drei Wochen sind niemandem aufgefallen.** Ein Anruf, der
   nie ankommt, erzeugt bei uns keine sichtbare Spur.
3. **Der verlassene Anruf terminiert nicht.** Der Anstoss ist Lebenszeichen und setzt den
   Dead-Air-Timer zurueck; bei dauerhaftem Schweigen laeuft der Call bis `time_limit_secs`
   (30 min) oder bis zur Tenant-Kostendecke. Bestandsverhalten, in GQ-P7 bewusst NICHT
   mitgeaendert: Dead-Air waehrend einer laufenden Rueckfrage zu schaerfen wuerde mitten im
   Warten auflegen. Eigene Phase mit eigener Messung.
4. **`diagnostic` greift weiterhin nie** — die private Nummer ist immer noch leer (O-10).
   Am 05.08. erneut bestaetigt: das Rohtranskript von `call_msfwfmf7thof` war weg.

## Zwei Kickoff-Befunde sind widerlegt

- **B-5** ("`end_call` feuert nie"): feuerte in `call_msf0epenyv9g` turnSeq 19.
- **N-3** ("zweiter Consult kommt nicht zustande"): kein Defekt, sondern
  `MAX_IN_CALL_CONSULTS_PER_CALL = 1`. Das Modell ruft das entzogene Werkzeug trotzdem auf
  und die Ablehnung landet als Ausrede beim Kunden ("Ich kann Antonio nicht erreichen") —
  DAS ist der echte, noch offene Teil.

## Unveraendert offen

Fragilitaets-Analyse (Schritt -1, **nie angefangen**), N-2 (drei `take_message`-Eintraege),
B-4 (`look_up` feuert nie -> O-4 Modell-A/B), B-7 (STT-Kauderwelsch), GQ-P3-Rest
(Inbound-Handoff feuert vor `answered`), Owner-Hypothese "zu wenig Kontext".

## GQ-P8 bis P10 — die drei Blindheiten, gebaut am 2026-08-05

Alle drei Befunde haben DIESELBE Form: **der Zustand existierte, nur sah ihn niemand.**
Nicht eine fehlende Faehigkeit, sondern ein fehlendes Signal.

| Phase | Was das Modell nicht sah | Live-Beleg |
|---|---|---|
| GQ-P8 | dass die Rueckfrage-Antwort EINGETROFFEN ist | `call_msfx9pruzjvc`: sagte "ich frage mal und rufe spaeter an", Antwort lag seit 4 s im Prompt |
| GQ-P9 | dass die Gegenstelle nichts ueber den Auftraggeber wissen kann | zweimal: "Koennen Sie mir sagen, welches Modell es ist?" |
| GQ-P10 | was es in diesem Gespraech schon notiert hat | drei `take_message`-Eintraege fuer einen Sachverhalt |

**GQ-P8:** `advanceInCallConsult` suchte nur nach OFFENEN Rueckfragen. Nach dem Eintreffen
steht der Consult auf `answered` -> keine offene Rueckfrage -> `CONSULT_WAIT.NONE` ->
`consultTurnMarker` liefert `""` -> der Turn trug **gar keinen** Steuertext. Fuer "laeuft
noch" und "abgelaufen" gab es je einen Hinweis, fuer "die Antwort ist DA" keinen. Neu ist
der dritte Zustand `CONSULT_WAIT.ANSWERED`. Er teilt sich `deliveredAt` mit GQ-P7 statt
einen zweiten Einmal-Riegel zu fuehren.

**GQ-P9:** dagegen gab es bis dahin **keine einzige Regel** im Prompt. Neue Grenzen-Zeile,
unbedingt in jedem Turn — der Defekt trat auf, WAEHREND `get_consult` im Werkzeugsatz lag.
Ausdruecklich KEINE dritte Formulierungsrunde im Sinne von O-4: dort geht es um ein
angebotenes Werkzeug, das nicht gewaehlt wird. Hier fehlte die Regel schlicht.

**GQ-P10:** neuer Prompt-Block SCHON NOTIERT aus den Action Items des Calls. Eigener
Listeneintrag in `systemPrompt`, NICHT in `assignmentBlock` — der haengt an `call.goal` und
rendert nur outbound, waehrend Nachrichten gerade **inbound** entstehen.

**Alle drei ungemessen** — sie brauchen je einen Testanruf. Owner hat Testanrufe vorerst
gestoppt ("keine Testcalls mehr, bau").

### Was diese drei Phasen ueber das Repo sagen

Dreimal dieselbe Fehlerklasse an drei verschiedenen Stellen: ein Zustand wird korrekt
gefuehrt, aber nie an den Entscheidungspunkt getragen. Das ist ein Kandidat fuer die noch
offene Fragilitaets-Analyse — nicht "fehlende Features", sondern **fehlende Kanten zwischen
vorhandenem Zustand und der Stelle, die ihn braucht.**

---

## Tagesstand 2026-08-06 — Zustand geradegezogen, sieben Messungen, GQ-P11 live

Vollstaendig in `tasks/gq-strategie-2026-08-06.md` (Messungen M-1..M-7, Owner-Entscheidungen
O-A/O-B/O-C, Phasenplan) und `tasks/gq-fragilitaet-2026-08-06.md` (7 bestaetigte Befunde).
Hier nur, was der Kettenstand tragen muss.

### Drei Kickoff-Aussagen sind widerlegt

1. **"Ohne Rohtranskript ist nichts belegbar."** 222 Segmente liegen in der Prod-DB.
   **Kein Call hat Summary UND Segmente** (t/t = 0 von 58) — der Purge haengt an der
   Summary. Umkehrung: **ein sauber beendeter Anruf verliert sein Transkript, ein
   abgebrochener behaelt es.**
2. **"`diagnostic` — Ursache unbekannt."** Nicht kaputt, dreifach zugesperrt. Bedingung 1
   war, dass das CLIENT-Modell das Flag setzt — dieselbe Fehlerklasse (B-4), die
   diagnostiziert werden sollte. Der Vorgaenger hatte nur Bedingung 3 geprueft.
3. **"Die GQ-P9-Zeile ist die Herkunft des Persona-Defekts."** Der Satz "Ich frage Antonio,
   ob zehn Uhr passt" steht im Transkript vom **2026-08-01**; die Zeile entstand am
   2026-08-05 um 10:26 UTC. **Das Verhalten ist vier Tage aelter als seine angebliche
   Ursache.** GQ-P12 muss gegen das Verhalten gebaut werden, nicht gegen die Zeile.

### Zwei Belege, die der Kickoff fuer verloren hielt

`call_msfx9pruzjvc` hat sein Rohtranskript (10 Segmente). Damit ist **GQ-P7 als wirksam
belegt** (genau ein Fenster, genau ein Satz darin) und **GQ-P8 hat einen woertlichen
Vorher-Zustand**: der Agent hatte die Consult-Antwort seit 6 s im Prompt und kuendigte im
Zustellfenster einen Rueckruf an. GQ-P8 war zu dem Zeitpunkt nicht live (Deploy 10:35 UTC).

**Harte Grenze:** fuer **keinen** Anruf nach dem P8/P9/P10-Deploy existiert ein Transkript.
Die drei Phasen sind nachtraeglich nicht messbar — nur mit neuen Anrufen.

### GQ-P11 — gemergt und live

`b55aaf9` (Merge), Deploy `dep-d9pkme7lk1mc73eaes20`. Dualer Review PASS, 0 Fix-Runden,
3959/3959 gruen.

- `diagnosticRetentionGranted` ist **Opt-out** statt Opt-in: der Server markiert jeden Anruf
  an die eigene verifizierte Nummer selbst. Ziel-Gate (`to === ownNumber`) und Frist-Gate
  unveraendert — sie sind die Datenschutz-Grenze. Ablehnung prueft gegen `false` UND
  `"false"` (die Truthiness-Falle des Bestands, spiegelbildlich).
- Sechste Boot-Sonde `Diagnose-Transkripte:` — der Live-Wert war bis dahin nicht ablesbar.

**Offen und Owner-pflichtig:** `DIAGNOSTIC_RETENTION_DAYS` im Render-Dashboard auf >0 und
die Datenschutzerklaerung. Ohne beides greift die Phase nicht. Gegenprobe im Boot-Log:
die neue Sonden-Zeile nennt den Live-Wert.

### Fragilitaets-Analyse (nie begonnen -> erledigt)

Workflow `wf_b6f0223d-338`, 11 Agenten. **7 bestaetigt, 1 widerlegt.** Die Klasse zerfaellt
in zwei Formen: *Projektion enger als der Zustand* (F1/F2/F4 — echte Fixes) und *Wert ohne
jeden Leser* (F3/F5/F6/F7 — Loeschung, Sonde oder Messung, nie ein Fix).

**F4 erklaert einen offenen Kickoff-Befund:** `failureReason` ist bei jedem Fehlanruf
gespeichert (`state-ops.js:608-618`), die passive Nachricht baut aber nur auf `call.status`
(`call-finish.js:59-66`) — no-answer, besetzt, Fehler, Cap und Budget sind darin nicht
unterscheidbar. Das ist die Ursache fuer "fuenf stille Fehlanrufe sind niemandem
aufgefallen".

**F5 beruehrt die pro-Tenant-Kostendecke** und ist deshalb ausdruecklich eine Mess-, keine
Fix-Phase: `CallDuration` wird geparst und hat im gesamten `src/`-Baum **null Leser**;
abgerechnet wird aus der Serveruhr. Dass die Zahl deshalb falsch ist, ist **unbelegt**.

### Nebenbefund, gemessen und dadurch entschaerft

Du/Sie-Mischung im Agenten-Text: **1 von 12 Anrufen** (dort spiegelte er das Register der
Gegenstelle), 0 in den uebrigen 11. Kein systemischer Defekt, keine Phase.

### M-3 ist geschlossen: die Sonde hat live geantwortet

Drei Minuten nach dem GQ-P11-Deploy, Boot-Log 2026-08-05 14:40:42Z:

```
Diagnose-Transkripte: aus (DIAGNOSTIC_RETENTION_DAYS=0) - 0 = kein Rohtranskript ueberlebt
```

**Der Live-Wert ist 0.** Damit ist D-1 endgueltig aufgeklaert: von den drei Bedingungen in
`diagnosticRetentionGranted` fielen **zwei** durch (Modell-Opt-in UND Frist), nicht die
dritte, die der Vorgaenger als einzige geprueft hat. GQ-P11 hat die erste beseitigt; die
zweite ist ein Dashboard-Wert mit rechtlicher Vorbedingung und liegt beim Owner.

Nebenbei ist damit auch die Reichweite von "Live != render.yaml" praezisiert: fuer
`EVIDENCE_RETENTION_DAYS` weichen sie ab (live 7, Datei 0), fuer
`DIAGNOSTIC_RETENTION_DAYS` nicht (beide 0). **Die Datei ist also weder verlaesslich noch
durchgehend falsch — nur unbelegt.** Genau dafuer sind die Sonden da.

## GQ-M1 — F5 gemessen und gefallen (2026-08-06)

Die Fragilitaets-Analyse fand: `CallDuration` wird geparst
(`webhook-events.js:44-46`) und hat im gesamten `src/`-Baum **null Leser**; abgerechnet wird
`Math.ceil((endedAt - answeredAt)/60000)` aus der Serveruhr. Weil der Pfad in die
pro-Tenant-Kostendecke bucht, war das ausdruecklich eine **Mess-**, keine Fix-Phase.

Quelle: der `[voice/status]`-Log-Dump (`src/routes/voice.js:531`) traegt `diagnostics`
vollstaendig — der Wert ist also lesbar, obwohl ihn kein Code liest. Sieben Anrufe im
Log-Fenster:

| Call | Provider `callDurationS` | unsere Sekunden | Diff | abgerechnete Minute |
|---|---:|---:|---:|---|
| `call_msczw0irl06s` | 79 | 80 | +1 | 2 vs. 2 |
| `call_msegs822qyuo` | 29 | 29 | 0 | 1 vs. 1 |
| `call_msegtel31iqp` | 10 | 10 | 0 | 1 vs. 1 |
| `call_mseguri8r6gp` | 24 | 24 | 0 | 1 vs. 1 |
| `call_mseqcvoh8bcx` | 59 | 60 | +1 | 1 vs. 1 |
| `call_msf0q18o473z` | 7 | 7 | 0 | 1 vs. 1 |
| `call_msf0qch6nect` | 6 | 6 | 0 | 1 vs. 1 |

**Median 0, Maximum 1 s (Rundung an der Sekundengrenze), in KEINEM Fall aendert sich die
abgerechnete Minute.** Der Befund ist als Defekt erledigt.

**Zwei Einschraenkungen, damit die Messung nicht mehr behauptet, als sie zeigt:**

1. Alle sieben Anrufe sind **inbound**. Ein Outbound-Beleg liegt im Log-Fenster nicht vor.
2. Die urspruengliche Hypothese ("die Zustellverzoegerung wirkt sich auf die gebuchte
   Minute aus") ist aber **strukturell unmoeglich**: wir rechnen ab `answeredAt`, Klingelzeit
   kann in unsere Zahl gar nicht einfliessen. Sie koennte nur in die Zahl des **Providers**
   einfliessen — und das ist eine Frage der Kostendeckung (zahlen wir mehr an Telnyx, als wir
   dem Tenant anrechnen), nicht eine Frage der Kostendecken-Ueberziehung. Diese Richtung
   deckt die bestehende Ist-Kosten-Kette (`actual_cost_micro_cents`, `cost_trued_at`) ab,
   nicht dieser Befund.

Der Rest von F5 bleibt wahr und harmlos: `callDurationS` ist ein geparster Wert ohne Leser.
Er im Code zu lesen brachte nach dieser Messung **nichts** — die richtige Konsequenz ist
also, ihn zu lassen, wo er ist (Diagnose-Feld im Log), und den Befund zu schliessen.

---

## Testanruf `call_msgf3r21x0w0`, 2026-08-05 18:25 UTC — die erste auswertbare Messung

Stand `4ccec82` (P11/P13/P15/P16 live). Owner spielte die Werkstatt. Owner-Urteil:
*"Absolute Katastrophe... mit Abstand das Schlimmste, was ich bisher erlebt habe."*

### GQ-P11 ist LIVE BEWIESEN

`diagnostic = true` — **ohne dass der Aufrufer das Flag gesetzt hat.** Der Server hat selbst
entschieden. Und zum ersten Mal ueberhaupt traegt ein Call **Summary UND Segmente**
(16 Stueck). Vorher: 0 von 58. Das ist exakt die Zahl, die die Spec vorher benannt hatte.

### Der Supersede-Riegel ist in der Praxis WIRKUNGSLOS

Die entscheidende Log-Zeile, zweimal:

```
turn_probe turnSeq 8  gapMs 2691  prevRelation "extends"
supersede  turnSeq 8  superseded:false  refusal:"no_inflight"
turn_probe turnSeq 9  gapMs 2077  prevRelation "extends"
supersede  turnSeq 9  superseded:false  refusal:"no_inflight"
```

`no_inflight` = **es gab nichts mehr zu verdraengen.** Modell-Latenz 1107/1325/1972 ms,
Fortsetzung des Anrufers nach 2077/2691 ms. Der Riegel kommt **strukturell** zu spaet.
Folge im Transkript: **drei Agenten-Antworten in fuenf Sekunden** (18:26:51/:53/:55) auf
eine einzige, wachsende Aeusserung.

**Korrektur an der Diagnose von heute Vormittag:** dort stand "der Riegel feuert korrekt,
der Code ist an dieser Stelle richtig". Das war aus `messagesCount` geschlossen (die Nachricht
wird nicht doppelt angehaengt) — stimmt, aber der Turn laeuft trotzdem und spricht. Der
Riegel verhindert die doppelte NACHRICHT, nicht die doppelte ANTWORT.

### B-4, zum vierten Mal: `get_consult` 0 von 4

`offeredToolNames` enthielt in **jedem** Turn (7, 8, 9, 10) `get_consult` und `look_up`.
`toolNames` war **jedes Mal leer** — waehrend der Agent die Gegenstelle wiederholt nach
Informationen ueber den Auftraggeber fragte. Genau der Fall, fuer den das Werkzeug existiert.

### GQ-P9 ist wirkungslos — die Phase von gestern hat ihr Ziel verfehlt

Fuenf Verstoesse gegen genau die Regel, die P9 eingefuehrt hat:
*"Welches Fahrzeugmodell hat Antonios Auto denn?"*, *"kann ich ihn kurz sprechen?"*,
*"Ist er erreichbar?"*, *"Kann ich Antonio kurz ans Telefon bekommen?"*, *"Kann ich ihn
erreichen?"* — bestaetigt M-4: **eine Prompt-Zeile steuert dieses Verhalten nicht.**

### Neuer Befund: Identitaets-Kollaps

Der Agent hielt die Gegenstelle fuer den Auftraggeber: *"Hallo Antonio, ich bin Hermes, dein
persoenlicher Assistent"* — an die Werkstatt. Danach *"Jetzt bin ich am Telefon mit dir,
Antonio."* Erst nach *"Ich bin die Werkstatt"* korrigiert. In keinem Befundkatalog bisher.

### Eroeffnung: 13,6 s Monolog, danach 6 s Stille

`speak.started` 18:25:51,5 -> `speak.ended status=completed` 18:26:05,1. Der Provider meldet
die Eroeffnung als **vollstaendig gesprochen**. Der Owner berichtet dennoch, die Offenlegung
sei nicht zu 100 % gekommen. Aus dem Log ist die Zustellung NICHT belegbar; es existiert eine
Telnyx-Aufnahme (`call.recording.saved`). **Unabhaengig davon ist ein 13,6-Sekunden-Monolog
vor dem ersten Wort der Gegenstelle fuer sich ein Defekt.**

Erste Anrufer-Aeusserung 18:26:12: *"Ja, Du hast aufgehoert zu reden. Was ist denn?"*

### Fehler des Leads in diesem Anruf

Auf die Eroeffnungs-Rueckfrage nach der Rueckrufnummer antwortete der Lead *"Antonio meldet
sich selbst."* Das ging als Fakt in den Kontext (`answeredFacts: 3`) und hat die
"Kann ich Antonio sprechen?"-Schleife mit hoher Wahrscheinlichkeit gefuettert. **Eine
Consult-Antwort ist Prompt-Inhalt, kein Formular** — sie muss so formuliert sein, wie der
Agent sie der Gegenstelle gegenueber verwenden koennte.

### D-2 live bestaetigt

`await_call_event` lieferte `event:"done"` mit
*"(Noch keine Zusammenfassung verfuegbar)"* — die Zusammenfassung wurde danach geschrieben und
erreichte den Client nie. Genau der Befund D-2, bisher "Ursache unbekannt".

### Was daraus fuer die Reihenfolge folgt

1. **Das Haken** — der Riegel muss VOR dem Sprechen greifen. Code plus `eot_threshold`.
   Vorher-Zahl steht: 3 Antworten in 5 s, 2x `refusal:"no_inflight"`.
2. **O-4 (Haiku -> Sonnet)** — Vorher-Zahl steht: `get_consult` 0 von 4 bei 4/4 angeboten.
3. **Persona/Identitaet** — nicht ueber eine weitere Prompt-Zeile (P9 ist der Gegenbeweis).
4. Eroeffnungs-Laenge und D-2.

---

## GQ-H1: die Praemisse des Hakens traegt nicht (2026-08-06, am Log belegt)

**Der Anrufer hat nie drei Antworten gehoert.** Telnyx verwirft die ueberzaehligen Turns,
bevor sie gesprochen werden. Die "drei Antworten in fuenf Sekunden" stammen aus **unserem**
`transcript_segment` — wir schreiben jeden Shim-Turn mit, auch die nie gesprochenen.

### Beleg, zweifach und unabhaengig

1. **Telnyx' Gespraechsprotokoll** (`GET /v2/ai/conversations/59553cc6-7e81-4f49-8ca9-815ff5ab2b1f/messages`):
   **12 Nachrichten, davon 5 vom Assistenten** — bei 8 substanziellen Turns auf unserer Seite.
2. **Unser eigenes Render-Log** (`turn_probe`, derselbe Anruf): `messagesCount` waechst genau
   dort NICHT, wo eine Antwort fehlt.

| turnSeq | chars | prevRelation | messagesCount | Antwort |
|---|---|---|---|---|
| 4 | 25 | other | 6 | **verworfen** |
| 5 | 51 | extends | 6 | behalten |
| 6 | 23 | other | 8 | behalten |
| 7 | 33 | other | 10 | **verworfen** |
| 8 | 68 | extends | 10 | **verworfen** |
| 9 | 106 | extends | 10 | behalten |
| 10 | 42 | other | 12 | — |

Die Zeichenzahlen passen lueckenlos: turn 4 = 25 Zeichen *"Was wuerde ich das wissen?"*,
turn 5 = 51 Zeichen derselbe Satz zu Ende gesprochen.

### Widerlegt

- **"Eager-EOT ist aus, weil `eot_threshold == eager_eot_threshold`."** Telnyx' Doku behauptet
  das; live stehen beide auf 0.9 **und Eager feuert trotzdem**. Anbieter-Aussage und
  Anbieter-Verhalten widersprechen sich.
- **`eot_threshold` hat keinen Spielraum** — Deepgram-Bereich 0.5-0.9, live steht das Maximum.
- **Eine Haltefrist im Code (P1b) waere der falsche Hebel** — sie tauschte Latenz gegen ein
  Doppelsprechen, das es nicht gibt.
- **`eager_eot_threshold` laesst sich per API nicht loeschen:** `PATCH` mit `null` liefert 200,
  legt eine neue Version an, aendert den Wert nicht (Telnyx merged tief). Weg bleibt das
  Mission-Control-Portal oder der Support. Snapshot:
  `data/evidence/telnyx-config/assistant-snapshot-2026-08-06-gq-h1.json`.

### Was der Owner wirklich gehoert hat — und warum das P3 ist, nicht P1

Alle fuenf tatsaechlich gespielten Antworten:

| # | Wortlaut |
|---|---|
| 1 | „Welches Fahrzeugmodell hat **Antonios** Auto denn?" |
| 2 | „Ich habe das Fahrzeugmodell leider nicht, aber **Antonio kann mir das gleich sagen**, wenn ich ihn spreche. Ist er erreichbar?" |
| 3 | „Gerne — kann ich **Antonio kurz ans Telefon** bekommen?" |
| 4 | „Jetzt bin ich am Telefon mit dir, **Antonio**." (zur Werkstatt gesagt) |
| 5 | „Ah, entschuldige — dann bin ich ja wieder bei dir in der Werkstatt. … **Kann ich ihn erreichen?**" |

**5 von 5 verstossen gegen die bindende Owner-Vorgabe** (Auftraggeber als Auskunftsquelle,
Gegenstelle ueber ihn ausfragen); Nr. 4 ist der Identitaets-Kollaps. Kein Doppelsprechen dabei.
Das Owner-Urteil *"absolute Katastrophe"* ist vollstaendig durch **P3** erklaert.

### Folge fuer die Reihenfolge

Der Kickoff wollte P2 zurueckstellen, *"solange der Agent dreimal auf einen Satz antwortet"*.
Er tut es nicht — **P2 ist ab sofort messbar**. Owner-Entscheidung 2026-08-06:
**H1-a -> P2 -> P3**.

### GQ-H1-a: umgesetzt (9fb40bb), noch NICHT deployt

Verworfene Antworten werden aus dem Transkript genommen, sobald Telnyx' gespiegelte
Nachrichtenliste beim naechsten Request nicht gewachsen ist. Ausgenommen `prevRelation "same"`
(doppelte Zustellung — dort ist die Antwort gesprochen). Mitgefixt: `flushTranscript`
(`store/pg.js`) hing index-basiert an und haette bei einem schrumpfenden Transkript still
jedes weitere Segment des Calls verloren; der Abgleich laeuft jetzt ueber den Inhalt.

Neues Messinstrument im Log: `discarded_answer` (PII-frei, `callId` + `turnSeq`). Im
Testanruf waeren es **3 von 8 substanziellen Turns** gewesen.

**Offen:** Deploy + ein Testanruf zur Bestaetigung; `discarded_answer` je Anruf auszaehlen.

### GQ-H1-a live abgenommen (2026-08-06, `14073ff`)

Deploy per `/healthz` gemessen, nicht aus einer Notiz. Zwei Testanrufe an die Owner-Nummer.

**Anruf 1 (`call_mshb9v7btbsp`, 183 s)** — die Erkennung lief (viermal
`providerMessagesGrew:false`, turnSeq 4/5/7/13), aber **keine einzige `discarded_answer`-Zeile**.
Ursache: beide Backend-Wrapper folgten dem fire-and-forget-Muster von `addTranscript` und
lieferten `undefined`; der Shim verzweigt auf den Rueckgabewert. Die Entfernung passierte,
das Messinstrument blieb blind. Die Repro-Tests haben es nicht gefangen, weil ihr `fakeStore`
ein Boolean liefert — **der Fake konnte mehr als der echte Store**. Gefixt in `14073ff`,
abgesichert an BEIDEN echten Backends plus Paritaets-Test (alle vier ohne den Fix rot).

**Anruf 2 (`call_mshbrhnc7nfp`)** — lueckenlose Zuordnung, keine Fehlalarme:

| turnSeq | prevRelation | messagesCount | providerMessagesGrew | Aktion |
|---|---|---|---|---|
| 1 | first | 2 | `null` | nichts (nicht entscheidbar) |
| 2 | extends | 2 (unveraendert) | `false` | **discarded_answer** |
| 3 | other | 4 (gewachsen) | `true` | nichts |
| 4 | extends | 4 (unveraendert) | `false` | **discarded_answer** |

Kein Drop dort, wo die Liste gewachsen ist. Kein Drop beim ersten Request.

**Latenz:** die Entfernung ist ein `pop()` auf einem Array im Speicher plus ein ohnehin
faelliges `save()` — sie liegt nicht im Sprechpfad. Die `shim_turn`-Werte streuen zwischen
den Anrufen (Anruf 1: 1008-2101 ms ohne Werkzeug; Anruf 2: 2589-2900 ms, dazu ein Ausreisser
5297 ms mit `attempts:2`, also einem LLM-Retry). **Bei n=2 Anrufen ist daraus keine
Latenz-Aussage abzuleiten** — belegt ist nur, dass der Fix keinen Wartepunkt einfuegt.

**Offen aus diesen Anrufen (nicht H1-a):**
- **B-7 STT-Kauderwelsch, deutlich verschaerft**: *"Es geht dich in Schwesterkanne"*,
  *"Weiss ich jetzt an Nile? What the fuck?"* — in Anruf 2 hat der Agent aus dem Kauderwelsch
  einen Namen erfunden (*"Anil Jones"*) und die Gegenstelle danach so angesprochen.
- **Du/Sie-Mischung** in Anruf 2 (der Agent wechselte auf "Sie", der Owner blieb bei "du").
- `supersede refusal:"no_inflight"` erscheint weiter — der Riegel aus GQ-P1 laeuft wie
  erwartet ins Leere und ist durch H1-a fachlich abgeloest.

---

## Die zwei offenen Punkte nach B-7 — Owner-Vorgaben, dauerhaft hier statt im Kickoff

Diese Abschnitte lagen bisher nur im verbrauchten Kickoff. Sie sind **bindend** und gehoeren
in den Kettenstand, damit kein Verweis ins Leere zeigt.

### P2 — Modellwechsel Haiku -> Sonnet (Owner-Entscheidung O-4, bindend)

Vorher-Zahl steht (s. Abschnitt "B-4, zum vierten Mal"): `get_consult` **0 von 4** bei 4/4
angeboten; frueher `look_up` 0/19, `get_consult` 0/4 (`call_msg0swwfhe5e`).

**O-4 ist bindend: dagegen hilft der Modellwechsel als A/B-Lauf mit Messung, NICHT die
naechste Prompt-Runde.** Prompt-Runden wurden dreimal versucht (AL-P14, AL-D3, GQ-P9) und
haben nie gewirkt.

### P3 — Persona und Identitaet

**GQ-P9 ist wirkungslos, am Log belegt.** Die Phase vom 2026-08-05 fuehrte die Regel ein, die
Gegenstelle nicht ueber den Auftraggeber auszufragen. Im Testanruf danach: fuenf Verstoesse.
Zweiter Beleg gegen die Prompt-These: das Verhalten ist **aelter als die Regel**
(`call_msabz9975sph`, 2026-08-01; die Regel entstand am 2026-08-05 10:26 UTC).

**Owner-Vorgabe (bindend), gilt in de/en/fr, sinngemaess uebersetzt:**

| Situation | Was Hermes sagt |
|---|---|
| Er weiss etwas nicht und klaert es jetzt | „Warten Sie kurz, ich schaue einmal nach." |
| Er findet es nicht | „Tut mir leid, ich kann die Information momentan nicht finden." |
| Er kann es erst spaeter klaeren | „Das klaere ich und melde mich bei Ihnen zurueck." |

**Verboten:** „auf meiner Seite", „bei meinem Auftraggeber", jede Nennung des Auftraggebers
als Auskunftsquelle gegenueber der Gegenstelle.

**Nicht als vierte Prompt-Runde bauen.** Hier ist ein Judge-Panel angebracht: mehrere
unabhaengige Mechanismus-Ansaetze (z. B. Werkzeug-Zwang statt Formulierung, Rollenbindung im
Turn-Kontext, Nachbearbeitung der Antwort), parallel bewertet, bester umgesetzt.

### Was ausserdem offen bleibt

| ID | Befund | Beleg |
|---|---|---|
| **Eroeffnung** | 13,6 s Monolog vor dem ersten Wort der Gegenstelle, danach 6 s Stille | Log |
| **Offenlegung** | Owner berichtet, sie sei nicht zu 100 % gekommen; Provider meldet den Speak als vollstaendig. Aus dem Log NICHT entscheidbar — es existiert eine Aufnahme. **Absolute Regel 2 hat Vorrang, sobald es einen Beleg gibt** | unbelegt |
| **D-2** | `await_call_event` liefert `done` mit "(Noch keine Zusammenfassung verfuegbar)"; die Summary entsteht danach und erreicht den Client nie | live bestaetigt, zuletzt `call_mshbrhnc7nfp` |
| F6 | `DASHBOARD_PASSWORD` ohne Konsument, blockiert aber weiter den Boot (`config.js:966`, `:1610-1614`) | am Code belegt |
| F7 | `WORLD_DEFAULT_LANGUAGE_ENABLED` ohne Boot-Sonde — trifft die Sprache der Offenlegung | am Code belegt |
| F3 | `turnText.gapMs` wird berechnet, aber von keiner Entscheidung gelesen | am Code belegt |

---

## B-7: das Kauderwelsch, gemessen statt gehoert (2026-08-06)

**Die Wurzel ist das STT-Modell `deepgram/flux`. Das Audio ist einwandfrei.**

### Wie das messbar wurde

Die Telnyx-Aufnahme ist **Dual-Channel**: die Gegenstelle liegt auf einem eigenen Kanal.
Damit laesst sich das bisher Ungreifbare zu einer Zahl machen:

1. Aufnahme holen (`GET /v2/recordings`, Zuordnung ueber `call_session_id`),
2. Kanal der Gegenstelle mit `ffmpeg` isolieren,
3. von einem **zweiten, unabhaengigen** Erkenner abschreiben lassen (Referenz),
4. Wortfehlerrate gegen das rechnen, was Telnyx' Erkenner verstanden hat
   (`GET /v2/ai/conversations/<uuid>/messages`, Rolle `user`).

Der **Agentenkanal** liefert die Kontrolle: dort kennen wir die Wahrheit (der Agententext
steht im Protokoll). Die Referenz holt daraus 94-96 % der Woerter zurueck — aus demselben
8-kHz-MP3. Ohne diese Kontrolle waere die Hauptzahl nicht interpretierbar.

Werkzeug: `scripts/stt-wer.mjs <call_session_id|recording_id>`. Belege und Turn-fuer-Turn-
Gegenueberstellung: `data/evidence/stt-wer-2026-08-06/befund.md` (gitignored, lokal).

### Die Zahlen (alle auf denselben zwei echten Anrufen)

| Erkenner | `call_mshb9v7btbsp` | `call_mshbrhnc7nfp` |
|---|---|---|
| **live im Einsatz: `deepgram/flux` + `de`** | 21,8 % | **45,7 %** |
| `deepgram/flux` + `de`, direkt gemessen | **97,0 %** | **95,7 %** |
| `deepgram/nova-2` + `de` | 24,1 % | 24,3 % |
| **`deepgram/nova-3` + `de`** | **18,8 %** | **12,9 %** |
| Referenz gegen bekannten Agententext (Messgenauigkeit) | 4,3 % | 5,7 % |

`deepgram/flux` erkennt deutsches Telefon-Audio als **Englisch** (*"Yeah. Zippon. this one,
we can't see good thing."*) und **ignoriert den Sprach-Hint**: `language=de` und
`language=multi` liefern byte-identische Ausgabe. Die Telnyx-Doku behauptet ausdruecklich
Deutsch-Unterstuetzung seit 2026-04-29. Anbieter-Aussage und Anbieter-Verhalten
widersprechen sich — zum zweiten Mal in dieser Kette bei genau diesem Modell.

### Wie die Replay-Bank funktioniert (und die Falle darin)

Telnyx hat neben den AI Assistants eine **eigenstaendige** Streaming-STT:
`wss://api.telnyx.com/v2/speech-to-text/transcription?transcription_engine=…&model=…&language=…&input_format=wav&sample_rate=…`,
Bearer-Auth. Aufgezeichnetes Audio im Echtzeit-Takt hineinschicken, `is_final`-Transkripte
sammeln — damit sind Kandidaten vergleichbar, **ohne** einen Menschen anrufen zu lassen.

**Die Falle, fast hineingelaufen:** der Parameter heisst `model`, nicht `transcription_model`.
Mit dem falschen Namen liefern flux, nova-2 und nova-3 **byte-identische** Ergebnisse — der
Parameter wird still ignoriert und alles laeuft auf demselben Default. Der erste Bank-Lauf
sah dadurch so aus, als seien alle drei Modelle gleich gut (12,9 %). Aufgefallen ist es nur,
weil drei angeblich verschiedene Modelle exakt dieselbe Zeichenkette lieferten —
**Fingerabdruck je Ergebnis mitloggen, sonst ist ein ignorierter Parameter unsichtbar.**

### Widerlegt (nicht nochmal untersuchen)

- **Audio-Weg (H1)** — die Referenz holt aus dem staerker komprimierten 8-kHz-MP3 sauberes
  Deutsch. Der Kanal traegt die Information.
- **Barge-in/Ueberlappung** — Aeusserungen, die WAEHREND der Agent spricht beginnen: 31 %
  mittlere WER; Aeusserungen in Stille: 33 %. Kein Effekt.
- **Echo/Mithoeren des Agenten** — beide Kanaele gemischt durch dieselbe Engine ergibt
  saubere Transkripte BEIDER Sprecher, keinen Salat.
- **Aeusserungslaenge** — <=6 Woerter: 33 %, laenger: 32 %.
- **Sprachmischung kippt das Modell** — widerlegt als Erklaerung: *"What the fuck"* wurde
  korrekt erkannt, der Salat steht rundherum.
- **Fehler konzentriert am Anfang der Aeusserung** — nur teilweise: erste drei Woerter 39 %
  Fehler (14/36), Rest 24 % (37/155). Erhoeht, aber nicht die Erklaerung.
- **"Der erfundene Name kam aus einer zerschnittenen Aeusserung"** — falsch. Zwischen
  *"Du bist"* und *"ein Idiot"* liegen **2,0 s echte Pause** (Wort-Zeitmarken der Referenz).
  Die Turn-Trennung war korrekt; *"ein Idiot"* -> *"Anil Jones"* ist ein reiner
  Erkennungsfehler. Fragmentierung (a) und Wortsalat (b) bleiben getrennte Befunde.

### Umgesetzt

`STT_MODEL` in `src/telephony/adapters/telnyx/voice.js` von `deepgram/flux` auf
`deepgram/nova-3`. **Das Modell wird pro Call mitgesendet** (`transcriptionFields`, Zeile
~338) — eine Aenderung nur am Assistant-Objekt haette der naechste Anruf ueberschrieben.
Das Assistant-Objekt ist zusaetzlich gepatcht (Fallback, wenn die Sprache nicht aufloesbar
ist und kein `transcription`-Block mitgeht).

Snapshots: `data/evidence/telnyx-config/assistant-snapshot-2026-08-06-vor-nova3.json` und
`-nach-nova3.json`.

**Bewusst bezahlter Preis:** `eot_threshold`, `eager_eot_threshold` und `eot_timeout_ms` sind
laut Telnyx-Doku **flux-only**. Mit nova-3 bestimmt Telnyx die Turn-Grenzen selbst; das
Gespraechs-Timing kann sich spuerbar aendern und gehoert in die Abnahme des Testanrufs.
Nebenwirkung: `eager_eot_threshold` steht seit dem Wechsel auf `null` — das Feld, das sich
laut GQ-H1 per API "nicht loeschen" liess, ist mit dem Modellwechsel verschwunden.

### B-7 live abgenommen (2026-08-06, `b073e8d`)

Deploy per `/healthz` gemessen, danach zwei ausgehende Testanrufe an die Owner-Nummer.

| Messung | WER |
|---|---|
| vorher, `flux`, `call_mshb9v7btbsp` | 21,8 % |
| vorher, `flux`, `call_mshbrhnc7nfp` | 45,7 % |
| **nachher, `nova-3`, `call_mshgg6ijtyul`** | **8,9 %** (157 Referenzwoerter) |
| Kontrolle auf demselben Anruf | 9,3 % |

Die Erkennung liegt auf dem Niveau der Messgenauigkeit — **diese Methode kann keinen weiteren
Gewinn mehr aufloesen.** Wer B-7 weiter optimieren will, braucht erst eine genauere Referenz
(z. B. eine von Hand erstellte Abschrift). Qualitativ eindeutig: *"Ich möchte, dass du jetzt
mal recherchierst, was der aktuelle Kader von Portugal ist"* kam wortgenau an.

**Einschraenkung:** Vorher eingehend, nachher ausgehend — nicht perfekt vergleichbar. Der
Abstand ist um ein Vielfaches groesser als jeder plausible Richtungseffekt.

**Der erste Testanruf (`call_mshgd8jt83di`) ist KEIN Beleg** — Mailbox, 2 Referenzwoerter
(*"Ja, hallo?"*), kein einziger Agenten-Turn. Er steht hier, damit niemand ihn spaeter als
Fehlschlag der Umstellung liest.

**Gespraechs-Timing:** im 169-s-Anruf keine Beschwerde ueber Unterbrechungen oder Wartezeiten,
aber das ist eine Beobachtung an EINEM Anruf, keine Messung. Der Wegfall der flux-Turn-Regler
bleibt zu beobachten.

**Zwei Befunde aus dem Testanruf, die NICHT B-7 sind:**

- **`look_up` feuert weiterhin nicht** (B-4/AL-D3). Der Agent bestritt erst, Internetzugriff
  zu haben, raeumte die Funktion dann ein und benutzte sie trotzdem nicht. Das war das
  eigentliche Aergernis des Owners in diesem Anruf. Naechster Punkt ist O-4 (Haiku -> Sonnet).
- **Erkannter Text kommt jetzt ohne Satzzeichen und kleingeschrieben.** Unser Pro-Call-Block
  ueberschreibt die GANZE `transcription`-Konfiguration und setzt `smart_format`/`numerals`
  nicht mit — die gelten fuer nova-3 (nicht fuer flux) und stehen am Assistant-Objekt auf
  `true`. Fuer die WER irrelevant, fuer das Sprachmodell moeglicherweise nicht.

---

## GQ-H2 — Die Wurzel des Kappens war Telnyx' Barge-in-Schwelle (2026-08-09, GEFIXT)

Owner-Urteil vor dem Fix: *"jeder dritte bis vierte Satz war komplett abgehakt und es war mir
nicht moeglich, mit dem KI-Agenten ein Gespraech zu fuehren."*

### Was widerlegt wurde

**Eager-EOT ist NICHT (mehr) die Wurzel.** Der Kettenstand vom 08-06 fuehrte
`eager_eot_threshold` als Ursache und notierte, es lasse sich per API nicht loeschen. Am
Live-Assistant gemessen (`GET /v2/ai/assistants/...`, HTTP 200): der Wert steht auf `null`,
ist also geloescht — und der Defekt war am 08-09 trotzdem **staerker** als am 08-06
(5 von 8 `extends`-Turns gegen 4 von 13). Eine Wurzel, die entfernt ist, kann nicht die
Wurzel sein.

Ebenso widerlegt: die Behauptung des Agenten IM Gespraech, es liege an "der Audio-Pipeline".
Der Agent hat das erfunden; unsere Pipeline lieferte den vollen Text.

### Die Wurzel, dreifach belegt

Live-Config des Assistants trug ein **im API-Schema undokumentiertes** Feld:

```
interruption_settings: { enable: true, interrupt_prediction_threshold: 0.2 }
telephony_settings:    { noise_suppression: "disabled" }
```

Telnyx' Release-Notes (Primaerquelle) zu `interrupt_prediction_threshold`: *"Range 0.0 to
1.0, default 0.0 (off), 0.4 is a good starting point"* und *"adjust up for stricter gating or
down for more permissive barge-in"*. **0.2 ist also eingeschaltet und halb so streng wie der
empfohlene Startwert** — kombiniert mit abgeschalteter Rauschunterdrueckung.

**Beleg 1 — Telnyx' eigenes Gespraechsprotokoll** (`/v2/ai/conversations/<id>/messages`; das
Textfeld heisst `text`, NICHT `content`). Zeichenzahl gegen `sent_at`/`ended_at` gerechnet:

| Zeichen | Sprechdauer | Zeichen/s | `audio_first_token_ms` | Ergebnis |
|---|---|---|---|---|
| 245 | 13,9 s | 17,6 | 127 | vollstaendig |
| **78** | **3,9 s** | 20,1 | **2558** | **gekappt, endet auf "...die ich sehe, laeuft"** |
| 234 | 13,2 s | 17,7 | 322 | vollstaendig |

Die gekappte Antwort ist die mit der langsamsten Sprachausgabe (2558 ms bis zum ersten Ton
statt 127-322 ms) — es war der Turn mit `look_up`. **Je laenger bis zum ersten Ton, desto
groesser das Fenster, in dem ein Geraeusch die Ausgabe kippt.**

**Beleg 2 — unser Store gegen Telnyx' Store.** Hermes hatte den vollstaendigen Satz erzeugt
(~290 Zeichen, im MCP-Transkript nachlesbar). Telnyx sprach 78 davon. Die Differenz beweist:
der Verlust passiert NACH unserer Auslieferung.

**Beleg 3 — Vorher/Nachher an zwei echten Anrufen.**

| Signal | `call_mslm38yfw5xb` (vor Fix) | `call_mslml7vvy1oe` (nach Fix) |
|---|---|---|
| Turns | 8 | 3 |
| `discarded_answer` | 2 | **0** |
| `superseded: true` | 1 | **0** |
| `[turn] abbruch grund=superseded` | 1 | **0** |
| gekappte Antwort | 1 von 3 | **0 von 2** |
| laengste Antwort am Stueck | 245 Zeichen | **680 Zeichen / 39,4 s** |

### Der Eingriff (Live-Config, kein Code, kein Deploy)

`PATCH /v2/ai/assistants/<id>` mit **nur** den zwei Teilobjekten (Telnyx merged tief):

```
interruption_settings.interrupt_prediction_threshold: 0.2 -> 0.4
telephony_settings.noise_suppression: "disabled" -> "deepfilternet"
```

Danach per GET verifiziert — **nicht der 200 vertraut**, denn genau die hatte beim
`eager_eot_threshold` getaeuscht. Gegengeprueft, dass Stimme, STT-Modell, TeXML-App,
`user_idle_reply_secs` und `eot_threshold` unveraendert blieben.
Neue `version_id`: `20260809T095319385426`.

**Engine-Wahl begruendet:** Enum ist `krisp` / `deepfilternet` / `disabled`. `deepfilternet`
ist quelloffen und ohne belegbare Zusatzkosten; Krisps Preis bei Telnyx ist unbelegt. In
einem Repo mit Kosten-Gates gewinnt die belegbar kostenfreie Variante.

Snapshots: `data/evidence/telnyx-config/assistant-snapshot-2026-08-09-{vor,nach}-bargein-fix.json`
(gitignored, lokal).

### Was BLEIBT — die Doppelantwort

Ein `extends`-Fall ueberlebt den Fix: Telnyx lieferte die Nutzer-Aeusserung in zwei Haeppchen
(61 -> 100 Zeichen, 2,5 s Abstand, `providerMessagesGrew:false`), und Hermes hat **auf beide
geantwortet** — mit je einer eigenen `look_up`-Recherche. Folge fuer den Owner hoerbar: zwei
Wetterberichte mit **widersprechenden Zahlen** (16-21 Grad und 30-33 Grad). Das ist keine
Halluzination, das sind zwei unabhaengige Abfragen.

GQ-P1 (Verdraengungs-Riegel) bleibt damit wirkungslos, aber aus einem ANDEREN Grund als
notiert: der Riegel meldet jetzt `already_spoken` statt `no_inflight` — die erste Antwort lief
bereits. Naechste Kandidaten (unbelegt, erst messen): Deepgrams `min_turn_silence`/
`max_turn_silence` (beide `null`), `eot_timeout_ms` (5000), `user_idle_reply_secs` (4).

### Zwei Korrekturen am Bestand dieses Dokuments

1. **`look_up` feuert.** Der letzte Abschnitt oben behauptet das Gegenteil. Am 08-09 in beiden
   Anrufen belegt: `[lookup] fertig ok=true dauer_ms=1233 fakten=3` (mehrfach), und der Owner
   hat die Recherche-Antwort inhaltlich bestaetigt. **B-4/AL-D3 ist an diesem Punkt erledigt** —
   ohne dass der dafuer vorgesehene Modellwechsel O-4 stattgefunden haette.
2. **Der Offenlegungs-Abbruch ist KEIN Defekt.** Owner hoerte den Erst-Turn auf *"...ohne"*
   enden. Ursache: `OPENING_GOAL_MAX_CHARS = 75` (`claude.js:350`) kappt das Anliegen an der
   Wortgrenze; das per MCP geschickte `objective` war 87 Zeichen lang, verloren ging
   *"Abbrueche durchlaeuft"*. Gegenprobe: 129 (Offenlegung) + 22 (Bruecke) + 66 = 217 Zeichen
   bei gemessenen 12,0 s = 18,1 Zeichen/s, im AL-P1-Band 17,3-20,3. **Offener Produktbefund:**
   die Kappe schneidet hart mitten im Satz, statt sauber abzuschliessen — fuer den Angerufenen
   klingt jeder etwas laengere Auftrag nach Verbindungsabbruch. Der Code nennt den Hebel
   selbst (*"Klingt der Erst-Turn live trotzdem unvollstaendig, wird DIESE Zahl angehoben"*),
   die Abwaegung gegen das Auflege-Fenster ist eine Owner-Entscheidung.

---

## GQ-P18 — Sprechsperre statt Wartezeit. **GEMERGT** (`4d4a18c`), Live-Abnahme offen

Ersetzt GQ-P17 vollstaendig (`src/telnyx-turn-hold.js` ist geloescht). Die abgelehnte
Latenz kam daher, dass die Haltefrist **vor** dem Turn lag und sich auf jede Antwort
addierte. Jetzt laeuft der Turn sofort los und nur das **Sprechen** wird zurueckgehalten —
solange nichts auf der Leitung war, kann der Riegel GQ-P1 den Turn stumm ueberholen.

**Zuerst wurden die drei Kickoff-Ansaetze an Live-Daten gemessen und ALLE DREI verworfen**
(11 `extends`-Ereignisse aus 4 Anrufen, Luecken **1314-5476 ms**):

| Ansatz | warum tot |
|---|---|
| kuerzere Frist (800-1200 ms) | faengt **0 von 11** — die kleinste gemessene Luecke ist 1314 ms |
| Satzzeichen (`smart_format`) | `AIAssistantStartRequest.transcription` hat laut OpenAPI **genau zwei** Felder (`model`, `language`). Kein `settings` — dieselbe Grenze sperrt auch die Turn-End-Regler von AssemblyAI und Soniox |
| adaptiv | schlechter als pauschal: Fragmentierung beginnt immer an einem `other`-Turn, die Regel kommt per Konstruktion zu spaet |

**Die Wurzel, benannt:** die Luecken sind **Sprechpausen eines Menschen**, keine Zerhackung.
Ein Textsignal, das "Pause" von "fertig" trennt, existiert nicht. Wer Fragmente fangen will,
muss warten — die einzige freie Variable ist, WORAUF gewartet wird.

| | GQ-P17 | GQ-P18 |
|---|---|---|
| Aufschlag auf die fertige Antwort | +3000 ms auf **jeden** Turn | **0 ms, immer** |
| Aufschlag auf das erste Wort | +3000 ms auf jeden Turn | bis 3000 ms, nur bei Turns, die ohnehin laenger dauern |
| Fragment-Abdeckung | 7 von 11 | dieselben 7 |
| Kosten je gefangenem Fragment | 0 | eine Modellrunde + ggf. eine Recherche |

**Live-Abnahme (braucht Deploy + einen Anruf):** `TELNYX_SHIM_EXTEND_HOLD_MS` steht in der
Render-Env auf `0` und **muss dort bleiben, bis der neue Code live ist** — auf dem alten Stand
reaktiviert jeder Wert > 0 exakt die abgelehnte serielle Frist. Danach Wert setzen, ein Anruf,
`[telnyx-shim] hold` nach `outcome` auswerten: `silenced` = Fragment gefangen (der Gewinn),
`released` = die Sperre hat das erste Wort gekostet (der Preis), `flushed` = sie war gratis.
