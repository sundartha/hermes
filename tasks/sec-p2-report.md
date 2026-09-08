# SEC-P2 — Lieferkette · Detailbericht

**Gate:** PASS
**finalBranch:** sec/p2
**headCommit:** a12f30485dc44b56d46e69e58c41e3a7835b0166

## Plan (gekuerzt)

Blast-Radius: 1 Zeile `package.json`, 10 Lockfile-Eintraege, 0 Zeilen Anwendungslogik, 1 neue Testdatei. Kein `npm audit fix`, kein `--force`, keine neue Abhaengigkeit, keine Aenderung an Safety-Gates/Offenlegung/Signaturpruefung.

- **Vorbedingung:** lokaler Selbst-Symlink `node_modules/node_modules` verzerrt `npm ls` ("extraneous"); alle Messungen lockfile-only in isolierten Kopien erhoben, Repo nicht angefasst.
- **Abweichung vom Spec-Wortlaut (begruendet):** Spec verlangt `npm audit fix` ohne `--force`. Gemessen: das stuft `express` faelschlich 4.22.2 -> 4.22.1 zurueck und behebt das `qs`-Advisory dabei nicht einmal. Stattdessen gezieltes `npm update` von 6 benannten Transitiv-Paketen.
- **Commit 1 (nicht-brechend):** `npm update ip-address fast-uri hono @hono/node-server body-parser brace-expansion` — alle innerhalb bestehender semver-Ranges, `package.json` unveraendert.
  - `ip-address` 10.2.0 -> 10.7.0 (3x hoch)
  - `fast-uri` 3.1.2 -> 3.1.7 (6x hoch)
  - `hono` 4.12.25 -> 4.13.7 + `@hono/node-server` (7x moderat, via MCP-SDK)
  - `body-parser` 1.20.5 -> 1.20.8 (moderat)
  - `brace-expansion` 5.0.6 -> 5.0.9 (3x hoch, dev-Baum — CI auditiert ohne `--omit=dev`)
  - Pflicht-Testsatz wegen IP-Achsen-Bewegung (Limiter/Trust/MCP); Entwarnung nach Codelesen: `isTrustedLocalCaller` und der eigene Rate-Limiter nutzen `ip-address` nicht — nur MCP-SDK-transitiv betroffen.
- **Commit 2 (Major, allein):** `nodemailer` ^7.0.13 -> ^10.0.1, exakt eine `package.json`-Zeile, ein Lockfile-Eintrag. Einziger Breaking Change laut Anbieter-CHANGELOG: Node >=20 (wir fahren >=22 <23). Drei Aufrufstellen (`src/smtp-mail.js`, `src/mail-boot-probe.js`, `src/mail/ports.js`) unveraendert kompatibel, differentiell an beiden Versionen gemessen: identische Fehlerklasse (`ESOCKET`/`ETLS`).
- **Neuer Test:** `test/nodemailer-lernvertrag.test.js` — Lernvertrag (Clean-Code P10) gegen die ECHTE Bibliothek, da alle Bestands-Mailtests Attrappen injizieren und einen Bruch der Fremd-API nicht sehen koennten. Zwei Faelle: Aufrufform-Vertrag + `requireTLS` verhindert Klartext-Versand (kein `DATA` ohne `STARTTLS`, Fehlerklasse `ETLS`). Vorab an 7.0.13 und 10.0.1 gemessen: identisch gruen.
- **Rauchtest (differentiell):** geplant als Boot mit lokalem SMTP-Gegenpart ohne STARTTLS, vor/nach jedem Commit.
- **Verbleibender Befund:** `qs` 6.15.2 (2x moderat) via `express@4.22.2` — nur ueber express-Downgrade oder `overrides` erreichbar; laut Spec bei moderater Schwere zulaessig, bewusst getragen bis Hochstufung auf `high`.
- **Ausdruecklich nicht getan:** kein `npm audit fix`/`--force`/`overrides`, keine neue direkte Abhaengigkeit, keine neue Env-Variable, kein `apps/web`, keine Safety-Gate-/Offenlegungs-/Auth-Aenderung, kein Deploy.
- **PLAN-SECURITY.md Owner-Entscheidungen:** (1) nodemailer faehrt ab jetzt auf `^10`, Node >=20 harte Untergrenze; (2) `qs`-Advisory bewusst getragen solange moderat.

## Impl-Zusammenfassung

3 Commits auf `sec/p2` (Basis master `173629b`):
1. Nicht-brechende `npm update`-Anhebung der 6 Transitiv-Pakete (statt `npm audit fix`), `package.json` unveraendert.
2. `nodemailer` ^7.0.13 -> ^10.0.1, 0 Quellcode-Aenderungen, belegt durch neuen Lernvertrag-Test.
3. `PLAN-SECURITY.md` um SEC-P2-Abschnitt mit den beiden Owner-Entscheidungen ergaenzt.

Ergebnis: `npm audit --omit=dev --audit-level=high` und `npm audit --audit-level=high` (CI-Paritaet) beide Exit 0; 2 verbleibende moderate `qs`-Befunde gezaehlt und benannt. Betroffener Testsatz (189 Faelle: Mail/IP-Achse/MCP/Auth) gruen, inkl. der 2 neuen Lernvertrag-Faelle. Safety-Gates, Offenlegungssatz, Auth-Middleware, Provider-Signaturpruefung: keine Zeile angefasst. Kein `--force`, keine neue Abhaengigkeit, `apps/web` nicht beruehrt.

**filesCreated:** `test/nodemailer-lernvertrag.test.js`
**filesEdited:** `package.json`, `package-lock.json`, `PLAN-SECURITY.md`
**testPassCount:** 189, **testFailCount:** 0

### Deviations

1. Vorbedingung Section 0 (Selbst-Symlink `node_modules/node_modules`) war im Worktree anders gelagert als beschrieben: der initiale Symlink zeigte auf das echte Haupt-Repo-`node_modules` (nicht auf sich selbst) — der Selbst-Symlink-Bug lag INNERHALB des Ziels (Haupt-Repo). Nach `rm` blieb `npm ls` trotzdem "extraneous" wegen Pfad-Diskrepanz Worktree<->Haupt-Repo. `npm update` hat den Symlink selbststaendig durch eine echte, eigene `node_modules`-Installation im Worktree ersetzt — Haupt-Repo-`node_modules` dadurch NICHT veraendert, funktional gleichwertig zum Plan-Ziel, aber technisch anders als "Symlink bleibt bestehen".
2. Der differentielle Boot-Rauchtest (Abschnitt 5 des Plans) konnte NICHT wie beschrieben gefahren werden: lokaler Boot bricht mit "Keine aktive Nummer im Store" ab, bevor die Mail-Boot-Sonde geloggt wird — Vorbedingung ausserhalb des Scopes dieser Phase. Laut VORGEHEN best-effort (`smokePass=false` + Grund, kein Blocker). Ersatz: der neue Lernvertrag-Test, der dieselbe TLS-Invariante gegen die echte Bibliothek (7.0.13 UND 10.0.1) prueft.

## Safety-Urteil

**verdict: PASS — freigegeben.**

- approved / testsPassIndependently / safetyGatesIntact / disclosureIntact / authFailClosedIntact / scopeRespected / noSecretsLeaked / behaviorAsIntended: alle `true`.
- `git diff master sec/p2 --name-only` liefert genau 4 Dateien; `git diff master sec/p2 -- src/` ist LEER. Safety-Gates (`outbound-gates.js`, `OUTBOUND_FROZEN`, Budget-Achse), Offenlegungssatz (`claude.js:428`, `bridge.js:225`) und Auth-Kette (Telnyx-Ed25519, `webAuthMw`/`adminMw`, `internalOnly`, `safeEqual`) byte-identisch zu master.
- Unabhaengig nachgemessen (nicht der Doku geglaubt): 20 Testdateien selbst gefahren gegen ein hybrides `node_modules` (Symlinks auf Hauptkopie-Pakete + frische `nodemailer@10.0.1`) — 189 pass, 0 fail. `master` `npm audit --omit=dev --audit-level=high` -> Exit 1 (nodemailer <=9.1.0, high); `sec/p2` dasselbe -> Exit 0; `sec/p2` `npm audit --audit-level=high` (CI-Kommando) -> Exit 0; `sec/p2` `npm audit --omit=dev` -> exakt 2 moderate (qs via express 4.22.2).
- Positiv-Kontrolle gegen Vakuum-Test: temporaerer Wegwerf-Test mit `requireTLS:false` -> `DATA` erreicht den Server (die Zusicherung misst also wirklich etwas); Datei wieder geloescht.

### Concerns (keiner blockierend)

1. Lernvertrag deckt nur den STARTTLS-Zweig; der `secure: port===465`-Zweig (impliziertes TLS, Zoho-Default) ist von keinem Test gegen die echte Bibliothek beruehrt.
2. `verify()` wird nur als `typeof === "function"` geprueft, nie real gegen einen Server aufgerufen — `mail-boot-probe.js:55` ruft es real auf.
3. Engine-Drift (nicht von dieser Phase verursacht): `package.json` sagt `>=22 <23`, Pruefmaschine faehrt Node v26.7.0 — ausserhalb des deklarierten Bereichs.
4. `qs`-Advisory bleibt bewusst offen (2 moderate); nur die `--audit-level=high`-Gates sind gruen.
5. Fuer den Merge-Lauf: Haupt-Arbeitskopie-`node_modules` haelt weiterhin `nodemailer@7.0.13` — ohne `npm install` VOR der vollen Suite liefe der Lernvertrag-Test dort gegen die alte Bibliothek und beweist nichts.

## Clean-Code-Audit (S1-S4)

**verdict: PASS.** S1: []. S2: []. S3: []. S4: []. Kein Blocker.

`package.json` (nodemailer ^7 -> ^10), `package-lock.json` (6 nicht-brechende Transitiv-Bumps + nodemailer, express selbst unveraendert), `PLAN-SECURITY.md` (Doku/Owner-Entscheidungen), `test/nodemailer-lernvertrag.test.js` (neu). Kein `src/`-Edit.

**passNotes:** Verifiziert (nicht nur gelesen): `npm audit --omit=dev --audit-level=high` und `npm audit --audit-level=high` -> Exit 0, exakt "2 moderate severity vulnerabilities" (qs via express@4.22.2), deckungsgleich mit `PLAN-SECURITY.md`. `npm test` auf `a12f304`: 5800/5800 pass, 0 fail (volle Suite). Lockfile-Diff bestaetigt: nur die 6 genannten Pakete + nodemailer geaendert, express-Version selbst unberuehrt. Neuer Test folgt P10 (Lernvertrag gegen echte Bibliothek statt Attrappe) und P13 (Build-Operate-Check, geteilte Helper `startSmtpOhneStarttls`/`smtpConfig`), ein Konzept pro Test (P14), aussagekraeftige Namen. `.github/dependabot.yml` existierte bereits vor dieser Phase.

**topTodos:**
- Kein Blocker offen; einziger benannter Restpunkt: `qs`-Advisory bewusst getragen bis `high`-Einstufung.
- Bei kuenftiger Eskalation des `qs`-Advisories auf `high`: express-5-Sprung oder `overrides` als EIGENE Entscheidung behandeln.
- Worktree wurde fuer die Verifikation kurz auf `a12f304` (detached) umgeschaltet und danach auf den urspruenglichen Branch zurueckgesetzt — keine bleibende Aenderung.

## Fix-Runden

Keine — die Phase erreichte PASS ohne Fix-Runde.
