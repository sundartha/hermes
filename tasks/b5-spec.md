# B5 — DeepSeek-Adapter + Anbieter-Registry

Spezifikation, Stand 2026-08-09. Basis: `master` (nach B3b-Merge `48b9617`).
Vorgaenger: B2 (Vertrag `src/llm/ports.js`), B3a (Antwortseite), B3b (Anfrageseite,
gemergt `48b9617`), B4a (Preisstaffel).

## 1. Ziel in einem Satz

Der Owner soll den **LLM-Anbieter per Env-Variable wechseln** koennen, ohne eine Zeile
Fachcode anzufassen — mit Anthropic als Rueckfall.

## 2. Warum das die letzte Phase ist

B3a+B3b haben Antwort- UND Anfrageseite neutralisiert: `claude.js` und
`precall-briefing.js` enthalten **null** anbieter-spezifische Marker (am 2026-08-09
nachgemessen). Was fehlt, ist der **zweite Adapter** — und genau er ist der Beweis, dass die
Naht traegt. Bis dahin ist der Port eine Behauptung.

## 3. Scope — K20 und K21 der Grenztabelle, plus der Adapter

Autoritative Quelle fuer K20/K21: `tasks/b3a-report.md`, Abschnitt "Grenztabelle B3a/B3b".

1. **DeepSeek-Adapter** `src/llm/adapters/deepseek.js` — implementiert denselben
   `LlmProvider`-Vertrag wie `adapters/anthropic.js`.
2. **K21 Registry** — Auswahl ueber `LLM_PROVIDER` (Env, zentral in `src/config.js`,
   dokumentiert in `.env.example`). **Default `anthropic`.** Unbekannter Wert -> Boot-Abbruch
   mit benanntem Wert (fail-closed, Hausmuster `boot-guard.js`), NICHT stiller Fallback.
3. **K20 `LlmProvider.limits`** — erst JETZT sinnvoll, weil es einen zweiten Anbieter gibt.
   Nur aufnehmen, wenn ein echter Konsument existiert; sonst begruendet weglassen (S4).

## 4. Was der Spike bereits gemessen hat — BINDEND, nicht neu erheben

Quelle: Branch `spike/b3-deepseek-toolloop` (`5e0ee0c`), Report per
`git show spike/b3-deepseek-toolloop:tasks/b3-spike-report.md`. Gemessen am 2026-08-09 gegen
die echte API, Kosten 0,0017 USD.

| Befund | Konsequenz fuer den Adapter |
|---|---|
| **`deepseek-v4-pro` laeuft per Default im "Thinking mode"**. Dort scheitern `tool_choice:"required"` UND die benannte Form mit **HTTP 400 "Thinking mode does not support this tool_choice"** (reproduzierbar 2/2). | **Der Adapter MUSS das loesen**, nicht der Vertrag. Belegte Abhilfe: `thinking:{"type":"disabled"}` im Body -> beides HTTP 200. **ACHTUNG: nur isoliert getestet (n=2), nicht ueber den vollen Loop.** Das ist im Rahmen dieser Phase zu verifizieren. |
| `tool_calls` kommen beim **Streaming fragmentiert ueber viele SSE-Chunks** und muessen ueber `index` zusammengesetzt werden. | Eine durchreichende Sink gaebe **kaputte JSON-Fragmente** weiter. Der Adapter muss zusammensetzen, bevor er `LlmTurn.toolCalls` liefert. |
| `reasoning_content` streamt als **eigener Kanal VOR** dem sichtbaren Text (undokumentiert). | Darf **nicht** als Sprechtext durchgereicht werden — der Anrufer wuerde Denk-Text hoeren. |
| Verbrauchsfelder: `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` (nur im Thinking mode, Teilmenge von `completion_tokens`). | Abbildung auf die **vier Sorten** von `LlmTokenUsage`. `reasoning_tokens` sind KEINE eigene Sorte — sie werden zum normalen Output-Satz berechnet und sind bereits in `completion_tokens` enthalten. **Nicht doppelt buchen.** |
| Deutsch ueber 6 Runden fluessig, keine Abschneidung, 8/8 Werkzeug-Aufrufe mit parsebarem JSON. | W8 ist mit GO beantwortet. Praezedenz B-7 wiederholt sich hier NICHT. |

## 5. Offene Frage, die B5 entscheidet

**W2 — unparsebare Werkzeug-Argumente.** B1 und der Spike haben den Fall nie beobachtet
(8/8 parsebar), also ist er **nicht widerlegt, nur nicht eingetreten**. B5 ist der erste
Adapter, der Werkzeug-Argumente wirklich **parst** (Anthropic liefert sie bereits als Objekt,
DeepSeek als JSON-String). Der Adapter MUSS den Fehlerfall definieren:
**fail-closed** (Werkzeug-Aufruf verwerfen und als Fehler melden), nicht `undefined`
durchreichen. Ein still verschluckter Parse-Fehler ist ein Werkzeug-Aufruf mit falschen
Argumenten — im Telefonpfad heisst das eine falsche Handlung.

## 6. Preis — Regel 1 beruehrt

`MODEL_PRICE_SCHEDULES` (`config.js`, aus B4a) kennt heute nur die zwei Anthropic-Modelle.
**`assertPricedModels` bricht den Boot ab, wenn `claudeModel`/`briefingModel` keine Staffel
haben.** Wird ein DeepSeek-Modell konfiguriert, MUSS seine Staffel mit `validFrom`, `asOf`
und `source` (abgerufene, nicht geratene Rate) in derselben Tabelle stehen — sonst startet
der Dienst nicht.

**`worstCasePrice` ist das punktweise Maximum jeder der vier Raten** (W4, bindend). Ein
zweiter Anbieter ist genau der Fall, fuer den diese Form gebaut wurde — sie darf nicht
aufgeweicht werden. Der Fallback bleibt: ohne ihn endet ein unbekanntes Modell in `NaN`, und
`NaN > limit` ist immer `false` = **fail-open am Gate**.

## 7. Abgrenzung

- **Kein Wechsel des Live-Anbieters.** B5 liefert die Faehigkeit, nicht die Umstellung.
  Default bleibt `anthropic`.
- **`bridge.js` bleibt unberuehrt** — der Realtime-Pfad spricht direkt mit OpenAI, nicht ueber
  den Port (das verbliebene `tool_choice` dort ist korrekt und kommentiert).
- **Kein B4b** (Kostenmessung), keine Store-Migration.
- **Keine Aenderung an Safety-Gates, Offenlegungssatz, Signaturpruefung.**

## 8. Abnahme — jeder Punkt ein Kommando

1. **Syntax:** `node --check` auf jede geaenderte Datei. Exit 0.
2. **Suite:** `npm test` -> `fail 0`, Exit 0, `pass` **>= 4086** (Stand `48b9617`).
   Ein SINKEN ist ein Blocker, auch bei `fail 0`.
   **Der Lauf MUSS im Worktree stattfinden** (`cd .claude/worktrees/<run>-2 && npm test`) —
   `git checkout` scheitert still, wenn ein Worktree den Branch belegt (Lehre 2026-08-09).
3. **Golden-Master `42a2fe5`** (`test/b3-wire-golden-master.test.js`): muss **unveraendert
   gruen** bleiben. Er beschreibt den Anthropic-Draht; ein zweiter Adapter darf ihn nicht
   bewegen. Eine Aenderung dort ist ein Blocker.
4. **Registry-Beweis:** ein Test, der belegt, dass `LLM_PROVIDER=deepseek` den DeepSeek-
   Adapter liefert und `LLM_PROVIDER` unbekannt/leer den Boot **fail-closed** abbricht bzw.
   auf `anthropic` faellt (je nach gewaehltem Design — begruenden).
5. **Dreiwertiger `toolChoice` am DeepSeek-Adapter:** Test fuer `AUTO`, `REQUIRED` und
   **benanntes Werkzeug**. Der benannte Zwang ist der Pfad, den `precall-briefing.js` live
   nutzt — er ist der teuerste Fehler dieser Phase.
6. **W2-Beweis:** Test mit **unparsebarem** `arguments`-String -> fail-closed, kein
   `undefined` im Werkzeug-Aufruf.
7. **Streaming-Beweis:** Test mit ueber mehrere Chunks fragmentierten `tool_calls` ->
   korrekt zusammengesetzt. Und: `reasoning_content` landet **nicht** im Sprechtext.
8. **Rotprobe (Pflicht):** mindestens eine Gegenprobe — Mechanismus zurueckbauen, Test MUSS
   rot werden. Ohne diesen Beleg zaehlt der Test nicht.
9. **Kein Netzaufruf in der Suite.** Alle Adapter-Tests laufen gegen Attrappen; `npm test`
   muss offline und ohne `.env` gruen sein (Repo-Invariante).

## 9. Arbeitsweise (Repo-Lehren, teuer bezahlt)

- Erst Branch/Worktree auf `master` anlegen, **dann** lesen.
- Hintergrund-Testlaeufe **nie** durch eine Pipe filtern (`| tail`, `| grep`) — volle Ausgabe
  in eine Datei, erst beim Lesen filtern. Sonst ist das Ergebnis beim Backgrounding weg.
- Ein Testlauf, der eine Aenderung belegen soll, wird gegen ein **Merkmal der Aenderung**
  geprueft (`grep -c "^ok .* - B5-"`), nicht nur gegen `fail 0`.
- Commit-Messages mit Anfuehrungszeichen ueber `-F datei`, nie inline.
- Dateien **einzeln** adden, **nie** `git add -A`.
- Kommentare auf Deutsch OHNE Umlaute; gesprochene deutsche Strings behalten korrekte Umlaute.
- `timeout` und `xargs -a` gibt es auf macOS nicht.
- Env-Variablen zentral in `src/config.js` UND in `.env.example` dokumentieren; `render.yaml`
  pruefen. Neue config-Env-Var IMMER in `BASE_ENV` (`test/helpers.js`), sonst leakt die echte
  `.env` in Spawn-Tests.
