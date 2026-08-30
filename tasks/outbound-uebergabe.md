# Uebergabe: Outbound-Resilienz-Kette (Stand 2026-08-30, nach dem Deploy)

Selbsttragend. Ersetzt die Fassung vom Morgen.

## 1. Die Kette ist KOMPLETT gemergt

`master` steht auf dem Merge von E5. Alle Etappen sind gemergt, gepusht UND live (s. 1b).
Test-Anker: **5420 pass / 0 fail** (`LLM_PROVIDER=anthropic npm test`, vom Lead selbst gefahren).

| Etappe | Inhalt |
|---|---|
| E1 | Plattform-Nummern-Bindung + dreifacher Freigabe-Riegel (die Wurzel des Ausfalls) |
| E2 | EIN Fehlervokabular ueber alle Engines, getrennt nach Schuld |
| E3a/E3b | Der Fehler erreicht Nutzer bzw. Betreiber |
| E4 | Drift-Waechter - erkennt den Ausfall OHNE dass ein Anruf stattfindet |
| E5 | **Der Outbound sendet wieder die DID des anrufenden Tenants** (die Regression aus dem EL-Umstieg) |

Der Ausfall vom 27.08. selbst ist seit dem 28.08. behoben (ANI-Override zeigt auf `+18643028341`),
der MCP-Weg ist demofaehig. Hergang: `tasks/befund-outbound-ausfall-2026-08-27.md`.

## 1b. DEPLOY-STAND (2026-08-30, gemessen)

**Der Code ist LIVE.** `1f4f4a5` auf lokal = origin = upstream = Render.
Beleg: `/healthz` am Live-Dienst meldet `commit: 1f4f4a5...` (nicht dem Push- oder Deploy-Status
glauben - dieses Feld ist der Beleg). Deploy `dep-da9uqvss728c73et5ngg`, Status `live`.

Dabei zwei Notiz-Korrekturen, beide frisch gemessen:
- `mcp__render__trigger_deploy` wird NICHT mehr vom Classifier blockiert (Notiz von 2026-07-21
  ueberholt) - der Deploy liess sich direkt ausloesen.
- `autoDeploy` steht weiterhin auf `no`: ein Push allein deployt nichts, das gilt unveraendert.
- upstream trug zwei eigene Commits von Jonas (apps/web) - bidirektionale Divergenz wie
  dokumentiert. Gemergt, Test-Gate 5420/0, beide Remotes gepusht.

Die neuen E5-Env-Variablen haben alle sichere Defaults (`ELEVENLABS_NUMBER_REGISTRATION_ENABLED`
= `false`, SIP-Zugangsdaten leer), die Migration ist rein additiv (drei nullable Spalten,
`ADD COLUMN IF NOT EXISTS`) und laeuft beim Boot automatisch. Der Dienst ist unauffaellig.

## 2. DIE OFFENE OWNER-AKTION, ohne die E5 wirkungslos bleibt

**STAND 2026-08-30, am Anbieter gemessen: der Cutover DARF JETZT NICHT gefahren werden.**
Er wuerde den Ausfall vom 27.08. exakt wiederholen. Die Belege:

| Vorbedingung | gemessen | Ergebnis |
|---|---|---|
| V1 SIP-Zugangsdaten | `TELNYX_SIP_TRUNK_USERNAME`/`-PASSWORD` existieren weder lokal noch sonstwo greifbar | **BLOCKIERT - nur der Owner kann sie in Telnyx anlegen** |
| V2 Pilot | nicht gefahren (Anbieter-Schreibzugriff, Kosten UNBELEGT) | offen |
| V3 jede DID registriert | `npm run elevenlabs:nummern`: "1 von 1 aktiven DIDs ohne Registrierung" | **NICHT erfuellt** |
| V4 Rueckfall kontoeigen | EL-Registrierung traegt `+15739090177`; das Telnyx-Konto besitzt `+15804504874`, `+17067101188`, `+18643028341` - die Rueckfall-Nummer ist NICHT darunter | **NICHT erfuellt** |

**Die Kausalkette, wenn man den Cutover trotzdem faehrt:** keine Tenant-DID hat eine eigene
Registrierung (V3) -> jeder Anruf faellt auf die globale Registrierung zurueck -> die traegt eine
Nummer, die dem Konto nicht gehoert (V4) -> ohne den maskierenden ANI-Override antwortet Telnyx mit
SIP 403 "Unverified origination number". Das ist woertlich der Ausfall vom 27.08.

**Der ANI-Override ist derzeit das EINZIGE, was den Outbound am Leben haelt.** Er bleibt stehen,
bis V1-V4 erfuellt sind.

Reihenfolge fuer den Owner: V1 (SIP-Zugangsdaten anlegen + in Render setzen, dann
`ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true`) -> V4 (Registrierung fuer eine KONTOEIGENE
Plattform-DID, `ELEVENLABS_AGENT_PHONE_NUMBER_ID` nachziehen) -> V2 (Pilot, eine Nummer, Testanruf,
Rechnung) -> V3 (`npm run elevenlabs:nummern` bis Exit 0) -> ERST DANN der PATCH unten.

Der neue Code ist korrekt und **folgenlos**, solange Telnyx jede gesendete Nummer ueberschreibt.
Erst der Cutover schaltet ihn scharf:

```
PATCH https://api.telnyx.com/v2/fqdn_connections/3026479542865757220
{"outbound":{"ani_override":""}}
```

`ani_override_type` NICHT anfassen - das Enum kennt keinen Aus-Wert; leeres `ani_override` genuegt
(am Live-Konto per GET bestaetigt). **Vier Vorbedingungen und der Rueckbau stehen in
`docs/RUNBOOK-OUTBOUND.md`, Abschnitt "ANI-Cutover und Nummern-Registrierung".** Besonders V4: die
globale Rueckfall-Registrierung traegt heute noch die am 24.08. freigegebene `+15739090177` - ohne
V4 endet jeder Rueckfall-Anruf nach dem Cutover in SIP 403.

Zweite, unabhaengige Rueckbau-Achse: `ELEVENLABS_NUMBER_REGISTRATION_ENABLED=false`.

## 3. Prozess-Wurzel behoben (der teuerste Befund des Tages)

Die Kette hatte **12.757 Mio Token ueber 118 Laeufe** verbraucht; ein einzelner Impl-Agent 447 Mio
in 955 Turns. Wurzel: Beweispflichten wuchsen monoton (6 -> 9 -> 6 -> 7 -> 10 -> 12
"woertlich"-Forderungen ueber E1..E5), waehrend das einzige sichtbare Kostensignal
(`subagent_tokens`) die Cache-Reads weglaesst und um **Faktor ~197** zu niedrig zeigt. Die alte
Fassung dieser Uebergabe schrieb "rund 15,5 Mio" fuer eine Kette, die 3.060 Mio kostete.

**Ab jetzt gilt `.claude/refs/workflow.md` Abschnitt 2a** (Pflichtlektuere): keine woertlichen
Kommando-Ausgaben, volle Suite genau EINMAL vom Lead statt in jedem Agenten, Agenten unter ~150
Turns. Nach JEDEM Lauf messen:

```
node scripts/workflow-kosten.mjs <lauf-id>
```

**Eine Kostenangabe, die nicht aus diesem Werkzeug stammt, ist nicht zu glauben und nicht
weiterzureichen.** Wirkung am selben Tag gemessen: der E5-Rest-Lauf nach den neuen Regeln kostete
**17,0 Mio statt 861 Mio** - Faktor 50, bei gleichem Ergebnis (PASS, alle Pruefungen selbst
gefahren).

`.claude/workflows/runs/outbound-e5-rest.js` ist die Vorlage fuer den naechsten Lauf. Die teuren
Vorgaenger sind geloescht (Historie in `git`) - **bitte nicht aus der Historie zurueckholen.**

## 4. Zwei weitere Wurzeln, im selben Zug behoben

- **Verwaiste Testserver:** 19 liefen gleichzeitig, drei ueber einen Tag. `stop()` laeuft nur auf
  dem guten Pfad; stirbt der Testrunner abnormal, ueberlebt sein Serverkind. `startServer` startet
  jetzt ueber `test/helpers/server-mit-elternwaechter.mjs`, der sich bei Elterntod selbst beendet.
  (NICHT die Wurzel: Port-Kollisionen - `BASE_ENV` setzt `PORT=0`.)
- **Der pre-commit-Hook blockierte jeden Commit waehrend eines Laufs:** `eslint .` las die
  Agenten-Worktrees mit (648 Dateien, 8.622 Scheinfehler). `.claude/worktrees/**` steht jetzt auf
  der Ignore-Liste.

## 5. Offene Owner-Entscheidungen

| # | Frage | Stand |
|---|---|---|
| **F-3** | **ANI-Cutover bei Telnyx** (Abschnitt 2) | **offen - ohne ihn wirkt E5 nicht** |
| F-1 | Eigene Plattform-DID kaufen (1 USD + 2 USD/Monat) statt der owner-DID? | Zwischenloesung laeuft |
| F-4 | Waechter-Secrets im GitHub-Repo hinterlegen | offen; VIER: `TELNYX_API_KEY`, `ELEVENLABS_API_KEY`, `PLATFORM_ANI_E164`, `ELEVENLABS_AGENT_ID` |
| F-5 | ANI-Riegel scharf schalten (Default aus)? | nach einer Woche gruener Waechter-Laeufe |
| F-7 | Telnyx-Guthaben (3,09 USD) und DeepSeek (HTTP 402) auffuellen | offen |
| — | ~~Wann wird gepusht/deployt?~~ | **ERLEDIGT 2026-08-30**: beide Remotes + Render auf `1f4f4a5` |
| — | `seed-test-payment.mjs` + `seed-card-test-payment.mjs` | vom Lead nach `scratchpad/beiseite-gelegt/` verschoben (nicht geloescht), weil sie den Linter blockierten. Entscheidung steht aus. |

**Vor dem naechsten Deploy zwingend:** `PLATFORM_ANI_E164` und `PLATFORM_ALERT_MAIL_TO` sind im
Render-Dashboard gesetzt (28.08.). Neue Env-Variablen aus E5 stehen in `.env.example` und
`render.yaml`; `ELEVENLABS_NUMBER_REGISTRATION_ENABLED` hat Default **aus**.

## 6. Nicht-blockierende Beobachtung aus dem E5-Review (fuer den Nachzug)

Kein Test pinnt, dass **der Orchestrator** `sipRegistrarWennAktiv` aufruft - die Abdeckung ist
transitiv. Ein Rueckbau auf ein Inline-Gate bliebe gruen. Da die Gate-Frage nur noch an einer
Stelle beantwortet wird, waere das eine bewusste Re-Duplizierung, kein Versehen.

## 7. Arbeitsweise

- **Lead bleibt duenn**, prueft aber vor JEDEM Merge selbst `git diff --stat` und ob Testdateien
  verschwunden sind. Ein PASS des Workflows ist keine Merge-Freigabe. (Heute nuetzlich: eine
  scheinbar geloeschte Datei war nur ein aelterer Verzweigungspunkt.)
- **Eine Bahn zur Zeit.** Nie zwei Workflows, nie zwei Testlaeufe parallel.
- **Nach jedem Lauf:** Worktrees entfernen, Review-Branches loeschen, Kosten messen.
- **Nachbesserung statt Neustart:** endet eine Etappe BLOCKED, kostet ein schlanker Lauf mit einem
  Fixer und einem Reviewer einen Bruchteil einer zweiten Vollrunde.
- **Zwischendurch committen.** Ein Impl-Agent starb heute am Sitzungslimit mit 1.929 ungespeicherten
  Zeilen; nur eine manuelle Rettung hat sie erhalten.
