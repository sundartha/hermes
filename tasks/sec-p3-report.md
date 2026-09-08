# Phase SEC-P3 — Eingabegrenzen + CSRF

- **Gate:** PASS
- **finalBranch:** `sec/p3-fix1`
- **Datum:** 2026-09-09

## Plan (gekuerzt)

**Ausgangslage:** genau ein ungedeckeltes prompt-gebundenes Freitextfeld auf dem
Self-Service-Schreibweg — `agentName` (laeuft in `PROMPT_DE/EN/FR.persona`, wird im
ersten Satz gesprochen). Alle anderen Prompt-Felder tragen den Deckel bereits
(`TEXT_LIMITS` in `src/routes/_validation.js`). Keine Origin-/CSRF-Pruefung existiert;
der Self-Service-Router wird in `src/wiring/web-login.js` **vor** `/voice`, static und
`registerApiRoutes` gemountet — ein nacktes `router.use(mw)` liefe an jedem spaeteren
Request entlang, `/voice/incoming` eingeschlossen.

**Entscheidungen (D1–D10):**
- D1 Herkunftspruefung = Origin-Host gegen Request-Host, keine Allowlist.
- D2 nur Host verglichen, kein Schema (Proxy terminiert TLS; `X-Forwarded-Proto` waere spoofbar).
- D3 Montage per Praefix `router.use("/api/self-service", mw)`, nicht global, nicht per Einzelroute.
- D4 `AGENT_NAME_MAX_LEN` wird **keine** Env — der Deckel lebt in `TEXT_LIMITS` (dieselbe Frage, dieselbe Hausquelle, kein Drift).
- D5 `CSRF_ENFORCE` wird Env (`config.safety.csrfEnforce`, Default `true`) als Rueckfall-Hebel ohne Deploy.
- D6 `CSRF_ENFORCE=false` kommt NICHT in `PRODUCTION_FOOTGUNS` — ein Not-Aus, der den Boot verweigert, ist kein Not-Aus.
- D7 fail-closed kodiert: nur der Literalwert `false` schaltet ab.
- D8 Laenge in Codepoints (`[...value].length`), keine Zeichen-Allowlist — nur C0/C1-Steuerzeichen verworfen.
- D9 Nicht-Strings bleiben unveraendert (Bestandsverhalten von `updateSettings`).
- D10 Grenzwert 80 Zeichen fuer `agentName`.

**Neue Dateien:** keine. Edits in `src/middleware.js` (`crossOriginRequest` + `createSameOriginGuard`), `src/util.js` (`AUTH_FAILED_GRUND.CROSS_ORIGIN`), `src/routes/_validation.js` (`TEXT_LIMITS.agentName=80` + `promptLineRejection`), `src/self-service-routes.js` (Praefix-Montage + 400-Check vor Schreibzugriff), `src/config.js` (`csrfEnforce`), `.env.example`, `render.yaml`, `test/helpers.js` (BASE_ENV), `test/config-namespaces.test.js` (Zaehler), `PLAN-SECURITY.md` (Owner-Entscheidungs-Anhang).

**Tests:** neue Datei `test/sec-p3-eingabegrenzen-csrf.test.js` (Einheits- + pglite-Integrationsfaelle: Grenze/Grenze+1, Gross-/Kleinschreibung, kein Origin passiert, fremder Origin 403 auf allen vier Schreibrouten ohne Zustandswechsel, sichere Methoden unberuehrt, `CSRF_ENFORCE=false`-Rueckfall, Codepoint- statt UTF-16-Zaehlung mit Zoe/kyrillisch/chinesisch).

## Impl-Zusammenfassung

- headCommit (Ausgangsstand): `6ed2de2d5a4a604f9f73b2e4c862d2d6b6f14903`
- `node --check` gruen auf allen geaenderten Dateien; Tests gruen: **149 pass / 0 fail** ueber die 15 betroffenen Testdateien (inkl. `headers.test.js`, `config-shape.test.js`, `boot-guard.test.js`).
- Umgesetzt: `crossOriginRequest`/`createSameOriginGuard` in `src/middleware.js` (Vergleichsanker `req.headers.host`, nicht `req.hostname`), `promptLineRejection`/`TEXT_LIMITS.agentName=80` in `src/routes/_validation.js`, Praefix-Montage in `src/self-service-routes.js`, `CSRF_ENFORCE` durchverdrahtet (`config.js`, `.env.example`, `render.yaml`, BASE_ENV), Owner-Entscheidungs-Block in `PLAN-SECURITY.md`.
- Smoke-Test: echter Server-Boot, `GET /healthz` -> 200; entscheidende Gegenprobe `POST /voice/incoming` mit fremdem Origin -> **200** (Riegel fasst `/voice` nicht an). Die vier Self-Service-Routen lokal nicht erreichbar (SELF_SERVICE_ENABLED braucht MULTI_TENANT+pg+SESSION_SECRET) — dafuer deckt der pglite-Integrationstest den vollen HTTP-Weg ab.

### Deviations
1. **COMMIT BLOCKIERT (Hauptbefund):** `pre-commit`-Hook (`check-staged-suppressions.js`) lehnte `src/self-service-routes.js` ab, weil `makeSelfServiceRoutes` durch die 6 neuen Zeilen von 418 auf 424 Zeilen waechst und der `max-lines-per-function`-Suppressionsschluessel die Zeilenzahl traegt (bereits 4x ueber Limit, seit jeher eingefroren). Beide sanktionierten Auswege (Datei komplett lint-rein machen, oder ein Eintrag in `eslint-legacy-exceptions.json`) lagen ausserhalb des Mandats — `--no-verify` ist laut Hook/CLAUDE.md keine Option. Stand lag vorgemerkt (`git add`) im Worktree-Branch `sec/p3`, nicht committet.
2. Zwei planwortlaut-Abweichungen, beide verhaltensgleich, vom Repo-Linter erzwungen: (1) `res.status(403|400)` -> benannte Konstanten `HTTP_FORBIDDEN`/`HTTP_BAD_REQUEST` (`no-magic-numbers`); (2) Control-Char-Regex -> Codepoint-Praedikat mit benannten Grenzen `C0_LETZTER`/`DEL`/`C1_LETZTER` statt regulaerem Ausdruck mit Steuerzeichen (`no-control-regex`).
3. `test/config-namespaces.test.js` brauchte drei Zaehler statt einem: `safety` 13->14 (geplant), `EXPECTED_TOTAL_KEYS` 183->184 und `EXPECTED_PRIMITIVE_LEAVES` 171->172 (im Plan uebersehen, rein mechanisch).
4. Testfile hat 21 statt 20 geplante Faelle — `u12` (Emoji-Grenzlaenge) ergaenzt, beweist Codepoint- statt UTF-16-Zaehlung.
5. Manueller Rauchtest konnte die vier Schreibrouten lokal nicht anfahren (Postgres-Abhaengigkeit) — abgedeckt durch pglite-Integrationstest.
6. `npm test` (volle Suite) wurde auftragsgemaess nicht gefahren, nur die 15 betroffenen Dateien.

## Safety-Urteil

**Verdict: PASS.** Alle Absoluten Regeln geprueft und intakt:
- **SAFETY-GATES** unberuehrt (Diff fasst outbound-gates/state-ops/numberGateError nicht an); Hauptrisiko (Riegel faengt `/voice` ab) live widerlegt (200 trotz fremdem Origin).
- **OFFENLEGUNG**: `claude.js`/`bridge.js` kommen im Diff nicht vor.
- **AUTH FAIL-CLOSED**: nur Zusatzschicht, keine Entfernung; unklare Faelle (opaker/unparsbarer Origin, fehlender Host) -> 403; `enforce !== false` statt `Boolean(enforce)` — vermuellter Env-Wert laesst die Sicherung scharf.
- **SECRETS/AUDIO**: Antworten echoen weder Origin noch abgelehnten Wert.
- **SCOPE**: keine neue Dependency, kein Extra ausserhalb SEC-P3.
- **VERHALTEN wie beabsichtigt**: `CSRF_ENFORCE=false` liefert sofort `next()` (Test b5).

**Concerns (keine Blocker):**
1. Forensik-Defekt: die `auth_failed`-Zeile des neuen Riegels traegt einen **mount-relativen** Pfad (`path=/settings` statt `/api/self-service/settings`), weil `createSameOriginGuard` in einem gemounteten Sub-Router laeuft — der Code-Kommentar behauptet faelschlich Gleichlauf mit den Bestands-Sicherungen. Fix: `req.baseUrl + req.path` statt `req.path`.
2. Restrisiko ausserhalb der Phasen-Reichweite: `POST /api/admin/tenants/:id/approve|suspend` und `POST /auth/logout` bleiben ohne Herkunftspruefung (Cookie-Auth, echte CSRF-Ziele mit Folgewirkung). Der neue "Reichweite"-Abschnitt in `PLAN-SECURITY.md` nennt sie nicht namentlich — sollte nachgetragen werden (Kandidat SEC-P5/P6).
3. Reihenfolge: `agentName`-Validierung laeuft vor `webAuthMw` — unauthentifizierter Aufrufer bekommt 400 statt 401 (kein Leak, aber Abweichung vom Hausmuster "erst Identitaet, dann Inhalt").
4. Kosmetischer Pin-Drift: Testname in `config-namespaces.test.js` nennt weiterhin "183 Keys" trotz Zaehler-Update auf 184.
5. Host-Vergleich normalisiert Standard-Port weg; ein Proxy mit explizitem `:443` im Host-Header wuerde legitimen Verkehr sperren (fail-closed, `CSRF_ENFORCE=false` ist der dokumentierte Rueckfall).
6. Testfile traegt ein literales 0x7F-Byte im Quelltext (u10) — getragenes Risiko, wird laut rot statt still gruen, falls ein Editor es je schluckt.
7. Drift-Naht ohne Waechter: `makeSelfServiceRoutes` bleibt ohne Riegel montierbar exportiert; nur ein Produktions-Mount existiert heute, nichts pinnt das strukturell (Kandidat SEC-P6).

## Clean-Code-Audit (S1–S4)

- **S1:** keine Befunde.
- **S2:** keine Befunde.
- **S3:** Info (kein Fix noetig) — `rejectInvalidAgentName` laeuft vor `webAuthMw`, auch unauthentifizierte Aufrufer erhalten das 400-Ergebnis (kein Daten-Leak, Grenze ist ohnehin oeffentlich dokumentiert).
- **S4:** kein struktureller Befund — Funktionen klein, Konstanten benannt, Verantwortlichkeiten sauber getrennt (`createSameOriginGuard` rein CSRF, `rejectInvalidAgentName`/`promptLineRejection` rein Eingabegrenze, `mountSelfServiceRoutes` nur Verdrahtung/Reihenfolge).

**Verdict:** PASS. Keine S1/S2-Blocker. Sehr sorgfaeltige Doku (jede Design-Entscheidung inkl. verworfener Alternativen kommentiert). G5 (eine Audit-Quelle wiederverwendet), G25 (Magic Numbers benannt), G28 (Praedikate gekapselt), G36 (kein Train-Wreck) erfuellt.

**Top-Todos (optional, kein Pflicht-Todo):**
- Optional: `promptLineRejection`-Check nach `webAuthMw` verschieben, falls die Vor-Auth-Bestaetigung der Laengengrenze je als unerwuenscht bewertet wird.
- Bei kuenftigem zweiten prompt-gebundenen Freitextfeld pruefen, ob `promptLineRejection` generisch genug bleibt.

## Fix-Runden

**Runde r1 (Review-Fix):** Der Branch `sec/p3` war leer (0-Byte-Diff gegen `master`) — die Implementierung war zwar real erfolgt, aber nie committet; die Diffs lagen uncommitted in einem Sibling-Worktree (`wf_a8b13fc0-9a4-2`). Fix: die uncommitted Arbeit aus diesem Sibling-Worktree uebernommen und auf `sec/p3-fix1` committet. Anschliessender unabhaengiger Review-Lauf (frischer Worktree `review-sec-p3-r1` auf `sec/p3-fix1`): 149/149 pass + zusaetzlich `test/web-login-wiring.test.js` 5/5 pass, `node --check` gruen, eigene Laufzeitsonde bestaetigt Riegel greift auf `/api/self-service/settings` (403) und laesst `/voice/incoming` sowie `/api/admin/tenants/x/approve` unberuehrt (200). Ergebnis: **PASS**, finalBranch = `sec/p3-fix1`.
