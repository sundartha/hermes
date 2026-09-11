# Phase GP-P0 — "Sichtbarkeit: zahlender Mandant ohne Nummer"

- Gate: **PASS**
- finalBranch: `gp/p0`
- Basis: `master` (`438a231`)
- headCommit (Impl): `003071ecfc3b04a20af26b62eba58a59263a35c5`

## Ziel

Der Vorfall vom 11.09.2026 war nur durch manuelle DB-Forensik sichtbar: ein Mandant mit
aktivem Abo, dessen Nummer auf `failed` stand, hatte keinen offenen Provisioning-Job mehr
und tauchte in keinem bestehenden Wächter auf. GP-P0 schließt diese Sichtbarkeits-Lücke —
**reine Beobachtung, keine Handlung**: kein Kauf, kein Retry, kein Provider-Aufruf, kein
neuer Endpunkt, kein Schema-Change.

## Plan (gekürzt)

**Designentscheidungen:**

- **D1 — Zeitanker:** Beginn der laufenden Stripe-Abrechnungsperiode via
  `resolvePeriodStartIso` (`src/billing/period.js`, bereits geteilte Ableitung, G5). Fehlt
  der Anker (Owner-/Bootstrap-Tenant ohne Stripe-Abo, frisches Abo ohne Webhook) → fail-closed,
  **kein** Befund. Akzeptiertes Restrisiko: in der ersten Stunde nach Perioden-Verlängerung
  ist der Anker jünger als die Frist — ein Fall in diesem Fenster wird einen Sweep später
  gemeldet, nicht verloren.
- **D2 — "keine Live-Nummer":** wiederverwendet `tenantHasLiveNumber`
  (`liveNumbers`/`occupiesCapacity`), keine zweite Definition. Bewusste Lücke: ein Mandant,
  der dauerhaft auf `requested`/`provisioning` hängt, hat eine Live-Nummer und wird NICHT
  gemeldet — das deckt der Boot-Reconciler ab, nicht dieser Selektor.
- **D3 — Notiz-Stufe:** `meldeBetreiberNotiz` (WARN → Audit → Marker), **kein**
  Mail-/SMS-Versand — GP-P0 ist "Beobachtung, keine Handlung", SMS wäre ein
  kostenpflichtiger Kanal und eine eigene Owner-Entscheidung.
- **D4 — Modul-Ort:** `src/billing/paid-without-number-watch.js`, nicht in
  `outage-report.js` (dessen Vokabular ist telephony-nah); Präzedenz:
  `cost-truing.js` importiert bereits `meldeBetreiberNotiz` von dort.
- **D5 — Rollback-Hebel:** `graceMs <= 0` schaltet den Wächter komplett aus (Bestandskonvention
  wie bei `platformHoldEscalationMaxAgeMs`, `outboundDriftMinIntervalMs`).
- **D6 — Schließ-Übergang:** je Zustandsänderung genau eine Log-/Audit-Zeile, in BEIDE
  Richtungen (eintreten UND behoben) — sonst bliebe ein Marker für immer offen und ein
  zweiter Vorfall desselben Mandanten wäre still.
- **D7 — Explizit nicht gebaut:** kein Kauf, kein Retry, kein Stripe-Aufruf, kein
  Dashboard-Text, keine Änderung an `provisionNumber`/`classifyQueuedProvisioningJobs`/
  Gates/`occupiesCapacity`, kein `payment_method_types`, kein Signalwechsel an
  `invoiceTotal===0`, keine neue Dependency, kein neuer Endpunkt, kein Schema-Change.

**Umfang laut Plan:** neuer reiner Selektor `paidWithoutNumberCandidates` in
`src/store/state-ops.js`; neues Modul `src/billing/paid-without-number-watch.js` als achter,
unabhängiger Sweep-Zweig; Rollback-Hebel `paidWithoutNumberGraceMs` in `src/config.js`;
Verdrahtung in `src/server.js`/`src/boot.js` (achter Zweig, `durableAudit`, kein
`messaging`/`mailer`); `.env.example`/`render.yaml` dokumentiert; neue Testdatei
`test/gp-p0-paid-without-number.test.js` (14 geplante Fälle); vier Bestandstests additiv
angepasst (`sweep-fabrik-vertrag.test.js`, `ausfall-server-wiring.test.js`,
`kv-m4-monthly-cross-check.test.js`, `config-namespaces.test.js`), plus `test/helpers.js`
`BASE_ENV`-Pin auf `0`.

## Impl-Zusammenfassung

Plan wurde wie oben beschrieben umgesetzt. 66 betroffene Tests grün, `node --check` grün auf
allen 5 geänderten/neuen Quelldateien. Neu erstellt:

- `src/billing/paid-without-number-watch.js`
- `test/gp-p0-paid-without-number.test.js` (15 Fälle, einer mehr als geplant)

Geändert:

- `src/config.js`, `src/store/state-ops.js`, `src/server.js`, `src/boot.js`
- `.env.example`, `render.yaml`
- `test/helpers.js`, `test/config-namespaces.test.js`, `test/sweep-fabrik-vertrag.test.js`,
  `test/ausfall-server-wiring.test.js`, `test/kv-m4-monthly-cross-check.test.js`

Config-Namespace-Zähler nachgezogen: `billing` 52→53, Gesamt 187→188, primitive Blätter
175→176.

**Smoke-Test:** nur teilweise möglich — Server verweigert den lokalen Boot ohne
Bootstrap-Tenant-Seed (außerhalb des Phasenumfangs). Primäre Verifikation stattdessen: 66
grüne `node:test`-Fälle über 7 betroffene Testdateien plus `node --check` auf allen
geänderten/neuen src-Dateien.

### Deviations

**Keine** (`deviations: []` im Impl-Report). Einziger dokumentierter Befund an den Lead: der
Plan-Abschnitt "Verifikationsmethode" erwähnt "Mailversand wird NICHT in node:test
verifiziert" als Boilerplate-Satz, obwohl GP-P0 laut Auftrag auf der Notiz-Stufe
(`meldeBetreiberNotiz`, kein Versand) bleibt — nach Auftrag/D3 umgesetzt, nicht als
Abweichung gewertet, siehe Plan Abschnitt "Blast-Radius".

## Safety-Urteil (final)

**approved: true** — alle Einzelurteile true (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected,
behaviorAsIntended).

Unabhängig nachgefahren: `node --test` über 5 Testdateien → 43 pass, 0 fail, 0 skipped;
`node --check` grün auf allen 5 Quelldateien. Kein Anbieter-Aufruf, kein Netz, kein echter
Call/SMS/Stripe-Kontakt in irgendeinem gefahrenen Test.

**Verdict:** PASS. Keine neue Route (0 Treffer im Diff, `route-policy.js` unberührt), keine
neue npm-Dependency, kein Stripe-/Telnyx-/ElevenLabs-Aufruf. `src/claude.js` und
`src/bridge.js` byte-unberührt → `disclosureSentence` unangetastet. Kein Gate angefasst.
Meldeweg geprüft: kein Mail-/SMS-Versand, also kein Carrier-Kostenvektor. Befund-Zeile
PII-frei (interne `tenantId` + ISO-Zeit), per Test gegen Name/E.164 gepinnt.
`payment_method_types`/`invoiceTotal`/Link-Denylist: null Treffer im Diff. Fail-closed an
zwei Stellen belegt (fehlender Anker, unparsbares Datum); `graceMs<=0` kehrt vor
`store.load()` zurück. Alle vier Plan-Abnahmekriterien mit echten Assertions abgedeckt.

**Drei nicht-blockierende Anmerkungen:**

1. `schliesseBehobene` schließt jeden offenen `paid-no-number`-Marker, der im Lauf kein
   Kandidat mehr ist — auch wenn der Mandant nur gekündigt/suspended wurde statt eine
   Nummer erhalten zu haben. Betreiber liest dann irreführend
   `paid_without_number_recovered`. Kein Sicherheits-/Geldrisiko; relevant, sobald spätere
   Phasen (GP-P3/P4) auf diesen Markern steuern.
2. Redundanter Doppel-Claim: `meldeMandant` claimt den Marker im eigenen Lock UND ruft
   danach `meldeBetreiberNotiz`, die intern nochmal claimt (zweiter Lock, zweites `save()`).
   Idempotent, kein Defekt, aber unnötig — siehe Clean-Code-Fund S2 unten.
3. `PAID_WITHOUT_NUMBER_GRACE_MS` ist per Default `3600000` (an) in `.env.example`/
   `render.yaml`/Config-Fallback. Vertretbar, da reine Beobachtung ohne Kauf/Versand/
   Provider-Aufruf; "flag-off byte-identisch" gilt nur für den ausdrücklichen
   Rollback-Wert `0`.

## Clean-Code-Audit (S1–S4, final)

- **S1 (Blocker-Klasse): keine Funde.**
- **S2 (ein Fund, kein Blocker im strengen Sinn, aber vor Merge zu bereinigen):**
  `GP-P0-DUP` in `src/billing/paid-without-number-watch.js:meldeMandant` (Z. 31–40) —
  `meldeMandant` claimt den Outage-Marker zweimal in zwei getrennten Lock/Save-Runden:
  einmal selbst, dann nochmal über `meldeBetreiberNotiz` (welche intern
  `withStoreLock`+`claimOutageAlert`+`store.save()` wiederholt,
  `outage-report.js:122-129`). Der Kommentar "Reservierung ATOMAR im SELBEN Lock" stimmt
  nur für die Gate-Prüfung, nicht für die zweite Reservierung. Funktional harmlos
  (`claimOutageAlert` idempotent), aber unnötige Duplikation, ein zusätzlicher
  Lock/Save-Zyklus je Kandidat, und ein theoretisches Race-Fenster, falls zwischen den
  beiden Locks ein anderer Prozess denselben Marker schließt. Empfohlener Fix: Vorbild
  `meldeHoldEskalation` exakt kopieren (Gate-Funktion ruft NACH eigenem Claim nur noch
  `meldeBetreiberAlarm`, die selbst nicht erneut claimt), oder `meldeBetreiberNotiz` hier
  durch reines warn+audit ohne zweiten Claim ersetzen.
- **S3: keine Funde.**
- **S4 (gebündelt mit S3):** Namen, Struktur, Funktionslänge, Verschachtelung, Magic
  Numbers (`GRACE_HOURS_DEFAULT` benannt), Kommentare (PII-frei, aktuell, nicht
  auskommentiert) sind sauber; Datei folgt konsequent dem
  outageWatch/driftWatch-Fabrik-Muster (INV-7).

**Verdict:** "GP-P0 ist sauber gegen den bestehenden Katalog... EIN S2-Fund... Kein Blocker
im strengen Sinn (keine Sicherheits-/Korrektheitsauswirkung), aber sollte vor Merge
bereinigt werden, weil das Kommentar-Versprechen ('atomar im selben Lock') vom Code nicht
eingelöst wird."

**topTodos (Auditor):**

1. S2-Fund beheben: `meldeMandant` soll nicht ein zweites Mal über `meldeBetreiberNotiz`
   claimen — Vorbild `meldeHoldEskalation`/`meldeBetreiberAlarm` exakt übernehmen.
2. Nach dem Fix denselben Testlauf (`test/gp-p0-paid-without-number.test.js` + die vier
   Wiring-Testdateien) erneut grün bestätigen.

## Fix-Runden

Keine — die vorliegende Quelle enthält keinen `=== FIXES ===`-Inhalt (Abschnitt leer). Der
S2-Fund aus dem Clean-Code-Audit ist zum Zeitpunkt dieses Berichts **offen** und noch nicht
behoben.
