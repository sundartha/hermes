# Uebergabe an die naechste Session (2026-08-07)

## Wie du diesen Text liest

Der Autor dieser Datei hatte am Ende eine sehr lange Session und wenig Kontext uebrig.
**Behandle jede Bewertung hier als unbestaetigt.** Der Text ist in drei Sorten getrennt:

- **GEMESSEN** — mit dem Kommando dabei. Miss nach, wenn etwas daran haengt.
- **VERMUTUNG** — eine Schlussfolgerung des Vorgaengers. Kann falsch sein. Nicht darauf
  aufbauen, ohne sie selbst zu pruefen.
- **AUFGABE** — was zu tun ist. Ohne Loesungsvorgabe.

Wo GEMESSEN und VERMUTUNG kollidieren, gilt das Kommando, nicht der Satz.

---

## 1. Zuerst lesen

| Reihenfolge | Datei | wozu |
|---|---|---|
| 1 | `CLAUDE.md` | Absolute Regeln. **Regel 1 wurde am 2026-08-07 geaendert** (Twilio-HMAC-Pruefung entfernt, Owner-Freigabe eingetragen) — lies den Eintrag, bevor du irgendetwas an Signaturen anfasst |
| 2 | `.claude/refs/workflow.md`, `.claude/refs/clean-code.md` | Pflicht bei nicht-trivialen Tasks |
| 3 | `PLAN-ANBIETER-PORT.md` | Track B (LLM-Anbieter-Port) + Track C (Twilio raus), inkl. Stand-Tabelle und offener Owner-Entscheidungen |
| 4 | `tasks/todo.md` | Track A (STT), Belege und die offene Anbieter-Frage |
| 5 | `tasks/lessons.md`, letzte ~6 Abschnitte | die Fehler dieser Session, damit sie sich nicht wiederholen |
| 6 | `tasks/gq-chain-state.md` (mit `grep -n`, nicht am Stueck) | Gespraechsqualitaet; dort stehen P2/P3 als bindende Owner-Vorgaben |

---

## 2. Was tatsaechlich passiert ist (GEMESSEN)

```
git log --oneline 5865b96..HEAD        # alles, was diese Session gemacht hat
curl -s https://vodafone-agent.onrender.com/healthz   # was LIVE laeuft
```

- **Live laeuft `5865b96`** (Track A / STT-A1). Alles danach liegt auf lokalem `master`
  und ist **nicht deployt**; `upstream/master` steht ebenfalls auf `5865b96`.
- Gemergt auf lokalem `master`: C-P1, C-P1b, C-P2, C-P3 (Track C).
- **C-P4 (Twilio-Adapter entfernen) lief beim Sessionende.** Stand pruefen:
  `git log --oneline master..phase/c-p4-adapter-entfernen` — leer heisst: nicht gebaut.
- Letzter eigener Volllauf auf `master`: `npm test` 4057/4057, Exit 0.

**Vor jedem Merge eines Phasen-Branches:** `git log master..<branch>` und `git diff --stat`
selbst ansehen. In dieser Session hat ein Impl-Agent das Gate mit PASS bestanden und dabei
einen **leeren** Branch hinterlassen (C-P2).

---

## 3. Offene Aufgaben

### AUFGABE A — C-P4 neu aufsetzen. Der Lauf ist FEHLGESCHLAGEN.

**GEMESSEN:** der `phase-impl-lean`-Lauf fuer C-P4 brach ab — der Impl-Agent beendete, ohne
`StructuredOutput` zu rufen (dieselbe Fehlerklasse wie bei C-P2). Es gab deshalb **keinen
Review, keinen Testlauf-Nachweis, keinen Report**.

Der Zwischenstand ist gesichert, damit er nicht mit dem Worktree verschwindet:

```
git show --stat 8e644c1        # Branch phase/c-p4-adapter-entfernen, 59 Dateien
```

> **NICHT ungeprueft mergen.** An diesem Commit haengt kein einziger Beleg. Zusaetzlich
> ueberschreitet er sichtbar den Scope aus `tasks/c-p4-spec.md` Abschnitt 3: `ONBOARDING.md`,
> `START-DEMO.command`, `scripts/check-setup.js` und ein Rename
> `scripts/set-webhooks.js -> scripts/set-public-url.js` gehoeren laut Spec erst nach C-P5.

Zwei Wege, beide vertretbar:
- den Lauf fortsetzen:
  `Workflow({scriptPath: ".claude/workflows/runs/c-p4.js", resumeFromRunId: "wf_4303ac5c-b9a"})`
  (das per-run-Skript liegt evtl. schon im Aufraeum-Commit — dann aus der Historie holen)
- oder den Commit als Materialsammlung lesen und die Phase frisch bauen.

Spec: `tasks/c-p4-spec.md`, Abnahme dort in Abschnitt 5. **Die Registry-Invariante in
`test/telephony-registry.test.js` ("jeder PROVIDER-Wert ist in jedem Full-Coverage-Port
registriert") darf nicht abgeschwaecht werden** — bleibt sie rot, ist der Ausbau
unvollstaendig.

### AUFGABE B — C-P5: Config, Boot-Pflicht, Env, Doku

Noch nicht spezifiziert. Betroffen sind mindestens: `src/config.js` (`twilioSid`,
`twilioToken`, `assertConfig`), `.env.example`, `render.yaml`, `BASE_ENV` in
`test/helpers.js`, `README.md`/`ONBOARDING.md`.

> **GEMESSEN, und hier haengt ein Ausfall dran:**
> ```
> grep -n "TWILIO_ACCOUNT_SID" src/config.js     # :1669-1670, unbedingte Boot-Pflicht
> curl -s https://vodafone-agent.onrender.com/healthz   # Dienst laeuft -> Keys sind gesetzt
> ```
> Die Boot-Pflicht ist **unbedingt**, und der Live-Dienst startet. Daraus folgt: die Keys
> sind in der Render-Umgebung gesetzt. **Reihenfolge nicht vertauschen** — erst den Code,
> deployen, verifizieren, dann die Render-Keys. Read-only kommt man an die Render-Env mit
> den vorhandenen Werkzeugen nicht heran (das MCP hat nur einen schreibenden Zugang).

Zweite bekannte Falle: eine aus `config.js` entfernte Env-Variable muss auch aus `BASE_ENV`
raus, sonst leckt die echte `.env` in Spawn-Tests (`tasks/lessons.md`, "BASE_ENV-Drift").

### AUFGABE C — Track B: LLM-Anbieter-Port

**Nicht begonnen.** `PLAN-ANBIETER-PORT.md`, Teil 2. Blockiert an einem DeepSeek-API-Schluessel
(Owner) — Phase B1 ist eine Messung an der echten API.

> **VERMUTUNG des Vorgaengers, ausdruecklich ungeprueft und wahrscheinlich zu revidieren:**
> Der Plan enthaelt einen Abschnitt ueber Cache-Preise und die Form von
> `config.modelPricesUsd`. Der Owner hat dem am Sessionende **widersprochen**: ihn
> interessiert nicht, wie sich der Preis zusammensetzt, sondern **was der Anbieter dem
> API-Key tatsaechlich abbucht**. Der Vorgaenger hat daraufhin vorgeschlagen, es wie
> `cost-truing` bei Telnyx zu machen (live schaetzen, nachgelagert gegen die echten
> Anbieter-Daten abgleichen) — **das ist ein Vorschlag, kein Beschluss, und nichts davon ist
> gebaut oder geprueft.** Der Plan ist an dieser Stelle NICHT nachgezogen worden.
>
> Belege, die dabei entstanden sind (nachpruefbar, unabhaengig von der Bewertung):
> - `https://api-docs.deepseek.com/api/create-chat-completion` — `usage` liefert
>   `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`,
>   `prompt_cache_miss_tokens`, `total_tokens`. **Kein Geldfeld.**
> - `https://api-docs.deepseek.com/api/get-user-balance` — `total_balance` in USD/CNY.
> - Bestehendes Muster im Repo: `src/billing/cost-truing.js` + `src/billing/cost-ledger-map.js`.
>
> **Fang hier mit dem Owner an, nicht mit dem Plandokument.**

### AUFGABE D — Abnahme-Anruf fuer Track A (braucht den Owner)

`tasks/todo.md`, Schritt 6. Nach dem Anruf: `node scripts/stt-wer.mjs <call_session_id>`.
Vorher-Wert **8,9 %** (`call_mshgg6ijtyul`), Eigenrauschen ~±1,5 Punkte.

### AUFGABE E — Die offene Anbieter-Frage (ein Anruf entscheidet sie)

`tasks/todo.md`, Schritt 7. Ersetzt der Telnyx-Pro-Call-`transcription`-Block die `settings`
des Assistant-Objekts, oder werden sie zusammengefuehrt? Versuchsaufbau und der Preis
(das Modell faellt dabei auf einen englisch-only Default) stehen dort ausformuliert.

---

## 4. Was in dieser Session GEMESSEN wurde (mit Kommando)

Nutze das, statt es neu zu erarbeiten — aber miss nach, bevor eine Entscheidung darauf steht.

| Behauptung | Kommando |
|---|---|
| Produktions-DB: 3 Tenants, 3 Nummern, 67 Anrufe, **0 auf Twilio** | `psql "$(cat ~/.config/hermes/db-url)"`; RLS ist FORCE -> `select set_config('app.current_tenant','<id>',false);` je Tenant, dann `select provider, count(*) from number;` |
| Telnyx: Pro-Call-`transcription` kennt nur `model`+`language`, das Assistant-Objekt zusaetzlich `settings` | OpenAPI `https://raw.githubusercontent.com/team-telnyx/openapi/master/openapi/spec3.json`, Schemata `TranscriptionConfig` vs. `TranscriptionSettings` |
| Live-Assistant traegt flux-only-Felder an einem nova-3-Modell | `node scripts/telnyx-stt-drift.mjs` (braucht `TELNYX_API_KEY` + `TELNYX_ASSISTANT_ID`) |
| Es gibt **keine** `/voice/twilio/*`-Routen; der Provider kommt aus Headern | `src/telephony/registry.js` `providerFromHeaders`, `src/route-policy.js` |
| Sprengradius einer Aenderung, bevor man sie baut | Wegwerf-Worktree: `git worktree add --detach <tmp> master`, Aenderung anwenden, `npm test`, rote Tests namentlich auflisten |

---

## 5. Wo der Vorgaenger sich geirrt hat (damit du es nicht wiederholst)

Alles ausfuehrlich in `tasks/lessons.md`. Kurz:

1. **C-P1 hat selbst einen Defekt erzeugt.** Beim Umstellen eines Defaults wurde nach dem
   Namen der Konstante gegrept statt nach dem **Wert** — fuenf weitere Defaults standen als
   Parameter-Default an anderer Stelle. Behoben in C-P1b.
2. **Ein Gate-PASS ist keine Merge-Freigabe.** Drei echte Defekte kamen erst durch eigene
   Gegenproben ans Licht (Sabotage einbauen, Rot sehen, zurueckbauen).
3. **Ein Pruefwerkzeug, das bei null Befunden schweigt**, ist von einem kaputten nicht zu
   unterscheiden. Passiert mit `scripts/telnyx-stt-drift.mjs`.
4. **Nicht auf laufende Workflows blockieren** — die Benachrichtigung kommt von selbst.
5. **Der Vorgaenger hat eine Kosten-Aussage ueberzogen** ("Abrechnungsdefekt auf dem
   Kundenbeleg") und musste sie zuruecknehmen: KI-Token stehen auf keiner Kundenrechnung,
   der Kunde zahlt einen Plan mit enthaltenen Minuten. **Das ist das Muster, vor dem diese
   Datei warnt** — plausibel klingende Schluesse, die niemand nachgerechnet hat.
