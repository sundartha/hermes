# Phase GP-P4 — Zeitgesteuerter Wiederanlauf

**Gate: PASS**
**finalBranch:** `gp/p4`

## Plan (gekuerzt)

Basis: `master` @ `07454be`. Groesse **M** (`maxFixRounds: 2`), `highStakes: true`.

Der Entscheidungskern fuer den Wiederanlauf nach fehlgeschlagener Provisionierung
existiert bereits (`src/billing/provision-retry.js resolveCardRebindRetry`, rein,
IO-frei) und deckt Not-Aus, Abo/KYC-Pruefung, Eignung und Kostendeckel bereits ab.
GP-P4 baut **keinen zweiten Entscheidungskern** — neu sind nur die Mandanten-Schleife
im stuendlichen Sweep und eine Mindestfrist (Entprellung), beide als Wiederverwendung
bestehender Muster (`outbound-drift-watch`, `paid-without-number-watch`).

**Befund gegen GP-P1** (gemeldet, nicht gebaut): Abnahme 5 verlangt, die Unterscheidung
strukturell/temporaer lese "das getypte Feld aus GP-P1" — dieses Feld ist nicht
persistiert (`attachProviderDecline` haengt es nur ans Fehlerobjekt, der Orchestrator
schreibt daraus nur `err.message`). Umgesetzt wird stattdessen die binaere Partition
ueber das persistierte Typ-Gate aus GP-P2 (`isHoldCapablePaymentMethodType`).

**Pre-Mortem-Gegenmittel:** Claim vor dem Anstoss, atomar im selben `withStoreLock`;
`nowMs` injiziert; Umfangs-Zeile immer geloggt; Kern unveraendert wiederverwendet
(Eignungs-Gate bleibt intakt); `retriggerFailedProvisioning` wirft nie + eigener
`.catch()`; Rollback-Hebel `PROVISIONING_RETRY_MIN_INTERVAL_MS<=0`.

**Neue Datei:** `src/billing/provision-retry-sweep.js` — `provisionRetryDue` (rein),
`runProvisionRetrySweep` (unrein, fail-soft), `makeProvisionRetryWatch` (Fabrik,
Muster `makePaidWithoutNumberWatch`).

**Edits (Kern-Punkte):**
- `provision-retry.js`: Enum um `THROTTLED` erweitert; Umbenennung
  `resolveCardRebindRetry`→`resolveAutoProvisionRetry`,
  `retriggerProvisioningAfterCardBind`→`retriggerFailedProvisioning`; injizierte
  Zeitriegel-Naht `claimAttempt` mit No-op-Default (`KEIN_ZEITRIEGEL`), Kartenwechsel-
  Route bleibt dadurch byte-identisch.
- `self-service-routes.js`: reine Umbenennung, keine Verhaltensaenderung.
- `state-ops.js`: neue reine Query `allTenantIds` (bewusst ungefiltert — der Filter
  bleibt allein im geteilten Kern, G5).
- `config.js`/`.env.example`/`render.yaml`: neue Env `PROVISIONING_RETRY_MIN_INTERVAL_MS`
  (Default 24 h, `0` = zeitgesteuerter Zweig komplett aus).
- `boot.js`/`server.js`: neunter, unabhaengiger Zweig im Stunden-Sweep, eigener
  `.catch()`, Konstruktion nach dem Provisioning-Orchestrator (TDZ-Vermeidung).
- `test/helpers.js` BASE_ENV: `PROVISIONING_RETRY_MIN_INTERVAL_MS: "0"`.

**Tests:** neue Datei `test/gp-p4-zeitgesteuerter-wiederanlauf.test.js` (9 Faelle,
Abnahme 1–4 + Praedikat isoliert + beide Rollback-Hebel + Geld-Gate + Fail-soft +
Fabrik-Vertrag), plus Anpassungen an drei strukturellen Verdrahtungs-Waechtern
(`ausfall-server-wiring`, `kv-m4-monthly-cross-check`, `sweep-fabrik-vertrag`).
`gp-p3-wiederanlauf-kartenwechsel.test.js` bleibt unveraendert gruen als Beleg fuer
Byte-Identitaet des Bestandspfads.

**Blast-Radius:** 1 neues Modul + 1 Testdatei, 1 neue Env-Var, 1 neue reine Query;
9 Bestandsdateien geaendert (4 rein additiv, 2 reine Verdrahtung, 2
Umbenennung+Naht, 1 neue Query); keine Migration, kein neues Store-Feld, keine neue
Route, keine neue Dependency, kein neuer Timer.

## Impl-Zusammenfassung

- headCommit: `1b52acebc370a5aa447ecb878d54202ff801634d`
- `node --check`: PASS (alle 7 geaenderten src-Dateien)
- Tests: **152 pass / 0 fail** (14 betroffene Testdateien, volle Suite bewusst nicht
  gefahren — Sache des Leads)
- Smoke: Server lokal gestartet (`DATA_DIR`-Override, `PORT=3987`,
  `PROVISIONING_RETRY_MIN_INTERVAL_MS=86400000`), `GET /healthz` OK, neunter Zweig
  TDZ-frei konstruiert.
- Umsetzung folgt dem Plan vollstaendig: geteilter Entscheidungskern
  (`resolveAutoProvisionRetry`), Claim+Urteil atomar im selben `withStoreLock`
  (Muster `outbound-drift-watch#beanspruchen`), injizierte Zeitriegel-Naht mit
  no-op-Default, Rollback-Hebel `PROVISIONING_RETRY_MIN_INTERVAL_MS<=0`.

### Deviations

1. **Befund statt Bau (wie in Plan 0b vorgesehen):** Abnahme 5 ("Feld aus GP-P1")
   ist ueber die persistierte GP-P2-Allowlist (`isHoldCapablePaymentMethodType`)
   umgesetzt, nicht ueber ein nicht existierendes GP-P1-Enum-Feld. Feinere Klassen
   (`insufficient_funds` vs. `authentication_required`) blieben bewusst aussen vor.
2. **Ueber den Plan hinaus (Bestands-Waechter):** `test/config-namespaces.test.js` —
   drei gepinnte Zahlen nachgezogen (provisioning 16→17, `EXPECTED_TOTAL_KEYS`
   189→190, `EXPECTED_PRIMITIVE_LEAVES` 177→178). Zwangslaeufig bei jeder neuen
   Config-Variable.
3. **Ueber den Plan hinaus (Pre-Commit-Hook `check-staged-suppressions`):** der
   neunte Zweig riss in KV-M4-8 die `max-lines-per-function`-Grenze. Statt
   Suppression wurde der Test entdupliziert (Tabelle statt neun handgerollter
   Attrappen); dabei entfielen zusaetzlich fuenf `id-length`-Befunde, Suppression-
   Eintrag via `npx eslint --prune-suppressions` entfernt.
4. **Laufumgebung:** `ln -s ./node_modules node_modules` erzeugte im Worktree einen
   selbstbezueglichen Symlink (ELOOP) — jeder `npx`-Aufruf scheiterte still mit
   Exit 194/leerer Ausgabe (falsches "sauber"). Link auf das echte `node_modules`
   des Hauptcheckouts umgehaengt, danach war die Lint-Messung gueltig; Symlink
   gitignored, nicht committet.
5. Volle Suite bewusst nicht gefahren (Laufregel: der Lead faehrt sie einmal am
   Ende).

## Safety-Urteil

**PASS** (`approved: true`, keine Blocker). Alle sieben Pruefpunkte belegt am
Diff `master..gp/p4` (16 Dateien):

1. **Safety-Gates intakt** — kein zweiter Kaufpfad; die fail-closed-Kette
   (Not-Aus → `NOT_FAILED` → Abo/KYC → Typ-Eignung → Deckel/`needs_manual_reconcile`)
   ist unveraendert. `MAX_NUMBERS`/`MAX_NUMBERS_PER_TENANT` bleiben unberuehrt.
2. **Offenlegung intakt** — `git diff --stat` gegen `src/claude.js`/`src/bridge.js` leer.
3. **Auth fail-closed intakt** — kein neuer Endpunkt, einziger Einstieg der bestehende
   Stunden-Timer mit eigenem `.catch()`; `route-auth-inventory.test.js` gruen.
4. **Secrets/PII sauber** — Log- und Audit-Zeilen tragen nur interne Kennung, Enum,
   Zahl.
5. **Verbotsliste eingehalten** — keine Treffer fuer `payment_method_types`,
   `invoiceTotal`, `eslint-disable`, `test.skip`/`.only`; keine Denylist gegen
   `link`; kein Freitext-Parsing.
6. **Keine neue Dependency.**
7. **Verhalten wie spezifiziert** — alle vier Abnahmekriterien + Rollback-Hebel +
   Flag-off-Byte-Identitaet des Kartenwechsel-Pfads unabhaengig nachgefahren
   (13 Testdateien, 158 pass / 0 fail im Review-Worktree).

**Concerns (kein Blocker, an den Lead):**
- Scope: `kv-m4-monthly-cross-check.test.js` wurde ueber das Minimum hinaus
  umgebaut (verhaltensgleich, zieht eslint-Suppressions ab statt sie zu erweitern).
- **Betrieb:** mit dem Merge wird der automatische Geldpfad per Default scharf
  (`PROVISIONING_RETRY_MIN_INTERVAL_MS=86400000` in `render.yaml`/`.env.example`,
  `PROVISIONING_RETRY_MAX_ATTEMPTS=3` bereits live seit GP-P3). Telnyx-Guthaben vor
  Deploy erneut pruefen (Kettenstand nannte 6,79 USD, "knapp, nicht reichlich").
- Dauerhaft offener Marker je Mandant (`provision-retry:<tenantId>` in
  `state.outageAlerts`, nie geschlossen) — begrenzt in der Praxis, fuer
  Millionen-Skala vermerkenswert.
- Terminalzustand unerreichbar bei `global_cap`: liefert `triggerTenantProvisioning`
  `{ok:false, reason:'global_cap'}`, entsteht kein neuer `failed`-Datensatz, der
  Mandant wird alle 24 h erneut angestossen ohne je `needs_manual_reconcile` zu
  erreichen. Kein Kostenvektor, aber stiller Dauerlauf — Kandidat fuer GP-P6 oder
  Befundliste.
- Komplexitaet: `runProvisionRetrySweep` ist O(Mandanten × Nummern) je Stunde,
  identische Bauform wie Bestand (`paidWithoutNumberCandidates`), keine neue
  Regression, nur fuer Skalen-Ambition notiert.

## Clean-Code-Audit (S1–S4)

**Verdict: PASS**, keine S1/S2/S3/S4-Flags. `blocker: false`.

- s1: []
- s2: []
- s3: []
- s4: []

**passNotes:** geteilter Entscheidungskern statt zweiter Buchfuehrung (G5); injizierte
`claimAttempt`-Naht mit no-op-Default (Route byte-identisch); Entprell-Marker/Lock-Muster
wortgleich mit `outbound-drift-watch.js`; fail-soft konsequent (try/catch um den
gesamten Sweep); Dispatch-Table statt if-Kette (G23); Audit-Zeilen PII-frei; Config-Var
korrekt zentralisiert und Zaehler konsistent nachgezogen; `KV-M4-8` wurde als
Nebeneffekt von einer 180-zeiligen Copy-Paste-Attrappen-Kaskade auf eine
tabellengetriebene Struktur refaktoriert (G5-Verbesserung, nicht nur additiv). Kein
`payment_method_types`, keine Denylist gegen `link`, kein `invoiceTotal===0`-
Signalwechsel im Diff. 42/42 betroffene Tests gruen, `node --check` auf allen 7
geaenderten src-Dateien sauber.

**topTodos:**
1. Keine Blocker offen — mergefaehig aus Clean-Code-Sicht.
2. Owner-Hinweis im Auge behalten: `provision-retry-sweep.js` ist bewusst ohne
   eigenen Filter gebaut — jede kuenftige Erweiterung des Wiederanlaufs muss
   weiter ausschliesslich ueber `resolveAutoProvisionRetry` laufen, sonst entsteht
   die vermiedene zweite Buchfuehrung doch noch.

## Fix-Runden

Keine — beide Reviews (Safety, Clean-Code) waren im ersten Durchlauf PASS ohne
Blocker. `maxFixRounds: 2` wurde nicht in Anspruch genommen.
