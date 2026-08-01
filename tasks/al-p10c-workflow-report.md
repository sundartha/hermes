# AL-P10c — Detailbericht: In-Call-Such-Anbieter tauschen (Brave raus, Exa rein)

**Status:** Gate = PASS. `finalBranch = phase/al-p10c-exa` (Commit `34de249`, Basis `master @ cfbf2ce`).
**Wichtig fuer den Merge:** `LOOKUP_ENABLED` steht im Render-Dashboard bereits LIVE auf `true`. Solange `EXA_API_KEY` ungesetzt bleibt, ist der Pfad inaktiv (fail-closed); sobald der Key gesetzt wird, ist er sofort scharf — siehe Owner-Aufgaben unten.

---

## 1. Plan (gekuerzt)

**Auftrag:** In-Call-Such-Adapter (`look_up`) von Brave Search auf Exa umstellen — Ersatz, nicht Nebeneinander. `LOOKUP_ENABLED` ist bereits live an; der nie live gelaufene Brave-Adapter wird geloescht.

**Recherchierte API-Form (nachgeschlagen, nicht geraten — exa.ai/docs, abgerufen 2026-08-01):**
- Endpunkt: `POST https://api.exa.ai/search`, Auth-Header `x-api-key`
- Request: `{ query, type: "auto", numResults, contents: { highlights: true } }`
- Response: `{ results: [{ title, url, highlights: [...] }], costDollars }`
- `type="auto"` bewusst statt `fast`/`instant` gewaehlt: deren Zusammenspiel mit `contents` ist nicht dokumentiert (Lehre aus `cost-truing-leg-join-root-cause` — keine geratenen Feldnamen/Parameter). `auto` liegt mit ~1 s sicher unter `LOOKUP_TIMEOUT_MS=2500`.
- `contents.highlights` statt `contents.text`: gleicher Seitenpreis, aber weniger Egress/Injektionsflaeche/Latenz.

**Gebuehr `LOOKUP_SEARCH_FEE_CENTS`:** vorher eine Brave-Annahme, jetzt belegt gegen die Exa-Preisliste ($7/1k Anfragen + $1/1k Seiten): bei 3 geholten Treffern `0,7 + 3×0,1 = 1,0 US-Cent` — Startwert `1` bleibt, ist jetzt aber punktgenau, kein Puffer. Formel `Cent = 0,7 + 0,1 × Trefferzahl`; ab 4 Treffern waere der Wert Unterbuchung.

**Umfang laut Plan:**
1. Neue Datei `src/research/adapters/exa-search.js` (ersetzt `brave-search.js` 1:1, gleicher Port/Signatur, `numResults` importiert `LOOKUP_MAX_FACTS` statt eigener Konstante, wirft nie — `{ok:false,reason}`, Key nie geloggt/zurueckgegeben).
2. `git rm src/research/adapters/brave-search.js` — ersatzlos.
3. Edits: `src/research/registry.js` (Tabelleneintrag + Key-Pruefung), `src/config.js` (Keys/Kommentare/Namespace, Anzahl bleibt 7), `src/llm-usage.js` (nur Kommentar), `.env.example`, `render.yaml` (nur Secret-Key-Name, `LOOKUP_ENABLED: "false"` im Blueprint bleibt unangetastet), `test/helpers.js` BASE_ENV, `test/config-namespaces.test.js` (nur Kommentare, Counts 7/129/138 unveraendert), `test/al-p10b-lookup-hooks.test.js` (Kommentar), `README.md`, `PLAN-SECURITY.md`, `tasks/al-testcall-checklist.md`, `tasks/assistant-leap-chain.md`.
4. Tests: Bestandsdatei `test/al-p10b-lookup.test.js` bleibt inhaltlich unveraendert (15 Tests), nur die Mock-Naht wechselt von GET/Querystring auf POST/JSON. Drei neue Tests AL-P10c-1..3 (Anfrage-Form positiv pinnen, `filter(Boolean)`-Zweig bei fehlendem Highlight, Gebuehren-Relation zu `LOOKUP_MAX_FACTS` verriegeln).
5. Deterministische Pruefungen: `git grep -in brave` leer, 4 Fundstellen fuer `EXA_API_KEY` an den Pflichtstellen, `node --check`, isolierte + volle Testsuite, `git diff --stat` gegen erwarteten Blast-Radius.
6. Pre-Mortem im Plan: `LOOKUP_ENABLED` live an → Key ist einziger Riegel; Datenschutzerklaerung nennt bislang keinen Anbieter → als blockierende Owner-Aufgabe markiert; Gebuehr ohne Puffer → per Test verriegelt; API-Form-Fehlraten → belegt statt geraten, `!res.ok` faellt sicher; Latenz von `auto` passt rechnerisch zur Turn-Frist.

---

## 2. Implementierung — Zusammenfassung

Der Adapter-Tausch wurde exakt wie geplant umgesetzt: neuer Adapter `src/research/adapters/exa-search.js`, alter `brave-search.js` per `git rm` entfernt, `registry.js`/`config.js`/`llm-usage.js` sowie Doku und Tests nachgezogen.

- **Geld:** `LOOKUP_SEARCH_FEE_CENTS=1` ist jetzt gegen die Exa-Preisliste hergeleitet (0,7 + 3×0,1 Cent = exakt 1,0 Cent), kein Puffer. Test AL-P10c-3 verriegelt die Relation zu `LOOKUP_MAX_FACTS`, statt sie nur im Kommentar zu behaupten.
- **Spurenfreiheit:** `git grep -in brave -- src test .env.example render.yaml` gegen HEAD leer (Exit 1); `EXA_API_KEY` an allen vier Pflichtstellen (`src/config.js`, `.env.example`, `render.yaml`, `test/helpers.js`).
- **Tests:** 3695 → 3698 pass, fail 0. 15 Bestandstests aus AL-P10b inhaltlich unveraendert (nur Mock-Naht POST/JSON statt GET/Querystring). Drei neue Tests: AL-P10c-1 (Anfrage-Form positiv: Methode, Pfad, `x-api-key`, gesaeuberte Query, `numResults=LOOKUP_MAX_FACTS`, `contents.highlights=true`, `type=auto`), AL-P10c-2 (Treffer ohne `highlights` → reine Titelzeile, URL nie im Prompt), AL-P10c-3 (Gebuehrendeckung). Alle vier vorgesehenen Mutationsproben schlugen an und wurden zurueckgenommen.
- **Blast-Radius:** 15 Dateien (1 neu, 1 geloescht, 13 Edits). `src/research/in-call.js`, `src/research/ports.js`, `src/claude.js`, `src/bridge.js`, `src/store*`, `src/telephony/*`, `src/outbound-gates.js`, `src/budget-gate.js` unberuehrt (0 Diff-Zeilen).
- **Smoke:** `/healthz` → 200, sauberer Boot-Banner mit neuen Keys, kein Fatal wegen entfernter `BRAVE_*`-Env. Der eigentliche `look_up`-Pfad ist per curl nicht erreichbar (braucht aktiven Outbound-Call) — dafuer decken die 18 Tests gegen den lokalen Exa-Mock.

### Deviations (vom Impl-Agenten dokumentiert)

1. **Plan-interner Widerspruch aufgeloest:** Plan-Abschnitte 3.1/1 verlangten Kommentartexte mit dem Wort "Brave", waehrend Abschnitt 5 als Abnahmekriterium einen leeren `git grep -in brave`-Treffer forderte. Zugunsten des Abnahmekriteriums entschieden — Kommentare umformuliert ("Vorgaenger-Adapter" statt "Brave-Adapter"), Inhalt/Aussage unveraendert, Verweis auf PLAN-SECURITY.md/assistant-leap-chain.md/git-History fuer die Vorgeschichte.
2. **Blast-Radius:** 13 statt der im Plan (Abschnitt 5) genannten 12 Bestandsdatei-Edits — `test/al-p10b-lookup.test.js` war in Abschnitt 5 nicht mitgezaehlt, obwohl Abschnitt 4.1 die Umstellung ausdruecklich anordnet. Kein zusaetzlicher Scope, nur eine Zaehl-Luecke im Plan.
3. **`tasks/al-testcall-checklist.md`:** zusaetzlich zu den zwei im Plan genannten Stellen eine dritte Brave-Nennung (Freischaltungszeile AL-P10b-4) auf Exa gezogen sowie die aus dem Pre-Mortem geforderte blockierende Owner-Zeile (Datenschutzerklaerung muss Exa nennen, bevor der Key gesetzt wird) ergaenzt.
4. **Smoke-Test brauchte mehr Dummy-Env** als im Plan skizziert (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PUBLIC_URL, COST_TRUING_REQUIRED_RECORD_TYPES, geseedeter Tenant) — alles bestehende, fail-closed arbeitende Boot-Guards ohne Bezug zur Phase.

---

## 3. Safety-Urteil (final)

**Verdict: PASS** — Anbieter-Tausch sauber auf den Adapter-Platz begrenzt.

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, keine Blocker.
- **Unabhaengiger Test-Nachvollzug** (eigener Worktree, review-Branch aus `phase/al-p10c-exa`, exakt 1 Commit auf aktuellem master, keine Stale Base): erster `npm test`-Lauf 2 rote Tests (`cq-p8-briefing.test.js`, `telnyx-p5-origination.test.js`), beide isoliert nachgefahren gruen → Voll-Last-Flakes ausserhalb des Diffs (etabliertes Gate-Protokoll). Zweiter Lauf komplett gruen (3698/3698). `npm run test:gates`: 126/129, die 3 roten sind der dokumentierte Bestand (GAP-05, GAP-15×2), nichts AL-P10c-nah. Beide Store-Backends abgedeckt (json per Spawn-Default, pg per 169 pglite-Tests), alle gruen — AL-P10c fasst `src/store*` ohnehin nicht an.
- Zielunterlagentest `test/al-p10b-lookup.test.js` isoliert: 18/18 pass. `node --check`, ESLint, Prettier auf allen geaenderten Dateien ohne Befund.
- **Scope:** kein neuer Endpunkt, keine neue Route, kein neuer Call-/SMS-Ausloeser. Alle vier bestehenden Riegel (`lookupEnabled`, `assistantContextEnabled`, Budget-Engine, Richtung outbound+active + Kontingent 2/Anruf + Tenant-Recht + gesetzter Key) unveraendert. Fail-closed bestaetigt: leerer `EXA_API_KEY` → `inCallSearchProvider` gibt `null`.
- **Offenlegung/Auth/Secrets:** `disclosureSentence` byte-identisch, keine Auth-Datei/Route beruehrt, Key nur im Header gesendet, Fehlerantworten liefern nur `http_<status>` ohne Body/Query, Logs bleiben PII-frei (AL-P10b-14 prueft explizit gegen Query, Treffer, Key, Rufnummern).

### Concerns (keine Merge-Blocker)

1. **Gebuehr ohne Puffer, auf ungegenpruefter Preisbehauptung:** `LOOKUP_SEARCH_FEE_CENTS=1` deckt exakt 0,7+3×0,1 Cent; die Preisliste war offline nicht gegenpruefbar. Rechnet Exa je Highlight statt je Seite ab, unterbucht das die Budget-Achse still (Umsatzverlust, kein Gate-Umgehungsrisiko; `LOOKUP_MAX_PER_CALL=2` deckelt die Groessenordnung). **Vor Scharfschalten am echten Rechnungsbeleg gegenpruefen.**
2. **Doku-Drift ausserhalb des Diffs:** `tasks/al-owner-notes.md:59-60` sagt weiterhin woertlich "Anbieter ist Brave, nicht Exa"; `tasks/al-kickoff-prompt.md:15` nennt Brave "bindend"; `PLAN-ASSISTANT-LEAP.md:1150/1738` fuehrt Brave als getroffene Entscheidung. Kein Code-Effekt (repoweit Brave-frei in src/scripts/public/apps/render.yaml/.env.example), aber Risiko, dass ein kuenftiger Agent den alten Env-Namen wieder einschleppt.
3. **Betriebs-Scharfstellung:** `LOOKUP_ENABLED` steht seit 01.08. live auf `true` im Dashboard; `apps/web/src/pages/datenschutz.astro` nennt bis heute keinen Auftragsverarbeiter. Solange `EXA_API_KEY` ungesetzt bleibt, ist der Pfad inaktiv — aber sobald gesetzt, sofort scharf. Als blockierende Owner-Aufgabe markiert (AL-P10b-4 in `tasks/al-testcall-checklist.md`) — **darf beim Merge nicht als erledigt gelten.**
4. **Kosmetik:** ein Kommentar-Reflow in `src/llm-usage.js` laeuft ueber die umgebende Zeilenbreite hinaus; `prettier --check` ist gruen, reiner Schoenheitsfehler.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS**, `blocker: false`.

- **s1 (Blocker):** keine.
- **s2 (Blocker):** keine.
- **s3 (kosmetisch):** eine Fundstelle — `test/al-p10b-lookup.test.js`: die drei neuen AL-P10c-Tests seeden Calls unter den alten IDs `call_alp10b_19`/`call_alp10b_20` statt `call_alp10c_...` (N4/Konsistenz). Keine Funktionsauswirkung, optional bei Gelegenheit umbenennen.
- **s4:** keine.

**Begruendung:** sauberer 1:1-Anbietertausch — alte Datei entfernt statt danebengelegt (kein toter Code), neuer Adapter uebernimmt exakt das Vertragsmuster (nie werfen, `{ok,reason}`, Key nie geloggt). Verbesserung gegenueber dem Vorgaenger: `RESULT_COUNT`-Duplikat entfernt, `LOOKUP_MAX_FACTS` als EINE Quelle importiert (G5/G25). Gebuehr per Test AL-P10c-3 als Relation verriegelt statt als geratener Fallback. AL-P10c-1 pinnt erstmals positiv die Anfrage-Form, AL-P10c-2 deckt den `filter(Boolean)`-Zweig ab. Alle 6 alten Zusagen (Gates, Geld, Egress, Injektion, Logs, Realtime-Ausschluss) unveraendert gruen. Kommentare durchgehend ohne Umlaute, API-Form/Preis ausdruecklich "nachgeschlagen, nicht geraten" mit Datum/Quelle belegt.

**Top-TODOs:**
1. Vor produktivem Freischalten: Owner-Aufgabe aus `tasks/al-testcall-checklist.md` abarbeiten (`EXA_API_KEY` setzen, Datenschutzerklaerung Exa als zweiten Auftragsverarbeiter nennen) — reine Betriebsaufgabe, kein Code-Befund.
2. Optional: neue Test-Call-IDs auf `call_alp10c_*` umbenennen (kosmetisch).

---

## 5. Fix-Runden

Keine — die erste Implementierung bestand beide Reviews (Safety PASS, Clean-Code PASS) ohne Nacharbeit. Der `=== FIXES ===`-Abschnitt der Quelle ist leer.

---

## 6. Offene Owner-Aufgaben (nicht Code-Scope)

1. Datenschutzerklaerung (`apps/web/src/pages/datenschutz.astro`) muss Exa als zweiten Auftragsverarbeiter nennen, **bevor** `EXA_API_KEY` gesetzt wird — `LOOKUP_ENABLED` ist bereits live an.
2. `EXA_API_KEY` im Render-Dashboard setzen (erst nach Punkt 1).
3. Vor Scharfschalten: Exa-Preisliste ($7/1k Anfragen + $1/1k Seiten) am echten Rechnungsbeleg gegenpruefen (Concern 1).
4. Bei Gelegenheit: Doku-Drift in `tasks/al-owner-notes.md`, `tasks/al-kickoff-prompt.md`, `PLAN-ASSISTANT-LEAP.md` nachziehen (nennen weiterhin Brave).
