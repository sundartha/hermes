# Kickoff-Prompt fuer die AL-Kette

**Bedienung:** frische Session im Repo oeffnen, alles unter der Linie kopieren und absenden.
Nichts weiter tun — die Session laeuft autonom bis sie fertig ist oder etwas vom Owner braucht.

---

Du setzt die AL-Kette um: `PLAN-ASSISTANT-LEAP.md`, gesteuert ueber
`tasks/assistant-leap-chain.md`. Der Owner ist **nicht erreichbar**. Arbeite autonom bis die
Kette durch ist oder du wirklich etwas von ihm brauchst.

**Lies zuerst, in dieser Reihenfolge:**

1. `tasks/al-owner-notes.md` — was der Owner beigesteuert hat. Ausgefuellte Abschnitte sind
   bindend. Insbesondere: Such-Anbieter ist **Brave**, der Ueberbrueckungssatz darf **nie**
   abgeschnitten werden, und der Agent kuendigt die Suche **nie** an.
2. `tasks/assistant-leap-chain.md` — Bahnen, Phasen-Register, Betriebsregeln, Buchfuehrung.
3. `PLAN-ASSISTANT-LEAP.md` — der Plan. **Bindend ist der Abschnitt "Entscheidungen O1-O9";
   "Herleitung der offenen Fragen" darunter ist historisch und gilt NICHT.**

**Als Erstes, noch vor der ersten Phase:**

- `git log --oneline -20` — sind seit `da17c4e` fremde Commits dazugekommen? Es gibt eine
  zweite, zurueckgestellte Kette (PLAN-AUTH-GATE). Laeuft sie parallel: **nicht beide fahren**,
  die AL-Kette hat Vorrang (Owner-Entscheidung).
- **Caffeinated-Modus AN**, solange Phasen laufen:
  `caffeinate -dims >/dev/null 2>&1 & echo $! > /tmp/al-caffeinate.pid`
  (Es laeuft evtl. schon ein fremdes `caffeinate -di -t 14400` — das ignorierst du, du
  verwaltest nur deinen eigenen Prozess ueber die PID-Datei.)
  **AUS**, sobald alle Phasen durch sind ODER du auf den Owner wartest:
  `kill "$(cat /tmp/al-caffeinate.pid)" 2>/dev/null; rm -f /tmp/al-caffeinate.pid`
  Das gilt auch fuer Zwischenstopps: wartest du auf eine Antwort, ist der Modus aus.

## Wie du die Phasen faehrst

Ein Lauf je Phase, ueber das Lean-Template. Kein `resume`.

```
Workflow({
  scriptPath: ".claude/workflows/phase-impl-lean.js",
  args: {
    phaseId: "AL-P4",
    phaseTitle: "Seiteneffekt-Werkzeuge brechen den Tool-Loop",
    branch: "phase/al-p4-tool-loop",
    baseBranch: "master",
    planDoc: "PLAN-ASSISTANT-LEAP.md",
    specFile: "tasks/assistant-leap-chain.md",
    maxFixRounds: 2,
    highStakes: false
  }
})
```

**`highStakes` MUSST du explizit setzen — das ist die Token-Stellschraube.** Das Template
schaltet damit den Impl-Agenten von Sonnet auf Opus und den Safety-Review eine Stufe schaerfer.
Sein eingebauter Default `HIGH_STAKES_PHASES = ["P5","P6","P7"]` sind IDs einer **alten** Kette
und greifen bei `AL-P*` **nie** — ohne expliziten Wert liefe auch die Budget-Phase auf Sonnet.

| `highStakes: true` | Grund |
|---|---|
| AL-P5 | Naehe zum Offenlegungssatz (Regel 2) |
| AL-P6 | Budget-Pruefung pro Runde — Regel 1, Geldpfad |
| AL-P7 | groesste Phase, geteilter `agentTurn`-Seam |
| AL-P10b | neues Secret, fremder Text im Gespraechspfad, Kosten pro Zug |
| AL-P13 | neue Endpunkte, neues Protokoll |
| AL-P14 | Verhalten am Tool-Entscheidungspunkt + Richtungs-Gate |

**Alle uebrigen Phasen: `highStakes: false`.** Plan- und Safety-Agent laufen ohnehin immer auf
Opus, Clean-Code/Fix/Report immer auf Sonnet — daran aenderst du nichts.

**In JEDEN Phasen-Prompt gehoert Regel 0:** der Worktree MUSS auf dem aktuellen `master` stehen.
`isolation: "worktree"` legt ihn nicht zuverlaessig dort an.

## Reihenfolge

Zwei Bahnen, **maximal zwei Workflows gleichzeitig** (jeder parallelisiert intern schon).

- **Zuerst allein:** AL-P1.
- **Dann parallel:**
  - Bahn A (`src/claude.js`-Hub, strikt sequenziell): AL-P4 -> AL-P6 -> AL-P5
  - Bahn B (fasst `src/claude.js` nicht an): AL-P3 -> AL-P8 -> AL-P9 -> AL-P10 -> AL-P11
    -> AL-P12 -> AL-P13
- **Dann** AL-P2 (Spike, s. u.), danach AL-P7 -> AL-P7b -> AL-P10b -> AL-P14 -> AL-P15.

Merges macht der Lead, **nie waehrend eine Welle laeuft**. Vor jedem Merge
`git diff --stat master..<finalBranch>` — PASS ist keine Merge-Freigabe. Gemergt wird der
**zurueckgegebene** `finalBranch`, nicht blind der geplante Branch.

## AL-P2 — der Owner hat es freigegeben

**Du darfst eine neue Telnyx-Connection/TeXML-App anlegen** (Owner-Freigabe 2026-07-28) und eine
der beiden **nicht-live** DIDs darauf zeigen. Kostenlos und reversibel. Bestand steht in
`tasks/al-owner-notes.md` §4: 3 aktive DIDs, 3 ungenutzte `Blank`-Assistants.

**Vorher zwingend:** feststellen, welche der drei DIDs LIVE genutzt wird (steht in der Prod-DB,
nicht in der Telnyx-Antwort — alle drei haengen an derselben Connection). Wird das nicht geklaert,
experimentierst du am Live-Anschluss. Im Zweifel: nicht anfassen und den Punkt dem Owner
vorlegen.

**Verboten bleibt** `scripts/telnyx-assistant-provision.mjs` fuer diesen Zweck — es schreibt die
ganze Live-Config aus der lokalen `.env`.

Der Spike braucht **keinen Menschen**: Hermes ruft eine eigene Ersatz-DID an, die ueber eine
triviale TeXML-App abnimmt und schweigt; gemessen wird `audio_first_token_duration_ms` aus dem
Telnyx-Conversation-Record plus die Aufnahme. Die reguelaeren Gates werden dabei **nicht**
umgangen.

## Grenzen

- **Nicht deployen.** Kein Push nach `upstream`, kein Deploy ausloesen. Der Gateway hat
  `autoDeploy: off`.
- **Render-Env-Vars aendern ist erlaubt, mit Protokoll** in `tasks/al-env-changes.md`
  (Zeitstempel, Variable, Alt-/Neuwert, Phase). **Aber die geldrelevanten Flags bleiben AUS**:
  `PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `THINKING_SIGNAL_ENABLED`.
  Ihr Anschalten IST die Abnahme, und die hat der Owner auf "offen protokollieren" gesetzt.
- **Phasen mit Testanruf-Abnahme** werden gebaut, das Flag bleibt aus, der offene Punkt kommt
  nach `tasks/al-testcall-checklist.md`. Nicht als erledigt markieren.
- **Kein Code lesen als Lead.** Details stehen in `tasks/al-p<N>-report.md`.
- `npm test` MUSS gruen bleiben. `npm run test:gates` darf rot sein. Ein Regressionstest traegt
  **nie** eine Katalog-ID am Namensanfang.
- Nach jeder Welle verwaiste Testserver killen: `pkill -f "node src/server.js"`.
- **Nie `git add -A`.** Nie `git stash`, solange ein Worktree-Workflow laeuft.

## Wenn du fertig bist

1. Caffeinated-Modus aus (s. o.).
2. `tasks/al-chain-state.md` auf Stand: welche Phase gemergt, welcher Commit, welches Gate-Urteil.
3. `tasks/al-testcall-checklist.md`: was der Owner noch abnehmen muss.
4. Ein kurzer Bericht an den Owner: was steht, was blockiert, was er entscheiden muss.
