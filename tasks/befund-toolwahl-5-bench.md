# Befund: Vorher-Messung Werkzeugwahl unter DeepSeek — BLOCKIERT

Auftrag war, die Vorher-Messung fuer den D3-Defekt (`look_up`/`get_consult` feuern nicht
eigenstaendig, `take_message` gewinnt/feuert zusaetzlich) **unter der heute live laufenden
Konfiguration `LLM_PROVIDER=deepseek`, `CLAUDE_MODEL=deepseek-v4-pro`** herzustellen.

**Ergebnis vorweg: DeepSeek-Zahlen sind NICHT GEMESSEN.** Der Bench kann diese Konfiguration
strukturell nicht erreichen — unabhaengig davon, was in der Shell oder `.env` steht, laeuft
der gespawnte Server im Bench immer gegen Anthropic Claude Haiku. Das ist kein Zufallsfund,
sondern an drei Stellen im Code belegt (unten). Kein Produktivcode und kein Bench-Code wurde
angefasst, wie beauftragt.

## Messkette traegt (mechanisch) — JA

Minimallauf n=1, Szenario `d3-consult-verlangt`, Treiber `shim`, `--repeat 1`:

```
[convo-bench] d3-consult-verlangt r0 -> ended_via=agent_hangup turns=7 checks=10/11
```

Turns=7 (>0), Checks laufen, Judge urteilt (`concern`) — die Falle aus der Projektlehre
("turns:0 meldet trotzdem 100%") greift hier NICHT. Report:
`data/convo-bench/befund-toolwahl-5-minimal/d3-consult-verlangt-r0.json` (gitignored).

Werkzeuge je Turn in diesem einen Lauf (`metrics.turns[].tools`):
`[take_message] [get_consult] [] [take_message] [take_message] [end_call]` —
der Check `no_message_taken` schlaegt fehl: **derselbe Doppel-Feuer-Befund wie im
b3-Baseline** (`get_consult` UND `take_message` im selben Gespraech), diesmal unter
Anthropic Claude Haiku auf dem AKTUELLEN Commit.

## Positiv-Kontrolle (Pflicht laut Auftrag/Koordinator) — bestanden

`offeredToolNames` (unconditional `[telnyx-shim] turn_ok`-Log, `src/telnyx-llm-shim.js:348`,
Union ueber alle Tool-Loop-Runden eines Turns, `src/claude.js:942/1170`) belegt, dass die
Werkzeuge im angebotenen Satz stehen, BEVOR eine Feuerrate etwas ueber die Modellwahl aussagt:

| Szenario | offeredToolNames (1. Turn) | gefeuert |
|---|---|---|
| `d3-nachschlag-auftrag` | `end_call, take_message, look_up` | `look_up` |
| `d3-consult-verlangt` | `end_call, take_message, get_consult` | `get_consult` (Lauf A) / `take_message` (Lauf B, gleicher Text) |
| `d3-fremde-recherche` | `end_call, take_message, look_up` | (keins — korrekt, Negativ-Check) |

Rohlog: `data/convo-bench/befund-toolwahl-5-minimal/positive-control-log.txt`, Skript
`positive-control.mjs` (repliziert `runner.mjs#buildEnv` 1:1, kein Repo-File geaendert).

**Zu den zwei Parallel-Spur-Einwaenden:** (1) Env-Flags leaken nicht aus lokaler `.env` —
`LOOKUP_ENABLED`/`CONSULT_ENABLED`/`IN_CALL_CONSULT_ENABLED`/`EXA_API_KEY` werden je
Szenario explizit in `scripts/convo-bench/scenarios/d3-*.mjs` (`env:{...}`) gesetzt und
ueberschreiben `BASE_ENV`, belegt durch den Lauf oben. (2) `PAID_PLAN_PROFILE.allowLookup:
false` (`src/plans.js:105`) ist fuer den Bench irrelevant: er seedet nur unter
`BOOTSTRAP_TENANT_ID` (`runner.mjs#buildCallSeed`), und `resolveProfileFrom`
(`src/store/defaults.js`) pinnt diese ID hart auf `OWNER_PROFILE`
(`allowLookup:true`, `allowConsult:true`) — der gespeicherte Plan wird gar nicht gelesen.
Identisch zum b3-Baseline vom 2026-08-08 (byte-identischer Code-Pfad): intern
vergleichbar, misst aber die Werkzeug-WAHL des Modells, nicht Rechte-Durchsetzung fuer
einen realen Bezahl-Tenant — das galt schon in der alten Baseline.

## BLOCKER: Bench kann die Konfiguration `LLM_PROVIDER=deepseek` nicht erreichen

Drei zusammenwirkende Fakten, jeder einzeln in `scripts/convo-bench/` bzw. `test/helpers.js`
belegt:

1. **`runner.mjs#buildEnv` (Zeile ~74) setzt `CLAUDE_MODEL` hart auf die Konstante
   `PRODUCTION_CLAUDE_MODEL = "claude-haiku-4-5"`** — unabhaengig von Shell/`.env`.
2. **`test/helpers.js#BASE_ENV` pinnt `LLM_PROVIDER: "anthropic"` und
   `DEEPSEEK_API_KEY: ""`** (Zeilen 55-59, bewusst so kommentiert: *"sonst leakt eine
   lokale .env via dotenv in Spawn-Tests"*). `startServer` spawnt den Kindprozess mit
   `env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR }` — **NUR `PATH` kommt
   aus der eigenen Shell**, der Rest ist explizit. dotenv im Kindprozess fuellt laut
   demselben Kommentar nur UNgesetzte Variablen — kann `LLM_PROVIDER`/`DEEPSEEK_API_KEY`
   also nicht ueberschreiben.
3. **Kein Durchreich-Pfad existiert:** `grep -rn "LLM_PROVIDER\|DEEPSEEK" scripts/convo-bench/`
   liefert null Treffer. `convo-bench.mjs` kennt keinen `--llm-provider`/`--agent-model`-Flag
   (nur `--persona-model`, `--judge-model`, `--provider` [Telefonie], `--driver`). Keines der
   drei `d3-*.mjs`-Szenarien setzt `LLM_PROVIDER`/`DEEPSEEK_API_KEY`/`CLAUDE_MODEL` in
   `scenario.env` (wo es durchginge, da `scenario.env` VOR `driverEnv` gespreadet wird).

**Empirisch verifiziert** (Diagnose-Skript, kein Repo-File geaendert,
`data/convo-bench/befund-toolwahl-5-minimal/deepseek-plumb-check-log.txt`): `LLM_PROVIDER=
deepseek` + `DEEPSEEK_API_KEY=""` (= exakt der Zustand, den `BASE_ENV` heute an den
Bench-Kindprozess weiterreichen wuerde, wenn `LLM_PROVIDER` je durchkaeme) → Boot-Refusal
`[Konfiguration fatal] ... fehlt/ungueltig: DEEPSEEK_API_KEY` (`src/config.js:1928-1929`).
Mit korrekt durchgereichtem `DEEPSEEK_API_KEY` **bootet derselbe Server erfolgreich** — die
Luecke ist reines Env-Plumbing, keine tiefere Inkompatibilitaet. Der Minimallauf oben belief
real gegen Anthropic ($0.0510), obwohl meine Shell zuvor `LLM_PROVIDER=deepseek` + echten
`DEEPSEEK_API_KEY` aus `.env` exportiert hatte — **direkter Beweis, dass die Shell-Umgebung
den Kindprozess nicht erreicht.**

## Konsequenz fuer diesen Auftrag

Gemaess Auftrag ("Wenn der Bench selbst blockiert, beschreibe den Blocker praezise statt ihn
zu umgehen") wurde NICHT versucht, `scripts/convo-bench/**` zu patchen, um `LLM_PROVIDER`
durchzureichen — das waere ein Umgehen des gemeldeten Blockers, kein Beleg. Die n=5-Messung
auf den drei d3-Szenarien wurde **nicht gefahren**: sie wuerde real gegen Anthropic laufen
und liesse sich leicht als "DeepSeek-Zahl" missverstehen — genau die Fehlerklasse, vor der
dieses Projekt wiederholt gewarnt hat (falsches Ergebnis sieht aus wie ein echtes).

**DeepSeek, alle drei d3-Szenarien, alle Kennzahlen (look_up/get_consult/take_message-Raten,
Check-Quoten, Judge-Urteile): NICHT GEMESSEN.**

## Konfiguration dieser (Teil-)Messung

| | |
|---|---|
| Git-Commit | `3bffd49bcbc3b03059ec0af0080ef2b3672bebfb` (Arbeitsverzeichnis sauber) |
| Treiber | `shim` (Default, = Live-Sprechpfad) |
| Provider | `telnyx` |
| Agent-Modell (real gelaufen) | `claude-haiku-4-5` / Anthropic — **NICHT** `deepseek-v4-pro` |
| Persona | `claude-haiku-4-5`, Judge `claude-sonnet-5` (beide Anthropic, vom Bench nie beeinflusst) |
| Umfang real gelaufen | 1x `d3-consult-verlangt` (n=1) + 3x Positiv-Kontroll-Turns (je 1 Turn, kein Judge) |
| Kosten | ca. $0.05 (n=1-Lauf) + wenige Cent (Positiv-Kontrollen) |

## Empfehlung (nicht umgesetzt, ausserhalb des Auftrags)

Der Fix ist klein und lokalisiert: `runner.mjs#buildEnv` muesste `LLM_PROVIDER`,
`DEEPSEEK_API_KEY` und `CLAUDE_MODEL` aus `process.env` durchreichen (mit Default auf den
heutigen Anthropic-Pfad, damit bestehende Laeufe unveraendert bleiben), und `BASE_ENV`
bliebe unangetastet (dort sind die neutralen Pins fuer alle ANDEREN Spawn-Tests richtig).
Das ist eine eigene, bewusste Entscheidung — nicht Teil dieses Auftrags.
