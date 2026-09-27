# Phase E1 — Sonde fuer die Authorization-Server-Faehigkeiten (S5-A4 + F1-F4)

- **Gate:** PASS
- **finalBranch:** `phase/openai-e1-as-sonde-fix1`
- **headCommit (final):** d86cad7 (Fix-Runde r1)
- **Scope:** ausschliesslich `scripts/probe-as-faehigkeiten.mjs`, `test/probe-as-faehigkeiten.test.js`, `docs/RUNBOOK-AS-METADATA.md`, `knip.json` (+1 Zeile). `git diff master...review-e1-r1 -- src/` ist LEER.

---

## 1. Plan (gekuerzt)

Autoritativ gelesen: `tasks/openai-e1-spec.md`, `tasks/openai-fix/S5-authorization-server.md` (A4, F1-F5), `PLAN-OPENAI.md`, `.claude/refs/clean-code.md`, plus `src/auth.js`, `src/app.js`, `src/routes/mcp.js`, `scripts/check-setup.js`, `eslint.config.js`, `knip.json`.

**Kernentscheidungen:**

- **D1 — Schritt 2 ist ein POST** auf `/mcp` ohne Token (Abweichung vom Spec-Wortlaut "nur GET"), weil `GET /mcp` 405 ohne Auth-Middleware liefert und F3 sonst unbeantwortbar bleibt. Reiner Lesevorgang: `mcpAuth` antwortet 401 vor jedem Handler, kein Koerper wird gesendet oder gelesen. Ruecknahmepfad benannt (Schritt 2 streichen, Preis: F3/A3-Vorhersage entfallen).
- **D2 — acht Faehigkeitszeilen**, nummeriert `1/8`…`8/8`: issuer-Gleichheit, jwks_uri-Origin, S256, DCR, CIMD, `token_endpoint_auth_methods_supported` enthaelt `none`, RFC-9207-iss-Parameter, userinfo_endpoint. `scopes_supported` nur INFO.
- **D3 — Status x Gewicht:** `PASS|FAIL|UNKNOWN` x `PFLICHT|BEFUND`. Vier PFLICHT-Zeilen (PRM erreichbar, AS-Metadata erreichbar, 1/8, 3/8). Exit `0` = alle PFLICHT PASS, `1` = mind. eine PFLICHT nicht PASS, `2` = Aufruffehler vor jeder Netzanfrage.
- **D4 — keine Abstraktion mit `scripts/check-setup.js`:** gegensaetzliche Wahrheitsquelle (Live-PRM vs. lokale `.env`), anderer Algorithmus, anderer Ausgabevertrag, anderer Scope. Residualer Ueberlapp (Well-known-Pfade als Konstante) bewusst belassen, Auslesebedingung fuer spaetere Extraktion im Runbook dokumentiert.
- **D5 — `redirect: "manual"`**, damit eine gefolgte Umleitung die issuer-Gleichheit nicht unbemerkt verfaelscht.
- **D6 — kein Commit-Pin**; deployter Commit als Handnotiz im Runbook statt eingebautem `/healthz`-Vorabruf (Scope-Zuwachs vermieden).
- **D7 — kein `package.json`-Script, kein `src/`-Import, keine neue Dependency, keine Env-Variable** — verhindert, dass die Sonde je zu einem Gate (CI/Boot) wird.
- **D8** — Zeilenzahl (~180 geplant) begruendet ueber deklarative Tabelle statt achtfachem Copy-Paste.

**Neue Dateien laut Plan:** `scripts/probe-as-faehigkeiten.mjs` (Konstanten, reine Helfer, deklarative Acht-Zeilen-Tabelle, Messschritte `messePrm`/`messeMcpModus`/`messeAsMetadata`/`bewerteFaehigkeiten`, `sondiere`/`berichte`/`main`) und `docs/RUNBOOK-AS-METADATA.md` (11 Abschnitte inkl. datierter Live-Messung, Deckungsgrenze, Abgrenzung zu check-setup, Owner-Vorbehalt). Einziger Edit an Bestand: `knip.json` (+1 Entry-Point-Zeile). Ausdruecklich nicht angefasst: alles unter `src/`, `check-setup.js`, `package.json`, `.env.example`, `render.yaml`, `test/helpers.js`, `PLAN-SECURITY.md`, `eslint-suppressions.json`.

**Tests laut Plan:** 16 Faelle (`E1-1` bis `E1-16`), Praefix landet automatisch im Regressionslauf (kein Katalog-Treffer). Deckt ab: Acht-Zeilen-Invariante, issuer-Normalisierung, Gewichtstrennung (jwks_uri cross-origin nur BEFUND), UNKNOWN-Regel fuer T-11, CIMD-Sonderfall (fehlend = FAIL, nicht UNKNOWN), Formatinvariante bei fehlendem AS-Dokument, A3-Vorhersage (NEIN/JA/UNBEKANNT), Exit-2-Pfade ohne Netzanfrage, Positiv-Kontrolle Exit 0, zwei 404-Faelle, Ende-zu-Ende gegen echten Gateway + Mini-IdP, Quelltext-Sicherheits-Gate mit Positiv-Kontrolle, Spawn-Verdrahtung.

**Pre-Mortem (6 Risiken benannt):** A1 vs. F4-Issuer-Quelle divergiert kuenftig (Runbook-Abschnitt 7 haelt die heutige Gleichung fest); Messung gegen veralteten Deploy (Commit-Handnotiz); UNKNOWN als "ok" fehlgelesen (CIMD faellt auf FAIL statt UNKNOWN); Sonde wird zum Gate (kein Script/Import/Env); Sonde bekommt zweite Aufgabe und leakt Daten (Quelltext-Gate E1-15); POST auf `/mcp` als "Aktion" fehlgedeutet (D1 explizit begruendet). Blast Radius: null Laufzeitpfade, keine absolute Regel beruehrt.

---

## 2. Implementierungs-Zusammenfassung

Umgesetzt und committed auf `phase/openai-e1-as-sonde` (30f2a06), in isoliertem Worktree, `master` unberuehrt.

- **Neu:** `scripts/probe-as-faehigkeiten.mjs` (~410-496 Zeilen inkl. Kommentare, keine `src/`-Aenderung), `test/probe-as-faehigkeiten.test.js` (17 Faelle, inkl. spaeter ergaenztem `E1-12c`-Regressionstest), `docs/RUNBOOK-AS-METADATA.md` (datierte Live-Messung gegen `https://app.sundartha.com`: F1=Issuer `https://fearless-network-26.authkit.app`, F2=Audience `https://app.sundartha.com/mcp` (kanonisch), F3=Modus `oauth`, A3-Vorhersage NEIN, PFLICHT 4/4 PASS inkl. S256, Exit 0).
- **Edit:** `knip.json` (neuer Entry-Point, eine Zeile).
- **Negativkontrollen bestanden:** ohne Argument -> Exit 2, kein Netzzugriff; 404 auf Discovery-Pfad -> FAIL + Exit 1.
- **Lint:** 0 Fehler, `eslint-suppressions.json` byte-identisch (0 neue Suppressions).
- **Regressionslauf:** 6082 Tests, 6078 pass, 4 fail — alle 4 in `test/elevenlabs-consult-webhook-blockers.test.js` (nicht angefasste Datei), isoliert 13/13 gruen -> bestaetigter Parallelitaets-Flake, keine Regression durch diese Phase.
- **Smoke:** echter Server via `test/helpers.js` `startServer()`+`startIdp()`, `sondiere()` gegen echten Gateway lieferte erwartete F1/F2/F3/A3-Werte; zusaetzlich Live-Lauf gegen Produktions-URL ohne Secret-Leak.

### Deviations

1. **D1** (POST-Schritt statt reinem GET) wie im Plan begruendet umgesetzt — reiner Lesevorgang, kein Koerper gesendet/gelesen; Owner-Entscheidung dazu bleibt offen.
2. Waehrend der Umsetzung war ein zuvor gesetzter `node_modules`-Symlink fehlerhaft (self-referentiell) und liess `eslint`/`npm test` mit kryptischem Exit-Code 194 abbrechen — reines Tooling-Problem der Session, kein Plan-/Code-Fehler. Korrigiert, vor dem Commit wieder entfernt.
3. Erster lauffaehiger Stand hatte 2 echte Lint-Fehler (Complexity 12 in `messePrm`, zu tiefer Demeter-Zugriff) — behoben durch Aufspalten von `messePrm` in zwei Helfer und Destrukturierung einer `map`-Callback-Variable; alle 17 Tests liefen danach unveraendert gruen.

### Clean-Code-Selfcheck (Implementierer)

Deklarative Acht-Zeilen-Tabelle (ein Renderpfad); alle Zahlen/Woerter als benannte Konstanten (G25/G35, 0 Magic Numbers ausser 0/1/-1); DIP ueber injizierbares `{ abrufen }` (Default `holeDokument`) fuer Offline-Tests; kleine Einzweck-Funktionen (`messePrm` nach Lint-Fund gesplittet, Complexity <10); max. 2 Parameter je Funktion; `id-length>=2` durchgehend; keine Argument-Mutation; kein toter/auskommentierter Code; Kommentare deutsch ohne Umlaute; ESM ohne Build-Step; keine neue Dependency; `npm run lint` 0 Fehler, `eslint-suppressions.json` byte-identisch.

---

## 3. Fix-Runden

**Runde 1 (r1) — MESSTREUE-Blocker behoben:**
`scripts/probe-as-faehigkeiten.mjs` las `AS_PFADE` in umgekehrter Reihenfolge zu `discoverJwksUri` (`src/auth.js:31`). Fix: `AS_PFADE` auf Produktionsreihenfolge gedreht (`openid-configuration` zuerst, `oauth-authorization-server` danach), Kommentar an der neuen Reihenfolge ausgerichtet. Ergebnis auf finalem Branch `phase/openai-e1-as-sonde-fix1` (d86cad7) unabhaengig verifiziert (s. Safety-Urteil unten).

---

## 4. Safety-Urteil (final)

**approved: true** — alle Kernflags true (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`).

**Unabhaengiger Testlauf** im frischen Worktree, Node v26.7.0, Branch `review-e1-r1` = `phase/openai-e1-as-sonde-fix1` (d86cad7):

1. `npm test -- --test-concurrency=4` (Backend json): Exit 0, 6063/6063/0, Delta zu Master (3d32492, 6045/6045/0) exakt +18 = die 18 E1-Faelle, alle gruen.
2. `STORE_BACKEND=pg npm test -- --test-concurrency=4`: Branch 99 fail, Master-Basis 100 fail — Ursache environmental (kein lokales Postgres), kein Befund dieser Phase.
3. `eslint` (einziges per Pre-Commit-Hook/CI erzwungenes Gate): sauber auf beiden neuen Dateien.
4. CLI-Abnahme nachgestellt: ohne Argument / `file:///etc/passwd` / zwei Argumente -> je Exit 2, USAGE auf stderr, stdout leer, keine Netzanfrage. Gegen lokalen Alles-404-Host: PRM FAIL + AS-Metadata FAIL + 8x UNKNOWN + Exit 1 — kein stilles Gruen.
5. Runbook-Rohausgabe unabhaengig gegengeprueft (nur GET, kein zusaetzlicher POST gegen Produktion): `app.sundartha.com` PRM liefert `resource`/`authorization_servers[0]` identisch zum Runbook; WorkOS `openid-configuration` hat tatsaechlich kein `code_challenge_methods_supported`/`registration_endpoint`/`client_id_metadata_document_supported`, `oauth-authorization-server` hat alle drei — reproduzierbar, nicht geschoent.
6. `AS_PFADE`-Reihenfolge stimmt mit `src/auth.js:31` ueberein — der Fix aus Runde 1 sitzt.

**Scope:** exakt vier Dateien gegenueber Master (A `docs/RUNBOOK-AS-METADATA.md`, A `scripts/probe-as-faehigkeiten.mjs`, A `test/probe-as-faehigkeiten.test.js`, M `knip.json` +1 Zeile). `git diff master...review-e1-r1 -- src/` leer. Keine neue Dependency, `render.yaml`/`.env.example`/`.github/`/`eslint-suppressions.json` unberuehrt. `knip.json`-Eintrag in `entry`, nicht `ignore` — keine neu abgeschaltete Sicherung.

**Safety-Gates:** unantastbar (byte-identisch zu Master), kein neuer Endpunkt/keine neue Route. Die Sonde ist ein Client, kein Server.

**Offenlegung:** `src/claude.js` unveraendert. Eine "bridge.js" existiert in `src/` nicht (mehr), OpenAI-Realtime-Bridge seit IE6-S2 entfernt — nichts zu pruefen.

**Auth fail-closed:** einziger Beruehrungspunkt ist F3 (`POST /mcp` ohne Token). `router.post("/mcp", mcpAuth, ...)` verifiziert: `mcpAuth` faellt in jedem Modus vor dem Handler auf 401 zurueck, kein Tool-Handler wird erreicht. Die Sonde sendet keinen Koerper und liest den Antwortkoerper nie.

**Secrets:** sauber, per Quelltext-Gate `E1-15` MIT Positiv-Kontrolle getestet (nicht nur behauptet). `process.env` wird nirgends gelesen, kein Authorization-/Cookie-Header gesetzt, kein `node:fs`, keine schreibende HTTP-Methode. Zielhost als Pflichtargument, `src/config.js` nicht importiert.

**Verhalten wie spezifiziert:** alle fuenf Abnahmepunkte aus `tasks/openai-e1-spec.md` selbst nachgestellt und erfuellt.

**Einschraenkung zur Zustimmung:** approved bezieht sich auf Sicherheit/Scope/Verhalten. Die inhaltliche Runbook-Schlussfolgerung "S256 ist neuer Blocker fuer Etappe 6/8" gilt als nicht belastbar genug (Concern 1) — steht als offene Owner-Entscheidung, blockiert diese Etappe nicht, ist aber vor Zuschnitt von Etappe 6/8 neu zu bewerten.

### Concerns (nicht blockierend)

1. **Auslegungsrisiko im Runbook:** die acht Faehigkeiten werden auf `openid-configuration` benotet (weil `discoverJwksUri` diesen Pfad zuerst liest), aber die client-seitigen Fragen (S256/DCR/CIMD) beantwortet laut RFC 8414/MCP-Spec eigentlich `/.well-known/oauth-authorization-server` — dort bewirbt WorkOS alle drei Felder live bestaetigt. Der im Runbook ausgerufene "neue Blocker fuer Etappe 6/8" ist moeglicherweise ein Artefakt der Dokumentwahl, kein echter WorkOS-Mangel. Entschaerft: beide Dokumente stehen als INFO-Zeilen im Runbook, Folgerung ausdruecklich als "Owner-Entscheidung ausstehend" markiert.
2. **Kleine Messtreue-Luecke:** `messeAsMetadata` waehlt den ersten Pfad mit 2xx, `discoverJwksUri` waehlt den ersten Pfad mit 2xx UND nicht-leerem `jwks_uri`. Heute identisch (beide Live-Dokumente tragen `jwks_uri`), koennte aber divergieren.
3. **SSRF-artige Steuerbarkeit** (fuer manuell aufgerufenes Diagnosewerkzeug akzeptabel): `issuer` stammt aus der Antwort des Zielhosts (`PRM.authorization_servers[0]`), ein feindlicher Zielhost kann Anfrage 3/4 auf beliebige Origin lenken. Wirkung gering: nur GET, `redirect: "manual"`, keine Credentials, nur benannte Discovery-Felder werden ausgegeben.
4. `STORE_BACKEND=pg`-Testlauf in dieser Umgebung auch auf Master rot (reines Umgebungsdefizit, kein lokales Postgres) — "beide Backends gruen" hier nicht belegbar, weder fuer Branch noch Basis.

---

## 5. Clean-Code-Audit (final)

**verdict: PASS**, **blocker: false**

**S1 (Blocker):** keine Funde.
**S2 (Blocker):** keine Funde.

**S3 (kleinere Funde, nicht blockierend):**
- `scripts/probe-as-faehigkeiten.mjs:346-347` — `header` als Funktion statt Property in `holeDokument`-Rueckgabe: Name ohne Verb wirkt wie Feld statt Funktion; konsequent so verwendet und getestet, keine echte Verwirrung, PASS bewertet, nur vermerkt.
- `docs/RUNBOOK-AS-METADATA.md` — Abschnittsnummerierung springt von "## 8" auf "## Messung ..." (bewusst ohne Nummer) auf "## 10" — "## 9" fehlt. Kosmetisch, kein Blocker. Fix-Optionen: "## 9" fuer Platzhalter vergeben oder Luecke explizit erklaeren.

**S4 (Struktur):**
- `scripts/probe-as-faehigkeiten.mjs` ist mit 496 Zeilen die groesste Datei im Diff, aber klar in Abschnitte (reine Helfer / IO / Ausgabe) gegliedert, jede Funktion kurz und einzweckig (G30 eingehalten) — kein Fragmentierungs-/Monolith-Problem, nur als Groessenhinweis vermerkt.

**Begruendung:** Diff fuegt ausschliesslich ein neues, isoliertes Messwerkzeug samt Test-Suite und Runbook hinzu — kein produktiver Code-Pfad veraendert (kein `package.json`-Script, kein Boot-Pfad, kein Aufruf aus `src/`). Alle 18 zugehoerigen Tests gruen, `node --check` sauber. Sicherheits-/Gate-relevante Regeln unbetroffen: nur oeffentliche Discovery-Dokumente, nie ein Koerper gesendet, Response-Body beim 401-Check nie gelesen, nichts geschrieben, kein `src/config.js`-Import, Ziel als Pflichtargument. Der MESSTREUE-Fix aus Runde 1 zeigt "Wurzel statt Symptom"-Vorgehen (eigener Regressionstest `E1-12c` + neu erhobene Live-Messung). Keine Duplizierung (G5): einziger Ueberlapp zu `check-setup.js` ist eine geteilte Pfad-Konstante, keine Logik-Kopie, Abgrenzung im Runbook Abschnitt 10 begruendet inkl. Migrationsplan. Magic Numbers/Argumentzahl/Verschachtelungstiefe im Zielkorridor.

**Top-TODOs:**
1. Kein Blocker offen — Merge kann erfolgen.
2. Optional/kosmetisch: Nummerierungsluecke "## 9" im Runbook schliessen oder explizit erklaeren.
3. Vor Etappe 6/8 (nicht Teil dieses Diffs): der im Runbook dokumentierte Befund "PKCE S256 fehlt auf dem produktionsrelevanten `openid-configuration`-Dokument" bleibt offen — WorkOS-Klaerung noetig, bevor A1/A3 gebaut werden (s. auch Safety-Concern 1).

**Pass-Notizen:** DIP-Seam ueber injizierbares `{ abrufen }` macht IO offline testbar; reine Funktionen exportiert und einzeln getestet; alle Magic Numbers/Strings benannte Konstanten; Sicherheitszusagen im Kopfkommentar durch eigenen Test (`E1-15`) mit Positiv-Kontrolle belegt statt nur behauptet; Exit-Code-Logik eine einzige reine Funktion (`exitCodeAus`); Acht-Zeilen-Bewertungstabelle deklarativ; Tests folgen Build-Operate-Check und decken Randfaelle ab; Runbook dokumentiert Grenzen der Messung ehrlich (Abschnitt 7 "Deckungsgrenze", Abschnitt 2 "beweist keinen erfolgreichen Connector-Flow").
