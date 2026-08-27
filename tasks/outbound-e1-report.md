# Phase OUTBOUND-E1 — Detailbericht

## WURZEL

Der Ausfall vom 24.08.2026 entstand, weil EINE Rufnummer zwei Rollen gleichzeitig trug: Tenant-DID und Plattform-Absender (Outbound-ANI bzw. Alarm-SMS-Absender). Nur die erste Rolle war im Datenmodell darstellbar. Der Loeschweg eines Wegwerf-Kontos konnte damit stillschweigend den Absender des gesamten Produkt-Outbounds freigeben.

Die Phase behebt das durch zwei Massnahmen:

1. **Plattform-Nummern-Bindung (`platform_number_use`)**: eine eigene, globale (nicht tenant-gescopte) Collection, die festhaelt, welche Rufnummer die PLATTFORM fuer welchen Zweck (`outbound_ani`, `alert_sms_sender`) benutzt.
2. **Dreifacher Freigabe-Riegel**: drei unabhaengige Ebenen, die eine gebundene Nummer vor Freigabe/Umwidmung schuetzen.

**Gate:** PASS (Clean-Code-Audit, keine S1/S2-Befunde, PASS mit Auflagen)
**finalBranch:** `phase/outbound-e1-plattform-nummer-fix3`

---

## Vollstaendigkeit des Engpasses — alle gefundenen Freigabe-/Umwidmungs-Pfade

Per grep ermittelt (`\.status *=`, `transitionNumber(`, `UPDATE number|DELETE FROM number|INSERT INTO number`), nicht dem Plan geglaubt.

| # | Pfad | Erreicht released/suspended? | Laeuft durch Ebene A? | Urteil/Deckung |
|---|---|---|---|---|
| 1 | `releaseNumber` <- `release-reconcile.js` (`performNumberRelease`, Grace + Erase) — der Weg des 24.08.-Ausfalls | ja | ja | A + B + C |
| 2 | `releaseNumber` <- `onboarding.js` (`rollbackAfterOrder`) | ja, nur `failed -> released` | ja | A. Kein False-Positive: `e164` ist hier `null`, Praedikat liefert `null` |
| 3 | `beginProvisioning`/`beginCapturing`/`activateNumber`/`failNumber` | nein (Zielzustand nicht released/suspended) | n. z. | kein Befund |
| 4 | Jeder kuenftige Suspend-Pfad | — | ja | A, vorwaertsgerichtet — heute existiert kein Aufrufer fuer SUSPENDED |
| 5 | `attemptContractEndCleanup` -> `releaseTenantNumbersOnErase` | ja (Kuendigung) | ja, ueber #1 | A + B, Ebene B hier kritisch |
| 6 | `runContractEndCleanupSweep` (6-h-Retry) | ja, ueber #5 | ja | A + B |
| 7 | `runReleaseReconcile` <- `wiring/web-login.js` (bei jedem Login) | ja (Grace) | ja, ueber #1 | A + B |
| 8 | `scripts/erase-tenant.js` | nein — fasst `s.numbers` nie an | n. z. | kein Befund |
| 9 | `scripts/seed-owner-number.js`, `scripts/bootstrap-tenant.js` | nein (nur Anlegen) | n. z. | kein Befund |
| 10 | `src/db/migrate.js` direktes UPDATE (nur `country`/`language`) | nein, Spalte `status` nicht betroffen | nein | kein Befund — Trigger ist `BEFORE UPDATE OF status`, feuert hier nicht |
| 11 | `pg.js` `flushNumbers`-Upsert (bei jedem `save()`) | schreibt `status` mit, meist unveraendert | nein | Ebene C mit `WHEN`-Klausel — empirisch entschaerft |
| 12 | `pg.js` `deleteMissing`/`flushOwnScoped`-Prune (`DELETE FROM number ...`) | loescht Zeile ganz | nein | **Befundluecke, bewusst nicht per Trigger geschlossen** (s. unten) |
| 13 | Manueller `psql`-Eingriff / kuenftiger Store-Umgeher | ja | nein | Ebene C — deren alleiniger Daseinszweck |
| 14 | Umwidmung beim Anbieter (Telnyx-Portal `connection_id`, `ani_override`, `DELETE /v1/convai/phone-numbers`) | ja, faktisch | nein | von KEINER Ebene gedeckt — Waechter-Sache spaeterer Phase (E4) |

**Zeile 12 (Prune-DELETE) — die einzige echte Schleichweg-Luecke im eigenen Code, bewusst offengelassen:**
Ein `BEFORE DELETE`-Trigger mit `RAISE EXCEPTION` wuerde sie schliessen, waere aber PM-12: jede Spiegel-Divergenz (Teil-Hydrierung, Overlap-Prozess) machte aus einem lokalen Problem einen Totalausfall des gesamten Schreibpfads fuer alle Tenants. Tragbar, weil (a) die Bindung in `platform_number_use` selbst nicht tenant-gescoped ist und den Prune ueberlebt, (b) ein Prune-DELETE die Nummer nicht beim Anbieter freigibt — der irreversible Schritt laeuft nur ueber `performNumberRelease`, gedeckt von Ebene B.

---

## Die drei Riegel-Ebenen einzeln

**Ebene A — Store-Engpass (`transitionNumber`)**
`transitionNumber` in `src/store/state-ops.js` ist der EINZIGE Schreiber von `number.status` im gesamten Repo (grep-belegt). Vor jedem Uebergang nach `released` oder `suspended` prueft die Funktion `numberBusyReason` (bindungsbasiert + laufender-Anruf-Check) und wirft, wenn die Nummer gesperrt ist. Deckt automatisch jeden heutigen UND kuenftigen Aufrufer, ohne dass dieser selbst daran denken muss.

**Ebene B — Verdikt vor dem irreversiblen Provider-DELETE**
`numberReleaseVerdict` liefert `HOLD` statt `RELEASE`, wenn die Nummer plattform-gebunden ist — VOR dem Aufruf des Telnyx-`DELETE /v2/phone_numbers`. `tenantNumbersForErase` liefert seit dieser Phase Koerbe `{release, hold}` statt eines Filters: eine herausgefilterte Nummer waere sonst spurlos verschwunden (`numberReleasePending` faelschlich `false`, der Retry-Sweep faende den Tenant nie wieder — PM-18). Jeder HOLD zaehlt im Orchestrator als `aborted` und erzeugt genau eine PII-freie Audit-Zeile (`did_release_aborted`, Detailtext ohne E.164).

**Ebene C — DB-seitiger Backstop (pg-Trigger)**
`BEFORE UPDATE OF status ON number`-Trigger in `schema.sql`, deckt manuelle DB-Eingriffe und jeden Schreibweg, der `state-ops.js` umgeht. Drei Formeigenschaften waren nicht optional:
1. `WHEN`-Klausel auf den Zustandsuebergang (`OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('released','suspended')`) — ohne sie feuert der Trigger auch bei No-Op-Updates und der komplette Flush-Schreibpfad stirbt (PM-11).
2. Kein werfender `BEFORE DELETE`-Zweig — sonst macht jede Spiegel-Divergenz beim Prune einen Totalausfall (PM-12).
3. `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION` — Idempotenz, da `applySchema` bei jedem Prozessstart die ganze Datei ausfaehrt; ein blankes `CREATE TRIGGER` liesse den zweiten Boot fehlschlagen.

---

## Abnahmepunkte einzeln, Urteil + Kommando

| # | Kommando | Ergebnis | Urteil |
|---|---|---|---|
| A0 | `LLM_PROVIDER=anthropic npm run test:gates` (master, vor Edit) | `fail 3` (GAP-05, GAP-15, E2E-03) | Vorher-Zahl gemessen |
| A1 | `node --test test/plattform-nummer-bindung.test.js` | `pass 15, fail 0` | PASS |
| A2 | `node --test test/schema-plattform-trigger.test.js` | `pass 5, fail 0` | PASS |
| A3 | `node --test test/rls-with-check.test.js` | `fail 0`, zweimaliges `applySchema` uebersteht die neue Trigger-DDL | PASS |
| A4 | `LLM_PROVIDER=anthropic npm test` | zuletzt (nach Fix-Runden) `5147/5147, fail 0` | PASS, Anker 5111 nicht unterschritten |
| A5 | `node --test test/plattform-nummer-bindung-pg.test.js` | `pass 8, fail 0`, offline (PGlite) | PASS |
| A6 | `grep -c "OUTBOUND-RESILIENZ" PLAN-SECURITY.md` | `>= 1` | PASS |
| A7 | `LLM_PROVIDER=anthropic npm run test:gates` | `fail 3`, dieselben drei Namen wie A0 | PASS, nicht schlechter |
| A8 | `npm run lint` | `0 errors`, 64 Warnungen (Bestand) | PASS |
| A9 | `node --check src/store/state-ops.js src/store/pg.js src/store/json.js src/release-reconcile.js src/boot.js src/boot-guard.js src/config.js` | keine Ausgabe | PASS |
| A10 | `node -e "...config.provisioning.platformAniE164..."` | `""` (Default leer) | PASS |
| A11 | Sabotage-Gegenprobe, 6 Schnitte | je Schnitt genau der benannte Test rot, danach wieder gruen | PASS |
| A12 | *(Owner, rein lesend, NICHT Teil dieser Etappe)* `psql ... "\d+ number"` | zeigt `number_platform_binding_guard` | offen, kein Code-Gegenstand |

---

## Ausgefuehrte Gegenproben (woertlich)

### Positiv-Kontrolle (Pflicht — sonst besteht ein Alles-Blocker jeden Negativ-Test)
- **T3 (Ebene A):** ungebundene Nummer -> `releaseNumber` laeuft durch, `status=RELEASED`, `e164=null`, Assignment geschlossen.
- **T7 (Ebene B/Orchestrator):** ungebundene DID -> `provisionerCalls=1`, `released=1`, `aborted=0`, Audit `did_released`.
- **P3 (Ebene C/DB):** rohes `UPDATE number SET status='released'` auf ungebundener Zeile -> geht durch, `status='released'` in der DB.

### Sabotage (sechs Schnitte, jeweils gesetzt -> Test rot -> zurueckgenommen -> wieder gruen)
1. `NUMBER_OUT_OF_SERVICE`-Block in `transitionNumber` auskommentiert -> **T1 und T2 rot**, restliche 13 gruen. Zurueckgesetzt -> 15/15 gruen.
2. `busy`-Zeile in `numberReleaseVerdict` UND `tenantNumbersForErase` entfernt -> **T4, T5, T6, T10, T11 rot** (T8/T9 blieben gruen — T8 durch zusaetzliche Verteidigungstiefe in `performNumberRelease`/Ebene A, T9 pruefte den Riegel gar nicht; dokumentierte Abweichung von der Vorhersage). Zurueckgesetzt -> 15/15 gruen.
3. Trigger-DDL aus `schema.sql` entfernt (`DROP TRIGGER.../CREATE TRIGGER`-Block geloescht) -> **P2 UND S3/S4/S5 rot**, P1/P3-P8 gruen. Zurueckgesetzt -> 13/13 gruen.
4. `flushPlatformNumberUse` hinter die Tenant-Schleife verschoben -> **genau P6 rot**, alle anderen 7 pg-Tests gruen. Zurueckgesetzt -> 8/8 gruen.
5. `WHEN`-Klausel aus dem Trigger entfernt -> **P4 UND S4 rot** (dabei wurde ein Bug in der ersten P4-Testfassung gefunden und behoben: `assert.ok(true)` erkannte einen echten Flush-Fehler nicht, umgestellt auf `await store.drainFlushes()`). Zurueckgesetzt -> 13/13 gruen.
6. `PLATFORM_ANI_E164` aus `test/helpers.js` BASE_ENV entfernt, mit temporaerer `.env` (fiktiver Wert, gitignored) -> ein echter Server-Spawn zeigte VORHER `warnedEmpty:true`, NACH der Sabotage `warnedEmpty:false` (der lokale `.env`-Wert leakte in den Spawn-Test). Zurueckgesetzt, BASE_ENV traegt wieder `PLATFORM_ANI_E164:""`.

Unabhaengig vom Impl-Report wurde die Sabotage bei der finalen Safety-Pruefung (fix3) erneut selbst gefahren: Ebene A, B, C je einzeln ausgehaengt -> jeweils die vorhergesagten Tests rot (T1/T2/T17; T5/T6 mit Nebenbefund Tiefenverteidigung; P2/S5) -> nach Wiederherstellung 65/65 gruen, `git status` sauber.

---

## PGlite-Vorbedingung und die daraus gewaehlte Form von Ebene C

Vor der Umsetzung wurde eine Wegwerf-Sonde offline gegen PGlite gefahren (kein Netz, kein Provider-IO), um zu klaeren, ob die geplante plpgsql-Trigger-Form ueberhaupt lauffaehig ist. Ergebnis Zeile fuer Zeile:

- plpgsql ist in PGlite vorinstalliert und im Bestand bereits in Benutzung (`schema.sql` enthaelt schon einen `DO $$ ... END $$;`-Block mit Dollar-Quoting) — die Plan-Aussage "NULL Funktionen im Schema" gilt fuer `CREATE FUNCTION`, nicht fuer plpgsql als solches.
- `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION` ist idempotent (Erst- und Zweitlauf beide OK).
- Gebundene Nummer -> Release/Suspend wirft, ungebundene -> OK.
- Flush-Upsert auf bereits released-er gebundener Zeile -> kein Wurf (PM-11 entschaerft durch WHEN-Klausel).
- Prune-DELETE auf gebundener Zeile -> kein Wurf (PM-12 entschaerft, kein DELETE-Zweig gebaut).
- Teilindex `(e164, purpose) WHERE released_at IS NULL` wirkt, Doppelbindung wird abgewiesen.
- `err.code === "P0001"` ist lesbar -> Test-Assertions pruefen SQLSTATE statt Meldungstext.

**Entscheidung:** die geplante plpgsql-Trigger-Form BLEIBT — keine Ausweich-CHECK-Form noetig. Alle im Plan als Blocker gefuehrten Risiken waren kleiner als angenommen oder durch die WHEN-Klausel/den fehlenden DELETE-Zweig bereits entschaerft. Nebenbefund: der Trigger feuert auch bei `released -> suspended`, obwohl das im JS-Zustandsautomaten illegal ist — am rohen SQL aber moeglich, genau der manuelle Eingriff, gegen den Ebene C gebaut ist. Korrektes Verhalten, keine Aenderung noetig.

---

## Impl-Zusammenfassung

Umgesetzt: globale Collection `platform_number_use` (Schluessel `e164`, `purpose` in `outbound_ani`|`alert_sms_sender`) plus dreifacher Freigabe-Riegel (Ebene A/B/C wie oben). Unbind-Protokoll fuer die legitime Kuendigung (eigene Bindung darf mit dem Tenant gehen), `e164=null` bei Freigabe (Wiederkauf derselben Nummer moeglich), Bindungen werden beim Boot idempotent aus `PLATFORM_ANI_E164` + der aktiven Bootstrap-Nummer ABGELEITET statt von Hand gepflegt (nicht-fataler Boot-Guard-Befund bei leerem Wert). DSGVO bleibt vollstaendig erfuellt — `eraseTenantData` faesst `s.numbers` nie an; nur die DID-Rueckgabe haelt (HOLD), nicht die Datenloeschung.

28 neue Tests (15 state-ops/Orchestrator + 8 pg/PGlite + 5 Schema-Text), 3 minimal angepasste Bestandstests (`tenantNumbersForErase` liest jetzt `.release`/`.hold` statt Array). Alle sechs geplanten Sabotage-Gegenproben ausgefuehrt, inkl. eines dabei gefundenen und behobenen Fehlers in der ersten P4-Testfassung.

### Deviations (Impl)
1. PGlite-Vorbedingung empirisch bestaetigt (s. oben) — keine CHECK-Ausweichform noetig.
2. Ebene A sitzt in `transitionNumber` (dem einen Schreiber von `number.status`), nicht separat in `releaseNumber` — deckt SUSPENDED und RELEASED mit einer Bedingung statt einer kopierten zweiten. Kein heutiger Suspend-Aufrufer, der Riegel ist dort vorwaertsgerichtet.
3. Kein `RAISE WARNING`-DELETE-Zweig im Trigger gebaut — waere in Render/PGlite in keinem gelesenen Log sichtbar, kostet eine zweite Funktion. Prune-Luecke stattdessen in `PLAN-SECURITY.md` benannt.
4. Kein neues Wahl-Gate im Outbound-Pfad bei leerem `PLATFORM_ANI_E164` — waere ein Falsch-Positiv-Abschalter, toetete Outbound beim Deploy, falls die Dashboard-Variable noch fehlt. Stattdessen lauter, nicht-fataler Boot-Befund.
5. `test/plattform-nummer-bindung-pg.test.js` ist nicht `DATABASE_URL`-gated — die pg-Bank laeuft im Bestand ohnehin gegen PGlite und ist offline.
6. Fallzahlen weichen von der Plan-Kurzfassung ab (15/5/8 statt 10/4/—) — deckt DSGVO-Doppelpruefung, Unbind, laufenden Anruf, ANI-Wechsel, Boot-Idempotenz zusaetzlich ab.
7. `runReleaseReconcile` bekommt zusaetzliche WARN-Zeilen fuer HOLDs im Grace-Pfad — additiv, schliesst eine stille Hold-Luecke.
8. `tenantId` auf der Bindung ist heute immer `null` (beide abgeleiteten Rollen sind reine Plattform-Anlagen) — der `forTenantId`-Zweig des Praedikats ist damit produktiv erst mit einer spaeteren Phase (E5) erreichbar, aber ueber `bindPlatformNumber` bereits real getestet (T10), kein toter Code.
9. **Architektur-Deviation, waehrend der Umsetzung entdeckt:** kein `store.syncPlatformBindings`/`platformNumberBinding`-Fassaden-Wrapper auf `json.js` UND `pg.js`, obwohl der Plan das als Wrapper-Paritaet vorsah. Grund: ein reiner Durchreicher haette `pg.js`' `makePgStore` ueber die in `eslint-legacy-exceptions.json` gepinnte Zeilenzahl (562) hinaus wachsen lassen — die Altlast-Ratsche (`test/check-staged-suppressions.test.js`) verbietet einem Bau-Agenten, diesen Pin ohne Owner-Freigabe anzuheben. Stattdessen nutzen `boot.js` und die Tests die reine Funktion in `state-ops.js` direkt ueber die auf beiden Backends bereits identischen `store.load()`/`store.save()`-Primitiven. `src/store.js` blieb dadurch komplett unveraendert.
10. In den zwei Bestandsdateien mit bereits gepinnter Altlast (`state-ops.js` id-length 241, `pg.js` id-length 41 + max-lines-per-function 562) wurden in jeder neuen Zeile bewusst mehrbuchstabige Bezeichner statt der sonst ueblichen Einbuchstaben-Idiome verwendet, um die Ratsche nicht anzuheben.

---

## Fix-Runden

**r1:** Alle drei Review-Blocker der ersten Runde behoben. `platformNumberBinding` (Array.find, nur erste offene Bindung) durch `platformNumberBindings` (Array.filter, ALLE offenen Bindungen) ersetzt; `numberBusyReason` haelt seither ueber `.some(...)` — verhindert, dass eine zweite offene Bindung auf derselben Nummer unbemerkt bleibt.

**r2:** Vier gemeldete Review-Blocker der zweiten Runde behoben, mit Regressionstests (T19-T21). `LLM_PROVIDER=anthropic npm test`: 5126/5126 gruen (>= 5111 erfuellt). `npm run test:gates`: 689/692, dieselben 3 roten Faelle unveraendert.

**r3 (final, entspricht `fix3`):** die beiden harten Blocker plus ein dritter (E1-S1-A/B) waren derselbe Befund und wurden gemeinsam behoben. Blocker 1: `closeBinding(binding)` mutierte eine Property des Funktionsparameters `binding` (no-param-reassign), was die gepinnte Altlast-Zahl fuer `src/store/state-ops.js` in `eslint-legacy-exceptions.json` verletzt haette — auf eine reine Rueckgabe umgestellt, die den Aufrufer die Zuweisung machen laesst.

---

## Safety-Urteil

**FREIGEGEBEN** (unabhaengig nachgemessen auf `phase/outbound-e1-plattform-nummer-fix3`, Commit `aa4c2ec`, Basis `master`=`c1d7c0d`, Diff gegen den Phasenbranch leer).

- Regression: `LLM_PROVIDER=anthropic npm test` -> **5147/5147**, kein Flake.
- Lint (voll): **0 errors**, 64 Warnungen (Bestand).
- Gates-Vergleich (beide selbst gefahren): master 686/689 pass, Branch 690/693 pass — identische drei roten Faelle (GAP-05, GAP-15, E2E-03); die vier zusaetzlich gezaehlten Zeilen sind reines TAP-Namens-Rauschen, kein Test ist per Katalog-Praefix in die Gates-Bahn gerutscht.
- Alle drei Ebenen einzeln SELBST nachgestellt (eigene Sonden, nicht nur die Impl-Tests) inkl. Positiv-Kontrollen und aller Sabotage-Schnitte — Ergebnis deckungsgleich mit dem Impl-Report.
- DSGVO: `eraseTenantData` byte-gleich im Diff, faesst `s.numbers` nie an; Calls/ActionItems/Notifications/`privateNumber` vollstaendig geloescht, nur die DID mit offener Bindung bleibt (HOLD).
- Engpass-Grep bestaetigt unabhaengig: `number.status` wird im gesamten Repo an genau EINER Stelle geschrieben (`transitionNumber`); der irreversible Provider-DELETE hat genau zwei Aufrufer (`release-reconcile.js`, `onboarding.js`), beide jetzt riegel-gedeckt. Kein ungedeckter Pfad gefunden.
- Kein Safety-Gate beruehrt (Outbound-Permit, `OUTBOUND_FROZEN`, Denylist/Land-Gate, Kostendecke, Signaturpruefung, Offenlegung/`callee_is_owner` unangetastet); kein `src/bridge.js`, keine Route-/`server.js`-Aenderung, kein echter Provider-Schreibzugriff im Diff/in Tests.
- PII/Secrets: nur reservierte Testnummern im Diff (`+15005550006/7`, `+4915112345678` u.ae.), keine echte Betriebsnummer, keine Schluessel/Token.

**Concerns (nicht blockierend, dokumentiert):**
1. Zweistufige manuelle Umgehung von Ebene C selbst gemessen: `UPDATE number SET e164=NULL` (feuert nicht, `status` nicht in SET-Liste) gefolgt von `UPDATE number SET status='released'` (sieht `OLD.e164=NULL`, EXISTS falsch, geht durch). Ausserhalb des Bedrohungsmodells eines Backstops (derselbe Operator koennte `DROP TRIGGER`), gehoert aber als Reichweiten-Hinweis in `PLAN-SECURITY.md`.
2. Fail-open-Prune auf `platform_number_use` selbst: `deleteMissingPlatformNumberUse` loescht bei leerer keep-Liste die ganze Tabelle — eine Spiegel-Divergenz auf dieser Tabelle wuerde den Riegel still entwaffnen. Heute nicht erreichbar, aber die einzige leise Verlustquelle im Umbau.
3. `derivePlatformNumberBindings` ruft `resolveBootstrapAlertSender` bei jedem Boot unkonditioniert auf, auch ohne aktive Bootstrap-Nummer -> irrefuehrende Log-Zeile bei jedem Start.
4. `numberBusyReason` greift ungeschuetzt auf `state.calls`/`state.platformNumberUse` zu; vier Bestandsfixtures mussten nachgezogen werden. Produktivpfade tragen beide Felder immer.
5. `PLAN-SECURITY.md` nennt `unbindPlatformNumber` als Mechanismus der Freigabe-Kette, tatsaechlich wird `unbindOwnPlatformBindings` genutzt — Doku-Drift.
6. Betrieblich (nicht am Code loesbar): zeigt `PLATFORM_ANI_E164` je auf eine Kunden-DID, haengt deren Kuendigung dauerhaft (HOLD ohne automatische Eskalation, die kommt erst mit einer spaeteren Phase).
7. Grace-Pfad: HOLD bekommt nur eine WARN-Zeile, keinen Audit-Eintrag, keinen pending-Marker — plan-konform, aber ohne durable Spur auf diesem Weg.

**Harte Merge-Vorbedingung (Owner, nicht vom Code erzwingbar):** `PLATFORM_ANI_E164` muss im Render-Dashboard gesetzt sein, BEVOR E1 deployt wird — und zwar auf eine kontoeigene Plattform-DID, NIE auf eine Kunden-DID (sonst friert der Riegel deren Doppelrolle ein statt sie zu beenden).

---

## Clean-Code-Audit

**Verdikt:** PASS mit Auflagen — keine S1/S2-Befunde. `npm test` 5147/5147, die vier neuen Testdateien 36/36 (inkl. 8 echte PGlite-Tests), `npx eslint .` 0 Fehler/64 Bestands-Warnungen, keine neue Suppression.

### S3-Befunde (lokal behebbar, kein Merge-Blocker)
1. **Fail-open statt fail-closed:** `isOpenBinding` prueft `binding.releasedAt === null` strikt — eine Bindung mit `releasedAt === undefined` (fehlendes Feld) gilt faelschlich als geschlossen, waehrend das SQL-Gegenstueck (`released_at IS NULL`) sie als offen sieht. Heute unauffaellig durch Konstruktions-Konvention, aber die einzige Abweichung, die in die falsche Richtung zeigt. Fix: `!binding.releasedAt`.
2. **Vertragsbruch in `alert-sms.js`:** der dokumentierte Vertrag "erst Empfaenger-Riegel, dann `resolveSender()`" wird vom neuen Boot-Aufrufer nicht eingehalten — unkonditionierter Aufruf erzeugt bei jedem Start eine irrefuehrende Warnung.
3. **Doku-Drift:** `PLAN-SECURITY.md` nennt `unbindPlatformNumber` (kein Produktionsaufrufer) statt `unbindOwnPlatformBindings` (tatsaechlicher Weg); verspricht zudem einen Handbetrieb-Loese-Hebel ohne konkrete Route/CLI.
4. **Verschachtelungstiefe 5** in `performNumberRelease` (Repo-Obergrenze 4) und zwei vermischte Abstraktionsebenen — Fix: Lock-Rumpf als eigene Funktion herausziehen.
5. Ein Umlaut im Kommentar (`waechst` statt `wächst`) — Repo-Konvention verletzt.
6. Prozess-/Review-Buchhaltung im Quelltext (VCS-Info gehoert in Commits, nicht in Kommentare) — ~90 Zeilen Kommentar auf 60 Zeilen Code im OUTBOUND-E1-Block von `state-ops.js`.
7. Trigger-Kommentar in `schema.sql` nennt nicht die Gegenrichtung: eine manuell in `platform_number_use` eingefuegte Bindung ueberlebt den naechsten Flush nicht (wird geprunt).

### S4-Befunde (kosmetisch)
- Duplizierte ANI-Gueltigkeitspruefung in `boot.js` und `boot-guard.js` statt einer geteilten Funktion.
- Zwei String-Literale statt Enum-Konstanten in einem neuen Test.
- Fehlender abschliessender Newline in `eslint-suppressions.json` plus phasenfremd entfernte Eintraege (scope-fremd, aber harmlos).
- `derivePlatformNumberBindings` speichert bei jedem Boot, auch ohne Aenderung; Rueckgabewert wird produktiv nicht genutzt.
- Log-Rauschen: jeder HOLD im Grace-Pfad erzeugt eine WARN-Zeile, auch fuer den unveraenderlichen Bestandsgrund `non_telnyx_manual`.

**topTodos aus dem Audit:** `isOpenBinding` auf `!binding.releasedAt` umstellen; den unkonditionierten `resolveBootstrapAlertSender`-Aufruf im Boot entschaerfen; `PLAN-SECURITY.md` auf `unbindOwnPlatformBindings` korrigieren und den Handbetrieb-Weg konkret benennen.
