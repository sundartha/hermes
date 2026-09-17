# Phase IEX-A8: Registrierungs-Beleg am Nummern-Datensatz

**Gate: PASS**
**finalBranch:** `phase/iex-a8-registrierungs-beleg`

## Plan (gekuerzt)

Basis: `phase/iex-a7-init-limit` (fd6de40, damals noch nicht auf master).

**Wirkung am Anruf: keine.** Kein Leser des neuen Felds ausser dem Sweep. E9/A9 lesen es erst spaeter. `/voice/*`, Init-Route und `inbound-path-decision.js#inboundElPathFor` bleiben unberuehrt, der Golden `iel-incoming-golden` bleibt byte-identisch. Kein Safety-Gate, keine Offenlegung, keine Auth-Flaeche angefasst; kein neuer Endpunkt, keine Env-Variable, keine Dependency.

**Fuenf Entscheidungen (Auslegung der Spec):**
- **D1:** Agent-Vergleich gegen `registrierung.assigned_agent?.agent_id` (GET liefert den Agenten dort, nicht als `agent_id` direkt).
- **D2:** Fuenfte BELEGT-Bedingung `registrierung.phone_number === number.e164` — verschaerft fail-closed, verhindert "Dial ins Leere".
- **D3:** `scope=` und `repariert=` fehlen in A8 in der Ergebniszeile bewusst (kommen erst mit A9/A10, sonst Luege bzw. Konstante ohne Verhalten).
- **D4:** Reparatur-Hook wird in A8 nur als Naht gebaut (`pruefeNummer` als eigene Funktion), nicht als Zweig — sonst toter Code.
- **D5:** `server.js` kommt zur Dateiliste dazu (Bestandsmuster: jede Boot-Sonde wird dort gebaut und ueber deps-Buendel an `bootServer` gereicht).

**Form der Felder:** "kein Beleg = Felder abwesend" in json UND pg (Muster `privateNumber`). Haelt den Golden-Master `store-pg-multitenant` T-PA6-1 ohne Testaenderung gruen.

**Neue Datei `src/elevenlabs/inbound-trunk-beleg.js`:** reiner Teil (`zugangsFingerabdruck`, `belegeInboundTrunk`, `belegAusAbruffehler`, `trunkSweepHindernis`, `trunkSweepErgebnisZeile`, `endungenTeil`) plus IO-injizierte Fabrik `makeTrunkSweep` (`pruefeNummer`/`holeBeleg`/`wendeBelegAn`/`laufe`/`runBootSweep`, begrenzte Parallelitaet `SWEEP_PARALLEL=4`, fail-soft).

**Edits:** `src/db/schema.sql` (2 neue nullable Spalten `el_inbound_trunk_belegt_at`, `el_inbound_trunk_zugang_fp`), `src/store/state-ops.js` (`markNumberElInboundTrunkBelegt`, `clearNumberElInboundTrunkBeleg`, `releaseNumber` entfernt Beleg), `src/store/json.js` (Wrapper), `src/store/pg.js` (SELECT/`rowToNumber`/`flushNumbers` + Spread-Helfer `inboundTrunkBelegFelder`/`-Werte`, Save-Closure extrahiert als `mitSpeichernBeiAenderung`), `src/store.js` (Re-Export), `src/server.js` (D5: Fabrik-Konstruktion + deps), `src/boot.js` (`void inboundTrunkSweep.runBootSweep()` im listen-Callback nach `logBootBanner`), `eslint-legacy-exceptions.json` (Pin-Folge, `makePgStore` Zeilenzahl).

**Tests:** 19 Testgruppen `IEX-A8-1..19` in `test/iex-a8-beleg.test.js` — reine Funktionen, state-ops, json/pg-Wrapper inkl. PGlite-Roundtrip, Ergebniszeilen-Kombinatorik, Parallelitaets-/Zeitpunkt-Verhalten, Hindernis, Fail-Soft, Log-Hygiene, Vor-listen-Sonde unveraendert, Leck-Grep mit Positiv-Kontrolle, Verdrahtung, Spawn-E2E gegen Fake-EL-Server.

**Pre-Mortem (§4):** Agent-ID leer/falsch loescht alle Belege (Gegenmassnahme: Hindernis `el_konto_unvollstaendig` + `gleichUndGesetzt`); EL-Stoerung (401/429/5xx) loescht nichts (nur 404 loescht); Rennen Freigabe/Sweep (Op prueft `status===ACTIVE`); Folge-Flush nullt Belege nicht (I8-Lehre, getestet); kein Log-Leck; Boot haengt nicht (fire-and-forget nach `listen`).

**Offene Review-Concerns / Uebergabe an A9/A10:** Fingerabdruck deckt nur `sipUser`, nicht das Passwort (PLAN-SECURITY-Eintrag gehoert in A9); Skalengrenze `SWEEP_PARALLEL=4` und periodischer/inkrementeller Sweep als A9-Folgeaufgabe; `scope=`/`repariert=` und Reparatur-Hook sind A9/A10-Scope; Runbook-Befund an den Lead (Registrierung ohne Inbound-Trunk = ABWEICHUNG, kollidiert potenziell mit a3-Bedingung `abweichung=0`) — Lead muss vor a3 entscheiden.

## Impl-Zusammenfassung

Branch `phase/iex-a8-registrierungs-beleg` (von `phase/iex-a7-init-limit` fd6de40), Head-Commit `ee24600`. `node --check` gruen auf allen geaenderten Dateien. `npm test -- --test-concurrency=4`: 5904/5904 gruen (0 Fail). `npm run lint`: Exit 0. `check-staged-suppressions.js`: Exit 0. Grep auf die Feldnamen findet genau die vier erwarteten Dateien.

Umgesetzt wie geplant: neues Modul `inbound-trunk-beleg.js` mit reinem Teil (Fingerabdruck 16 Hex sha256, fuenf BELEGT-Bedingungen inkl. D1/D2, Fehler-Klassifikation nur-404-loescht, Hindernis-Tabelle, Ergebniszeilen-Formatierer mit Kappung) und `makeTrunkSweep` (injiziertes IO, bis zu 4 parallele GETs, fail-soft). Store-Operationen in state-ops/json/pg symmetrisch (Feld-Abwesenheit als "kein Beleg"-Form in beiden Backends), `releaseNumber` entfernt den Beleg mit. Verdrahtung: `server.js` baut den Sweep mit derselben `elRead`-Instanz wie der Drift-Waechter, `boot.js` ruft ihn fire-and-forget nach dem Boot-Banner auf. Lint-Pin `makePgStore` 585→586 (eine Spread-Zeile) wie im Plan vorhergesagt gemessen. 38 neue Testfaelle (IEX-A8-1..19).

### Deviations
- `istNichtLeererString` in `src/elevenlabs/inbound-path-decision.js` ist jetzt exportiert (Plan sagte, Datei bleibt unveraendert) — verhindert eine dritte Kopie des Helfers; `inboundElAllowlistProbeLine` bleibt unberuehrt, per IEX-A8-16 belegt.
- `test/check-staged-suppressions.test.js` musste mitgeaendert werden: die "Altlast-Ratsche" vergleicht gegen einen fest eingetragenen Fingerabdruck (`LEGACY_FINGERPRINT`), den die Pin-Anhebung aus Plan 2.5 sonst rot liess. Nachgezogen nach Vorgaenger-Muster (IEL-B4a), Lead-Bestaetigung empfohlen.
- Kopfkommentar von `inbound-trunk-beleg.js` nennt die Feldnamen explizit, damit die Positiv-Kontrolle des Leck-Greps (IEX-A8-17) die Datei findet.
- Kontostand-Hindernis prueft ueber `istNichtLeererString(apiKey/agentId)`, nicht ueber eine blosse Leer-Pruefung — gleiches Verhalten, Implementierungsdetail, das der Plan offenliess.
- `belegeInboundTrunk` ist in drei private Praedikate zerlegt (`trunkTraegtZugang`, `trunkErlaubtNurDid`, `registrierungGehoertAgentUndDid`), um die Komplexitaetsgrenze (G28, <10) zu halten; die fuenf Bedingungen selbst sind unveraendert.

## Safety-Urteil

**PASS, approved.** Alle Gates gruen: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. Keine Blocker.

Unabhaengiger Testlauf (frischer Worktree, Branch `review-iex-a8` von `ee24600`): `node --check` auf allen 8 geaenderten src-Dateien ok; zwei separate `node --test`-Laeufe (142 + 42 Tests) beide gruen; eslint auf die geaenderten Dateien 0 Fehler (4 Vor-Diff-Warnungen unveraendert). Gegen den Diff geprueft: claude.js, locales, voice.js, Init-Route, convai, outbound, config, package.json unberuehrt — keine neue Route, keine neue Env-Variable, keine neue Dependency. Log nennt weder sipUser noch Fingerabdruck, Nummer, ID oder Fehlertext.

Concerns (nicht blockierend, A9/A10-Scope): Ergebniszeile hat noch kein `scope=`/`repariert=`; kein Reparatur-Hook (nur die Naht `pruefeNummer`); N Voll-Flushes beim ersten Boot nach Deploy (heute unkritisch, set-once je Zugang); eine werfende Bahn in `mitBegrenzterParallelitaet` laesst andere Bahnen im Hintergrund weiterlaufen ohne Ergebniszeile (bleibt fail-closed, da fehlende Zeile im Runbook ROT bedeutet); `e164=null` liesse den ganzen Sweep werfen (fail-closed, nach Lebenszyklus unwahrscheinlich); OHNE_REGISTRIERUNG loescht nie einen vorhandenen Beleg (heute nicht erreichbar ausser per DB-Eingriff); `PLAN-SECURITY.md` in A8 bewusst nicht angepasst (gehoert laut Spec in den A9/A10-Abschnitt).

## Clean-Code-Audit (s1-s4)

- **s1 (Blocker):** keine Funde.
- **s2 (schwer):** keine Funde.
- **s3 (mittel):** eine Randnotiz — `SWEEP_PARALLEL=4` ist eine algorithmische Konstante ohne Env-Knopf, im Kommentar begruendet ("kein Env-Knopf"); kein echter G35-Verstoss, da interne Rate-Limit-Bremse statt Betreiber-Konfiguration.
- **s4 (leicht):** eine Randnotiz — `pruefeNummer -> holeBeleg -> wendeBelegAn` ist implizite Reihenfolge (kein Bucket-Brigade-Rueckgabewert), aber sauber in einer kleinen Funktion gekapselt, kein externer Aufrufer kann die Reihenfolge falsch nutzen.

**Verdict: PASS**, kein Blocker. 38 neue Tests, alle gruen (reiner Teil, beide Store-Backends inkl. echtem PGlite-Roundtrip, Parallelitaets-/Zeitverhalten, Fail-Soft, Log-Hygiene per Dateiscan mit Positiv-Kontrolle, Verdrahtungs-Assertions per Quelltext-Match, Spawn-E2E gegen echten HTTP-Fake). Sicherheitsrelevante Punkte (Secrets nie loggen) aktiv belegt, nicht nur behauptet. Store-Symmetrie json/pg per echtem Roundtrip verifiziert (I8-Lehre beachtet). Ein einmaliger Flake in `test/store-pg.test.js` (`addNotification` kappt auf 50) liess sich isoliert als gruen reproduzieren — unabhaengig vom IEX-A8-Diff, kein Blocker.

Positiv vermerkt: `mitSpeichernBeiAenderung` als geteilte Factory statt Kopie (G5); `istNichtLeererString` wiederverwendet statt neu gebaut; `isoZeitpunktOderNull` wiederverwendet; "kein Beleg" konsistent als abwesende Felder in beiden Backends, per Test belegt; `releaseNumber` entfernt Beleg korrekt mit der Registrierung; fail-closed-Defaults bei leerem `agentId`/`sipUser`; Lint-Pin-Anhebung minimal und nachvollziehbar dokumentiert; additive/nullable Schema-Aenderung, RLS-Vererbung korrekt kommentiert, kein Backfill noetig.

Optionale Folgepunkte (kein Blocker): den store-pg.test.js-Flake unabhaengig beobachten, falls er sich haeuft; Schreib-Repair-Pfad beim Anbieter bleibt bewusst A10-Scope.

## Sicherheits-Review (final, separat vom Safety-Urteil)

**Approved, keine Blocker.** Kein neuer Endpunkt, kein Anruf-/SMS-/Geld-Ausloeser, keine Aenderung an Kostendecke, Denylist/Land-Gate/Stundenlimit, Max-Dauer, Verifikation, `OUTBOUND_FROZEN` oder Signaturpruefung; Offenlegung und Inbound-Eroeffnung unberuehrt. `makeTrunkSweep` liest beim Anbieter nur per GET, schreibt ausschliesslich die zwei Beleg-Felder am eigenen Nummern-Datensatz. Eine fremde Registrierung kann keine DID belegen (alle fuenf Bedingungen muessen passen). Loeschen nur bei belegter Abweichung/404, UNBEKANNT laesst Beleg stehen. Fingerabdruck enthaelt nie das Passwort. Felder erscheinen in keiner API-/MCP-Ausgabe und nicht in `exportTenantData` (von Hand geprueft). Vor-listen-Sonde bleibt byte-gleich. 38/38 Tests gruen.

Concerns (nicht blockierend): theoretisches Rennen Freigabe+Wiederaktivierung waehrend eines laufenden Boot-GETs (praktisch kaum erreichbar, billige Haertung fuer A9 vorgeschlagen: Registrierungs-ID beim Setzen vergleichen); Leck-Test (IEX-A8-17) prueft nur per Feldnamen-Grep, eine kuenftige Spread-View faende ihn nicht (heute kein Befund); `mitEndung` ruft `e164Endung` ohne Null-Pruefung (fail-closed, aber Ergebniszeile fehlt dann laut E11 als ROT); Diff aendert `server.js` und hebt den eslint-Pin an — nicht in der urspruenglichen Dateiliste der Spec, aber fuer den geforderten Boot-Aufruf noetig und begruendet.

## Fix-Runden

Keine — Gate wurde ohne Fix-Runde mit PASS erreicht (`=== FIXES ===` im Quellmaterial ist leer).
