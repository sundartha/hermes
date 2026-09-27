# Phase E5 — Origin-Pruefung auf `/mcp` mit Notventil `MCP_ORIGIN_ENFORCE`

- **Gate:** PASS
- **finalBranch:** `phase/openai-e5-origin-wache`
- **headCommit:** `c044a54`

## Plan (gekuerzt)

Neue Herkunftswache (DNS-Rebinding-Schutz, MCP-Spec T-06) auf `/mcp`, als `router.use("/mcp", createMcpOriginGuard(...))` VOR `mcpAuth` gemountet. Sie prueft nur die HERKUNFT (Origin-Header), ersetzt `mcpAuth` (Identitaet) nicht und schwaecht sie nicht ab.

Kernbausteine (`src/middleware.js`, neu, neben `crossOriginRequest`):
- `normalisierterOrigin(wert)` — reines Praedikat, parst nur absolute `http(s)`-Origins (Schema-Gate ist Pflicht: `new URL("foo://Bar").origin === "null"` als String — ohne Gate koennte ein unparsbarer Allowlist-Eintrag auf denselben Muellwert matchen).
- `mcpErlaubteOrigins({publicUrl, zusaetzlicheOrigins})` — EINE Stelle, die die Allowlist bildet: `publicUrl` (angekuendigter Origin) + additive `MCP_ALLOWED_ORIGINS`, Muell verworfen, leer = deny-all.
- `mcpOriginErlaubt(originHeader, erlaubteOrigins)` — kein Header = `true` (S2S/stdio/Bestandstests unveraendert); vorhanden aber unparsbar = `false`; sonst Mengenvergleich normalisiert.
- `originLogWert(originHeader)` — nur zeichenklassen-gefilterter Host (<=64 Zeichen) oder Sentinel `"unlesbar"` ins Log, nie der Rohwert.
- `createMcpOriginGuard({erlaubteOrigins, enforce})` — Express-Adapter; `enforce !== false` (Bauform wie `csrfEnforce`); bei Ablehnung `403 {error:"cross_origin_blocked"}` + `auditAuthFailed(req, AUTH_FAILED_GRUND.MCP_CROSS_ORIGIN, "origin=<host>")`.

Notventil `MCP_ORIGIN_ENFORCE` (Owner-Entscheidung E-4, Default `true`/scharf): einziger Reparaturweg ohne Deploy, weil die 403 VOR `mcpAuth` laeuft und ein Origin-sendender Client bei Ablehnung `WWW-Authenticate` (den einzigen PRM-Zeiger) nie sieht — ohne Notventil waere ein Aussperren nur per Deploy heilbar. `enforce=false` schreibt bewusst KEINE Audit-Zeile ("ein geloester Riegel soll nicht aussehen wie ein greifender"). Bewusst NICHT in `PRODUCTION_FOOTGUNS` (ein Not-Aus darf den Boot nicht verweigern).

Boot-seitiger Riegel (`src/boot-guard.js`: `angekuendigterOriginFindings`, `src/boot.js`: `assertAngekuendigterOrigin`, 14. `exit(1)`-Gate): erzwingt Eindeutigkeit des angekuendigten Origins — `OAUTH_AUDIENCE` (falls gesetzt) muss exakt der kanonischen `<PUBLIC_URL>/mcp`-Audience entsprechen (schraegstrich-tolerant), `PUBLIC_URL` ohne Pfad/Query/Fragment und in Produktion https, jeder `MCP_ALLOWED_ORIGINS`-Eintrag parsbar. Grund: Token-Audience (`src/auth.js audience()`) und PRM-`resource` duerfen nie stillschweigend auseinanderlaufen — sonst kann sich der Client nie erfolgreich autorisieren, ohne dass es jemand merkt.

Bestandsdateien mit Edits: `src/util.js` (neue Audit-Vokabel `MCP_CROSS_ORIGIN` + optionales `detail`-Argument, byte-identisch ohne Argument), `src/routes/mcp.js` (Mount + Kommentar), `src/app.js` (Kommentar), `src/config.js` (`mcpAllowedOrigins`, `mcpOriginEnforce`, Namespace-Eintrag), `.env.example`, `render.yaml` (`PUBLIC_URL` jetzt explizit statt implizit von `RENDER_EXTERNAL_URL` geerbt), `test/helpers.js` (BASE_ENV: beide neuen Env-Vars neutral gepinnt, Lehre `test-base-env-drift`).

Neue Testdatei `test/s2-mcp-origin.test.js` als EINZIGER Regressionsanker — `router.use`-Schichten sind fuer `collectRoutes` in `test/route-auth-inventory.test.js` unsichtbar, daher darf diese Datei nie geloescht, geskippt oder mit Katalog-Praefix versehen werden. 16 Einheits-Faelle (Praedikate/Normalisierung/Boot-Findings), 15 HTTP-Faelle (Spawn-Server: Origin-Treffer, Fehltreffer, Methoden GET/DELETE/OPTIONS, Pfadbindung `/mcp/foo`, Forensik-Log, Formel-Pin PRM.resource, additive Allowlist, Notventil), 5 Boot-Faelle (Audience-Divergenz, Pfad in PUBLIC_URL, unparsbare Allowlist, Hosting-ohne-https, Happy-Path-Schraegstrich).

Zwei vom urspruenglichen Spec uebersehene Bestandskollisionen bereits im Plan vorhergesagt: `test/config-namespaces.test.js` (gepinnte Zaehler `safety`/`EXPECTED_TOTAL_KEYS` muessen um 2 steigen) und `test/oauth.test.js` (ein Bestandstest pinnt exakt den divergenten `OAUTH_AUDIENCE`-Override als Betriebszustand, den der neue Boot-Riegel zum Refusal macht — muss ersetzt werden).

Bewusst NICHT umgesetzt (Scope): A9/Etappe 8 (Live-Werte lesen, Deploy) — bleibt separater Betriebsschritt mit Pflicht-Voice-Smoke vor jedem `PUBLIC_URL`-Wechsel.

## Impl-Zusammenfassung

- headCommit `c044a54`, alle Node-Checks gruen, `npm test` 6104/6104 gruen (0 rot), Commit erfolgt.
- Bearbeitete Dateien: `src/middleware.js`, `src/routes/mcp.js`, `src/util.js`, `src/config.js`, `src/boot-guard.js`, `src/boot.js`, `src/app.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/oauth.test.js`, `test/config-namespaces.test.js`, `eslint-suppressions.json`.
- Neue Datei: `test/s2-mcp-origin.test.js` (42 Faelle statt geplanter 36: 16 Einheit + 15+2 HTTP-Subfaelle + 5 Boot — Aufteilung aus Lint-Gruenden `max-lines-per-function`, gleicher Testinhalt).
- Smoke gegen echten Spawn-Server bestanden: fremder Origin -> 403 `{"error":"cross_origin_blocked"}`; ohne Origin unveraendert; `OPTIONS` ohne Origin -> 200, mit fremdem Origin -> 403; Audit-Log zeigt exakt `grund=mcp_cross_origin origin=evil.example`, kein Rohtext.

### Deviations

1. Zwei vom Spec-Text uebersehene, aber im Plan bereits vorhergesagte Bestandskollisionen gefixt: `test/config-namespaces.test.js` (Counts 15/196/183 -> 17/198/184) und `test/oauth.test.js` (divergenter-Override-Test durch Boot-Refusal-Test ersetzt — bewusste Ruecknahme der AM6-Faehigkeit, laut Plan live kostenfrei).
2. H12 (PM-7 Positiv-Kontrolle) nicht wie geplant gegen `POST /api/self-service/settings` getestet (Route im Default-Testumfeld ungemountet, eigenstaendig anderswo abgedeckt); stattdessen `GET /healthz` und `GET /api/plans` bleiben mit fremdem Origin unberuehrt — deckt dieselbe Pfadbindungs-Aussage ohne zweite pg-Kompositionsumgebung.
3. Beim Commit erzwang `check-staged-suppressions.js` eine zusaetzliche vollstaendige Lint-Bereinigung von `test/oauth.test.js` (id-length, no-magic-numbers auf 0) — vom Plan nicht vorgesehen, aber vom Commit-Gate erzwungen; `eslint-suppressions.json` entsprechend geprunt (ein Eintrag).
4. Zwei Kommentar-Formulierungen mit "WWW-Authenticate-Header" mussten umformuliert werden (`src/middleware.js`, `src/config.js`), weil sie den Quelltext-Scan-Test `test/auth-p7-gate-removed.test.js` (AUTH-P7-8) brachen — inhaltlich unveraendert, nur als "401-Bearer-Challenge (`src/auth.js`, `deny401`)" umformuliert.
5. H07 im Plan als ein Fall spezifiziert, wegen `max-lines-per-function` in H07a/b/c aufgeteilt; gleicher Testinhalt.
6. Zweiter `describe`-Block fuer HTTP-Methoden/Pfad/Forensik/Formel-Pin (statt ein Block wie im Plan) — ebenfalls wegen `max-lines-per-function`, minimaler Zusatz-Overhead, kein Verhaltensunterschied.

## Safety-Urteil

**PASS.** `approved: true`, alle Einzelflags true (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`), keine Blocker.

Unabhaengige Verifikation in frischem Worktree (Branch `review-e5` auf `phase/openai-e5-origin-wache`, 1 Commit `c044a54`, 14 Dateien, 869+/74-):
- Regressionsbank (json-Backend): `npm test -- --test-concurrency=4` -> Exit 0, 6104/6104 gruen, alle 30+ neuen E5-Faelle gruen.
- Zweiter Backend-Pfad (pg via pglite) + Auth/MCP-Nachbarschaft isoliert: Exit 0, 159/159 gruen.
- `npm run lint`: 0 Fehler, 69 Bestandswarnungen (keine in beruehrten Dateien); Prettier-Drift identisch zu `master`.
- Mutationsprobe: Guard-Mount aus `src/routes/mcp.js` entfernt -> 10 Faelle fallen (H01, H02, H07a/b/c, H08, H09, H10, H11, H14-evil), H01 liefert dann 200 mit gueltigem Token — Anker belegt greifend; danach wiederhergestellt, `git status` leer.
- Statische Gegenproben: keine neue Dependency, `claude.js`/`bridge.js`/`outbound-gates.js`/`state-ops.js`/`callee-is-owner.js`/`auth.js`/`route-policy.js` unberuehrt, kein `eslint-disable`/uebersprungener Check im Diff, Env-Lesen nur in `config.js`, kein Import-Zyklus, kein Browser-Aufrufer von `/mcp`.

**Verdict-Begruendung:** Rein additive Sicherung, laeuft als pfadgebundene `use`-Schicht vor `mcpAuth`, laesst `mcpAuth`, `route-policy`, Signaturpruefung und alle Kosten-/Anruf-Gates unberuehrt. Es kommen strikt weniger Requests durch (mutationsbelegt). Deny-by-default an drei Stellen: leere Allowlist lehnt jeden vorhandenen Origin ab, unparsbare Eintraege werden verworfen, Schema-Gate verhindert Treffer des opaken `"null"`-Strings gegen sich selbst. Notventil in der vorgeschriebenen Bauform (`enforce !== false`, scharfer Default, `boolEnv` erlaubt nur `"true"/"false"`).

### Concerns (nicht blockierend)

1. **Ruecknahme einer Faehigkeit:** divergente `OAUTH_AUDIENCE` ist jetzt Boot-Refusal statt Betriebszustand; der AM6-Override-Test dafuer wurde geloescht/ersetzt. Live nachweislich kostenfrei (`PRM.resource === publicUrl+"/mcp"`, gemessen 2026-09-18), aber ein kuenftig abweichender Resource-Indicator bedeutet `exit(1)` und damit KEIN `app.listen` — keine eingehende Telefonie. **Vor jedem Deploy Live-`PUBLIC_URL`/`OAUTH_AUDIENCE` lesen (F-b/F-e).**
2. Notventil `MCP_ORIGIN_ENFORCE=false` ist im Betrieb unsichtbar (keine Boot-Warnung, keine Logzeile) — konsistent zur `csrfEnforce`-Praezedenz, aber ein geloester Riegel kann unbemerkt dauerhaft offen bleiben.
3. Ein vorhandener, aber LEERER `Origin:`-Header faellt unter "kein Header" -> erlaubt (kein realer Fall, da Browser das nicht senden; bewusste Nachsicht).
4. Boot-Riegel ist lockerer als die `.env.example`-Doku behauptet: ein `MCP_ALLOWED_ORIGINS`-Eintrag MIT Pfad passiert den Boot (nur `normalisierterOrigin`-Parsbarkeit wird geprueft, kein "ohne Pfad"-Check) — nicht fail-open, aber Zusage und Pruefung decken sich nicht ganz.
5. `render.yaml` setzt `PUBLIC_URL` jetzt fest auf `https://app.sundartha.com`; bei Blueprint-Sync waehrend abweichendem Live-Wert verschieben sich Audience, Allowlist, Telnyx-`voice_url`, Stripe-Rueckkehr und OIDC-Redirect gleichzeitig. Eintrag ist Doku, kein Beleg fuer den Live-Zustand.
6. Vertragsaenderung an live verbundenem Endpunkt (deklariert + getestet, H09): `OPTIONS /mcp` antwortet mit fremdem Origin jetzt 403 statt 200; `GET`/`DELETE` mit fremdem Origin 403 statt 405. Ohne Origin unveraendert.
7. `test/s2-mcp-origin.test.js` ist der EINZIGE Regressionsanker — Mutationsprobe belegt, dass er greift; nicht loeschen/skippen/mit Katalog-Praefix versehen.

## Clean-Code-Audit (S1-S4)

**Verdict: PASS** — saubere, gut getestete Sicherheits-Ergaenzung, kein S1/S2-Blocker. Verhaltensaenderung (AM6-Override -> Boot-Refusal) bewusst, dokumentiert, per Test belegt.

- **S1:** keine Funde.
- **S2:** keine Funde.
- **S3** (kosmetisch, kein Fix noetig):
  - `createMcpOriginGuard` antwortet mit demselben `error`-String `"cross_origin_blocked"` wie die Schwesterwache `createSameOriginGuard`, obwohl der Audit-Grund bewusst getrennt ist (`CROSS_ORIGIN` vs. `MCP_CROSS_ORIGIN`). Trennung existiert im Log bereits; ein eigener `error`-Wert waere konsistenter, aber nicht zwingend.
  - Deutsche Funktionsnamen (`normalisierterOrigin`, `mcpErlaubteOrigins`, `angekuendigterOriginFindings`) neben ueberwiegend englischen Bestandsnamen — folgt etablierter Repo-Konvention (deutsche Kommentare/Domainbegriffe), PASS.
- **S4:** `test/s2-mcp-origin.test.js` splittet HTTP-Faelle in zwei `describe`-Bloecke rein wegen `max-lines-per-function`, im Kommentar selbst als Nicht-Verstoss begruendet. PASS, keine Aktion.

**passNotes (Auszug):** Trennung Identitaets- vs. Herkunftspruefung explizit dokumentiert; DNS-Rebinding-Schutz korrekt fail-closed gebaut (kein Fallback auf die fail-open-SDK-Option); Forensik-Log filtert Origin-Wert konsequent; G5 durchgaengig (ein Parse-Punkt, ein Allowlist-Bauer, eine Audience-Formel, per Formel-Pin-Test gegen Drift gesichert); Notventil korrekt NICHT in `PRODUCTION_FOOTGUNS`; BASE_ENV korrekt ergaenzt (Lehre `test-base-env-drift` beachtet); AM6-Verhaltensaenderung sauber begruendet und getestet; `eslint-suppressions.json`-Eintrag korrekt entfernt (Verstoesse tatsaechlich behoben).

**topTodos:** kein Pflicht-Fix; optional eigener `error`-Code fuer die `/mcp`-Herkunftswache (kosmetisch); ein separater voller `npm test`-Lauf vor Merge wird empfohlen (Timeout im Audit-Sandbox-Kontext), ist aber Prozess, kein Code-Befund.

## Fix-Runden

Keine — beide Reviews liefen direkt auf PASS ohne Blocker, keine Fix-Runde noetig.
