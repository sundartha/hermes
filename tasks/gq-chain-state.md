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
