# Abschlussbericht Phase T2-20 — Reviewer-Zugang: Anleitung, Seed-Skript, Login-Pfad

Branch `phase/openai-t2-20-reviewer-access-seed`, Commit `e75823a`. `src/` ist nicht angefasst
(Diff-Stat zeigt nur `docs/`, `scripts/`, `test/`, `PLAN-SECURITY.md`) — Gates, Offenlegung,
`tools/list`/`initialize`/`server-instructions` sind byte-gleich zum Basisstand.

## 1. Was diese Phase NICHT erfuellt

- **Ein Sicherheitsbefund aus dem letzten Review-Durchlauf ist nicht behoben:** Das Skript
  `scripts/seed-reviewer-demo.mjs` importiert unter `STORE_BACKEND=pg` `src/store.js` aus genau
  dem Checkout, aus dem es gestartet wird. `pg.init` fuehrt dabei `migrate()` mit der DDL dieses
  Codestands aus, gegen die Ziel-DB — und der anschliessende Flush schreibt alle Mandanten mit
  der Zeilenform dieses Codestands. Weder der Skript-Kopf noch `USAGE`/`PG_ABORT` noch
  `PLAN-SECURITY.md` verlangen, dass der Betreiber den pg-Lauf exakt vom deployten Live-Commit
  aus startet. Ich habe das nachvollzogen: `PG_ABORT` (scripts/seed-reviewer-demo.mjs:60-63)
  nennt nur die Pflicht `--dienst-gestoppt`, keinen Commit-Abgleich; im `PLAN-SECURITY.md`-Zusatz
  steht derselbe Flush-Hinweis, ebenfalls ohne Commit-Bedingung. Ist der lokale Stand (z.B. eine
  gemergte, aber nicht deployte Kette) neuer als der Live-Commit, wendet der Lauf DDL eines nicht
  deployten Codestands auf Produktion an; startet danach der alte Dienst, kann das den Start
  brechen oder Daten verwerfen. Bleibt offen.
- **Kein `check_inbox`-Seed.** Die Anleitung sagt in EN und DE offen, dass `check_inbox` fuer das
  Reviewer-Konto leer bleibt, weil die Beispielanrufe nicht ueber die Live-Anrufabwicklung
  entstehen (docs/OPENAI-REVIEWER-ACCESS.md Abschnitt 5, Beleg
  `src/telephony/call-finish.js:422`). Falls die Einreichung dort Inhalt braucht, ist das eine
  Folgephase.
- **Kein Outbound-Seed, kein Reviewer-Modus, kein Testziel-Gate, kein neuer Endpunkt, keine neue
  Env-Variable** — laut Spec Abschnitt 5 bewusst nicht gebaut.
- **Die eigentumsverifizierende Einrichtung ist Owner-Sache, nicht Code:** Konto beim
  Login-Anbieter, Abo/KYC, der Seed-Lauf gegen Produktion und die Live-Probe in ChatGPT sind laut
  Owner-Vorgabe explizit ausgeklammert (s. Owner-Punkte unten).
- **Die sichere Testziel-Nummer ist im Code nicht belegbar** — kein Gate unterscheidet
  Testziele von echten Zielen; das Dokument sagt das an derselben Stelle offen (Abschnitt 7) und
  markiert die Wahl als Owner-Entscheidung.

## 2. Was erfuellt ist — ID fuer ID

**O-9 — Reviewer-Zugang: Demo-Konto mit Beispieldaten, ohne MFA/SMS/E-Mail-Bestaetigung/
Neuanmeldung/privates Netz, nicht abgelaufen.**

- Woertliches Zitat der Primaerquelle mit URL vorhanden — und korrigiert gegenueber der
  Anforderungsdatei: `tasks/openai-audit/00-openai-anforderungen.md:104` ordnet das Zitat
  "Plugins that require additional login steps ..." der URL
  `https://developers.openai.com/plugins/deploy/app-review` zu. Ich habe das nicht selbst am 27.09.
  gegen die Live-Seite geprueft (das waere ein WebFetch-Schritt ausserhalb des Kontextbudgets),
  aber der Auftrag nennt es als Widerspruch, den diese Phase auflösen sollte: Das gebaute Dokument
  zitiert denselben Satz stattdessen mit der URL `.../plugins/app-guidelines`
  (docs/OPENAI-REVIEWER-ACCESS.md, Abschnitt 1, EN wie DE) und fuehrt daneben sieben weitere
  woertliche Zitate aus `deploy/app-review`, `deploy/submission` und
  `deploy/submission-errors` — jedes mit eigener URL, keines paraphrasiert.
- **Kein MFA/SMS/E-Mail-Bestaetigung/Neuanmeldung fuer den Reviewer:** Hermes hat auf dem
  MCP-Pfad ueberhaupt keinen Passwort- oder MFA-Schritt — der ganze Login laeuft ueber den
  externen Autorisierungs-Server. Belegt: `src/auth.js:247` (401 + `WWW-Authenticate` ohne
  Token), `src/auth.js:384`/`:376` (Resource-Metadata nennt `authorization_servers`),
  `src/auth.js:61` (Scopes `openid email offline_access`), `src/auth.js:259` (Signatur-/
  Claim-/Scope-Pruefung des vom AS ausgestellten Tokens), `src/auth.js:284` (Identitaet aus
  `sub`). Ich habe diese Zeilen gelesen; sie tragen die im Dokument zitierten Aussagen. Was der
  Anbieter selbst beim Login verlangt (MFA an/aus, E-Mail-Verifikation), ist im Code nicht
  pruefbar — das Dokument markiert genau diese Saetze ausdruecklich als "operator commitment,
  not a code fact" (Abschnitt 3, Schritt 3 und 5), nicht als Code-Beleg.
- **Erster Login legt keinen Mandanten an, kauft keine Nummer:** `src/routes/_tenant.js:162` ff.
  ruft nur `store.resolveTenant` (`src/store/state-ops.js:5306`) — eine reine Lese-Funktion, die
  bei fehlendem Index-Treffer auf einen 1:1-Scan zurueckfaellt, aber nichts anlegt (Zeilen
  5298-5312 gelesen: kein `createTenant`, kein Schreib-Aufruf im Pfad). Ohne Treffer antwortet
  jeder Tool-Call mit dem Fehler "No Hermes account is linked to this login"
  (`src/mcp-no-tenant.js:32`, `src/routes/mcp.js:211`) — Text im Dokument identisch zitiert. Der
  Test `test/openai-t2-20-reviewer-seed.test.js` ("Draht HTTP /mcp (OAuth, Interface-IP): Daten
  sichtbar, kein Mandant, keine Nummer") faehrt genau diesen Pfad ueber die echte HTTP-Route und
  bestand isoliert gruen (25/25 Tests dieser Phase, 0 fail, lokal
  nachgefahren: `test/openai-t2-20-reviewer-doku.test.js`,
  `test/openai-t2-20-reviewer-seed.test.js`, `test/openai-t2-20-reviewer-seed-pg.test.js`).
- **Beispieldaten vorhanden und ueber den Draht sichtbar:** drei beendete Inbound-Anrufe mit
  Zusammenfassung und je einem oder zwei offenen Action Items
  (`scripts/lib/reviewer-demo-seed.mjs:41-64`, Nummern aus dem reservierten NANP-Fiktivbereich
  +1 202 555 01xx). Der Test "erster Lauf: nur calls/actionItems geaendert" plus der
  Draht-Test oben belegen `list_calls`/`list_action_items` mit Inhalt.
- **Seed setzt nachweislich kein Abo-/KYC-/Verifikations-/Profil-/Nummern-/Budget-Feld:**
  `applyReviewerSeed` (scripts/lib/reviewer-demo-seed.mjs:127-138) schreibt ausschliesslich ueber
  `createCall`, `recordProviderCallResult`, `setCallEndedAt`, `addActionItem`. Der Test
  "Diff-Pruefer meldet eine Aenderung an einem geschuetzten Schluessel" bestand, ebenso der
  Store-Deep-Equal-Vergleich im ersten-Lauf-Test (Ausnahme dokumentiert: nur der reine
  Anzeige-Zaehler `usage[tenant].calls` waechst mit, kein Gate liest ihn — s. Abweichungen).
  `assertSeedableTenant` (Zeilen 74-84) verweigert leere Kennung, Betreiber-Mandant und
  unbekannten Mandanten, bevor irgendetwas gelesen wird; Test "Betreiber-, unbekannter Mandant
  und fehlender Ende-Zeitpunkt werden verweigert, nichts geschrieben" bestand fuer json und pg.
- **Idempotent:** zweiter Lauf meldet "nichts zu tun", Store unveraendert — eigener Test bestand.
- **Kein Vorfaelligkeitsalarm der Kosten-Ueberwachung durch den Seed:** `endedAt` der
  Seed-Anrufe liegt vor Beleg- und Herzschlag-Fenster (`reviewerSeedEndedAtIso`,
  scripts/lib/reviewer-demo-seed.mjs:100-107); vier Zeitpunkte plus Positivkontrolle getestet,
  alle gruen ("Kosten-Ueberwachung meldet nach dem Seed nichts, Quote unveraendert").
- **pg-Pfad:** Flush-Ueberleben, Neu-Hydrierung, unveraenderter Mandant, Idempotenz und die
  Pflichtabbruch-Bedingungen wurden gegen einen echten (Temp-)pg-Store getestet — 2 Tests, beide
  gruen. Der offene Sicherheitsbefund zum Commit-Stand (Abschnitt 1) betrifft NICHT diese
  Tests, sondern eine Betriebsanweisung, die im Dokument/Skript fehlt.

## 3. Beruehrte Pfade — Erfuellung ueberall?

- **json-Store (Trockenlauf, Abbruchpfade, Schreib-/Idempotenz-/Draht-Test):** vollstaendig
  getestet, alle Faelle gruen.
- **pg-Store:** getestet fuer Flush/Idempotenz/Abbruch — aber NICHT fuer den Commit-Abgleich vor
  Produktions-Migration (Abschnitt 1); dieser Pfad ist der einzige, der real gegen eine externe
  DB laeuft, und genau dort fehlt die Absicherung.
- **HTTP `/mcp` (OAuth):** ein Drahttest ueber die Interface-IP, uebersprungen ohne
  Interface-IP-faehige Maschine (laut Bau-Notiz) — auf dieser Maschine lief er (im Log als
  bestanden aufgefuehrt, kein "skip" in der Ausgabe).
- **Dokument (EN/DE):** ein eigener Test vergleicht Platzhalter/Login-Schritte/Warnungen
  zwischen beiden Sprachfassungen — bestanden.

## 4. Was ein fremder Pruefer nachmessen sollte (neutral)

- Ist das Zitat in `docs/OPENAI-REVIEWER-ACCESS.md` Abschnitt 1 fuer jede der acht Zeilen
  wortgleich mit der jeweils verlinkten Seite (Stand heute pruefen, nicht der Anforderungsdatei
  vertrauen — die Anforderungsdatei selbst war laut Bau-Notiz an einer Stelle veraltet)?
- Fuehrt ein OAuth-Login mit einem bei Hermes unbekannten `sub` tatsaechlich zu keinem
  Mandanten-Anlegen? Nachvollziehen: `src/routes/_tenant.js` ab Zeile 155 und
  `src/store/state-ops.js` `resolveTenant` ab Zeile 5306 lesen — enthaelt der Pfad irgendeinen
  Schreib-Aufruf (`createTenant`, `save`, o.ae.)?
- Verweigert `scripts/seed-reviewer-demo.mjs`/`reviewer-demo-seed.mjs` nachweislich jedes
  Schreiben von Abo-, KYC-, Verifikations-, Profil-, Nummern- oder Budgetfeldern? Grep im
  Kern-Modul nach `store.` — sind es wirklich nur die vier genannten Funktionsnamen?
  `grep -n "store\." scripts/lib/reviewer-demo-seed.mjs`.
- Verlangt der pg-Zweig des Skripts (`PG_ABORT`, scripts/seed-reviewer-demo.mjs Zeilen 60-63)
  irgendeinen Abgleich des lokalen Commits mit dem live deployten Stand, bevor er
  `src/store.js` importiert (und damit `migrate()` ausfuehrt)? Falls nicht: reproduziert das den
  im Bericht genannten Befund?
- Laufen die drei Tests `test/openai-t2-20-reviewer-*.test.js` isoliert gruen (nicht nur im
  vollen Lauf mit `--test-concurrency=4`)?
- Zeigt `git diff --stat master...HEAD -- src/` fuer diesen Branch wirklich nichts an — ist die
  Aussage "kein Code angefasst" damit gedeckt?

## 5. Owner-Punkte und Restrisiko

- Reviewer-Konto beim Identitaetsanbieter anlegen: FRISCHE E-Mail, die keinem Hermes-Konto
  zugeordnet ist, verifiziert, ohne MFA; Login im privaten Fenster ausserhalb des Firmennetzes
  gegenpruefen (Anbieter-Einstellung + Live-Probe, beides Owner-Vorbehalt).
- Einmaliger Web-Login mit diesen Daten (legt den einzigen Mandanten an) und ein echtes Abo mit
  echter Verifikation abschliessen; den Mandanten NICHT in `OWNER_SELF_CALL_TENANT_IDS`
  eintragen und kein `profile.unrestricted`/`allowedNumbers` setzen (Render-Dashboard-Werte,
  Owner-Vorbehalt).
- Seed gegen Produktion ausschliesslich mit gestopptem Dienst fahren
  (`STORE_BACKEND=pg ... --apply --tenant <ID> --dienst-gestoppt`), danach Dienst starten;
  vor der Einreichung und bei langem Review erneut, weil Aufbewahrung die Beispielanrufe
  entfernt. Dabei zaehlt der oben genannte offene Sicherheitsbefund: den Lauf nur vom Commit aus
  starten, der tatsaechlich live deployt ist — im Skript selbst nicht erzwungen.
- Sichere Testziel-Nummer festlegen (Code belegt keine) und zusammen mit E-Mail/Passwort/
  MCP-Server-URL nur im Einreichungsformular eintragen, nie ins Repo.
- Produktionswert von `RETENTION_DAYS` im Render-Dashboard pruefen: Standardkonfiguration laesst
  die Beispielanrufe nach rund 22 Tagen verschwinden, bei 8 oder weniger sofort — Betrieb muss
  den Seed-Lauf danach ausrichten.
- Deploy/Push dieses Merges hat keine Deploy-Vorbedingung (kein `src/`-Eingriff), ausser der
  Commit-Bedingung, die der offene Sicherheitsbefund fuer den PRODUKTIONS-Seed-Lauf selbst
  verlangt (nicht fuer den Deploy).

**Restrisiko:** Der einzige nicht behobene Befund ist betrieblich, nicht im Gate selbst: das
Seed-Skript kann, falls jemand es aus einem lokal weiter fortgeschrittenen Checkout gegen
Produktion startet, eine DDL-Migration eines nicht deployten Standes auf die Produktions-DB
anwenden und danach mit der Zeilenform dieses Standes flushen. Das Skript selbst ruehrt keine
Gates, kein Abo-/KYC-Feld und keine Nummernvergabe an — das Risiko liegt ausschliesslich in der
Reihenfolge "welcher Commit lief beim pg-Lauf", die weder Skript noch Dokument erzwingen. Bis
das nachgezogen ist, ist der pg-Produktionslauf nur sicher, wenn der Betreiber selbst darauf
achtet, ihn exakt vom deployten Commit aus zu starten.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: e75823a; Tests (volle Suite, pass/fail): 6756/2
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - O-9 | ja | Eigene Probe (json): Seed --apply legt 3 Inbound-Anrufe + 4 Items an, 2. Lauf 'nichts zu tun', Betreiber/unbekannter Mandant/pg ohne Flag -> Exit 1; Tenant/KYC/Nummern unveraendert; /mcp OAuth ueber Interface-IP: list_calls 3, Items 4, ohne Token 401 | Nur live (OW-L): echtes Reviewer-Konto beim IdP ohne MFA mit echtem Abo+KYC anlegen, Seed laufen lassen, Zugangsdaten ins Formular, Login selbst testen. Seed-Anrufe verfallen ~22 Tage nach Lauf (RETENTION_DAYS=30); Doku sagt: neu laufen lassen.
- Isoliert rot: []
- Offene Blocker:
  - safety/wichtig scripts/seed-reviewer-demo.mjs:32: Der pg-Lauf importiert src/store.js aus dem lokalen Checkout, der gerade ausgefuehrt wird. pg.init fuehrt dabei migrate() aus, also die DDL dieses Codestands (src/store/pg.js:70-73), gegen die Produktions-DB. Danach flusht es ALLE Mandanten mit der Zeilenform dieses Codestands. Weder die Skript-Doku noch PLAN-SECURITY verlangen, dass der Betreiber das Skript genau vom Commit aus startet, der live deployt ist.
