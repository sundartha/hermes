# Kickoff: OpenAI-Einreichung - technische Restarbeiten, Runde 2, FORTSETZUNG (ab Sitzung 7)

Du bist LEAN LEAD und setzt eine laufende Kette fort. **Der Auftrag steht unveraendert in
`tasks/kickoff-openai-technik-2.md` - lies diese Datei zuerst, sie gilt woertlich weiter**
(Kontext-Disziplin, Owner-Regel, Frageverbot, Betriebsregeln, Fallen aus Runde 1).
Diese Datei sagt nur, wo die Kette steht und was seither entschieden wurde.

## Stand

Der Zustand lebt in `tasks/openai-technik-2-stand.md` (kurz halten, nicht staendig neu lesen; fuer
den Einstieg reichen die Abschnitte "Phasenkoepfe", "Zwischenmessung 1" und "Sitzung 6").
Owner-Sicht (Stand, offene Punkte, vollstaendige Owner-Liste, Referenzen): `tasks/openai-technik-2-uebersicht.md` -
am Kettenende fortschreiben.
Der Plan mit allen Phasen steht in `tasks/PLAN-OPENAI-TECHNIK-2.md` - NICHT selbst lesen, die
Phasen-Agenten lesen ihn.

Gemergt (jede Phase mit unabhaengiger Opus-Verifikation):
T2-01 (a941d23), T2-02 (fff3b95), T2-03 (24ff703), T2-23 (c0438bd), T2-04 (1cfa474),
T2-05 (8a5b7ce), T2-06 (e8a0120), T2-07 (4cc2e9a), T2-08 (33d7f80), T2-09 (0cdb817),
T2-10 (6b3f9d1), T2-11 (91fc847), T2-12 (1a31815), T2-13 (c726212), T2-14 (252d154),
T2-15 (66d95ae, SQUASH), T2-16 (28e6fdb), T2-17 (f492a19), T2-18 (f096103, SQUASH), T2-19 (1c6b7a4),
T2-20 (91ef8cc).
**master steht auf 91ef8cc, nichts gepusht.** Branch `phase/openai-t2-15-restricted-data-mask` NIE pushen
(Zwischen-Commit 40ded37 traegt Secret-foermige Test-Fixtures; deshalb wurde T2-15 gesquasht). Ebenso
`phase/openai-t2-18-compat-contract-runbook` NIE pushen (Zwischenhistorie traegt ein verworfenes 922-KB-Widget-Archiv).

Offene Phasen in dieser Reihenfolge: **T2-21, T2-22, T2-24 (siehe unten)**.
Danach die volle Schlussabnahme nach Abschnitt 7 des Kickoffs. Skript fuer die Messung liegt
bereit: `.claude/workflows/runs/openai-t2-zwischenmessung.js` (4 Opus-Pruefer gegen genau 100 IDs,
Nachholen fehlender IDs, Stichprobe 12 Belege, Zusammenfuehrer mit Luecken-Abgleich). Fuer die
Schlussabnahme: `MASTER`, `AUSGABE` (`zwischenmessung-2.md` bzw. `schlussabnahme.md`) und die Liste
der "offenen Phasen" im Zusammenfuehrer-Auftrag patchen.

Die Phasenkoepfe (Titel, IDs, Slug, DOK, Owner-Rest) stehen als Tabelle in der Stand-Datei.
**Zusaetzlich mitzugeben:**
- **T2-21** (Review-Testfaelle, O-10, DOK ja): die Faelle bauen auf dem Reviewer-Zugang aus T2-20 auf
  (`docs/OPENAI-REVIEWER-ACCESS.md`, Seed `scripts/seed-reviewer-demo.mjs` - Seed-Anrufe haben 0 s und kein
  Transkript) und auf dem echten Ablauf prepare_call -> Karte -> ein Klick -> place_call. Naheliegende
  Negativfaelle, am Code zu belegen: Restricted Data wird abgelehnt, Werbe-/Massenanruf wird verweigert,
  place_call ohne Kartencode waehlt nicht. Werkzeugtexte nicht aendern (Bench-Regel).
- **T2-22** (Listing, O-11, DOK ja): Support-URL ist `/support` (T2-19, live erst nach OW-K); offen klein aus
  T2-20: `docs/OPENAI-REVIEWER-ACCESS.md:57-147` Codeverweise sind fuer den Reviewer nutzlos (Doku-Tests
  pinnen die Anker) - hier oder in der Schlussabnahme entscheiden.
- **T2-24 "Werkzeug-Ausgaben ehrlich und minimal"** (neu aus der Zwischenmessung; IDs `O-13`,
  `N-13`, `N-5`; `dokumentFuerOpenAI: true`; Branch `phase/openai-t2-24-tool-outputs-honest`;
  der Plan kennt diese Phase NICHT - Ziel/Dateien/Pre-Mortem stehen deshalb in der `notiz`):
  (a) O-13: `get_call_status` liefert `last_transcript_lines` woertlich bei jedem Status, auch nach
  Anrufende (vgl. `docs/OPENAI-POLICY-ABGLEICH.md`, Luecke zu Rohzeilen); (b) N-13:
  `list_action_items` sagt "from all calls", der Handler sieht nur die 50 neuesten
  (`src/routes/api-read.js:21,77`) - Text ehrlich machen oder paginieren; (c) N-5: veraltete
  Zeilenverweise in `docs/OPENAI-TOOL-INVENTORY.md`; dazu (Sitzung 5) der Doku-Anker
  `call-confirmation.js:63` im Policy-Abgleich/Inventar belegt "Bestaetigung je Anruf" nur schwach (ist
  nur die already_used-Konstante). Werkzeug-AUSGABEN aendern ist kein Werkzeugtext - aber aendert
  sich eine Beschreibung (z.B. "from all calls"), gilt die Bench-Regel unten.
- **X-9** ist GEKLAERT: gegenstandslos (Profil-Werkzeug optional, Beleg in der Stand-Datei). Nicht bauen.

## Neu gelernt (Sitzung 6)

- Der Bericht-Agent des Phasen-Skripts darf Owner-Punkte bis 400 Zeichen liefern (`MAX_EINTRAG_BERICHT`, in
  Vorlage `openai-t2-phase.js` eingebaut); vorher brach T2-19 nach 5 Schema-Fehlversuchen ab. Abbruch dieser
  Art: Grenze patchen, `Workflow({scriptPath, resumeFromRunId})` - fertige Agenten kommen aus dem Cache.
- Squash im Hilfs-Worktree: `git commit ... >/dev/null 2>&1; echo $?` - der pre-commit-Hook gibt sonst die
  volle eslint-Ausgabe (69 Warnungen) in den Lead-Kontext.
- `apps/web`-Tests selbst fahren (`cd <worktree>/apps/web && npm test > log`; Zahlen aus dem Log greppen).
- Nach Schwere steuern: ein reiner Doku-Rest-Befund nach MERGE-FREIGABE ja wird ohne erneute Verifikation
  behoben (T2-18, T2-20).

## So startest du eine Phase (bewaehrt, nicht aendern)

1. Vorlage kopieren und die EINE PHASE-Zeile patchen:
   `.claude/workflows/runs/openai-t2-phase.js` -> `.claude/workflows/runs/openai-t2-<nr>.js`.
   Zu patchen sind nur `const PHASE = {...}` (Z. 21) und `const VORGEBAUT = null` (Z. 29).
   Bewaehrt: `python3 .claude/workflows/runs/pin-phase.py <per-run.js> <phase.json>` (JSON-Felder
   id, titel, ids, branch, dok, notiz, ownerRest; JSON in den Sitzungs-Scratchpad legen). Das per-run-Skript
   `openai-t2-20.js` zeigt die Form der `notiz` (die aelteren per-run-Skripte sind aufgeraeumt, Historie in git).
   Felder: `id`, `titel`, `ids`, `branch` (muss mit `phase/openai-t2-` beginnen),
   `dokumentFuerOpenAI` (true => Bauen/Nachbessern mit Opus; IMMER true, wenn ein
   `docs/OPENAI-*` entsteht oder wesentlich geaendert wird), `notiz` (landet im RAHMEN aller
   Bau-/Pruef-Agenten, NICHT beim Verifizierer), `ownerRest` (Schluessel = ID, Wert = der Teil,
   den nur eine Owner-Live-Probe klaert).
2. Starten: `Workflow({scriptPath: ".../openai-t2-<nr>.js"})`. Ein Lauf dauert 1,5-4,5 Stunden,
   13-21 Agenten, 90-660 Mio. Token (fast alles Cache-Reads).
3. Rueckgabe ist das Kompaktschema. Danach selbst: `git status --short | grep -v '^??'` im
   Haupt-Checkout (darf nur `tasks/lessons.md` zeigen), `git diff --stat master...<branch>`,
   Lint-Diff (`git diff master...<branch> -- eslint-legacy-exceptions.json eslint-suppressions.json
   | grep -E '^[+-] .*": [0-9]+,?$'` - nur sinkende Zahlen erlaubt), dann `git merge --no-ff`.
   Nach dem Merge: `git worktree remove <pfad mit wt-t2-<nr>>` und
   `node scripts/workflow-kosten.mjs <lauf-id> | sed -n '3p'` fuer die Kostenzeile.
   ACHTUNG: Merge und Worktree-Remove NICHT mit `&&` hinter `| tail` verketten - in Sitzung 4
   lief das Remove nach einem gescheiterten Merge trotzdem.
4. Stand-Datei fortschreiben. Nach spaetestens 5 gemergten Phasen wieder uebergeben.

## Muster (bewaehrt, Sitzung 3 + 4)

- **Nach JEDEM Lauf die `offene_blocker` abraeumen, auch bei PASS** (Sitzung 4: 5 von 5 Phasen).
  Ablauf: Opus-Fix-Agent im Worktree der Phase (Bericht `tasks/openai-t2/T2-XX-bericht.md` darf er
  lesen, du nicht), danach ein eigener Opus-Verifizierer, der Berichte NICHT liest, neutral und
  punktweise fragt und mit `MERGE-FREIGABE ja/nein` endet (<= 1000-1300 Zeichen). Findet der
  Verifizierer selbst noch einen "wichtig"-Befund: denselben Fix-Agenten per `SendMessage`
  weiterlaufen lassen, denselben Verifizierer per `SendMessage` nachpruefen lassen (spart Kontext).
  Kleinigkeiten (Kommentare, Zahlen in Texten) per Sonnet-Agent, ohne erneute Verifikation.
- **FAIL ist nicht gleich Abbruch.** Ist der Befund eine echte Entscheidung (T2-10: Doku-Phase
  hatte Code gebaut; T2-13: Verifikation strukturell unmoeglich, weil der Klick erst in der
  Folgephase kommt), zuerst einen Opus-Agenten die Frage gegen die Primaerquelle klaeren lassen
  (Rueckgabe: "verlangt / Primaerquelle / Branch baut / Befunde / Empfehlung A/B/C / Bauanweisung /
  Abnahmekriterium"), entscheiden, dann Fix + Verifikation wie oben - oder, wenn der Branch
  grundlegend umgebaut wird, mit `VORGEBAUT` erneut durch den Workflow (T2-10).
- **Gekoppelte IDs:** gilt eine ID erst mit einer spaeteren Phase als erfuellt (T2-03/T2-23,
  T2-10/T2-16, T2-13/T2-14), den fertigen Teil mergen und die ID in `ids` der spaeteren Phase
  fuehren, damit deren Verifikation sie misst.
- **Neue Legacy-Lint-Eintraege sind keine Option** - Fix-Agenten wollen sie gern eintragen
  ("Ratschen-Test verlangt sie"). Stattdessen die angefassten Dateien auf 0 Befunde aufraeumen,
  ohne Zusicherungen abzuschwaechen (T2-12).
- In die `notiz` jeder Phase fest: keine internen Kennungen in `docs/OPENAI-*` UND in ausgelieferten
  Widget-Kommentaren (der OpenAI-Reviewer sieht sie); Lint-Pins nie anheben, keine neuen
  Legacy-Eintraege; Safety-Gates nur verschaerfen; ALLE Agenten NUR im Phasen-Worktree.
- Ein roter Test zaehlt erst, wenn er ISOLIERT erneut rot ist (jeder Lauf hat 0-4 Startflakes).
- `call.html` steht bei 266193 von 266240 Byte (Widget v12) - jede weitere Widget-Aenderung braucht Platz.

## Entscheidungen, die weiter gelten

- **Werkzeugtexte und server-instructions (Sitzung 5):** Messwerkzeug ist `scripts/briefing-bench`,
  NICHT `npm run convo-bench` (der misst nur den Sprachagenten, liest die MCP-Texte nie). Phasen-Worktrees
  haben keine `.env` - einen echten Lauf nur mit dem EINEN Schluessel starten, nie die ganze `.env` laden
  (Produktionswerte): `ANTHROPIC_API_KEY="$(grep '^ANTHROPIC_API_KEY=' <Haupt-Checkout>/.env | head -1 | cut -d= -f2-)"`.
  Stand 26.09.: scheitert wortgetreu an "Your credit balance is too low to access the Anthropic API"
  -> DEPLOY-VORBEDINGUNG OW-H: ein Lauf n=5, Alt 66d95ae gegen den Endstand; verfehlt -> Text-Commits
  zuruecknehmen (Anleitung README + PLAN-SECURITY). Weitere Textaenderungen (T2-24 u.a.) haengen sich an
  denselben Lauf an. Laengendeckel jetzt GQ-B1-04 6690/7090, prepare_call 1370; Consult-Kern der
  instructions hat nur 6 Zeichen Luft bis 512.
- **O-14 (Sitzung 5):** Restricted Data = Karten + BESCHRIFTETE Behoerden-IDs + Zugangsdaten, abgelehnt
  bei prepare_call/place_call/answer_consult, maskiert in 6 Ausgabewerkzeugen (nur MCP-Grenze). Keine
  PHI-Stichworte (Arzttermine erlaubt), IBAN bewusst nicht erfasst (allowBankData).
- **O-18 (Sitzung 5):** erfuellt = belegter Abgleich + Zweckbindung im Werkzeugtext; die Einhaltungs-
  Zusicherung gibt der Betreiber bei der Einreichung. Einwilligungs-/Zusicherungsformeln in der Karte
  sind Rechtstext (Owner, OW-J) - nicht bauen.
- **Merge-Art:** Traegt ein Zwischen-Commit Secret-foermige Literale, squash (Hilfs-Worktree +
  `git merge --ff-only`); vor jedem `--no-ff` die Branch-Historie greppen (`git log -p master..<br>`,
  Muster ghp_/sk_live_/AIza/sk-proj-/sk-ant-/github_pat_/PRIVATE KEY, mit Positiv-Kontrolle).
- **Wochenlimit:** Opus-Agenten koennen am Wochenlimit abbrechen; per `SendMessage` fortsetzen
  (verliert nichts, wenn frueh committet wurde).

- **T-31 (Widget-Domain):** `_meta.ui.domain` NUR bei Anfragen aus OpenAIs Egress-Bereichen
  (`src/ui/chatgpt-egress.js`); Alias `openai/widgetDomain` immer, stdio nie.
- **Scopes:** beworbene und erzwungene Menge getrennt; `offline_access` beworben, nicht erzwungen.
- **O-18 (Sitzung 4):** verlangt einen belegten Abgleich, keine serverseitige Zweck-Durchsetzung;
  Zweckbindung in den Werkzeugtexten folgt in T2-16.
- **N-10 (Sitzung 4):** Primaerquelle developers.openai.com/plugins/build/mcp-server: "Require
  confirmation for consequential write actions." Umgesetzt als Serverteil (T2-13) + Klick in der
  Karte (T2-14). Der Code ist an ALLE place_call-Argumente gebunden. **Ohne Widget-Karte kann kein
  Host mehr waehlen** (Claude Code inkl. claude.ai-Connector in Claude Code, stdio, API) - bewusst,
  steht als Owner-Kenntnisnahme in der Stand-Datei; ein Rueckfallweg (Bestaetigung in der Web-App)
  waere eine eigene spaetere Phase und ist NICHT Teil dieser Kette.
- **X-9:** gegenstandslos (optional laut Primaerquelle).
- Deploy-Vorbedingungen OW-G und OW-B sind ERLEDIGT (23.09., Belege in der Stand-Datei).
  Neu: T2-13+T2-14 nur gemeinsam deployen, `CALL_CONFIRMATION_SECRET` >= 32 Zeichen setzen,
  `MCP_UI_ENABLED` nicht false; T2-11+T2-12 nur gemeinsam; OW-N (`WORLD_DEFAULT_LANGUAGE_ENABLED`).
  Neu (Sitzung 5): OW-H (briefing-bench echt nach Guthaben-Aufladung, s.o.).

## caffeinate (Owner-Regel)

An, solange eine Phase laeuft; aus, sobald keine mehr laeuft oder eine Owner-Frage ansteht.
`nohup caffeinate -is -t 10800 &`, PID in den Scratchpad, mit `ps -p <pid>` pruefen (nie
`pgrep`), etwa jede Stunde neu starten und den alten Prozess beenden.
