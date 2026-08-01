# Phase AL-P16 — Boot-Sonden fuer die blinden Schalter

**Status:** Gate = PASS
**finalBranch:** `phase/al-p16-boot-sonden`
**Basis:** `master` @ `6ad7d82`
**headCommit (Impl):** `64a59f169936fb784f3e97088f9929a0bfd1a9d7`
**Art:** reine Beobachtbarkeit — kein Gate, kein Geldpfad, keine Env-Var, keine Dependency, keine Migration

---

## 1. Ausgangslage / Zweck

Mehrere Faehigkeiten (Vorab-Briefing, Vorab-Recherche, In-Call-Nachschlag, Consult-Kanal,
Ergebnis-Zitate) haben Plattform-Flags, deren Zustand am laufenden Dienst bislang nicht
ablesbar war — "gesetzt" ist nicht dasselbe wie "wirkt", weil die Schnittmenge zusaetzlich
vom Per-Tenant-Recht abhaengt. AL-P16 fuegt dafuer unkonditionale Boot-Banner-Zeilen ein,
die ausschliesslich den Plattform-Schalter melden und die uebrigen Bedingungen als Text
benennen — ohne ein zweites Gate-Urteil zu faellen.

### Widerspruch in der Spec — aufgeloest

Die Ueberschrift/der "Warum"-Absatz der Spec zaehlen **vier** blinde Schalter
(`CONSULT_ENABLED`, `PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`,
`EVIDENCE_RETENTION_DAYS`). Die Inhalts-Bullets verlangen aber ausdruecklich zusaetzlich
eine Zeile fuer den In-Call-Nachschlag (`LOOKUP_ENABLED` + `EXA_API_KEY`), der am Code ein
eigener Schalter ist (`config.research.lookupEnabled`, eigener Gate-Zweig
`inCallSearchProvider` in `src/research/registry.js`) und in keiner Liste des
"Warum"-Absatzes steht. Aufloesung: **fuenf Zeilen** — eine Zeile wegzulassen haette einen
expliziten Inhalts-Bullet verletzt; eine mehr verletzt nur eine Ueberschriften-Zahl. Der
Phasenname bleibt "vier blinde Schalter".

---

## 2. Plan (gekuerzt)

### Design-Entscheidungen

- **D1 — Sonde faellt KEIN Gesamturteil.** `AKTIV`/`aus` meldet ausschliesslich den
  Plattform-Schalter in der Klammer; alles nach dem Gedankenstrich listet die uebrigen
  Bedingungen. Die Schnittmenge entscheiden bereits `consult/gate.js`,
  `research/registry.js`, `precall-briefing.js` — ein zweites Urteil im Banner waere eine
  Kopie (G5) und das Per-Tenant-Recht ist zur Bootzeit ohnehin nicht bekannt.
- **D2 — Zeilen stehen IMMER**, auch im Aus-Zustand (anders als
  `tokenStreamingBannerLine`/`thinkingSignalBannerLine`, die bei aus leer sind; nach dem
  Muster `assistantPathLabel`). Grund: eine verschwindende Zeile waere im Live-Log nicht
  von einem Deploy ohne die Sonde zu unterscheiden.
- **D3 — Wiederverwender statt sechster Wahrheit.** Der Aus-Zustand der Zitate kommt aus
  der bestehenden exportierten Entscheidung `evidenceRetentionEnabled(privacy)` in
  `src/call-result.js`.
- **D4 — Secret niemals ins Log (Regel 4).** `EXA_API_KEY` erscheint nur als
  `gesetzt`/`fehlt`; zwei Tests pinnen das (reine Funktion + echtes Boot-Log).
- **D5 — Kein neues Modul.** Sonden kommen neben den vier bestehenden
  Banner-Zeilen-Funktionen in `src/boot.js`.
- **D6 — Genau EIN neuer Export**: `capabilityProbeLines(config)`; die fuenf Bauer bleiben
  modulprivat (S4).
- **D7 — Kein Padding.** Kein Ausrichtungswert (Magic Number ohne Nutzen, G25).

Pre-Mortem: (a) Tippfehler in `boot.js` legt den Dienst lahm -> nur reine
String-Funktionen, kein `await`/Throw, `node --check` + Spawn-Test im Gate. (b) Zeile sagt
"AKTIV", Betreiber glaubt "wirkt" obwohl Tenant-Recht `false` ist -> D1 + Pflicht-Zusatztext.
(c) Key landet doch im Log -> D4 + Spawn-Test mit Sentinel.

### Aenderungen (Blast-Radius)

| Datei | Art |
|---|---|
| `src/boot.js` | +1 Import (`evidenceRetentionEnabled`), `assistantPathLabel` ausgabegleich auf gemeinsamen Formatierer gezogen, ~7 modulprivate Funktionen + 1 neuer Export `capabilityProbeLines`, 1 Druckschleife im Banner |
| `test/al-p16-boot-probes.test.js` | neu, 9 Tests |
| `tasks/assistant-leap-chain.md` | Doku-Absatz |

Nicht beruehrt: `claude.js`, `bridge.js`, `disclosureSentence`, `outbound-gates.js`,
`budget-gate.js`, `consult/gate.js`, `research/*`, `precall-briefing.js`, `call-result.js`,
`store/*`, `config.js`, `.env.example`, `render.yaml`, `test/helpers.js`. Keine Route, kein
Gate, kein Geldpfad, kein Secret im Log, keine Dependency, keine Migration.

### Tests (Skizze)

Neue Datei `test/al-p16-boot-probes.test.js`, IDs `AL-P16-1..9` — landet im
Regressionslauf `npm test` (Praefix `AL-` faellt nicht unter `i18nCatalogPattern`).

| ID | Test | Kern |
|---|---|---|
| AL-P16-1 | Vorab-Briefing beide Richtungen | `PRECALL_BRIEFING_ENABLED=false/true`, nennt `ASSISTANT_CONTEXT_ENABLED=` |
| AL-P16-2 | Vorab-Recherche beide Richtungen | `RESEARCH_ENABLED=false/true`, nennt `allowResearch am Tenant` |
| AL-P16-3 | In-Call-Nachschlag, Flag x Schluessel | 3 Faelle (aus/leer, an/leer, an/gesetzt) |
| AL-P16-4 | Secret-Riegel | Sentinel-Key erscheint in keiner der 5 Zeilen |
| AL-P16-5 | Consult-Kanal beide Richtungen | `CONSULT_ENABLED=false/true` + `ASSISTANT_CONTEXT_ENABLED=` + `allowConsult am Tenant` |
| AL-P16-6 | Ergebnis-Zitate, Zahlenwert | `0` -> "keine Zitate"; `2` -> "nach 2 Tagen geloescht" |
| AL-P16-7 | **Mutationsprobe**: Config schlaegt Rohumgebung | `process.env` gegenteilig gesetzt, Zeilen folgen dem Objekt |
| AL-P16-8 | Spawn, alles aus (BASE_ENV) | jedes Label genau einmal, `/healthz`=200 |
| AL-P16-9 | Spawn, Nachschlag an + Sentinel-Key | Log zeigt "gesetzt", Sentinel-Wert selbst nirgends im Log |

---

## 3. Impl-Zusammenfassung

Fuenf unkonditionale Boot-Sonden fuer die blinden Faehigkeits-Schalter, reine
Beobachtbarkeit. Neuer Export `capabilityProbeLines(config)` in `src/boot.js` liefert die
Zeilen fuer:

- **Vorab-Briefing** (`PRECALL_BRIEFING_ENABLED`)
- **Vorab-Recherche** (`RESEARCH_ENABLED`)
- **In-Call-Nachschlag** (`LOOKUP_ENABLED` + `EXA_API_KEY` gesetzt/fehlt)
- **Consult-Kanal** (`CONSULT_ENABLED`)
- **Ergebnis-Zitate** (`EVIDENCE_RETENTION_DAYS`)

Gedruckt wird ausschliesslich in `logBootBanner`, zwischen der Denk-Signal-Zeile und
`MCP (HTTP):`. `AKTIV`/`aus` meldet nur den Plattform-Schalter; die uebrigen Bedingungen
stehen hinter dem Gedankenstrich. Zeilen stehen auch im Aus-Zustand. Sonden lesen
ausschliesslich die fertig geparste Konfiguration (`tenancy`/`research`/`privacy`), nie
`process.env`. Der Aus-Zustand der Zitate kommt aus der bestehenden Entscheidung
`evidenceRetentionEnabled` (`src/call-result.js`). `assistantPathLabel` wurde
ausgabegleich auf denselben Formatierer `envFlagState` gezogen (Bestandstest `AL-P1-9`
blieb unveraendert gruen = Regressionsbeweis). Kein Gate, kein Geldpfad, keine neue
Env-Variable, keine Dependency, keine Migration; `.env.example`, `render.yaml`,
`test/helpers.js` unberuehrt (`BASE_ENV` pinnt alle fuenf Schluessel bereits).

**Ergebnis:** `testPassCount: 3707`, `testFailCount: 0`, `smokePass: true`,
`nodeCheckPass: true`.

### Deviations

1. **5 statt 4 Sonden-Zeilen** (vom Plan selbst aufgeloest, hier bestaetigt umgesetzt):
   `LOOKUP_ENABLED` ist am Code ein eigener Schalter und steht in keiner Liste des
   "Warum"-Absatzes, waehrend die Inhalts-Bullets ausdruecklich eine Zeile fuer den
   In-Call-Nachschlag inkl. `EXA_API_KEY` verlangen.
2. **AL-P16-9 macht einen `/healthz`-Roundtrip** vor den Assertions (Testdetail
   gegenueber Plan-Skizze): ohne ihn war der Test deterministisch rot — `startServer`
   loest auf der Gateway-Zeile auf, die Sonden stehen im Banner dahinter und waren noch
   nicht eingetroffen. Muster `P5-B4`/`AL-P16-8` aus dem Bestand, keine Assertion
   abgeschwaecht.
3. **`npm test` lieferte in der Bash-Sandbox keinen Output/Fremd-Exitcode 194**
   (Sandbox-Artefakt, auch bei `prettier --check` ohne Befund reproduzierbar). Suite
   stattdessen ueber den identischen Einstiegspunkt gefahren:
   `NODE_ENV=test node test/i18n-catalog-run.mjs regression`.
4. Vorgegebener Befehl `ln -s ./node_modules node_modules` erzeugt einen
   selbstreferenzierenden kaputten Symlink (ELOOP) — folgenlos, Node loest ueber die
   Parent-Verzeichnis-Suche im Haupt-Repo auf; Symlink gitignored, nicht committet.

---

## 4. Safety-Urteil (final)

**Verdict: PASS** — approved, alle Einzelkriterien erfuellt
(`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`,
`noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`, `blockers: []`).

Diff besteht aus drei Dateien (`src/boot.js` +108/-3, `test/al-p16-boot-probes.test.js`
neu, `tasks/assistant-leap-chain.md` Doku).

- **Regel 1 (Safety-Gates):** unberuehrt — Diff auf `telephony/`, `claude.js`,
  `bridge.js`, `config.js`, `auth.js`, `web-auth.js`, `middleware.js` ist leer. Kein
  neuer Endpunkt, keine Route, kein Geldpfad, keine neue Env-Var.
- **Regel 2 (Offenlegung):** `claude.js`/`bridge.js` nicht im Diff — `disclosureSentence`
  unangetastet.
- **Regel 3 (Auth fail-closed):** keine neuen Endpunkte/Middleware/Signaturlogik beruehrt.
- **Regel 4 (Secrets):** `EXA_API_KEY` ausschliesslich als `gesetzt`/`fehlt`
  (Truthiness-Pruefung, nie Interpolation) — zwei Tests riegeln ab, einer davon am echten
  gespawnten Boot-Log mit Sentinel-Key.
- **Regel 5/6 (Audio/MCP, Scope):** `capabilityProbeLines` nur von `logBootBanner`
  aufgerufen, ueber keine API-/MCP-Oberflaeche erreichbar.

**Unabhaengige Verifikation:** frischer Worktree, Basis gegen `master`-HEAD geprueft (EIN
Commit darueber, sauberer Baum). `npm test`: EXIT 0, 3707/3707, 0 fail, beide
Store-Backends (JSON + Postgres/pglite) abgedeckt. `npm run test:gates`: EXIT 1, 126/129,
die 3 roten sind bekannter Bestandsstand (GAP-05, 2x GAP-15), kein Bezug zu `boot.js`.
Eigene Banner-Byte-Diff (master vs. Branch): exakt +5 Zeilen, sonst null Unterschied,
`configHash` unveraendert. Zwei selbst durchgefuehrte Mutationsproben (Sonde auf
`process.env` umgestellt / Druckschleife entfernt) machten die erwarteten Tests rot,
danach sauber zurueckgenommen; keine verwaisten Testserver.

**Concerns (keine Blocker):**
1. Spec-Zahl (vier) vs. Umsetzung (fuenf Zeilen) — durch Inhalts-Bullet der Spec gedeckt,
   in `tasks/assistant-leap-chain.md` dokumentiert.
2. Mit-Refactor `assistantPathLabel` auf `envFlagState` umgestellt, ausserhalb der reinen
   Neu-Funktion — Ausgabe-Identitaet bewiesen (Bestandstest + eigener Diff), vertretbar
   (G5), aber mehr als die Phase strikt verlangte.
3. `ASSISTANT_CONTEXT_ENABLED` wird in zwei Sonden-Zeilen genannt (Vorab-Briefing,
   Consult-Kanal) — rein kosmetisch, keine zweite Wahrheit.
4. `npm run test:gates` rot mit 3 bekannten Bestandsbefunden, kein Zusammenhang mit
   `boot.js`.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS**, `blocker: false`.

- **s1 (Blocker-Kategorie):** keine Befunde.
- **s2 (Blocker-Kategorie):** keine Befunde.
- **s3 (Struktur, kein Blocker):** die fuenf Wrapper-Funktionen
  (`precallBriefingProbeLine`/`researchProbeLine`/`lookupProbeLine`/`consultProbeLine`/
  `evidenceProbeLine`) sind fast wortgleiche Ein-Zeiler um `probeLine()` — waere als
  datengetriebene Tabelle etwas kompakter, aber Sonderfaelle (Lookup zweiteilig mit
  Secret-Redaction, Evidence mit Zahlenwert statt Bool) machen eine Tabelle nicht klarer
  lesbar. Bewusste Lesbarkeits-Entscheidung, kein Flag wert.
- **s4:** keine Befunde.

**passNotes (Auszug):** je Schalter ein Test fuer AN/AUS, dazu explizite Mutationsprobe
(AL-P16-7) und zwei Tests am echten gespawnten Boot-Log (AL-P16-8/9). Secret-Handling
korrekt (AL-P16-4/9, Regel 4). G5 sauber: `envState`/`envFlagState`/`probeLine` als EIN
Format, `evidenceProbeLine` referenziert bestehende Entscheidung statt zweiter
Zitat-Aus-Logik. G28/G34 eingehalten, Sonde faellt bewusst kein Gesamturteil (D1).
Kommentare aktuell und gegen `master` verifiziert, keine toten/auskommentierten Bloecke,
keine abgeschalteten Sicherungen.

**Hinweis zur Audit-Methodik:** Feldnamen wurden per `git show master:<pfad>` gegen den
echten `master`-Branch verifiziert, nicht gegen den Worktree-Dateisystem-Stand (der auf
einem anderen, unabhaengigen HEAD stand) — ein erster Durchgang haette sonst faelschlich
einen S1-Befund ("erfundene Config-Felder") gemeldet.

**topTodos:**
- Kein Pflicht-Todo — Phase ist mergefaehig.
- Optional/S4: bei einem sechsten Schalter die fuenf Wrapper-Funktionen auf eine kleine
  Tabelle umstellen.
- Bei zukuenftigen Audits: Worktree-HEAD vor Dateisystem-Reads gegen die zu pruefende
  Referenz abgleichen (Lehre aus dieser Phase).

---

## 6. Fix-Runden

Keine — Gate wurde im ersten Durchlauf mit PASS erreicht (Safety und Clean-Code beide
ohne Blocker). `=== FIXES ===` im Quellmaterial ist leer.

---

## 7. Deterministisch pruefbares Ergebnis (aus dem Plan)

```bash
cd "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent"
node --check src/boot.js                          # -> keine Ausgabe
node --test test/al-p16-boot-probes.test.js       # -> "# pass 9", "# fail 0"
npm test                                          # -> "# fail 0" (Regressionslauf gruen)
```

Erwarteter Banner-Block (alles aus) zwischen `Assistant-Pfad:`/`Denk-Signal:` und
`MCP (HTTP):`:

```
  Vorab-Briefing: aus (PRECALL_BRIEFING_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true
  Vorab-Recherche: aus (RESEARCH_ENABLED=false) - wirkt nur mit allowResearch am Tenant
  In-Call-Nachschlag: aus (LOOKUP_ENABLED=false) - EXA_API_KEY fehlt, wirkt nur mit allowLookup am Tenant
  Consult-Kanal: aus (CONSULT_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true und allowConsult am Tenant
  Ergebnis-Zitate: aus (EVIDENCE_RETENTION_DAYS=0) - 0 = keine Zitate
```
