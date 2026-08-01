# AL-Kette — Stand

Gefuehrt vom Lead der Umsetzungs-Session. Eine Zeile je Phase, sobald sie **gemergt** ist.
Quelle der Wahrheit ist `git`, nicht diese Datei — bei Zweifel `git log --oneline` und
`git merge-base --is-ancestor <commit> master`.

**Start der Kette:** 2026-07-28, master `e4a2751`.
**Plan:** `PLAN-ASSISTANT-LEAP.md` · **Steuerung:** `tasks/assistant-leap-chain.md`

## Register

| Phase | Branch (zurueckgegeben) | Gate | Merge-Commit | Stand |
|---|---|---|---|---|
| AL-P1 | `phase/al-p1-latenz-achse` | PASS (0 Fix-Runden, 3350 gruen) | `dd0c0dc` | **gemergt** — 4 Abnahmen in der Checkliste |
| AL-P2 | — | — | — | offen — **nicht gemessen**, kein Urteil |
| AL-P2s | `phase/al-p2s-spike-schalter` | PASS (0 Fix-Runden, highStakes, 3611 gruen) | `4305c15` | **gemergt** — Schalter gestellt, Messung gefahren |
| AL-P2z | `phase/al-p2z-spike-entfernen` | PASS (0 Fix-Runden, 3615 gruen) | `96d2526` | **gemergt** — Schalter ersatzlos weg (718 Zeilen), `git grep` leer |
| AL-P3 | `phase/al-p3-endpointing` | PASS (0 Fix-Runden, 3374 gruen) | `a4cbdd1` | **gemergt** — 3 Abnahmen in der Checkliste |
| AL-P4 | `phase/al-p4-tool-loop` | PASS (0 Fix-Runden, 3359 gruen) | `1021bc1` | **gemergt** — 2 Abnahmen in der Checkliste |
| AL-P5 | `phase/al-p5-eroeffnung-fix2` | PASS (2 Fix-Runden, highStakes, 3417 gruen) | `e208bc9` | **gemergt** — Abnahme = Testanruf |
| AL-P6 | `phase/al-p6-turn-budget` | PASS (0 Fix-Runden, highStakes, 3385 gruen) | `f16c00a` | **gemergt** |
| AL-P7 | `phase/al-p7-token-streaming` | PASS (0 Fix-Runden, highStakes, 3649 gruen) | `591e21f` | **gemergt** — `TELNYX_SHIM_TOKEN_STREAMING` Default AUS |
| AL-P7b | `phase/al-p7b-denk-signal-fix1` (NICHT der geplante) | PASS (1 Fix-Runde, 3688 gruen) | `7db1393` | **gemergt** — Weg A, `THINKING_SIGNAL_ENABLED` Default AUS |
| AL-P8 | `phase/al-p8-bench-fix1` | PASS (1 Fix-Runde, 3412 gruen) | `61d7563` | **gemergt** — 2 Abnahmen (kosten Geld) |
| AL-P9 | `phase/al-p9-briefing-impl` (NICHT der gemeldete) | PASS (0 Fix-Runden, 3426 gruen) | `479721e` | **gemergt** — Flag bleibt AUS |
| AL-P10 | `phase/al-p10-precall-research-fix1` | PASS (1 Fix-Runde, 3462 gruen) | `21a1f9c` | **gemergt** — Flag bleibt AUS |
| AL-P10b | `phase/al-p10b-lookup-fix3` (NICHT der geplante) | BLOCKED -> PASS im Nachlauf AL-P10b-fix (3694 gruen) | `b33216f` | **gemergt** — `LOOKUP_ENABLED` Default AUS, Key fehlt noch |
| AL-P11 | `phase/al-p11-ergebnis-karte` | PASS (0 Fix-Runden, 3457 gruen) | `dd0cc26` | **gemergt** — Zitate erst nach Datenschutzerklaerung |
| AL-P12 | `phase/al-p12-gedaechtnis` | PASS (0 Fix-Runden, 3475 gruen) | `3d645de` | **gemergt** |
| AL-P13 | `phase/al-p13-consult-kanal-fix1` | PASS (1 Fix-Runde, highStakes, 3524 gruen) | `a090dbd` | **gemergt** — Bahn B KOMPLETT |
| AL-P14 | `phase/al-p14-get-consult` | PASS (0 Fix-Runden, highStakes, 3636 gruen) | `5903f90` | **gemergt** — Flag AUS, Abnahme in der Checkliste |
| AL-P15 | — | — | — | offen (haengt an AL-P14-Praxis) |

## Verlauf

### 2026-07-28 — Session-Start

- master `e4a2751`, sauber. Seit `da17c4e` **keine fremden Commits** — die zurueckgestellte
  Kette `PLAN-AUTH-GATE` laeuft **nicht** parallel. AL hat Vorrang (Owner-Entscheidung).
- **Befund vor der ersten Phase:** `phase-impl-lean.js` kennt **kein** Argument fuer einen
  Zusatz-Prompt. Die in Abschnitt 6 der Kette geforderten Zusaetze (Regel 0, O1-O9-Vorrang,
  Flag-aus, Checklisten-Pflicht) waeren im Phasen-Prompt nie angekommen. Ausserdem enthielt die
  `specFile` **keine** Phasen-Abschnitte, und die IDs weichen ab (`AL-P1` hier gegen `Phase 1`
  im Plan-Doc) — der Plan-Agent haette den Abschnitt nicht gefunden.
  **Behoben:** Abschnitt 9 „Phasen-Spezifikationen" in `tasks/assistant-leap-chain.md`
  (Namensbruecke + Betriebsregeln je Phase).
- **AL-P2-Vorbedingung geklaert** (read-only `psql`, RLS pro Tenant gesetzt): `+17067101188` ist
  die live genutzte DID (letzter Outbound 2026-07-27). **Korrektur an der Annahme in
  `al-owner-notes.md` §4:** es gibt keine herrenlose Ersatz-DID — alle drei stehen auf
  `status=active` und jede ist die einzige Nummer eines eigenen Tenants. Zurueckhaengen ist
  deshalb Teil von AL-P2, nicht Nacharbeit. Details im AL-P2-Abschnitt der Kette.
- **Welle 0: AL-P1 gemergt** (`dd0c0dc`). Gate PASS ohne Fix-Runde.
- **Welle 1: AL-P4 (`1021bc1`) und AL-P3 (`a4cbdd1`) gemergt.** Beide PASS ohne Fix-Runde.
  Konflikt beim zweiten Merge nur in `tasks/al-testcall-checklist.md` (beide Bahnen haben Zeilen
  angehaengt) — beide Saetze behalten.
  AL-P3 hat die im Plan geforderte Vorpruefung per Objekt-GET am Live-Assistant erledigt und den
  spekulativen Absatz im Plan-Doc durch den Messwert ersetzt: `start_speaking_plan` haengt unter
  `interruption_settings`, **nicht** unter `transcription`. Der befuerchtete Guard-Wechsel
  entfaellt. Die Entscheidungen O1-O9 blieben unberuehrt (nachgeprueft).
- **Lastwaechter** laeuft seit Welle 1 (`scratchpad/al-load-guard.sh`): misst jede Minute und
  sammelt `node src/server.js`-Prozesse aelter als 10 min ein.
  **NACHTRAEGLICH KORRIGIERT (s. Welle 3):** die erste Fassung zaehlte die Prozesse mit
  `pgrep`. `pgrep` sieht in dieser Sandbox **keine fremden Prozesse** und lieferte stur `0`.
  Die damals notierte Entwarnung („null verwaiste Server, node=0") war deshalb **keine
  Messung, sondern ein blinder Zaehler**. Der Load-Wert selbst stimmte.
- **Flake nach dem Welle-1-Merge, ehrlich festgehalten:** der erste Volllauf auf dem gemergten
  master meldete **1 Fehlschlag von 3364**. Die Identitaet des Tests wurde nicht mitgeschnitten
  (Ausgabe lief durch `tail`). Die beiden folgenden Volllaeufe auf demselben Baum waren
  **grün (3364/3364)**. Das entspricht dem dokumentierten, vorbestehenden Spawn-Race unter
  Volllast; nach dem Gate-Protokoll gilt rot nur, wenn es isoliert rot bleibt. Sollte in einer
  spaeteren Welle erneut genau ein Test kippen: **Ausgabe mitschneiden und den Namen
  festhalten**, statt wieder nur die Zusammenfassung zu lesen.
- **Welle 2: AL-P6 (`f16c00a`) und AL-P8 (`61d7563`) gemergt.** Verifikationslauf auf dem
  gemergten master: **3414/3414 gruen**, diesmal mit vollem Mitschnitt (`exit=0`, keine
  `not ok`-Zeile). Kein Merge-Konflikt.
  - AL-P6 legt **keine** neue Env-Variable an (nachgeprueft: kein neues `numEnv`/`boolEnv` in
    `src/config.js`, die `process.env`-Zuweisungen im Diff stehen alle im Test-Setup). Damit
    keine BASE_ENV-Drift.
  - AL-P8 brauchte **eine** Fix-Runde; der zurueckgegebene `finalBranch` hiess deshalb
    `phase/al-p8-bench-fix1` — gemergt wurde dieser, nicht der geplante Branch.
  - Beide AL-P8-Abnahmen **kosten echtes Geld** (Bench-Laeufe gegen die echte Anthropic-API)
    und gehoeren damit dem Owner.
- **Lastregel nachgeschaerft:** Spitze ueber die Kette war Load1 = **21,9** bei 15 Kernen — das
  entstand, als der Lead waehrend laufender Workflows selbst die Suite fuhr. Seither gilt:
  eigene Verifikationslaeufe **nur zwischen den Wellen**, nie parallel zu einem Workflow.

### 2026-07-29 — Welle 3 und die Lastbremse

- **UEBERLAST, gemessen und behoben.** Waehrend AL-P5 und AL-P9 parallel liefen, stieg Load1 auf
  **32,4 bei 15 Kernen** (anhaltend ueber Minuten, Swap zu 94 % belegt). Ursache war **nicht**,
  was der Waechter vermutete: es lagen **null** verwaiste Testserver herum. Der Treiber waren die
  Suiten selbst — **39 node-Prozesse, davon 35 `node --test`**, weil in zwei Workflows jeweils
  Impl- und Safety-Agent gleichzeitig `npm test` fahren und `node --test` intern noch einmal
  auffaechert.
- **Wurzel der Fehlmessung:** der Waechter zaehlte mit `pgrep` (`pgrep -c node` -> 0, waehrend
  `ps -Ao comm | grep -c bin/node` -> 39). In dieser Sandbox sieht `pgrep` keine fremden
  Prozesse. **Lehre: in diesem Repo NIE mit `pgrep` messen, immer mit `ps`.** Der Waechter ist
  umgestellt und zaehlt `node --test` jetzt getrennt aus.
- **Eingriff:** AL-P9 per `TaskStop` angehalten, AL-P5 allein weiterlaufen lassen. Load fiel
  binnen zwei Minuten von 32,4 auf 12,5, danach auf 3,8.
- **Neue Betriebsregel, ersetzt „maximal zwei Workflows":** **eine Bahn zur Zeit.** Die Kette
  laeuft dadurch spuerbar laenger; das ist der Preis dafuer, dass der Arbeitsrechner benutzbar
  bleibt (ausdrueckliche Owner-Weisung).
- **Swap-Alarm wieder entfernt:** macOS holt ausgelagerte Seiten nicht zurueck, der Wert bleibt
  nach einer Spitze dauerhaft niedrig und feuerte im Minutentakt ohne Aussage. Der Wert wird
  weiter protokolliert; entschieden wird ueber Load und freien Speicher.
- **AL-P5 gemergt (`e208bc9`), PASS nach 2 Fix-Runden**, Verifikationslauf **3417/3417 gruen**.
  Regel 2 selbst nachgeprueft: der Offenlegungssatz ist unveraendert, gekuerzt wurde
  ausschliesslich die Anliegen-Zusammenfassung dahinter (`OPENING_GOAL_MAX_CHARS` 160 -> 75).
  Ein neuer Test pinnt, dass die Offenlegung der erste Satz bleibt.
  Die Fix-Runden haben eine **empirisch falsche Begruendung** im Kommentar korrigiert: die
  urspruengliche Kappe 70 haette dem gepinnten Testauftrag das Verb genommen — 75 ist die
  kleinste Kappe, die alle Grenzfaelle traegt.
- **AL-P9 wird neu gestartet, nicht per `resume` fortgesetzt** (Kickoff-Vorgabe „kein resume").
  Nebeneffekt: der Plan-Agent gruendet auf dem aktuellen master statt auf dem Stand vor AL-P5.

- **AL-P9 gemergt (`479721e`), PASS ohne Fix-Runde, 3426/3426 gruen** —
  aber nur, weil die Merge-Pruefung den **falschen** zurueckgegebenen Branch abgefangen hat:

  > **NEUER FALLSTRICK: ein abgebrochener Lauf hinterlaesst seinen Branch, und der naechste
  > Lauf weicht still auf einen anderen Namen aus.**
  >
  > Der per `TaskStop` abgebrochene erste AL-P9-Lauf hatte `phase/al-p9-briefing` bereits
  > angelegt (`4d3e02c`, Basis `11ccd39` = master **vor** AL-P5, halbfertiger
  > „Vorbereitung"-Commit). Im zweiten Lauf schlug `git checkout -b phase/al-p9-briefing
  > master` deshalb fehl; der Impl-Agent wich auf **`phase/al-p9-briefing-impl`** aus
  > (`6249608`, korrekt auf aktuellem master). Der Workflow meldete trotzdem
  > `finalBranch: phase/al-p9-briefing` — den **stale Torso**, weil das Template
  > `finalBranch` aus dem GEPLANTEN Namen ableitet, nicht aus dem, was der Agent wirklich
  > gebaut hat.
  >
  > Ein blinder Merge haette die halbfertige Arbeit des abgebrochenen Laufs auf master
  > gebracht **und die echte Umsetzung verloren** — lautlos, mit gruenem Gate.
  >
  > **Zwei Konsequenzen, ab sofort verbindlich:**
  > 1. `git merge-base --is-ancestor master <finalBranch>` ist **kein Formalismus**. Genau
  >    diese Pruefung hat den Fehler gefangen.
  > 2. **Vor dem Neustart einer abgebrochenen Phase deren Branch loeschen**
  >    (`git branch -D <branch>` + `git worktree remove`), sonst weicht der naechste Lauf
  >    wieder aus. Erledigt: Torso und sein Review-Branch sind entfernt.

- **AL-P9 legt keine neue Env-Variable an** — `.env.example` bekommt nur einen erklaerenden
  Kommentar. Keine Vier-Stellen-Pflicht, keine BASE_ENV-Drift.

- **AL-P10 gemergt**, PASS nach 1 Fix-Runde, Verifikationslauf **3442/3442 gruen**.
  **Spec-Fehler des Leads, hier korrigiert:** Abschnitt 9 dieser Kette schrieb AL-P10 den
  Brave-Adapter samt `BRAVE_SEARCH_API_KEY` zu. Falsch — A3 des Plans trennt sauber:
  **pre-call (AL-P10) = Anthropics serverseitiges `web_search`** im `llm.js`-Seam, ohne Key und
  ohne zweiten Auftragsverarbeiter; **in-call (AL-P10b) = eigener Brave-Adapter**. Der
  Clean-Code-Review hat den in AL-P10 angelegten Brave-Secret-Slot zu Recht als Scope-Drift
  blockiert. Der Spec-Abschnitt ist berichtigt, damit AL-P10b nicht auf der falschen Annahme
  aufsetzt.
  Vier-Stellen-Pflicht fuer die neuen Variablen `RESEARCH_ENABLED` und
  `RESEARCH_SEARCH_FEE_CENTS` vollstaendig erfuellt (`config.js`, `.env.example`, `render.yaml`,
  `BASE_ENV` in `test/helpers.js`) — nachgeprueft, keine Drift.

- **AL-P11 gemergt**, PASS ohne Fix-Runde, Verifikationslauf **3457/3457 gruen**.
  O5 selbst nachgeprueft (nicht dem Gate ueberlassen, weil es um PII-Haltung geht):
  hoechstens **2** woertliche Zitate (`RESULT_EVIDENCE_MAX_ITEMS`, in DE/FR/EN im Prompt UND
  serverseitig durchgesetzt; der Test speist absichtlich 4 ein); **eigene** Frist
  `EVIDENCE_RETENTION_DAYS` statt Umwidmung von `RETENTION_DAYS`/`DIAGNOSTIC_RETENTION_DAYS`;
  **Default 0** — keine laengere PII-Haltung als heute, Freischaltung erst wenn die
  Datenschutzerklaerung Zitate und Frist nennt.

- **AL-P12 gemergt**, PASS ohne Fix-Runde, Verifikationslauf **3475/3475 gruen**.
  Tenant-Isolation selbst nachgeprueft: Gate **vor** dem Scan (`allowCallMemory`, Default
  false), harter `c.tenantId === tenantId`-Vergleich **ohne** tenant-uebergreifenden Zweig,
  und **nur Outbound** — damit kann ein fremder Inbound-Anrufer kein Gedaechtnis fuer eine
  Nummer anlegen, die der Tenant spaeter selbst anruft. Diesen Injektionsweg hat die Phase
  bewusst geschlossen und im Kommentar begruendet.
- **Vor AL-P13 geprueft (Auflage aus Abschnitt 7b):** die Kette `PLAN-AUTH-GATE` ist
  weiterhin **nicht umgesetzt** — es existiert nur der Doku-Commit `a727804`. Die neuen
  Consult-Routen werden also gegen das heute geltende Auth-Modell gebaut.

- **AL-P13 gemergt**, PASS nach 1 Fix-Runde, Verifikationslauf **3525/3525 gruen**.
  **Damit ist Bahn B vollstaendig** (AL-P3, P8, P9, P10, P11, P12, P13).
  Regel 3 selbst nachgeprueft: beide neuen Routen liegen unter `/api/*`, also hinter der
  bestehenden Auth — **keine** neue Ausnahme, zusaetzlich ein Profil-Gate.
  Die Fix-Runde fing einen echten **S1**: `event_id` ging ungeprueft in die Audit-Zeile, ein
  authentifizierter Tenant haette gefaelschte `[audit]`-Zeilen und Log-Spam schreiben koennen.
  Das ist der zweite Fall in dieser Kette, in dem der Review einen echten Defekt fand statt
  Stilfragen (der erste: die empirisch falsche Begruendung in AL-P5).

### 2026-07-29 — Ende des autonom moeglichen Teils

**AL-P2 ist BLOCKIERT — und zwar aus einem Grund, den die Uebergabe nicht vorhergesehen hat.**

Die Uebergabe hielt AL-P2 fuer autonom machbar („der Spike braucht keinen Menschen"). Das
stimmt fuer den *Anruf* — aber nicht fuer den *Messaufbau*:

- Telnyx erreicht unseren Custom-LLM-Shim ueber `base_url = <oeffentliche URL>/v1`
  (`scripts/telnyx-assistant-provision.mjs`, `app.js:140`).
- AL-P2 misst, ob Telnyx **unseren** SSE-Strom inkrementell konsumiert. Dazu muss der
  **Verzoegerungs-Schalter im Shim** dort laufen, wo Telnyx ihn erreicht — also **deployed**.
- **Deployen ist dieser Session ausdruecklich untersagt** (kein Push nach `upstream`, kein
  Deploy ausloesen; der Owner entscheidet, wann etwas live geht).

Die einzige Umgehung waere, die Wegwerf-Connection auf einen **Tunnel zu diesem Rechner**
zeigen zu lassen. Das ist etwas qualitativ anderes als „eine Telnyx-App anlegen": es haengt
einen lokalen Entwicklungsserver mit Live-Zugangsdaten ans oeffentliche Netz. Davon ist in der
Owner-Freigabe nichts gedeckt — **also nicht getan.**

**Der Verzoegerungs-Schalter wurde bewusst NICHT auf Vorrat gebaut.** Ohne die Messung hat er
keinen Wert, und er ist genau die Sorte Schalter, die der Plan selbst als gefaehrlich benennt:
er haelt SSE-Chunks 8-30 s zurueck und kann damit einen Live-Anruf haengen lassen, ohne dass
ein Gate ihn sieht — die Kategorie „neue abgeschaltete Sicherung", die CLAUDE.md verbietet.

**Folge fuer die Kette** (so steht es auch in Abschnitt 4): solange AL-P2 offen ist, endet
Bahn A nach AL-P5. Damit sind **AL-P7, AL-P7b, AL-P10b, AL-P14 und AL-P15** ebenfalls
blockiert — nicht aus Zeitmangel, sondern weil ihr Bauplan von AL-P2s Urteil abhaengt
(AL-P7 wird bei „rot" ersatzlos gestrichen, AL-P7b nimmt Weg A oder Weg B).
Ein Bauen „auf Verdacht" waere geraten statt gewusst.

**Endstand: 11 von 17 Phasen gemergt und gruen, 6 blockiert hinter EINER Owner-Entscheidung.**

**Lastbilanz der Kette:** 458 Messpunkte, Mittel Load1 = **4,4**, Maximum **32,4** (die eine
Ueberlast-Episode), 3 Alarme, **null** verwaiste Testserver ueber die gesamte Laufzeit.
**Zweiter Messfehler im Waechter, ehrlich vermerkt:** macOS kennt `ps -o etimes` nicht — die
Altersprueferung des Einsammlers lief ins Leere und haette nie etwas eingesammelt. Zum Tragen
kam es nie (es blieb nichts liegen), aber die Funktion war **unbewiesen, nicht bewaehrt**.
Wer sie wiederverwendet, rechnet das Alter aus `ps -o etime` (Format `[[dd-]hh:]mm:ss`) oder
aus `lstart`.

### 2026-07-29 — DEPLOY (Owner-Freigabe erteilt)

Der Owner hat den Deploy freigegeben; die Sperre aus dem Kickoff faellt damit.

- **Reihenfolge war entscheidend: erst Migration, dann Deploy.** Vor dem Push wurde gemessen,
  dass dieses Projekt **keinen automatischen Migrationspfad** hat (`applySchema` wird nur von
  Tests gerufen, kein `preDeploy`, kein Migrationslauf beim Start, Free-Tier ohne Jobs) und dass
  **keine** der 6 neuen Spalten in der Prod-DB existierte. Ein Deploy ohne Migration haette
  jeden Anruf brechen lassen. Die 6 `ADD COLUMN IF NOT EXISTS` hat der Owner selbst gefahren
  (Schreibzugriff auf die Prod-DB ist fuer die Session gesperrt) — Gegenprobe: 6 Zeilen.
- **Zwischenfall: Prod-DB unerreichbar.** `psql` meldete „SSL connection has been closed
  unexpectedly". **Ursache war NICHT TLS, sondern die IP-Allowlist der Datenbank** — der
  Anschluss des Owners hatte durch die naechtliche Zwangstrennung eine neue IP. Beweis, dass es
  die Firewall war und nicht die DB: der Live-Dienst antwortete waehrenddessen normal (HTTP 200
  auf `/healthz`), weil Render-Dienste **intern** verbinden und die Allowlist umgehen.
  Kein Ausweichweg: `mcp__render__query_render_postgres` ist weiterhin SSL-kaputt
  (`FATAL: SSL/TLS required`) und ohnehin read-only.
- **Push** nach `upstream` (50 Commits, reines Vorspulen) — loeste **keinen** Deploy aus, weil
  der Dienst gemessen auf `autoDeploy: no` / `autoDeployTrigger: off` steht.
- **Deploy manuell ausgeloest** (`dep-d9kqqa61egvs7385g90g`), Status `live` nach 56 s.
  Verifiziert am tatsaechlich laufenden Commit, nicht am Deploy-Status:
  `/healthz` -> `85ba107`, Boot-Banner -> `[boot] deployed commit=85ba107`.
- **Zwei offene Punkte mit dem Deploy geschlossen:**
  1. **AL-P1-Abnahme 1 erledigt.** Das Banner zeigt jetzt beide Schalter:
     `Voice-Engine: budget` und `Assistant-Pfad: AKTIV (TELNYX_AI_ASSISTANT_ENABLED=true)`.
     Das ist die dauerhafte Sonde, die AL-P1 gebaut hat — sie funktioniert live.
  2. **O6 beantwortet.** Ist-Werte aus dem Banner: Worst-Case-Tarif **300 ct/min**,
     Tenant-Default **1500 ct**, Plattform **3000 ct**, Budget-Achse auf Spend-Monat.
     Offen bleibt nur die Owner-Frage, ob 300 ct/min gewollt ist.
- **Boot-Warnungen (alle vorbestehend, nicht durch diesen Deploy verursacht):**
  Deckungsquote 24 % unter `COST_TRUING_MIN_COVERAGE_PERCENT=80`; Tarif-Drift mit 0 Stichproben
  fuer +49/+33/+44; `FORCE_NUMBER_COUNTRY=US`. Keine Fehler, kein fataler Boot-Guard.

- **AL-P2, Teil 1 (Code) fertig:** Branch `phase/al-p2-sse-spike`, Gate PASS ohne Fix-Runde,
  3545 Tests gruen. **BEWUSST NICHT nach master gemergt** — der Branch traegt den befristeten
  Verzoegerungs-Schalter, und der gehoert laut Plan nach der Messung ersatzlos entfernt.
  Die Umsetzung ist fail-closed konstruiert und damit sicherer als der Plan verlangte:
  `sseSpikeDelayMsFor` liefert 0, solange nicht **Verzoegerung UND Zielnummer** gesetzt sind
  **und** `call.to === callee`; eine Verzoegerung ohne Zielnummer ist ein **Boot-Refusal**
  (`productionFootguns`). Dazu Boot-Banner-Zeile und `sse_spike_delay`-Logzeile bei jeder
  Anwendung. Die vier Notaus-Pfade (Rate-Gate, Budget-Kill, Loop-Guard, Degradations-Catch)
  uebergeben ausdruecklich keine Pause.
- **Owner-Entscheidung 2026-07-29:** der Spike laeuft auf einem **eigenen Wegwerf-Dienst** auf
  Render, nicht auf dem Live-Dienst und nicht ueber einen Tunnel. Der Live-Dienst bekommt den
  Schalter nie zu sehen.
- **Offen: Freigabe zum Umhaengen der zwei ungenutzten DIDs.** Ohne sie kann der Spike nicht
  fahren. Die Frage „kann ich meine eigene Nummer nehmen?" wurde beantwortet: das wuerde den
  Spike **nicht-autonom** machen (der Owner muesste bei jedem Durchgang abnehmen und schweigen)
  und ein bekanntes Risiko einbauen (US-DID -> DE-Mobil ist sporadisch nicht zustellbar; ein
  Fehlschlag saehe aus wie ein rotes SSE-Ergebnis, waere aber ein Routing-Problem).

### 2026-07-29 — Spike-Umgebung aufgebaut (AL-P2b)

- **AL-P2b war BLOCKED** und wurde in einem gezielten Nachlauf geloest. Der Befund war ein
  **Vakuumtest**: AL-P2b-4 schickte seine Anfrage von `127.0.0.1` ohne `X-Forwarded-For`, und
  das Auth-Gate laesst lokale Aufrufer ohnehin durch — der Test konnte seinen eigenen
  Fehlerfall nicht erzeugen. `PLAN-SECURITY.md` berief sich aber auf ihn als Nachweis einer
  Sicherung. Behoben auf `phase/al-p2b-spike-betrieb-fix3` (`6a879f8`).
  **Mit Mutationsproben bewiesen** (nicht behauptet): unter „`/voice`-Ausnahme entfernt" wird
  der Test jetzt ROT, waehrend die vorherige Fassung desselben Tests unter derselben Mutation
  GRUEN blieb. Drei weitere Mutationen (Mount-Reihenfolge, Gate global aus, Vertrauensgrenze
  aufgeweicht) zeigen, dass er mehrere unabhaengige Todesarten hat. 3583/3583 gruen.
  Offen und notiert, aber kein Blocker: die Doku ordnet AL-P2b-4 der Mount-Reihenfolge zu —
  die pinnt in Wahrheit AL-P2b-3.
- **Wegwerf-Dienst angelegt:** `hermes-spike-al-p2` (`srv-d9kt9bm1egvs738asd0g`),
  `https://hermes-spike-al-p2.onrender.com`, Branch `phase/al-p2b-spike-betrieb-fix3`,
  Free-Tier, Frankfurt, **autoDeploy aus**. Bewusst mit **`STORE_BACKEND=json`** — dadurch
  autark, ohne jeden Zugriff auf die Produktionsdatenbank.
- **Wegwerf-TeXML-Anwendung angelegt:** `AL-P2 Spike Silence (WEGWERF)`
  (`3014656686179747728`) -> `https://hermes-spike-al-p2.onrender.com/voice/spike-silence`.
- **Vorher-Zustand gesichert:** alle drei DIDs haengen an der TeXML-App `Hermes`
  (`2982643896460248193`). Rohdaten im Scratchpad (`telnyx-numbers-before.json`).
- **BLOCKIERT: 4 Werte muss der Owner im Dashboard des Wegwerf-Dienstes setzen.**
  Regel 4 verbietet, Secrets durch Werkzeugaufrufe und Protokolle zu schleusen — deshalb
  konnte die Session sie nicht selbst setzen.

### 2026-07-29 — AL-P2 Messversuch OHNE Ergebnis, Umgebung vollstaendig zurueckgebaut

- **Owner-Entscheidung revidiert:** der Wegwerf-Dienst scheiterte am Boot-Guard
  (`STORE_BACKEND` != `pg` ist im Hosting fatal — json-Store auf fluechtigem Dateisystem).
  Eine zweite vollstaendige Hermes-Installation samt eigener Postgres waere fuer eine
  einstuendige Messung unverhaeltnismaessig gewesen. Der Owner waehlte deshalb den
  Live-Dienst mit dem auf EINE Nummer begrenzten Schalter.
- **Spike-Umgebung war kurzzeitig live** (`fab4eff`): Schalter + Schweige-Route, Zielnummer
  `+15739090177` (stillgelegt), Verzoegerung 8000 ms.
- **Messung fehlgeschlagen — kein Urteil.** Anruf `call_ms6165ncegeb`
  (`+18643028341` -> `+15739090177`, ueber die regulaere `POST /api/calls`, alle Gates liefen)
  wurde **nie angenommen**: `answered_at` NULL, `telnyx_conversation_id` NULL, nach 31 s
  beendet. Die Schweige-Route hat also nicht abgenommen. Hypothesen (keine verifiziert) stehen
  in `tasks/al-handover-2026-07-29.md` §4.
- **VOLLSTAENDIG ZURUECKGEBAUT, jeweils verifiziert statt behauptet:**
  - alle drei DIDs wieder auf der TeXML-App `Hermes` (`2982643896460248193`) — per direkter
    Telnyx-Abfrage geprueft, nicht aus dem Skript-Rueckgabewert geschlossen;
  - Merge `fab4eff` revertiert (`6fb0030`), `grep` auf `sseSpikeDelayMsFor`/`SPIKE_SILENCE_PATH`
    in `src/` ist leer, 3525 Tests gruen;
  - `TELNYX_SSE_SPIKE_DELAY_MS=0`, `TELNYX_SSE_SPIKE_CALLEE=""` im Live-Dienst;
  - Live-Commit ist `6fb0030` (an `/healthz` geprueft).
- **Reste, die noch aufgeraeumt werden koennen:** Render-Dienst `hermes-spike-al-p2`
  (`srv-d9kt9bm1egvs738asd0g`, bootet nicht) und die Telnyx-TeXML-App
  `AL-P2 Spike Silence (WEGWERF)` (`3014656686179747728`). Beide kostenlos und ungefaehrlich,
  aber ueberfluessig, sobald der Spike anders geloest wird.
- **Uebergabe geschrieben:** `tasks/al-handover-2026-07-29.md`.

### 2026-07-31 — Wiederaufnahme nach der KS-Kette

Zwischen dem 29.07. und heute lief die **KS-Kette** (Kosten-Steuerung, `PLAN-KOSTEN-STEUERUNG.md`)
und ist seit `d6167bf` live. Sie hat zwei der drei Punkte erledigt, die die Uebergabe der
AL-Kette voranstellte:

1. **Der vermutete Budget-Gate-Defekt ist behandelt** (KS-P4: Ablehnungstexte und Reserve lesen
   dieselbe Achse wie das Gate; KS-P2/P3/P5a am selben Pfad).
2. **Der Spike-Schalter war ersatzlos aus master** (KS-AUF, `643f8dc`).

**Richtigstellung, die diese Session gemessen hat:** `tasks/ks-chain-spec.md` behauptet im
Abschnitt KS-AUF „Der AL-P2-Spike ist gemessen und abgeschlossen". **Das stimmt nicht.** Es gibt
kein Urteil — weder `incremental` noch `buffered`; der Messversuch vom 29.07. scheiterte daran,
dass die Schweige-Route den Anruf nie annahm. Belegt an: kein Verdikt in irgendeinem Report, kein
Commit zwischen dem 29.07. und heute, der eine Messung dokumentiert, und
`tasks/al-testcall-checklist.md` fuehrt AL-P2 weiterhin als **BLOCKER Nr. 1**.
Wer das uebernommen haette, haette AL-P7 (5-9 Tage) auf einer erfundenen Tatsache gebaut.

- **Ausgangslage gemessen statt angenommen:** live `/healthz` = `d6167bf`, lokal `master`
  = `64f89dc` (zwei reine Doku-Commits darauf) — Code-Stand identisch. Baseline `npm test`
  **3611/3611 gruen**, `not ok` = 0.
- **Abhaengigkeiten am Plan nachgeprueft, nicht aus der Uebergabe uebernommen:** AL-P7, P7b und
  P10b haengen hart an AL-P2; P15 haengt an P14 plus einer Live-Messung. **AL-P14 haengt NICHT an
  AL-P2** — der Plan nennt als Vorbedingungen Phase 13, 6 und 4, alle drei gemergt und live. Die
  Uebergabe fuehrte P14 pauschal als „blockiert"; das war zu grob. Einzige echte Beruehrung: der
  Plan will `consultTimeoutMs` „deutlich unter dem in Phase 2 gemessenen Telnyx-Timeout" — diese
  Zahl existiert nicht, also wird konservativ gegen den (fuer den Shim-Pfad unbestaetigten)
  `PROVIDER_WEBHOOK_HARDCUT_MS = 15000` hergeleitet und als unbestaetigt gekennzeichnet.
- **Owner-Entscheidungen 2026-07-31:**
  1. **AL-P2 wird live gemessen, der Owner geht selbst ans Telefon** (kein Wegwerf-Dienst — der
     scheiterte am Boot-Guard; kein Tunnel; keine Schweige-Route — die scheiterte bereits).
  2. **AL-P14: die Consult-Frage ist eine Paraphrase, keine woertlichen Zitate des Angerufenen**,
     serverseitig laengenbegrenzt und durchgesetzt, als Test gepinnt. Damit ist die
     Datenschutz-Grenze beantwortet, die AL-P13 ausdruecklich **vor** dieser Phase verlangt hat.
- **Neue bindende Regel 12 in der Kette: der Plan ist AELTER als der Code.** Die KS-Kette hat
  `src/telnyx-llm-shim.js` (Live-Budget-Term KS-P2, Re-Attach-Pfad KS-P1b), den Tarif-Fallback
  (300 -> 30 ct/min), `MAX_CALL_DURATION_S` (wird nicht mehr gelesen), die Plattform-Achse (seit
  KS-P9 keine Sperre) und die Ablehnungstexte umgebaut. Jede Plan-Zahl wird am echten Code
  nachgeprueft; bei Widerspruch gilt der Code. Ausserdem Regel 0 auf die korrigierte KS-Fassung
  gebracht („Basis herstellen, DANN lesen") — die alte Formulierung hat in der KS-Kette eine
  Fix-Runde an einem Nicht-Befund verbrannt.
- **AL-P2s gemergt (`4305c15`), PASS ohne Fix-Runde**, Verifikationslauf auf dem gemergten master
  **3631/3631 gruen**. Der Impl-Agent hat die 12 konfliktfreien Dateien der Vorlage `af4a66e`
  mechanisch restauriert und die 3 driftenden Dateien (Shim, Shim-Harness, Checkliste) von Hand
  nachgezogen — genau die Trennung, die KS-AUF vorhergesagt hatte.
  **Der Schalter ist erneut befristet:** AL-P2z entfernt ihn ersatzlos, sobald ein Urteil
  vorliegt. Umfangsvorlage dafuer ist der Abschnitt KS-AUF in `tasks/ks-chain-spec.md`.

### 2026-07-31 — AL-P2 GEMESSEN: `incremental` (GRUEN)

**Der Blocker, an dem seit dem 29.07. sechs Phasen hingen, ist aufgeloest.** Der Owner hat Push,
Deploy, Env-Werte und den Anruf ausdruecklich freigegeben und ist selbst ans Telefon gegangen.

| | |
|---|---|
| Deploy | `dep-d9m7krbl550s73dciogg`, live nach 52 s, `/healthz` -> `3bc5f43` |
| Scharfschalten | `TELNYX_SSE_SPIKE_DELAY_MS=8000` + `TELNYX_SSE_SPIKE_CALLEE` (Owner-Mobil) |
| Banner | `SSE-Spike: AKTIV (8000 ms, nur fuer die konfigurierte Wegwerf-Nummer)` |
| Pfad verifiziert | `Voice-Engine: budget` + `Assistant-Pfad: AKTIV` — die Messung lief durch den Shim |
| Anruf | `call_ms8t87whrxqo`, Conversation `12d1d46e-0af4-4b00-936c-965722bb4127` |

**Urteil, doppelt belegt (wie der Plan es verlangt):**

1. **Messwert:** `node scripts/telnyx-call-latency.mjs 12d1d46e-… --spike-delay-ms 8000` ->
   `status=incremental`, `audio_first_token_duration_ms`-Median **129 ms** ueber 3 Turns,
   waehrend der Shim jeden Chunk nach dem ersten **8000 ms** zurueckhielt. Bei Pufferung bis
   `data:[DONE]` muesste dieser Wert >= 8000 ms sein.
2. **Gehoer des Owners:** er meldete dem Agenten woertlich, dieser „bricht mitten im Satz einfach
   ab, obwohl ich nichts sage" — die inkrementelle Signatur (erster Chunk sofort, 8-s-Loch, dann
   der Rest). Bei Pufferung waere es 8 s Stille und danach ein zusammenhaengender Satz gewesen.

**Folgen fuer die Kette:**
- **AL-P7 (echtes Token-Streaming) ist gerechtfertigt** — nicht mehr gestrichen.
- **AL-P7b nimmt Weg A** (Ueberbrueckungssatz als fuehrender Text im selben Antwort-Block, kein
  Extra-Roundtrip). Weg B samt out-of-band-Sprechkanal und dessen drei Riegeln **entfaellt**.
- **AL-P10b** ist damit ebenfalls entsperrt (haengt an AL-P7b).
- **AL-P15** schrumpft: Experiment B war nur noetig, falls AL-P2 rot ausfaellt.

**Nebenbefund, nicht gesucht:** dieselbe Ausgabe liefert `unaccounted-median = 0 ms`,
`status=ok`. Das ist die offene **AL-P1-Abnahme 1** — und `status=unknown_component` haette
AL-P7 blockiert. Ebenfalls erledigt.

**Live-Beleg fuer die KS-Kette nebenbei:** der Anruf lief ueber die regulaere `place_call`-Kette
mit allen Gates und wurde **nicht** vom Budget-Gate abgelehnt. Der in der Uebergabe vermutete
Live-Defekt („lehnt Anrufe ab, die rechnerisch hineinpassen") ist damit am lebenden System
widerlegt.

### 2026-07-31 — Telnyx-Turn-Timeout: **groesser als 30 s**

Zweite Haelfte der AL-P2-Messung, mit der **obersten** Sprosse zuerst statt der geplanten Leiter
5/10/20/30 s — bricht der Turn dort nicht ab, sind die drei niedrigeren Sprossen ohne Aussage.

| | |
|---|---|
| Anruf | `call_ms8tfa3a1b2b`, Conversation `19b2c73f-aa24-4a16-b163-2008d9db49da` |
| Verzoegerung | 30 000 ms je Turn (`sse_spike_delay` im Log belegt) |
| Ergebnis | `audio_first_token_duration_ms` = **99 ms**, `status=incremental`, Turn **nicht** abgebrochen |
| Gegenprobe | 4 Agent-Aeusserungen ueber 120 s Anrufdauer, jede mit 30-s-Halt |

**Der Turn ueberlebt 30 s.** Der Telnyx-Turn-Timeout liegt damit **oberhalb** des im Plan
vorgesehenen Messbereichs. Fuer AL-P14 heisst das: die bindende Grenze fuer `consultTimeoutMs`
ist **nicht** Telnyx, sondern unser eigener `PROVIDER_WEBHOOK_HARDCUT_MS = 15000`
(`src/turn-budget.js`) — und der ist eine bewusste eigene Sicherung, kein geratener Fremdwert.

**Ein Fehlversuch dazwischen, ehrlich vermerkt:** `call_ms8tdt8shwxs` wurde **nicht angenommen**
(`call.initiated` -> nach 31 s `call.hangup`, kein `call.answered`, keine Conversation). Das ist
dieselbe 31-s-Signatur wie beim gescheiterten Versuch am 29.07. — dort war sie als ungeklaertes
Raetsel notiert. **Sie ist schlicht das Klingel-Timeout eines nicht angenommenen Anrufs**, kein
Defekt. Der Wiederholungsanruf 40 s spaeter kam normal durch.

**Abgeruestet, unmittelbar nach der Messung:** `TELNYX_SSE_SPIKE_DELAY_MS=0`,
`TELNYX_SSE_SPIKE_CALLEE=""` (Protokoll in `tasks/al-env-changes.md`). Der Schalter ist damit
inert; **ersatzlos aus dem Code entfernt ihn AL-P2z** — das ist die Zusage der Phase, nicht
„Flag auf 0". **Eingeloest:** `96d2526`, 718 Zeilen entfernt, `git grep` auf
`sseSpike`/`SSE_SPIKE` in `src/`, `scripts/`, `test/`, `.env.example`, `render.yaml` ist leer.

### 2026-08-01 — AL-P10b nach BLOCKED gemergt; Kette bis auf AL-P15 gebaut

- **AL-P7 (`591e21f`), AL-P7b (`7db1393`), AL-P14 (`5903f90`), AL-P2s/AL-P2z** stehen. Mit
  **AL-P10b (`b33216f`)** ist die Kette **16 von 17** — offen ist nur noch AL-P15, und die ist
  eine Messphase, die AL-P14 erst in der Praxis braucht.
- **AL-P10b lief zunaechst BLOCKED aus** (2 Fix-Runden verbraucht, ein Befund blieb). Der Befund
  war echt und **gemessen statt vermutet**: der Realtime-Pfad bekam die GRENZEN-Prompt-Zeile
  „kann nachschlagen", waehrend `realtimeTools = toolDefs` das Werkzeug nach Entscheidung E1
  bewusst nie traegt — Faehigkeits-Unehrlichkeit in geteiltem Code, live nicht ausloesbar
  (`VOICE_ENGINE=budget`, Flag aus), aber neu eingefuehrt. Behoben im Nachlauf **AL-P10b-fix**
  auf `phase/al-p10b-lookup-fix3` (Basis: der Branch, NICHT master), Gate PASS ohne Fix-Runde.
- **Der erste Anlauf dieses Nachlaufs lief vollstaendig ins Leere:** alle sechs Agenten
  scheiterten am Wochenlimit der API (`resets 3am`), 0 Tokens, 0 Werkzeugaufrufe, 0 Dateien.
  **Wichtig fuer die naechste Session:** ein solcher Lauf hinterlaesst **keinen** Branch — der
  Neustart war deshalb gefahrlos. Waere der Torso entstanden, waere der zweite Lauf still auf
  `…-fix3-impl` ausgewichen und haette trotzdem den geplanten Namen gemeldet.
- **Merge-Konflikt in dieser Spec-Datei** (beide Seiten haben Abschnitte angehaengt) — beide
  Saetze behalten. Dabei eine **ueberholte Aussage korrigiert**: der `callerName`-Filter aus E8
  ist ersatzlos gestrichen; das Feld ist seit der G1-Identitaets-Bindung hart `null`, und der
  Test, der den Filter gruen zeigte, setzte den Wert selbst. Ein Filter gegen eine Konstante
  `null` ist vorgetaeuschter Schutz.
- **Suite-Protokoll, ehrlich:** der erste Lauf auf dem gemergten Baum meldete **2 Fehlschlaege
  von 3715**, und ich habe **nur die Zusammenfassung gegriffen — die Namen sind verloren**.
  Genau der Fehler, den diese Datei nach Welle 1 schon einmal notiert hat. **Zwei** folgende
  Volllaeufe auf demselben Baum, beide mit vollem Mitschnitt: **3715/3715, exit 0, keine
  `not ok`-Zeile**. Nach dem Gate-Protokoll (rot zaehlt nur, wenn es isoliert rot bleibt) gilt
  das als der dokumentierte Volllast-Flake — **belegt ist es damit aber nicht, nur
  wahrscheinlich.** Wer das naechste Mal einen roten Lauf sieht: Ausgabe in eine Datei, dann
  `grep "^not ok"` — die Zusammenfassung allein reicht nicht.

### 2026-07-31 — Owner-Gegenprobe am Telefon: KEINE Verschlechterung

Der Owner meldete nach den Messanrufen zwei Defekte: falsch gesprochene Umlaute und ein
Abbrechen mitten im Satz. **Beide Meldungen waren berechtigt, keiner war ein Regress.**

1. **Das Abbrechen war das Messgeraet selbst** — der Schalter hielt jeden Chunk nach dem ersten
   8 bzw. 30 s zurueck. Genau diese Wahrnehmung ist der zweite Beleg fuer `incremental`.
2. **Die falschen Umlaute kamen aus dem uebergebenen Auftragstext, nicht aus dem System.** Der
   `objective` von `place_call` wird dem Angerufenen **woertlich vorgelesen**; er war in der
   Kommentar-Konvention des Repos geschrieben („moechte pruefen … ohne Verzoegerung … hoer
   einfach zu"). `src/i18n/locales.js:9` schreibt fuer **gesprochene** Strings ausdruecklich
   korrekte Umlaute vor, `shapeForSpeech` fasst sie nicht an. **Lehre: die ASCII-Konvention gilt
   fuer Quelltext, nicht fuer Nutzdaten, die gesprochen werden.**
3. **Gegenprobe gefahren** (`call_ms8u3j5xivkz`, 72 s, Auftrag in korrektem Deutsch, Schalter
   aus): der Owner testete gezielt mit dem Wort „Tuete" und urteilte **„schon besser, ist gut"**;
   Gesamteindruck „auf dem gleichen Stand wie vorher". Damit ist die Regressionsfrage beantwortet.

**Zwei echte Befunde aus derselben Gegenprobe, beide NICHT von dieser Kette verursacht:**
- **STT-Kauderwelsch (R2)** trat erneut auf: eine Aeusserung des Owners kam zweimal identisch
  falsch transkribiert an, der Agent fragte daraufhin am Thema vorbei.
- **Der Einsatz der Eroeffnung klingt abgehackt.** Sie laeuft ueber vorab synthetisiertes
  ElevenLabs-Audio (`opening_voice=elevenlabs`), also einen anderen Weg als das restliche
  Gespraech. Braucht eine Aufnahme, keine Vermutung.
- **Der Owner fragte im Gespraech nach einer Web-Recherche** („welche Filme laufen im Kino") und
  bekam „ich habe keinen Internetzugriff". Das ist exakt **AL-P10b**. Zur Einordnung: die bereits
  gebaute Recherche (AL-P10) laeuft **vor** dem Waehlen und haette die Frage auch eingeschaltet
  nicht beantwortet.

**Drei Fehl-/Teilanrufe, damit die Statistik ehrlich bleibt:** von 5 Waehlversuchen erreichten 3
den Owner. Einer klingelte 31 s ohne Annahme; einer wurde nach exakt 30 s **vom Netz** angenommen
(Mailbox/Ansage — der Owner bestaetigte, dass es bei ihm nicht geklingelt hat), woraufhin der
Agent 7 s ins Leere sprach. **Lehre fuer den Lead: `call.answered` ist ein Protokoll-Ereignis,
kein Mensch.** Diese Session hat daraus einmal faelschlich „der Owner hat abgenommen und
aufgelegt" gefolgert. Belegen laesst sich die Mailbox-These derzeit nicht — die Telnyx-
`detail_records` sind fuer diese Anrufe noch leer. Passend zum bekannten Befund
**US-DID -> DE-Mobil ist intermittent**.
