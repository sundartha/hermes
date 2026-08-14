# ElevenLabs-Testdefinitionen — Format, Beleg, Luecken

Diese Notiz gehoert zur Abnahmeliste aus `UMSETZUNG-ElevenLabs.md`,
Abschnitt 2 (Gruppe A, 10 Kriterien: A1-A10). Zehn Agenten fuellten je ein
Kriterium in eines der drei Vorlagenformate unter `templates/`. Sie
dokumentiert, woher jedes Feld belegt ist, und was NICHT belegt werden konnte.

**Die elf ausgefuellten Testdefinitionen liegen seit dem Umzug nicht mehr
hier, sondern unter `elevenlabs/test_configs/`, die Registry daneben unter
`elevenlabs/tests.json`** (Begruendung: Abschnitt "Ablage" unten). In diesem
Verzeichnis stehen nur noch diese Notiz und die Vorlagen unter `templates/`.

**Es existiert noch kein ElevenLabs-Agents-Abo.** Die Definitionen koennen
erst hochgeladen werden (`elevenlabs tests push`, `POST
/v1/convai/agent-testing/create`), wenn dieses Abo existiert. Bis dahin sind
diese Dateien reine Vorbereitung — kein API-Aufruf wurde und darf dafuer
gemacht werden.

## WARNUNG vor dem ersten Lauf (Pflichtlektuere)

**Kein Test aus `elevenlabs/test_configs/` darf laufen, solange auch nur ein
einziger `<AUSFUELLEN: ...>`-Marker in einer der elf Testdefinitionen steht.** Vor dem
ersten Push/Lauf pruefen: `npm run elevenlabs:check` (oder direkt
`grep -rn "AUSFUELLEN" elevenlabs/test_configs/*.json`) — jeder Treffer muss
durch einen echten Wert ersetzt sein, keine Ausnahme.

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

## Ablage: `test_configs/` + `tests.json`

Was die ElevenLabs-CLI erwartet (belegt,
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

Die CLI erwartet also eine Registry-Datei `tests.json` im Projekt-Wurzel-
verzeichnis plus einen Ordner `test_configs/` fuer die einzelnen Testdateien.
`elevenlabs/` IST dieses Wurzelverzeichnis — dort liegt bereits
`agent_configs/`; `test_configs/` und `tests.json` sind seit dem Umzug seine
Geschwister. Die frueher hier empfohlene Verschachtelung unter
`elevenlabs/tests/test_configs/` ist damit hinfaellig: sie haette
`agent_configs/` und `test_configs/` in zwei verschiedene Wurzeln gelegt,
also zwei verschiedene Arbeitsverzeichnisse fuer `agents push` und
`tests push` erzwungen.

CLI-Aufrufe (`elevenlabs tests push|pull`) gehoeren deshalb aus `elevenlabs/`
heraus abgesetzt: `pushTests` oeffnet den `config`-Pfad einer Registry-Zeile
unveraendert, also relativ zum Arbeitsverzeichnis (Beleg s.u.).

### Format von `tests.json`

Die Doku zeigt `tests.json` nur im Baumdiagramm, ohne Inhalt. Belegt ist das
Format deshalb am Quelltext der CLI (<https://github.com/elevenlabs/cli>,
`src/tests/commands/impl.ts`):

```ts
interface TestDefinition {
  config: string;
  type?: string;
  id?: string;
}
interface TestsConfig {
  tests: TestDefinition[];
}
```

- `config` — Pfad zur Testdatei. `pushTests` benutzt ihn direkt
  (`const configPath = testDef.config`), ohne `path.resolve` — also relativ
  zum Arbeitsverzeichnis des Aufrufs.
- `type` — optional, die VORLAGE, aus der `elevenlabs tests add` die Datei
  erzeugt hat (`basic-llm`, `tool`, `conversation-flow`, `customer-service`,
  s. `src/tests/templates.ts`). Unsere elf Dateien stammen aus keiner dieser
  Vorlagen, deshalb nicht gesetzt. Nicht verwechseln mit dem `type`-Feld IN
  der Testdatei (`llm` | `tool` | `simulation`, s. Abschnitt "Testarten").
- `id` — optional, die ElevenLabs-Kennung. Sie entsteht ERST beim ersten Push
  und wird von der CLI selbst zurueckgeschrieben (`testDef.id = newTestId`).
  Deshalb hier nicht gesetzt — ein `<AUSFUELLEN: ...>` waere hier falsch: der
  Wert ist nicht auszufuellen, sondern wird erzeugt.
- Der Testname steht NICHT in der Registry: `pushTests` liest ihn aus der
  Testdatei (`testConfig.name || 'Unnamed Test'`).

`tests.json` traegt bewusst KEINEN `_`-Doku-Schluessel, anders als die
uebrigen JSON-Dateien hier. Grund: die CLI schreibt die Datei selbst neu
(`writeConfig(testsConfigPath, testsConfig)`), und ob sie Fremdschluessel
dabei erhaelt oder verwirft, ist nicht belegt. Die Dokumentation steht
deshalb hier statt in der Datei.

### Eine neue Testdefinition braucht ZWEI Dinge

**Die Datei unter `elevenlabs/test_configs/` UND eine `config`-Zeile in
`elevenlabs/tests.json`.** Ohne die Registry-Zeile wird sie nie hochgeladen:
`pushTests` laeuft die Registry ab, nicht den Ordner (Beleg s. Abschnitt
"Format von `tests.json`"). Eine Definition ohne Zeile sieht geprueft aus und
laeuft nie — ihr Abnahmekriterium bleibt ungemessen.

### Was das Gate prueft

`npm run elevenlabs:check` (`scripts/check-elevenlabs-tests.js`) haelt genau
das fest, in drei Pruefungen:

1. **Registry-Kopplung, beidseitig.** Jede Definition unter
   `elevenlabs/test_configs/` (ohne `templates/`) muss eine `config`-Zeile in
   `elevenlabs/tests.json` haben — und jede `config`-Zeile muss auf eine
   vorhandene Datei zeigen, sonst bricht der Push an diesem Pfad ab. Ein
   fehlender oder leerer `test_configs/`-Ordner ist ein Fund fuer sich
   (fail-closed), auch wenn anderswo eine Streu-Definition liegt.
   `elevenlabs/tests/` ist kein Ablageort mehr: eine Definition dort wird
   namentlich gemeldet. Die Felder `id` und `type`, die die CLI nach dem Push
   selbst zurueckschreibt, sind ausdruecklich KEIN Fund.
2. **Platzhalter.** Kein `<AUSFUELLEN: ...>` in einer Testdefinition;
   Doku-Schluessel mit `_`-Praefix sind ausgenommen, sie sind kein Teil des
   ElevenLabs-Schemas.
3. **Vokabular.** Jede einzelne Testdefinition setzt in `dynamic_variables`
   jede Variable, die die Agentenkonfiguration als `{{name}}` liest — und
   keine, die diese nicht kennt.

**Geprueft wird die Vereinigung aus Ablage und Registry.** Platzhalter- und
Vokabular-Pruefung laufen nicht nur ueber die beiden Ablageorte, sondern
zusaetzlich ueber jeden vorhandenen `config`-Pfad aus `tests.json` — auch wenn
er an beiden Ablageorten vorbeizeigt (z.B. `agent_configs/streu.json`).
Hochgeladen wird, was in der Registry steht; genau diese Datei duerfte sonst
ungeprueft in ElevenLabs landen.

Damit gelten fuer `config`-Pfade drei weitere Regeln, jede ein Fund:

- **Kein absoluter Pfad, kein `..`.** Die CLI oeffnet den Pfad unveraendert
  relativ zu `elevenlabs/`; beides zeigt aus diesem Verzeichnis heraus.
- **Kein Pfad zweimal.** Zwei Zeilen auf dieselbe Datei legen den Test doppelt
  in ElevenLabs an — zwei Kennungen fuer ein Abnahmekriterium.
- **Gross-/Kleinschreibung exakt.** Der Abgleich laeuft case-sensitiv gegen die
  Verzeichnis-Eintraege, nicht ueber `existsSync`: auf macOS ist das Dateisystem
  case-insensitiv, dort saehe `test_configs/A1.json` vorhanden aus, waehrend der
  Push auf dem Linux-CI an genau diesem Pfad abbricht.

`elevenlabs/tests.json` selbst wird nicht auf Platzhalter oder
`dynamic_variables` geprueft: es ist eine Registry, keine Testdefinition. Die
Vorlagen bleiben ausgenommen — aber nur der Ordner `templates/` DIREKT unter
einem Ablageort und nur, solange die Vorlage in KEINER Registry-Zeile steht.
Ein `templates/`-Ordner in beliebiger Tiefe waere sonst ein Versteck fuer
ungepruefte Definitionen, und eine registrierte Vorlage wird gepusht wie jede
Testdefinition — dann wird sie auch geprueft wie jede.

Das Gate laeuft in der CI bei jedem Push (`.github/workflows/ci.yml`, Schritt
"ElevenLabs-Testdefinitionen"). Es ist dort vorerst NICHT blockierend
(`continue-on-error`), weil die vier oben genannten Platzhalter den Lauf heute
rot enden lassen; sobald sie aufgeloest sind, wird der Schritt blockierend
geschaltet.

### Drift zum LIVE-Agenten: `npm run elevenlabs:drift`

`elevenlabs:check` haelt Vorlage und Testdefinitionen zusammen. Es sagt
**nichts** darueber, ob der Agent, der wirklich telefoniert, noch aussieht wie
die Vorlage. Genau das war der Befund: Vorlage und Live-Agent waren
auseinandergelaufen, und nichts hat es bemerkt — es fiel nur auf, weil ein Test
in einen Timeout lief.

`npm run elevenlabs:drift` (`scripts/check-elevenlabs-drift.mjs`) holt den
Live-Agenten per **GET** und vergleicht ihn mit der Vorlage. Es **patcht
nichts** — das Reparieren ist eine eigene Entscheidung. Ein anderer Agent als
der voreingestellte:
`npm run elevenlabs:drift -- <agent_id>`.

**Verglichen wird nur, was die Vorlage BESITZT.** Die Besitz-Liste steht als
Datenfeld `_besitz.felder` in `elevenlabs/agent_configs/outbound-agent.template.json`
— nicht im Skript, nicht als Prosa: eine Liste, die nur ein Mensch liest,
driftet genauso wie das, was sie beschreiben soll. Wer der Vorlage ein Feld
hinzufuegt, das sie besitzen soll, traegt es **dort** ein, sonst wird es nie
verglichen.

Besessen sind heute `language`, `first_message`, `prompt`,
`dynamic_variables` (die **Namen**), `tools` und `language_presets`. **Nicht**
besessen sind `tts.voice_id`, `tts.model_id` und alles, was im Dashboard
gesetzt wurde; sie werden weder gemeldet noch angefasst. Der Grund ist kein
Aufwand, sondern Schaden: ein Vollabgleich ueber alle Felder wuerde eine
Stimme melden — und beim Reparieren ueberschreiben —, die der Eigentuemer im
Dashboard gewaehlt hat. In diesem Projekt hat schon einmal ein Provisionierer
die ganze Live-Konfiguration aus lokalen Werten geschrieben und Live-Werte
zerstoert.

Je Eintrag legt `art` fest, **wie** verglichen wird (begruendet in der Vorlage
an `_besitz._art_hinweis`):

- `wert` — exakter Wertvergleich, genau ein Pfad je Seite.
- `namen` — die Menge der Namen einer Sammlung. Noetig, weil beide Seiten
  dieselbe Sache verschieden formen: die Vorlage haelt Werkzeuge als
  Objekt-Karte, der Live-Agent als Liste. `null` zaehlt nicht als vorhanden —
  der Anbieter fuehrt jedes bekannte Systemwerkzeug als Schluessel und setzt
  die nicht konfigurierten auf `null`.
- `variablen` — die Menge der `{{name}}`-Vorkommen. Bei `dynamic_variables`
  werden die **Namen** verglichen, nicht die Werte: die Werte sind
  auftragsspezifisch und bei jedem Anruf andere.

#### Verbote: was ein Preset NICHT setzen darf

Ein Feldvergleich haelt zwei bekannte Stellen gegeneinander. Er kann nicht
sagen: „in dieser Sammlung darf **nirgends** dieser Pfad gesetzt sein" — und
genau das braucht es bei den `language_presets`. Der Namensvergleich oben
prueft nur, **welche** Sprachen der Agent fuehrt; ueber den Inhalt eines
Presets sagt er nichts, und ueber ein Preset, das es morgen erst gibt, schon
gar nichts.

Deshalb traegt `_besitz` neben `felder` eine Liste `regeln` (begruendet in der
Vorlage an `_besitz._regeln_hinweis`). Ein Eintrag der Art
`verboten_je_eintrag` loest seinen `live`-Pfad im Live-Agenten auf, geht
**jeden** Eintrag der Sammlung durch und meldet jeden, der einen der Pfade
unter `verboten` auf etwas anderes als `null` gesetzt hat — namentlich und mit
der Begruendung aus `meldung`. Das laeuft unabhaengig davon, ob die Namen der
Sammlung gerade abweichen.

Das eine Verbot heute:
**kein `language_preset` ueberschreibt `first_message`.** `first_message` ist
der Offenlegungssatz nach **Artikel 50 EU AI Act**; ein Preset, das ihn je
Sprache still ersetzt, ist genau der Weg, auf dem eine gesetzliche Pflicht
lautlos verschwindet. Verboten sind beide Wege dorthin —
`overrides.agent.first_message` (von Hand gesetzt) und
`first_message_translation.text` (vom Anbieter erzeugt); ein Verbot, das nur
den ersten kennt, waere nach dem ersten Klick im Dashboard umgangen. Braucht
eine Sprache einen eigenen Offenlegungssatz, kommt er **woertlich** aus
`src/i18n/locales.js` (`LOCALES.<sprache>.disclosure`) — nie als
Preset-Override und nie als Uebersetzung, die im Dashboard entsteht.

Der heutige Befund: die drei Live-Presets `en`, `es` und `fr` verletzen das
Verbot alle drei, samt der toten Platzhalter `{{user_name}}`/`{{call_purpose}}`.
Das **Zurueckschneiden** der Presets ist eine eigene Entscheidung mit eigenem
Paket — dieses Kommando meldet es nur.

**Fail-closed.** Ohne Schluessel, ohne erreichbare API, ohne Besitz-Erklaerung,
ohne Regel-Liste, bei einem besessenen Pfad, den die Vorlage gar nicht hat,
oder bei einer verbotenen Sammlung, die es live nicht gibt, endet der Lauf mit
einer Meldung und Exit 1 — nie mit OK. Ein gruenes Pruefkommando, das nichts
geprueft hat, sieht aus wie ein bestandenes; deshalb nennt auch die
OK-Meldung, wie viele Felder verglichen und wie viele Verbots-Pruefungen
(Regel x Eintrag) gefahren wurden. Der Vergleich laeuft immer ueber den vollen
Wert; gekuerzt ist ausschliesslich die Anzeige in der Meldung.

## Dateiformat

**JSON, eine Datei pro Test.** Die CLI-Doku bestaetigt das Verzeichnis-Muster
(ein Ordner mit Testdateien, s.o.); dass einzelne Testdefinitionen als JSON
uebertragen werden, ist ueber das Request-Schema von `POST
/v1/convai/agent-testing/create` belegt (Beleg-URL unten) — der Endpunkt
nimmt einen JSON-Body mit den unten aufgefuehrten Feldern entgegen, das ist
die Form, die auch die CLI beim Push/Pull verwendet. Wie einzelne Dateien in
`test_configs/` heissen, ist frei: die CLI findet sie nicht ueber ein
Namensmuster, sondern ueber den `config`-Pfad in `tests.json` (s.o.).

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

| `type`-Wert  | Vorlage                                   | Abnahme-Notation                      |
| ------------ | ----------------------------------------- | ------------------------------------- |
| `simulation` | `templates/simulation-test.template.json` | **[S]** Simulation Testing            |
| `tool`       | `templates/tool-call-test.template.json`  | **[T]** Tool Call Testing             |
| `llm`        | `templates/next-reply-test.template.json` | **[N]** Next Reply (Scenario) Testing |

**Einschraenkung zur Zuordnung `llm` = Next Reply/Scenario Testing:** Diese
Zuordnung ist NICHT woertlich in der Doku als Satz zu finden ("llm heisst
Next Reply Testing" steht nirgends). Sie ist aus der Felduebereinstimmung
abgeleitet: der `type: llm`-Testkoerper hat genau ein Bewertungsfeld
(`success_condition`, "A prompt that evaluates whether the agent's response
is successful") — das deckt sich mit der in `UMSETZUNG-ElevenLabs.md`
beschriebenen Funktion von Next Reply Testing ("prueft nur die naechste
Antwort"). Strukturell eindeutig, aber kein Zitat-Beleg fuer die Namensgleichheit.

## Feldtabelle

| Feldname                                               | Bedeutung                                                                                                                                                                                                                        | Beleg-URL                                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                                                 | Testname, Pflichtfeld, alle drei Typen                                                                                                                                                                                           | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `type`                                                 | Diskriminator: `llm` \| `tool` \| `simulation`                                                                                                                                                                                   | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `dynamic_variables`                                    | Map string->any, alle drei Typen                                                                                                                                                                                                 | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `chat_history`                                         | Liste vorheriger Turns (`role`, `time_in_call_secs`, `message`, optional `tool_calls`/`tool_results`)                                                                                                                            | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `conversation_initiation_source`                       | Enum, optional, Default `unknown`                                                                                                                                                                                                | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `parent_folder_id`                                     | Ordner-Zuordnung, optional                                                                                                                                                                                                       | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `from_conversation_metadata`                           | Verknuepfung zu "Create test from this conversation" (Objekt, optional)                                                                                                                                                          | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| **Simulation (`type: simulation`)**                    |                                                                                                                                                                                                                                  |                                                                                                                                                              |
| `success_conditions`                                   | Liste von Freitext-Erfolgsbedingungen, laut Doku gedeckelt ("Capped at the maximum number of evaluation criteria")                                                                                                               | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `simulation_scenario`                                  | Freitext-Szenario fuer den simulierten Gespraechspartner                                                                                                                                                                         | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `simulation_max_turns`                                 | Zugzahl der Simulation, Default 5                                                                                                                                                                                                | https://elevenlabs.io/docs/api-reference/tests/create , Range 1-50: https://elevenlabs.io/docs/conversational-ai/customization/agent-testing                 |
| `simulation_environment`                               | Freitext, optional/nullable                                                                                                                                                                                                      | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `tool_mock_config` / `tool_mock_overrides`             | Werkzeug-Mocking fuer die Simulation                                                                                                                                                                                             | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `evaluation_model`                                     | Bewerter-Modell, Default `claude-sonnet-4-6`                                                                                                                                                                                     | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `simulated_user_model`                                 | Modell fuer den simulierten Gespraechspartner, Default `claude-sonnet-4-6`                                                                                                                                                       | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `success_condition` (Singular)                         | **VERALTET**, auf Simulation-Typ vorhanden aber deprecated — nicht verwenden, `success_conditions` (Plural) nutzen                                                                                                               | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| **Next Reply / Scenario (`type: llm`)**                |                                                                                                                                                                                                                                  |                                                                                                                                                              |
| `success_condition`                                    | Freitext-Prompt, bewertet die naechste Agenten-Antwort True/False                                                                                                                                                                | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `success_examples`                                     | Liste `{response, type:"success"}`, nicht-leer wenn angegeben                                                                                                                                                                    | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `failure_examples`                                     | Liste `{response, type:"failure"}`, nicht-leer wenn angegeben                                                                                                                                                                    | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| **Tool Call (`type: tool`)**                           |                                                                                                                                                                                                                                  |                                                                                                                                                              |
| `tool_call_parameters`                                 | Container-Objekt; leer = Aufruf wird nicht bewertet                                                                                                                                                                              | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `tool_call_parameters.referenced_tool.id` / `.type`    | Welches Werkzeug geprueft wird; `type`-Enum: `system, webhook, client, workflow, api_integration_webhook, mcp, code`                                                                                                             | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `tool_call_parameters.verify_absence`                  | Boolean, Default `false`. **Das ist das Feld fuer Abwesenheits-Pruefung** (Plan-Begriff `verify_absence`) — `true` heisst: der Aufruf DARF NICHT stattfinden                                                                     | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `tool_call_parameters.parameters[].path`               | Pfad/Name des zu pruefenden Parameters                                                                                                                                                                                           | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `tool_call_parameters.parameters[].eval.type`          | Pruefart-Diskriminator: `anything` \| `exact` \| `llm` \| `regex`                                                                                                                                                                | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `...eval` bei `type:"exact"`                           | Feld `expected_value` (string) — exakter Vergleich                                                                                                                                                                               | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `...eval` bei `type:"regex"`                           | Feld `pattern` (string) — Muster-Vergleich                                                                                                                                                                                       | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `...eval` bei `type:"llm"`                             | Feld `description` (string) — Bewertung durch Modell                                                                                                                                                                             | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `...eval` bei `type:"anything"`                        | keine weiteren Felder                                                                                                                                                                                                            | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `tool_call_parameters.workflow_node_transition`        | `{agent_id, target_node_id, type}` fuer Workflow-Agenten                                                                                                                                                                         | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| `check_any_tool_matches`                               | Boolean, optional/nullable                                                                                                                                                                                                       | https://elevenlabs.io/docs/api-reference/tests/create                                                                                                        |
| **Ausfuehrung (NICHT Teil der Testdefinitions-Datei)** |                                                                                                                                                                                                                                  |                                                                                                                                                              |
| `repeat_count`                                         | Gehoert zum Ausfuehrungs-Aufruf `POST /v1/convai/agents/{agent_id}/run-tests`, nicht zur Testdefinition selbst. Bereich bis 50 (angehoben von 20). Im Ergebnis (Test-Invocation) taucht `repeat_count` mit Default 1 wieder auf. | Bereich/Aenderung: https://elevenlabs.io/docs/changelog/2026/6/22 · Default im Ergebnis: https://elevenlabs.io/docs/api-reference/tests/test-invocations/get |
| `rationale.messages` / `rationale.summary`             | Begruendung im Testergebnis (Test-Invocation), Einzelmeldungen + Zusammenfassung                                                                                                                                                 | https://elevenlabs.io/docs/api-reference/tests/test-invocations/get                                                                                          |
| `result_groups[].buckets[]`                            | Fehlschlaege gruppiert nach Ursache (`title`, `reason`, `status`: passed/failed/pending)                                                                                                                                         | https://elevenlabs.io/docs/api-reference/tests/test-invocations/get                                                                                          |

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
- ~~**Datei-Namenskonvention innerhalb von `test_configs/`.**~~ Erledigt mit
  dem Umzug: die CLI sucht nicht nach einem Namensmuster, sie liest den
  `config`-Pfad aus `tests.json` (Beleg s. Abschnitt "Format von
  `tests.json`"). Die Dateinamen sind damit frei waehlbar.

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
