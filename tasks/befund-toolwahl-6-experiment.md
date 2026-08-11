# Befund Toolwahl-6: die Fuenf-Arm-Experimentreihe am rohen Draht — GEBAUT, NICHT GEMESSEN

Auftrag: falsifizierbare Experimentreihe direkt gegen den DeepSeek-Adapter (kein Bench, kein
Server, kein Telefon), die zwischen den konkurrierenden Wurzeln der Werkzeugwahl TRENNT.
Stand 2026-08-11, Branch `phase/werkzeugwahl`, HEAD `5e50210`.

## 0. Kernaussage — und der Blocker

**Die Messreihe konnte NICHT gefahren werden: das DeepSeek-Guthaben ist erschoepft.** Jede der
25 Anfragen (5 Arme x n=5) endete mit **HTTP 402 `Insufficient Balance`**, keine einzige mit einer
Modellantwort. Kontostand-Endpunkt, direkt abgefragt:

```
GET https://api.deepseek.com/user/balance
200 {"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"-0.00",
     "granted_balance":"0.00","topped_up_balance":"-0.00"}]}
```

Damit ist zur eigentlichen Frage (Schwelle vs. Beschreibung vs. Ueberlappung vs. Reihenfolge)
**NICHTS GEMESSEN**. Es gibt keine Zahl in diesem Bericht, die eine Wurzel stuetzt oder
ausschliesst. Was steht, ist der Messaufbau — vollstaendig, verifiziert und in einem Befehl
wiederholbar, sobald das Konto Guthaben hat.

## 1. Der Aufbau (steht, verifiziert)

Messwerkzeug: `probe-werkzeugwahl-experiment.mjs` im Scratchpad, **kein Produktivcode geaendert**.
Es ruft den echten `systemPrompt(call)` und die echten Werkzeug-Definitionen auf HEAD und laesst
den echten DeepSeek-Adapter (`toDeepseekBody`) den Body erzeugen; gesendet wird dieser Body als
roher POST, damit sich die Arme nur in ihrer einen Variablen unterscheiden, nicht im Transportweg.

Gemeinsame Basis, live-treu auf HEAD:

| | Wert | Beleg |
|---|---|---|
| Modell / Anbieter | `deepseek-v4-pro` / `deepseek` | `config.llm.claudeModel` aus `.env` |
| `max_tokens` | 300 | `TURN_MAX_TOKENS`, `claude.js:761` |
| `thinking` | `{"type":"disabled"}` | unbedingt in `toDeepseekBody` (`deepseek.js:282`) |
| System-Prompt | 5785 Zeichen, `get_consult` **5x woertlich**, `take_message` 1x | gerendert, `ww-experiment/system-prompt.txt` |
| `consultAvailableFor(call)` | **true** (Owner-Tenant, frischer Poll, aktiver Outbound) | im Lauf ausgegeben |
| Werkzeugsatz | `end_call`, `take_message`, `get_consult` (= `agentTools` ohne `look_up`) | im Body belegt, s. 2 |
| Lage | IMPLIZITE Entscheidungslage, woertlich aus `scripts/convo-bench/scenarios/d3-consult-implizit.mjs` (Eroeffnung + `scriptedTurns[0]`, uebernommen aus dem Nachher-Transkript r0) | `ww-experiment/messages.json` |
| Timeout | **60 000 ms** (statt des Live-Deckels 3500 ms — hier soll die Werkzeugwahl gemessen werden, nicht die Latenz) | `TIMEOUT_MS` im Skript |

Bewusste Abweichung vom Bench, benannt: gemessen wird **die erste Entscheidungsrunde**
(Gegenstelle schlaegt einen mandatsfremden Termin vor und wartet auf Zusage), nicht das
vollstaendige 7-Turn-Gespraech. Ob sich der Bench-Wert 0/5 daraus reproduziert, haette Arm A0
zeigen muessen — **NICHT GEMESSEN**.

## 2. Positiv-Kontrolle: die Werkzeuge stehen wirklich im gesendeten Body

Aus den gedumpten Bodies (`ww-experiment/body-A0.json` .. `-A4.json`), Reihenfolge und
Beschreibungslaenge wie gesendet:

| Arm | `tools` im Body (Reihenfolge) | `tool_choice` |
|---|---|---|
| A0 Referenz | `end_call`:332, `take_message`:1159, `get_consult`:823 | Schluessel FEHLT (Anbieter-Default `auto`) |
| A1 Zwang | dieselben drei, dieselbe Reihenfolge | `"required"` |
| A2 Reihenfolge | `end_call`:332, **`get_consult`:823, `take_message`:1159** | Schluessel FEHLT |
| A3 ohne Ausweg | `end_call`:332, `get_consult`:823 (**kein `take_message`**) | Schluessel FEHLT |
| A4 benannt | dieselben drei wie A0 | `{"type":"function","function":{"name":"get_consult"}}` |

Kein Arm bietet nichts an; `get_consult` liegt in **jedem** Arm auf dem Draht.

**Ein-Variablen-Nachweis** (maschineller Schluesselvergleich gegen A0): A1 unterscheidet sich in
genau `tool_choice`, A2 in genau `tools`, A3 in genau `tools`, A4 in genau `tool_choice`.
`system` (5785 Zeichen) und `messages` sind in allen fuenf Armen **identisch**. Der Aufbau
erfuellt die Vorgabe "byte-identisch bis auf die EINE Variable".

## 3. Zaehltabelle — Ergebnis des Laufs

Alle 25 Anfragen scheiterten VOR jeder Modellentscheidung. Fehler sind getrennt ausgewiesen und
zaehlen NICHT als "0 gefeuert".

| Arm | n | get_consult | take_message | end_call | kein Werkzeug | **Fehler (HTTP 402)** |
|---|---|---|---|---|---|---|
| A0 Referenz | 5 | – | – | – | – | **5** |
| A1 Zwang `required` | 5 | – | – | – | – | **5** |
| A2 Reihenfolge | 5 | – | – | – | – | **5** |
| A3 ohne `take_message` | 5 | – | – | – | – | **5** |
| A4 benannter Zwang | 5 | – | – | – | – | **5** |

"–" heisst hier **NICHT GEMESSEN**, nicht "null". Latenz je Fehlschlag 564–646 ms (der Anbieter
lehnt sofort ab); kein Timeout, kein Abbruch auf unserer Seite. Die A1-Verteilung ueber die
Werkzeuge — das entscheidende Datum des Auftrags — ist damit **NICHT GEMESSEN**.

## 4. Nebenbefund mit Live-Bezug (ernst, teilweise unbelegt)

HTTP 402 ist in unserer Klassifikation **nicht-transient** (`llm/transient-errors.js`:
`RETRYABLE_STATUS = {408,409,429}` plus `>=500`; 4xx faellt durch). Folge im Live-Pfad: kein
Retry, sofortige Degradation auf `turnErrorSpeech` — der Anrufer hoert in JEDEM Turn den
Fehlersatz.

- **BELEGT:** der lokal in `.env` liegende Schluessel gehoert zu einem Konto mit Guthaben 0,00 USD
  und `is_available:false`. Guthaben ist bei DeepSeek konto-, nicht schluesselgebunden.
- **UNBELEGT / NICHT GEMESSEN:** ob der Live-Dienst (Render) einen Schluessel **desselben Kontos**
  benutzt. Wenn ja, telefoniert Hermes seit Erschoepfung des Guthabens ohne funktionierendes
  Gespraechs-Gehirn. Das laesst sich ohne Zugriff auf die Live-Env nicht von hier entscheiden —
  Pruefung durch den Owner empfohlen, **bevor** der naechste echte Anruf laeuft.
- Der Bench-Lauf der Nachher-Messung (19:33) enthaelt **kein** 402: die dortigen 19,8 % Fehler
  waren Timeouts am 3500-ms-Deckel, wie berichtet. Das Guthaben lief also NACH dieser Messung
  leer; die Nachher-Zahlen sind davon nicht kontaminiert (geprueft: `grep` auf Bench-Log und alle
  20 Reports, 0 Treffer auf `402`/`Insufficient`).

## 5. Fortsetzung — ein Befehl

Das Skript hat jetzt einen **Preflight**: es fragt zuerst den Guthaben-Endpunkt ab und bricht
benannt ab (`ABBRUCH: DeepSeek-Guthaben erschoepft`), statt 25 Anfragen in 402 zu verbrennen —
ein leeres Konto sieht in einer Zaehltabelle sonst genau aus wie "das Modell feuert nie".
Aufruf: `node <scratchpad>/probe-werkzeugwahl-experiment.mjs --n=5` (`--dry` baut nur die Bodies).

Kosten: 25 Anfragen a ~1,5 k Prompt-Token, Cent-Bereich. Abbruchregel unveraendert gueltig:
**reproduziert A0 die Bench-Erwartung (get_consult 0/5) nicht, ist die Basis falsch — dann stoppen
und melden, statt A1..A4 zu deuten.**

## 6. Was dieser Bericht NICHT zeigt

- Welche Wurzel es ist (Entscheidungsschwelle / Werkzeug-Beschreibung / Ueberlappung mit
  `take_message` / Reihenfolge im Array): **NICHT GEMESSEN**.
- Ob `tool_choice:"required"` `get_consult` oder `take_message` waehlt: **NICHT GEMESSEN**.
- Ob der Aufruf ueberhaupt erzeugbar ist (A4-Positiv-Kontrolle): in dieser Reihe **NICHT
  GEMESSEN**. (Aeltere Evidenz auf einem frueheren Commit und ohne den WW-P3-Prompt-Block:
  `tasks/befund-toolwahl-1-draht.md` §5, `tool_choice:"required"` feuerte `get_consult` 5/5. Das
  ist eine ANDERE Konfiguration und ersetzt A4 nicht.)
- Ob der Live-Dienst dasselbe DeepSeek-Konto benutzt: **NICHT GEMESSEN** (s. 4).
