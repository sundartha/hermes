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
