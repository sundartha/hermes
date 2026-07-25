# Prompt fuer die Umsetzungs-Session — PLAN-I18N-FIX in 9 Wellen

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen.

---

Du setzt `PLAN-I18N-FIX.md` um — 14 Phasen, 53 Katalog-IDs. Du bist **Lead und Merger, nicht
Implementierer**. Du liest in dieser Session **keinen Produktionscode und keinen Diff im
Volltext**. Deine Arbeit: Wellen schneiden, Workflows starten, Rueckgaben pruefen, mergen,
Suite fahren, berichten. Alles andere machen Subagenten.

## 0. Ausgangslage selbst pruefen (nicht glauben)

```
git log --oneline -3        # master sollte auf 81c5795 stehen, Arbeitsbaum sauber
git status --short
npm test                    # MUSS gruen sein (2940/2940/0)
npm run test:gates          # 114 Tests, 85 rot — das ist der Arbeitsvorrat
```

In diesem Repo sind schon Sessions auf einem angenommenen Stand losgelaufen und haben leere
Branches gemergt. Wenn `npm test` rot ist: **stoppen und mich fragen**, nicht weiterbauen.

Lies dann, in dieser Reihenfolge, **nur diese vier Abschnitte** (nicht das ganze Dokument):

- `PLAN-I18N-FIX.md` **Abschnitt 2a** — zwei gefallene Praemissen, die den Plan an der Wurzel
  aendern. Ohne die verstehst du den Rest falsch.
- `PLAN-I18N-FIX.md` **Abschnitt 3** — alle 15 Owner-Entscheidungen, bindend.
- `PLAN-I18N-FIX.md` **Abschnitt 6** — Uebersichtstabelle 53 IDs -> Phase.
- `PLAN-I18N-FIX.md` **Abschnitt 7** — was ausdruecklich NICHT Teil ist (getragene Risiken).

Die Phasenabschnitte selbst (Abschnitt 5) liest **der Plan-Agent jeder Phase**, nicht du.

---

## 1. Schritt 0 vor allem anderen: `phase-impl-lean.js` reparieren

`.claude/workflows/phase-impl-lean.js` ist das erprobte Phasen-Workflow dieses Repos
(Plan -> Impl im Worktree -> dualer Review -> Self-Fix bis PASS -> Postage-Stamp-Return).
**Es hat aber einen Defekt: null `model:`- und null `effort:`-Pins an den `agent()`-Aufrufen.**
Jeder Subagent erbt damit das Session-Modell — bei einer Fable-Session ist das ein
Vielfaches der noetigen Kosten, und es ist die Ursache eines Teils der bisherigen Probleme.

**Dein erster Arbeitsschritt:** die sechs `agent()`-Aufrufe in dieser Datei um `model` und
`effort` ergaenzen. Das ist eine reine Infrastruktur-Aenderung, kein Produktionscode, und sie
gilt fuer alle 14 Phasen. Danach `node --check .claude/workflows/phase-impl-lean.js` und ein
Commit — bevor die erste Phase startet.

### Modell-Politik (das ist die Antwort auf "wann Sonnet, wann Opus")

| Agent | Modell | effort | Warum genau so |
| --- | --- | --- | --- |
| `-plan` | **opus** | `high` | Der Plan-Agent groundet die Mechanik am echten Code und legt fest, WAS gebaut wird. Ein schwacher Plan pflanzt den Fehler in Impl, Review und Fix gleichzeitig — das ist die teuerste Stelle zum Sparen. |
| `-implement` | **sonnet** | `medium` | Der Plan traegt die Umsetzung. Sonnet schreibt hier Code gegen eine fertige Spezifikation, das ist Ausfuehrung, keine Erfindung. |
| `-review-safety` | **opus** | `high` | Das adversariale Gate am Geld- und Anruf-Pfad. Hier wird bewusst nicht gespart: dieser Agent hat in der Vorsession den `DEFAULT_LANGUAGE`-Flip **gemessen statt geglaubt** und drei S1 gefunden, die drei Opus-Plan-Entwuerfe uebersehen hatten. |
| `-review-cleancode` | **sonnet** | `medium` | Regelanwendung gegen einen geschriebenen Katalog (`clean-code.md`), keine offene Urteilsbildung. Sonnet reicht — aber nur, weil der Katalog praezise ist. |
| `-fix` | **sonnet** | `medium` | Die Befunde stehen schon da. Der Fix-Agent setzt um, er entscheidet nicht. |
| `-report` | **sonnet** | `low` | Reines Zusammenschreiben in eine Datei, die niemand als Entscheidungsgrundlage liest. |

**Drei Phasen brechen diese Regel — dort ist `-implement` ebenfalls `opus`, `effort: high`,
und `-review-safety` laeuft auf `xhigh`:**

- **P5** (Herkunfts-Achse der Tarifierung): aendert die Signatur von `tariffCentsPerMin` und
  damit JEDEN Aufrufer. Ein uebersehener Aufrufer ist kein haesslicher Code, sondern eine
  falsche Geldrechnung.
- **P6** (Budget-Fenster + Stundenlimit): baut die Budget-Achse und das Stundenlimit um. Ein
  Fehler hier macht ein Safety-Gate blind, und ein blindes Gate sieht aus wie ein Gate, das
  nicht ausloesen muss.
- **P7** (Boot-Kohaerenz): setzt einen `fatal:true`-Boot-Abbruch. Ein Fehler hier hindert den
  **Live-Dienst am Neustart**.

Alles andere laeuft auf dem Standard oben. Ueberschreib die Politik nicht "zur Sicherheit" nach
oben — die Sorgfalt liegt im Safety-Review, nicht im Modell des Report-Agenten.

---

## 2. Der Wellenplan — 14 Phasen in 9 Wellen

Parallel laufen darf nur, was **disjunkte Dateien** anfasst. Worktree-Branches, die dieselbe
Datei aendern, erzeugen beim Merge Konflikte, die du dann im Lead aufloesen muesstest — und
genau das soll dieser Aufbau vermeiden.

| Welle | Phasen | parallel? | Warum diese Gruppierung |
| --- | --- | --- | --- |
| **0** | P1 | allein | Sicht zuerst: `/healthz`-Fingerabdruck + `configHash`. Ohne die ist **keine** spaetere Phase am Live-Dienst nachweisbar. |
| **1** | P2, P3, P4 | **3 parallel** | Telefonie-Gates (`outbound-gates.js`) · Greeting/Offenlegung (`self-service.js`, `defaults.js`, `voice.js`) · Billing (`src/billing/`). Disjunkt. |
| **2** | P5, P9 | **2 parallel** | Tarif-Achse (`outbound-gates.js` + `metering.js`) · Web-Textoberflaechen (`public/`, `web-auth.js`). P5 muss NACH P2, weil beide `outbound-gates.js` anfassen. |
| **3** | P6 | allein | Beruehrt `state-ops.js` UND `outbound-gates.js` UND `boot-guard.js` — kollidiert mit P2, P5 und spaeter P10. |
| **4** | P7 | allein | Braucht P5 (Reserve aus echtem Tarif) und P6 (Achsen). Beruehrt `config.js` + `render.yaml`. |
| **5** | P8 | allein | Schema-Migration (Zeitzonen-Feld) + Onboarding + Login-Pfad. Eine Migration laeuft nie parallel zu etwas anderem. |
| **6** | P10 | allein | Der Weltdefault-Flip. Braucht P8 und P9 live. Beruehrt `locales.js` + die Schreibpfade in `state-ops.js`. |
| **7** | P11, P12 | **2 parallel** | Gesprochene Sprache (`claude.js`, `voice.js`, Notifications) · MCP-Textkanal (`mcp-tools.js`). Disjunkt. |
| **8** | P13, P14 | **2 parallel** | Widget · Rechtstexte (`apps/web`). P13 muss NACH P12, weil MCP-09 ebenfalls `mcp-tools.js` anfasst. |

**Dieser Plan ist ein Vorschlag mit Begruendung, kein Gesetz.** Vor jeder Welle pruefst du die
Kollisionsannahme selbst: lies im Plan die `beruehrt`-Angaben der Phasen dieser Welle (bzw. in
`tasks/i18n-tests/16-befund-klassifikation.md`, Detailtabellen) und ueberzeug dich, dass die
Dateimengen wirklich disjunkt sind. Sind sie es nicht, **fahr die Phase seriell** statt zu
hoffen. Eine serielle Phase kostet Zeit, ein Merge-Konflikt im Lead kostet deine Kontext-Diaet.

### Bekannte Kollisionsachsen (nicht raten, das ist geprueft)

- `src/telephony/outbound-gates.js` — P2, P5, P6
- `src/store/state-ops.js` — P6, P10
- `src/mcp-tools.js` — P12, P13
- `render.yaml` — P1, P7
- Greeting-Pfad (`self-service.js` / `defaults.js`) — P3, P11

### Zwei Phasen haben eine offene Vorbedingung

- **P3** braucht den **Wortlaut des Inbound-Pflichthinweises je Sprache** (O7). Der ist noch
  nicht vorgegeben. **Handlung am Anfang der Session:** lass einen einzelnen Agenten drei
  Vorschlaege (de/en/fr) erarbeiten und **leg sie mir vor, bevor Welle 1 startet**. WEB-04 ist
  auch ohne den Wortlaut umsetzbar; haengt die Freigabe, baust du in P3 nur WEB-04 und ziehst
  GAP-14 in eine spaetere Welle.
- **P7** braucht den Live-Wert von **`VOICE_TARIFF_DEFAULT_CENTS`** aus dem Render-Dashboard.
  **Frag mich danach, sobald Welle 3 laeuft** — dann ist die Antwort da, bevor Welle 4 startet.
  Ohne den Wert misst `test/prod-env.js` GAP-33 weiter gegen den Blueprint-Wert `300`, und der
  402-Befund koennte ein reines Blueprint-Artefakt sein (Praemisse P-B).

---

## 3. Aufruf des Workflows (technisch exakt — hier lagen die Fehler)

Pro Phase **ein** Workflow-Aufruf. Nie zwei Phasen in einem Skript.

```
Workflow({
  scriptPath: ".claude/workflows/phase-impl-lean.js",
  args: {
    phaseId: "P2",
    phaseTitle: "Wahl-Sicherheit und Anruf-Mechanik",
    branch: "phase/i18n-p2-wahl-sicherheit",
    baseBranch: "master",
    planDoc: "PLAN-I18N-FIX.md",
    specFile: "PLAN-I18N-FIX.md",
    maxFixRounds: 2
  }
})
```

Fuer parallele Wellen: **mehrere `Workflow`-Aufrufe in EINER Nachricht** — dann laufen sie
nebeneinander. Nacheinander gesendete Aufrufe laufen auch nebeneinander, aber du wartest dann
unnoetig.

### Die konkreten Fallen, an denen es bisher gescheitert ist

1. **`args` fail-closed.** Ohne `args.phaseId` wirft das Skript sofort. Das ist Absicht (es hat
   frueher versehentlich eine schon gemergte Phase nachgebaut). **`phaseId` immer setzen**, und
   zwar hart im Aufruf — nicht aus einer Variablen ableiten.
2. **`args` als echtes JSON-Objekt uebergeben, nicht als String.** `args: {phaseId:"P2"}` —
   NICHT `args: "{\"phaseId\":\"P2\"}"`. Ein stringifiziertes Objekt kommt als String an.
3. **Worktrees stehen NICHT zuverlaessig auf `master`.** In einer frueheren Welle standen zwei
   von drei Worktrees auf einem Commit, in dem die Plandatei noch gar nicht existierte. Das
   Skript setzt `baseBranch` — pruef trotzdem vor JEDEM Merge:
   `git merge-base master <finalBranch>` gegen `git rev-parse master`.
4. **Merge den ZURUECKGEGEBENEN `finalBranch`, nicht blind `branch`.** Nach einem Self-Fix
   heisst der Branch `...-fix1` oder `...-fix2`. Das Skript gibt den richtigen Namen zurueck.
5. **`gate: "PASS"` ist keine Merge-Freigabe.** Vor JEDEM Merge selbst:
   `git diff master...<finalBranch> --stat` und die Pfadliste ansehen. Es gab schon einen PASS
   auf einem **leeren** Branch. Ist der Diff leer oder beruehrt er Pfade, die nichts mit der
   Phase zu tun haben: nicht mergen, Phase neu starten.
6. **NIEMALS `git stash`, solange worktree-isolierte Workflows laufen.** `refs/stash` ist
   zwischen Worktrees geteilt und wird geklobbert.
7. **NIEMALS `git add -A`.** In diesem Repo landete so schon ein Kundendump im Commit. Pfade
   einzeln adden.
8. **Untrackte Dateien werden von Worktree-Branches geklobbert.** Was du behalten willst, wird
   vorher committet.
9. **Suite-Zahlen aus Agentenreports sind Hinweise, keine Belege.** Ein Block meldete einmal
   "73 Tests" als volle Suite (echt: ~3000). Nach jedem Merge faehrst **du** `npm test`.
10. **Wird ein Agent unterbrochen** (Ruhemodus, Netzabbruch), startet der Workflow ihn neu. Das
    ist normal. Ein Branch, der dabei schon halbfertige Aenderungen traegt, wird vom Neustart
    weiterbearbeitet — pruef das Ergebnis wie jedes andere.

---

## 4. Das Gate — Clean Code ist nicht verhandelbar

`.claude/refs/clean-code.md` ist **Pflicht, nicht Empfehlung**. Das Workflow erzwingt es bereits:
der Clean-Code-Auditor setzt `blocker=true`, sobald ein **S1** (Tests/Sicherheit/Korrektheit)
oder **S2** (Duplizierung) gefunden wird, und dann laeuft der Self-Fix-Loop. Deine Aufgabe ist,
das Gate **nicht zu untergraben**:

- **Merge NIE bei `gate: "BLOCKED"`.** Nach `maxFixRounds` ohne PASS: Phase stoppen, mich mit
  den `remainingBlockers` fragen. Nicht "nur diesmal" durchwinken.
- **Keine Erwartung senken.** Ein roter Katalogtest wird durch einen Fix gruen, nie durch eine
  abgeschwaechte Assertion. Wo eine Assertion sachlich falsch ist, wird sie nach **Regel R5**
  korrigiert oder geloescht — mit Begruendung im Commit, nie stillschweigend.
- **Stehende Auflage A3 aus dem Plan:** ein Katalogtest, der nach dem Fix gruen ist, muss aus
  `test:gates` in den Regressionslauf wandern. Sonst endet die Kette mit 53 gruenen Tests in
  einer Suite, deren Rot toleriert wird — und null neuem Regressionsschutz. Pruef nach jeder
  Welle, dass die Rot-Zahl von `test:gates` um genau die erwarteten IDs gesunken ist.
- **Absolute Regeln aus `CLAUDE.md`** (Safety-Gates, Offenlegungssatz, Auth fail-closed,
  Secrets, Audio nie durch MCP) stehen ueber jedem Phasenziel. Der Safety-Reviewer prueft sie;
  wenn er blockiert, hat er recht, bis das Gegenteil mit Beleg gezeigt ist.
- **Drei Stellen weichen bewusst ab** und sind KEINE Befunde, sondern getragene Risiken
  (`PLAN-I18N-FIX.md` 7.6-7.8): keine Coupon-Allowlist (GAP-05 bleibt dauerhaft rot — der
  Zielwert der Rot-Liste ist **1, nicht 0**), keine globale Plattform-Anrufbremse, IP-Geo statt
  aktiver Landabfrage. Wenn ein Agent die "fixen" will: ablehnen, auf 7.6-7.8 verweisen.

---

## 5. Wie du duenn bleibst

Das ist eine harte Vorgabe, keine Bitte. Der Lead soll am Ende deutlich unter 100k Token liegen.

- **Lies NIE Produktionscode oder einen `git diff` im Volltext.** Das Workflow gibt dir bewusst
  nur einen Postage-Stamp zurueck: `{gate, finalBranch, testPassCount, filesTouched,
  remainingBlockers, reportPath, summary}`. Die Details schreibt ein Report-Agent nach
  `tasks/<phase>-report.md` — **diese Datei liest du nicht**. Sie ist fuer mich und fuer spaeter.
- **Erlaubt sind kleine git-Ausgaben:** `--stat`, `--name-only`, `merge-base`, `log --oneline`.
  Das ist die Merge-Pruefung, nicht Code-Lesen.
- **`npm test` gehoert dir**, nicht den Agenten. Nach jedem Merge einmal. Bei rotem Ergebnis:
  betroffene Datei **isoliert** nachfahren, bevor du es als Regression behandelst.
- **Bekannte Flakes**, die dich nicht in die Irre fuehren duerfen:
  `test/telnyx-p5-gate-proof.test.js` (auch **isoliert** intermittent — mehrfach fahren und die
  Assertion-Diffs vergleichen, nicht einmal) und `test/voice-status-lifecycle.test.js` unter
  Voll-Last.
- **Kein Zwischenbericht nach jeder Phase.** Sammle pro **Welle** und melde eine Zeile je Phase:
  `Pn: PASS | Branch | Tests | gemergt`. Ausfuehrlich wird nur der Abschluss.

---

## 6. Ablauf je Welle

1. Kollisionsannahme der Welle pruefen (Abschnitt 2).
2. Alle Workflows der Welle in EINER Nachricht starten.
3. Auf die Rueckgaben warten. Kein Polling, keine Zwischenfragen an mich.
4. Je Phase: `gate` pruefen -> `git merge-base` -> `git diff --stat` -> mergen.
5. `npm test` **einmal** nach der ganzen Welle (nicht nach jedem einzelnen Merge).
6. `npm run test:gates` — Rot-Zahl notieren, gegen die Erwartung der Welle pruefen.
7. Eine Zeile je Phase an mich, dann naechste Welle.

**Abbruchbedingungen — hier stoppst du und fragst mich:**

- `npm test` ist nach einem Merge rot und die Datei ist **isoliert ebenfalls rot**.
- Eine Phase bleibt nach `maxFixRounds` BLOCKED.
- Der Safety-Reviewer meldet einen Befund an einem Safety-Gate, dem Offenlegungssatz oder der
  Geldrechnung, den der Fix-Agent **widerlegen** statt beheben will.
- Eine Phase will eine Datei anfassen, die laut Plan gar nicht zu ihr gehoert.
- Die Rot-Zahl von `test:gates` sinkt nicht um die erwarteten IDs — dann ist entweder der Fix
  unvollstaendig oder A3 wurde vergessen.

---

## 7. Abschluss

Wenn alle 9 Wellen durch sind:

- `npm test` gruen, `npm run test:gates` bei **1** (GAP-05, getragenes Risiko nach 7.6).
- Kurzer Bericht an mich: was gemergt wurde, welche Phasen Self-Fix-Runden gebraucht haben,
  welche Owner-Entscheidungen sich in der Umsetzung als unpraktikabel erwiesen haben, und was
  **nicht** deployt ist. **Deployt wird in dieser Session nichts** — `git push origin` macht
  ohnehin nichts live, Render deployt vom Upstream. Der Deploy ist eine eigene Entscheidung.
- Keine Datei-Dumps, keine Diffs im Bericht.
