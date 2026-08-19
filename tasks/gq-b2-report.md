# GQ-B2 — Drei-Klassen-Briefing + expliziter Unbekannt-Ausgang im Consult

**Gate:** PASS
**finalBranch:** `phase/gq-b2-briefing-klassen-fix1`
**Basis:** `master` @ `9ca10c2`
**headCommit (Impl):** `e544727a1a304c5123e6161234b8f5769582efd2`

Owner-Entscheidung 2026-08-19: der Auftraggeber ist waehrend des Anrufs ABWESEND —
das ist der Normalfall. Die GQ-B1-Pauschale ("nie vertroesten") verbrannte deshalb
die eine gedeckelte Rueckfrage auf Fragen, die auch der auftraggebende Assistent
nicht beantworten kann. GQ-B2 ersetzt sie durch eine Drei-Klassen-Selbsteinschaetzung
und macht den Unbekannt-Ausgang im Consult-Loop explizit.

Reine Stringliteral-Phase: kein Gate, kein Schema-Feld, kein Laufzeitpfad, keine
Dependency, kein neues Modul.

---

## Plan (gekuerzt)

Basis: `master @ 9ca10c2`, autoritativ `tasks/gq-b2-spec.md`.

**Gepruefter Code-Ausgangsstand:**
- `src/mcp-tools.js` → `briefing`-`.describe(...)` trug die GQ-B1-Pauschale (181 Zeichen:
  "…never write that the principal will get back to the other party - do not pre-empt
  that answer here…").
- `PLACE_CALL_CONSULT_LOOP`, `PLACE_CALL_DESCRIPTION`, `placeCallDescription()`: unveraendert.
- `src/mcp-server-info.js` → `MCP_CONSULT_INSTRUCTIONS` trug "if you do not know an answer,
  ask the user first rather than inventing one" und "if you have to ask the user, do it
  in the same turn".
- `test/gq-b1-briefing-openness.test.js`: GQ-B1-01 pinnte `/get back to the other party/i`
  → musste gedreht werden.
- **Wichtigster Planungsfund:** `test/place-call-context-bridge.test.js` (P1-01) pinnte
  denselben Satz `/never write that the principal will get back/i` **zusaetzlich, in der
  Spec nicht genannt** — ohne Anpassung waere die Suite rot geblieben.
- `test/p15-mcp-tool-descriptions-en.test.js`: `EXPECTED_MARKERS["place_call.briefing"] =
  ["SUMMARISE","NO","KNOW"]` (Anzahl+Reihenfolge) — durfte nicht verschoben werden.
- `test/al-p13-consult-channel.test.js`: vergleicht `MCP_CONSULT_INSTRUCTIONS` nur per
  Identitaet → von der Textaenderung nicht betroffen.
- Zeichen-Budget (identische Zaehlweise wie GQ-B1-04): `place_call*` ohne Kanal 5663/5800
  (137 Luft), mit Kanal 6065/6200 (135 Luft) — das harte Budget der Phase.

**Edits laut Plan:**
1. `src/mcp-tools.js`, `briefing`-Beschreibung: die Pauschale wird durch die Drei-Klassen-
   Regel ersetzt — (1) eigene Quellen (Kalender/Mail/Dateien/Chat) → Luecke offen lassen +
   in einer Zeile deklarieren, (2) Nur-Owner-Wissen → ehrliche Prozess-Auskunft ("get back
   on it"), (3) oeffentlich pruefbar → nichts schreiben. Die Erfindungs-Sperre "never script
   an answer" bleibt woertlich. Kein Werkzeugname im Text (Feld ist immer registriert,
   Rueckfrage haengt am Kanal). Kommentar darueber ersetzt (C2), nicht ergaenzt.
   Ein im Plan markierter Tippfehler-Stolperstein ("Can only the principal *can* know it?")
   war explizit als **nicht** so zu schreiben markiert — korrekt: "Can only the principal
   know it?".
2. `src/mcp-server-info.js`, `MCP_CONSULT_INSTRUCTIONS`: eigene Quellen zuerst, Nutzer-
   Rueckfrage nur bei echter Anwesenheit, expliziter Unbekannt-Ausgang ("say with
   answer_consult that you do not know instead of waiting"). Byte-identischer Prefix-Pin
   GQ-B1-05 bleibt laut Plan-Pruefung unangetastet (der geaenderte Text liegt hinter dem
   gepinnten ersten Satz).
3. Tests: vier neue Faelle GQ-B2-01..04 in der **bestehenden** Datei
   `test/gq-b1-briefing-openness.test.js` (kein neuer Attrappen-Bauer, G5/S2). GQ-B1-01
   gibt die zwei uebernommenen Aussagen ab (kein doppelter Pin). Pflicht-Edit an
   `test/place-call-context-bridge.test.js` (P1-01): Pin wird ersetzt, nicht gestrichen.
4. Nicht anfassen: `p15-mcp-tool-descriptions-en.test.js`, `al-p13-consult-channel.test.js`,
   `api.test.js`, `mcp-ui.test.js`, `outbound-agent.template.json`, jede Gate-/Auth-/Store-Logik.

**Pre-Mortem (Kernrisiken, im Plan vorab benannt):**
1. Klasse-1-Deklaration koennte zur ungedeckten Zusage werden, wenn der Kanal tot ist →
   entschaerft durch fehlenden Werkzeugnamen im Text; Restrisiko akzeptiert (SCOPE-fremd).
2. Klasse 2 koennte Klasse 1 "auffressen" (alles als Nur-Owner-Wissen einsortiert) →
   Erfindungs-Sperre bleibt woertlich; Wirkungsbeleg braucht echten Testanruf, nicht
   statisch messbar.
3. Zeichen-Deckel knapp (30/32 Zeichen Luft) → Deckel bewusst NICHT gehoben, Beispielsatz
   aus der Spec-Skizze (+222 Zeichen) gestrichen statt Deckel angehoben.
4. Gruener Waechter (P1-01) haette weggeschrieben statt gedreht werden koennen →
   Edit im Plan ausformuliert: Ersatz, keine Streichung.
5. Sicherheit: kein Gate/Auth/Secret/Endpunkt beruehrt, `place_call` laeuft unveraendert
   durch alle Gates.

---

## Implementierung — Zusammenfassung

Umgesetzt exakt gemaess Plan auf Branch `phase/gq-b2-briefing-klassen` (Basis `master @
9ca10c2`, Commit `e544727`), spaeter im Review-Fix zu `phase/gq-b2-briefing-klassen-fix1`.

**Zwei Stringliterale geaendert:**
1. `src/mcp-tools.js` — `briefing`-Beschreibung: Pauschale ersetzt durch die Drei-Klassen-
   Regel wie geplant; Kopf/Schwanz des Literals byte-identisch; ueberholter Kommentar
   ersetzt (C2); kein Werkzeugname im Text.
2. `src/mcp-server-info.js` — `MCP_CONSULT_INSTRUCTIONS`: eigene Quellen vor Nutzer-Rueckfrage,
   Rueckfrage an echte Anwesenheit gebunden, expliziter Unbekannt-Ausgang beim Fristablauf.

**Zeichen-Budget — gemessen statt gehoben (Kernpunkt der Phase):**

| Groesse | vorher | nachher | Deckel | Luft |
|---|---:|---:|---:|---:|
| `place_call*` ohne Kanal | 5663 | **5768** | 5800 | 32 |
| `place_call*` mit Kanal | 6065 | **6170** | 6200 | 30 |

Exakt die im Plan vorhergesagten Werte.

**Tests:** vier neue Waechter GQ-B2-01..04 in `test/gq-b1-briefing-openness.test.js`;
GQ-B1-01 gibt die zwei uebernommenen Aussagen ab (kein doppelter Pin); der Pin in
`test/place-call-context-bridge.test.js` (P1-01) wurde ersetzt (haelt jetzt "never script
an answer" statt der Pauschale), nicht gestrichen. `p15-mcp-tool-descriptions-en.test.js`
und `al-p13-consult-channel.test.js` unveraendert und gruen (keine eingeschmuggelte Emphase).

**Verifikation:** `node --check` auf alle vier Dateien; vier Waechter-Dateien isoliert
71/71 gruen; `LLM_PROVIDER=anthropic npm test` → 4908 pass / 0 fail (kein Flake); Smoke
gegen echt gespawnten Server gruen.

**Sicherheit (Impl-Selbstauskunft):** kein Safety-Gate, kein Offenlegungssatz, keine
Auth-Naht, kein Secret, kein neuer Endpunkt beruehrt. `place_call` laeuft unveraendert
durch `/api/calls` mit allen Gates.

### Deviations (Impl)

1. Vorgegebener `ln -s "./node_modules" node_modules` erzeugt im Worktree einen
   selbstreferenziellen toten Symlink → ersetzt durch Link auf das Haupt-Repo-`node_modules`
   (gitignored, nicht committet).
2. Plan erwartete `# tests 17` fuer die vier Waechter-Dateien; tatsaechlich 71 (Plan hat
   Bestand von p15/al-p13 untergezaehlt). Alle 71 gruen — Erwartungszahl war falsch, nicht
   das Ergebnis.
3. `npm run format:check`: Repo ist auf `master` bereits fuer 677 Dateien rot (inkl. aller
   vier hier beruehrten Dateien, per `git stash` gegengeprueft) — Bestandsschuld, keine neue
   Drift, nicht angefasst (SCOPE-fremd). `npm run lint`: 0 errors, 61 warnings, identisch
   zum Bestand.
4. Plan-Abweichung aus Abschnitt 2.2 bestaetigt: GQ-B1-05 (byte-identischer Prefix-Pin)
   musste **nicht** angepasst werden — bleibt unveraendert in Kraft und gruen. Urspruengliche
   Spec-Erwartung, er muesse gelockert werden, ist widerlegt.
5. Kein separater pglite-Testlauf noetig — pg/pglite-gestuetzte Tests laufen bereits
   innerhalb des einen `npm test`-Laufs mit (Teil der 4908 gruenen Faelle); beide Backends
   sind so abgedeckt, nur nicht als zwei getrennte Kommandos.

---

## Safety-Urteil (final)

**approved: true** — alle Einzelpruefungen (`testsPassIndependently`, `safetyGatesIntact`,
`disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`,
`behaviorAsIntended`) **true**.

**Unabhaengiger Testlauf** (frischer Worktree, `review-gq-b2-r1` = `phase/gq-b2-briefing-klassen-fix1`,
`master` als Ancestor):
- Branch `npm test`: korrigiert 4909/4909 pass, 0 fail, 116,4 s — pg via pglite lief mit gruen.
- Baseline (5 Dateien auf `master`-Inhalt zurueckgesetzt, gleicher Lauf): korrigiert
  4904/4903, 1 Fehler (`GET /mcp -> 405`, isoliert nachgefahren 2/2 gruen → Spawn-Flake auf
  `master`, nicht auf dem Branch). Delta +5 = exakt die fuenf neuen Faelle GQ-B2-01..05.
  Kein Test geloescht/umbenannt (`git diff --name-status`: 5× M, 0 D/R).
- `npm run test:gates`: Branch 129/126 pass/3 fail (GAP-05, GAP-15, E2E-03) — identisch zur
  Baseline, keine Gates-Regression.
- Lint: exit 0 auf allen 5 geaenderten Dateien, keine neue Suppression. Prettier: 4 Dateien
  rot — identisch auf `master`-Inhalt, Bestandsschuld.
- Eigenmessung Zeichen-Budget bestaetigt: 5768/5800, 6170/6200; Werkzeug-Inventur bestaetigt
  `await_call_event`/`answer_consult` nur mit `consultAllowed:true`.
- Keine verwaisten Testserver, Worktree am Ende sauber.

**Absolute Regeln, einzeln geprueft:**
1. SAFETY-GATES nicht beruehrt — kein Gate-Modul im Diff, `PLACE_CALL_DESCRIPTION` verweist
   unveraendert auf die Server-Gates, `MAX_IN_CALL_CONSULTS_PER_CALL=1` bleibt gepinnt.
2. OFFENLEGUNG: `src/claude.js`/`src/bridge.js` im Diff leer, `disclosureSentence` unveraendert.
3. AUTH FAIL-CLOSED: keine Route/Middleware im Diff; Kanal-Gatung haelt (Flag-aus bleibt
   byte-identisch, AL-P13-36 gruen).
4. SECRETS: keine Credentials im Diff; "NO secrets, passwords or payment data" bleibt in
   `place_call.briefing` woertlich stehen.
5. AUDIO ueber MCP nicht beruehrt.
6. SCOPE eingehalten — beide Commits gehoeren zu GQ-B2, keine Fremdsanierung.

**Verdict:** FREIGABE (approved) mit fuenf nicht-blockierenden Anmerkungen:
1. Klasse-1-Deklaration ("could you answer it yourself during the call…") ist im immer
   registrierten Feld unbedingt formuliert, obwohl die Live-Rueckfrage am Kanal
   (`consultAllowedFor`) haengt — bei totem Kanal wird eine Luecke offen gelassen, die im
   Gespraech nie gefuellt wird. Entschaerft durch fehlenden Werkzeugnamen; Kandidat fuer
   konditionale Formulierung in Folgephase.
2. `MCP_CONSULT_INSTRUCTIONS` weist jetzt aktiv auf "your own tools and context first
   (calendar, mail, files, this chat)" — Mail/Dateien sind Orte mit Zugangs-/Zahlungsdaten;
   `answer_consult` traegt (auch schon auf `master`) keinen Secrets-Riegel-Satz und es gibt
   keine Redaktion auf dem Consult-Pfad (nur den 200-Zeichen-Deckel `KEY_FACTS_LIMITS`).
   Keine Verletzung der Secrets-Regel (Nutzerdaten, nicht System-Secrets); Empfehlung:
   Secrets-Satz auch an `answer_consult` in Folgephase.
3. Zeichen-Deckel praktisch ausgereizt (30/32 Zeichen Luft) — naechste Textphase reisst ihn
   fast sicher.
4. Keine `gq-b2-spec.md` im Repo auffindbar (`git log --all --diff-filter=A` findet nur
   gq-b1/gq-e1); Pruefung nur gegen Commit-Botschaften und GQ-B1-Spec moeglich. GQ-B1-05
   heisst "Bestandstext bleibt byte-identischer Prefix", prueft nach der Aenderung aber nur
   noch `startsWith(...)` — der Testname verspricht mehr als er haelt (das IST der Zweck
   der Phase).
5. `tasks/gq-chain-state.md` nicht fortgeschrieben — ueblich Aufgabe des Merge-Commits,
   hier nur als Erinnerung notiert, kein Befund gegen die Implementierung.

---

## Clean-Code-Audit (final)

**s1:** [] · **s2:** [] · **s3:** [] · **s4:** [] · **blocker: false**

**Verdict: PASS** — keine S1/S2-Blocker. Diff ist reiner Prompt-/Beschreibungstext
(`mcp-server-info.js`, `mcp-tools.js`) plus zugehoerige Test-Aktualisierung (3 Testdateien),
keine neue Logik/Funktion/Klasse. Alle 26 betroffenen Tests isoliert gruen (`node --test`
gegen Branch-Snapshot via `git archive` + `node_modules`-Symlink). `node --check` fuer beide
Quelldateien ok.

**passNotes:** Saubere Owner-revidierte Aenderung mit klarem Kommentar-Trail (kein
stale/widerspruechlicher Kommentar zurueckgelassen, C2 sauber). Tests praezise aufgeteilt:
GQ-B1-01 behaelt nur, was phasenunabhaengig gilt; GQ-B2-01/02 pinnen die neue Aussage;
GQ-B2-05 prueft konsistent denselben Wortlaut pfad-uebergreifend (`answer_consult` vs.
`MCP_CONSULT_INSTRUCTIONS`) — verhindert Drift. Die drei Prosa-Bloecke (`briefing`-Feld,
`MCP_CONSULT_INSTRUCTIONS`, `answer_consult`-Beschreibung) wiederholen dieselbe Kernaussage
fuer unterschiedliche Adressaten — beabsichtigte Redundanz in LLM-Nutzeranweisungen, keine
Code-Duplizierung im Sinne von G5, daher nicht geflaggt. `place_call.objective` behaelt sein
eigenes "ask the user FIRST" fuer die Themenklaerung vor dem Anruf — inhaltlich unabhaengig,
keine Kollision mit GQ-B1-03. Zeichen-Deckel (GQ-B1-04) eingehalten.

**topTodos:** Kein Blocker offen. Optional: GQ-B2-Owner-Entscheidung (Drei-Klassen-Regel)
in `tasks/lessons.md` oder Chain-State-Notiz festhalten, analog zu anderen GQ-Phasen.

---

## Fix-Runden

**Runde 1** (→ Branch `phase/gq-b2-briefing-klassen-fix1`): behebt beide von Safety/Clean-
Code gemeldeten Blocker-Kandidaten. `answer_consult`s Tool-Beschreibung trug unveraendert
die unbedingte "ask the user FIRST"-Anweisung, obwohl GQ-B2 dieselbe Anweisung bewusst aus
`MCP_CONSULT_INSTRUCTIONS` entfernt hat (Owner waehrend des Anrufs abwesend). Da beide Texte
immer gemeinsam ausgeliefert werden, waere ein widerspruechliches Paar entstanden — der
Server-Loop erlaubt die eigene Recherche zuerst, das Werkzeug selbst verlangt weiterhin
"FIRST" die Nutzer-Rueckfrage. Fix bringt `answer_consult` auf denselben Drei-Klassen-/
Anwesenheits-Wortlaut; neuer Waechter GQ-B2-05 pinnt die Konsistenz beider Stellen. Nach
diesem Fix: Safety-Review und Clean-Code-Audit beide **PASS** ohne weitere Blocker (siehe
oben, final).
