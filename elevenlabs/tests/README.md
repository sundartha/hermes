# ElevenLabs-Testdefinitionen — Format, Beleg, Luecken

Dieses Verzeichnis enthaelt die Vorlagen fuer die Abnahmeliste aus
`UMSETZUNG-ElevenLabs.md`, Abschnitt 2 (Gruppe A, 10 Kriterien: A1-A10).
Zehn Agenten fuellen je ein Kriterium in eines der drei Vorlagenformate unter
`templates/`. Diese Notiz dokumentiert, woher jedes Feld belegt ist, und was
NICHT belegt werden konnte.

**Es existiert noch kein ElevenLabs-Agents-Abo.** Die Definitionen koennen
erst hochgeladen werden (`elevenlabs tests push`, `POST
/v1/convai/agent-testing/create`), wenn dieses Abo existiert. Bis dahin sind
diese Dateien reine Vorbereitung — kein API-Aufruf wurde und darf dafuer
gemacht werden.

## WARNUNG vor dem ersten Lauf (Pflichtlektuere)

**Kein Test aus diesem Ordner darf laufen, solange auch nur ein einziger
`<AUSFUELLEN: ...>`-Marker in einer der elf Testdefinitionen steht.** Vor dem
ersten Push/Lauf pruefen: `grep -rn "AUSFUELLEN" elevenlabs/tests/*.json` —
jeder Treffer muss durch einen echten Wert ersetzt sein, keine Ausnahme.

Drei Faelle sind dabei besonders gefaehrlich, weil ein "bestandener" Test
nichts beweist, solange die Luecke offen ist:

- **A3** (`a3-keine-ueberfluessige-rueckfrage.json`) ist ein
  `verify_absence`-Test — er soll nachweisen, dass ein Werkzeugaufruf
  ausbleibt. Steht in `tool_call_parameters.referenced_tool.id`/`.type`
  noch ein Platzhalter statt der echten Tool-Kennung, kann ElevenLabs den
  Aufruf eines nicht existierenden Werkzeugs per Definition nie beobachten
  — die Abwesenheitspruefung besteht dann GARANTIERT, egal wie sich der
  Agent tatsaechlich verhaelt. Das ist der gefaehrlichste Fall von falscher
  Sicherheit im ganzen Katalog: ein gruener Test, der nichts prueft.
- **A8** (`a8-sauberer-abschluss.json`) deckt nur die Haelfte des
  Kriteriums ab. Diese Testdefinition wertet ausschliesslich den
  simulierten Gespraechsverlauf aus (Datum/Uhrzeit/Preis wiederholen,
  sauber verabschieden). Ob die Zusammenfassung im Post-Call-Webhook
  (Datum, Uhrzeit, Preis und "Ziel erreicht: ja") tatsaechlich stimmt,
  prueft die Testmaschine hier NICHT — dafuer braucht es einen eigenen
  Nachweis gegen den echten Webhook-Payload.
- **A9** (`a9-kein-mitgehen-falsche-behauptung.json`) setzt voraus, dass
  dem Testagenten kein Recherche-Werkzeug zur Verfuegung steht. Das laesst
  sich in der Testdefinition selbst nicht erzwingen — welche Werkzeuge ein
  Agent hat, ist Eigenschaft der Agenten-Konfiguration im
  ElevenLabs-Dashboard, nicht der Testdatei. Vor dem Lauf von Hand
  sicherstellen, dass der Testagent kein Recherche-Werkzeug angehaengt hat,
  sonst prueft A9 nichts.

## Gewaehltes Verzeichnis

`elevenlabs/tests/` — vorgegeben durch den Auftrag, der diese Recherche
ausgeloest hat (Schreibrahmen), nicht selbst gewaehlt.

Zum Vergleich, was die ElevenLabs-CLI selbst dokumentiert (belegt,
<https://elevenlabs.io/docs/eleven-agents/operate/cli>, Abschnitt
"Project Structure", woertliches Baumdiagramm):

```
your_project/
├── agents.json
├── tools.json
├── tests.json
├── agent_configs/
├── tool_configs/
└── test_configs/
```

Die CLI erwartet also eine Registry-Datei `tests.json` im Projekt-Root plus
einen Ordner `test_configs/` fuer die einzelnen Testdateien — nicht
`elevenlabs/tests/`. Da der Schreibrahmen dieses Auftrags `elevenlabs/tests/`
fest vorgibt, uebernehmen wir davon nur das, was formatrelevant ist (JSON,
ein Ordner mit einer Datei je Test — s.u.), nicht den Ordnernamen selbst.
**Empfehlung fuer den spaeteren Push:** die ausgefuellten Definitionen der
zehn Agenten unter `elevenlabs/tests/test_configs/` ablegen (CLI-Unterordner-
Name, genestet unter dem vorgegebenen Root) und beim `push`/`pull` explizit
`--output-dir elevenlabs/tests/test_configs` bzw. eine passende `tests.json`
mitgeben. Eine `tests.json`-Registry wurde hier bewusst NICHT angelegt, weil
sie nicht Teil des Auftrags ist und mit Platzhalter-IDs nur Muell waere.

## Dateiformat

**JSON, eine Datei pro Test.** Die CLI-Doku bestaetigt das Verzeichnis-Muster
(ein Ordner mit Testdateien, s.o.); dass einzelne Testdefinitionen als JSON
uebertragen werden, ist ueber das Request-Schema von `POST
/v1/convai/agent-testing/create` belegt (Beleg-URL unten) — der Endpunkt
nimmt einen JSON-Body mit den unten aufgefuehrten Feldern entgegen, das ist
die Form, die auch die CLI beim Push/Pull verwendet. Ob einzelne Dateien in
`test_configs/` exakt `.json` heissen und wie sie benannt sind, steht in der
CLI-Doku nicht woertlich da — siehe UNGEKLAERT.

**Datei-Praefix in diesem Ordner:** `templates/*.template.json` — bewusst mit
`_vorlage_hinweis`/`_eval_varianten_hinweis`-Feldern markiert, die NICHT Teil
des dokumentierten Schemas sind und vor dem Push wieder entfernt werden
muessen. So ist eine Vorlage von einer echten Testdefinition nicht zu
verwechseln.

## Testarten — wie unterschieden

**Ein Feld, `type`, keine getrennten Endpunkte.** Belegt ueber
<https://elevenlabs.io/docs/api-reference/tests/create> und
<https://elevenlabs.io/docs/api-reference/tests/get>: derselbe Endpunkt
akzeptiert/liefert einen von drei `type`-Werten, jeder mit eigenem
Feld-Set (Union-Typ):

| `type`-Wert | Vorlage | Abnahme-Notation |
|---|---|---|
| `simulation` | `templates/simulation-test.template.json` | **[S]** Simulation Testing |
| `tool` | `templates/tool-call-test.template.json` | **[T]** Tool Call Testing |
| `llm` | `templates/next-reply-test.template.json` | **[N]** Next Reply (Scenario) Testing |

**Einschraenkung zur Zuordnung `llm` = Next Reply/Scenario Testing:** Diese
Zuordnung ist NICHT woertlich in der Doku als Satz zu finden ("llm heisst
Next Reply Testing" steht nirgends). Sie ist aus der Felduebereinstimmung
abgeleitet: der `type: llm`-Testkoerper hat genau ein Bewertungsfeld
(`success_condition`, "A prompt that evaluates whether the agent's response
is successful") — das deckt sich mit der in `UMSETZUNG-ElevenLabs.md`
beschriebenen Funktion von Next Reply Testing ("prueft nur die naechste
Antwort"). Strukturell eindeutig, aber kein Zitat-Beleg fuer die Namensgleichheit.

## Feldtabelle

| Feldname | Bedeutung | Beleg-URL |
|---|---|---|
| `name` | Testname, Pflichtfeld, alle drei Typen | https://elevenlabs.io/docs/api-reference/tests/create |
| `type` | Diskriminator: `llm` \| `tool` \| `simulation` | https://elevenlabs.io/docs/api-reference/tests/create |
| `dynamic_variables` | Map string->any, alle drei Typen | https://elevenlabs.io/docs/api-reference/tests/create |
| `chat_history` | Liste vorheriger Turns (`role`, `time_in_call_secs`, `message`, optional `tool_calls`/`tool_results`) | https://elevenlabs.io/docs/api-reference/tests/create |
| `conversation_initiation_source` | Enum, optional, Default `unknown` | https://elevenlabs.io/docs/api-reference/tests/create |
| `parent_folder_id` | Ordner-Zuordnung, optional | https://elevenlabs.io/docs/api-reference/tests/create |
| `from_conversation_metadata` | Verknuepfung zu "Create test from this conversation" (Objekt, optional) | https://elevenlabs.io/docs/api-reference/tests/create |
| **Simulation (`type: simulation`)** | | |
| `success_conditions` | Liste von Freitext-Erfolgsbedingungen, laut Doku gedeckelt ("Capped at the maximum number of evaluation criteria") | https://elevenlabs.io/docs/api-reference/tests/create |
| `simulation_scenario` | Freitext-Szenario fuer den simulierten Gespraechspartner | https://elevenlabs.io/docs/api-reference/tests/create |
| `simulation_max_turns` | Zugzahl der Simulation, Default 5 | https://elevenlabs.io/docs/api-reference/tests/create , Range 1-50: https://elevenlabs.io/docs/conversational-ai/customization/agent-testing |
| `simulation_environment` | Freitext, optional/nullable | https://elevenlabs.io/docs/api-reference/tests/create |
| `tool_mock_config` / `tool_mock_overrides` | Werkzeug-Mocking fuer die Simulation | https://elevenlabs.io/docs/api-reference/tests/create |
| `evaluation_model` | Bewerter-Modell, Default `claude-sonnet-4-6` | https://elevenlabs.io/docs/api-reference/tests/create |
| `simulated_user_model` | Modell fuer den simulierten Gespraechspartner, Default `claude-sonnet-4-6` | https://elevenlabs.io/docs/api-reference/tests/create |
| `success_condition` (Singular) | **VERALTET**, auf Simulation-Typ vorhanden aber deprecated — nicht verwenden, `success_conditions` (Plural) nutzen | https://elevenlabs.io/docs/api-reference/tests/create |
| **Next Reply / Scenario (`type: llm`)** | | |
| `success_condition` | Freitext-Prompt, bewertet die naechste Agenten-Antwort True/False | https://elevenlabs.io/docs/api-reference/tests/create |
| `success_examples` | Liste `{response, type:"success"}`, nicht-leer wenn angegeben | https://elevenlabs.io/docs/api-reference/tests/create |
| `failure_examples` | Liste `{response, type:"failure"}`, nicht-leer wenn angegeben | https://elevenlabs.io/docs/api-reference/tests/create |
| **Tool Call (`type: tool`)** | | |
| `tool_call_parameters` | Container-Objekt; leer = Aufruf wird nicht bewertet | https://elevenlabs.io/docs/api-reference/tests/create |
| `tool_call_parameters.referenced_tool.id` / `.type` | Welches Werkzeug geprueft wird; `type`-Enum: `system, webhook, client, workflow, api_integration_webhook, mcp, code` | https://elevenlabs.io/docs/api-reference/tests/create |
| `tool_call_parameters.verify_absence` | Boolean, Default `false`. **Das ist das Feld fuer Abwesenheits-Pruefung** (Plan-Begriff `verify_absence`) — `true` heisst: der Aufruf DARF NICHT stattfinden | https://elevenlabs.io/docs/api-reference/tests/create |
| `tool_call_parameters.parameters[].path` | Pfad/Name des zu pruefenden Parameters | https://elevenlabs.io/docs/api-reference/tests/create |
| `tool_call_parameters.parameters[].eval.type` | Pruefart-Diskriminator: `anything` \| `exact` \| `llm` \| `regex` | https://elevenlabs.io/docs/api-reference/tests/create |
| `...eval` bei `type:"exact"` | Feld `expected_value` (string) — exakter Vergleich | https://elevenlabs.io/docs/api-reference/tests/create |
| `...eval` bei `type:"regex"` | Feld `pattern` (string) — Muster-Vergleich | https://elevenlabs.io/docs/api-reference/tests/create |
| `...eval` bei `type:"llm"` | Feld `description` (string) — Bewertung durch Modell | https://elevenlabs.io/docs/api-reference/tests/create |
| `...eval` bei `type:"anything"` | keine weiteren Felder | https://elevenlabs.io/docs/api-reference/tests/create |
| `tool_call_parameters.workflow_node_transition` | `{agent_id, target_node_id, type}` fuer Workflow-Agenten | https://elevenlabs.io/docs/api-reference/tests/create |
| `check_any_tool_matches` | Boolean, optional/nullable | https://elevenlabs.io/docs/api-reference/tests/create |
| **Ausfuehrung (NICHT Teil der Testdefinitions-Datei)** | | |
| `repeat_count` | Gehoert zum Ausfuehrungs-Aufruf `POST /v1/convai/agents/{agent_id}/run-tests`, nicht zur Testdefinition selbst. Bereich bis 50 (angehoben von 20). Im Ergebnis (Test-Invocation) taucht `repeat_count` mit Default 1 wieder auf. | Bereich/Aenderung: https://elevenlabs.io/docs/changelog/2026/6/22 · Default im Ergebnis: https://elevenlabs.io/docs/api-reference/tests/test-invocations/get |
| `rationale.messages` / `rationale.summary` | Begruendung im Testergebnis (Test-Invocation), Einzelmeldungen + Zusammenfassung | https://elevenlabs.io/docs/api-reference/tests/test-invocations/get |
| `result_groups[].buckets[]` | Fehlschlaege gruppiert nach Ursache (`title`, `reason`, `status`: passed/failed/pending) | https://elevenlabs.io/docs/api-reference/tests/test-invocations/get |

## UNGEKLAERT (nicht belegbar, deshalb NICHT in den Vorlagen als scharfes Feld)

- **Exakte Obergrenze von `success_conditions`.** Die Doku sagt woertlich nur
  "Capped at the maximum number of evaluation criteria", ohne die Zahl zu
  nennen. Die in `UMSETZUNG-ElevenLabs.md` genannte Zahl 30 stammt NICHT aus
  meiner eigenen Verifikation — zwei Fetch-Runden auf die Create-Test-Doku
  haben die Zahl nicht bestaetigt. Nicht als belegtes Feld in die Vorlage
  uebernommen (Feld selbst ist belegt, der Zahlenwert nicht).
- **Exakter JSON-Pfad von `repeat_count` im Request-Body von `run-tests`.**
  Belegt ist: das Feld gehoert zu diesem Endpunkt (Changelog-Eintrag nennt
  Endpunkt und Feldname direkt). NICHT belegt: ob es ein Top-Level-Feld des
  Request-Bodys ist oder pro Eintrag in der `tests[]`-Liste steht — die
  automatisierte Doku-Extraktion zeigte bei mehreren Versuchen nur `test_id`,
  `workflow_node_id`, `root_folder_id`, `root_folder_name` je Listeneintrag,
  ohne `repeat_count` darin. Vor dem ersten echten Aufruf am tatsaechlichen
  Endpunkt/CLI-Hilfetext gegenpruefen, nicht raten.
- **`bucketing_status`-Feld.** Nur in einer Suchmaschinen-Zusammenfassung
  aufgetaucht (nicht als Zitat aus einer geladenen Doku-Seite bestaetigt).
  Nicht in die Feldtabelle als belegt aufgenommen.
- **Datei-Namenskonvention innerhalb von `test_configs/`.** Die CLI-Doku
  zeigt den Ordner im Projektbaum, aber keine Beispiel-Dateinamen fuer
  einzelne Tests darin (ein `.json` pro Test wird nur aus dem Muster bei
  `agent_configs/`/`tool_configs/` angenommen, nicht woertlich fuer Tests
  bestaetigt).

## Betriebs-Anweisung: erster Lauf mit `repeat_count` 1

**Der erste Lauf jeder Testdefinition misst die Kosten mit `repeat_count 1`,
nicht mit dem in `UMSETZUNG-ElevenLabs.md` genannten Zielwert** (z.B. 10 bei
A1/A2/A3/A6, 5 bei A4/A7/A8/A10). Grund: pro Simulationslauf sind laut
Abnahmeliste mindestens drei Sprachmodelle beteiligt (Agent, simulierter
Nutzer, Bewerter) und nach Verbrauch abgerechnet — ob das Minutenkontingent
zusaetzlich belastet wird, ist laut Abnahmeliste nirgends dokumentiert.
80 Durchlaeufe (Summe aller Zielwerte ueber A1-A10) auf Verdacht zu fahren
kann das Minutenkontingent an einem Nachmittag leeren, bevor ueberhaupt ein
Kriterium sauber gemessen ist. Erst mit `repeat_count: 1` je Kriterium
pruefen, dass Definition und Auswertung funktionieren und die tatsaechlichen
Kosten an der Rechnung ablesen — danach bewusst auf den Zielwert hochfahren.
Die Zielwerte selbst gehoeren in die jeweilige Testdefinition/Doku, nicht in
den ersten Testlauf.
