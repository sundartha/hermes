# Phasenbericht KV2-7 — Schliessregel, Faelligkeit, Verfall, Endzustaende

- **Gate**: PASS
- **finalBranch**: `phase/kv2-7-impl`
- **headCommit**: `f327bf7a39cbd431b26874da0dc6c6ddce0176a2`
- **Basis**: `master` @ `a01a7d2` (KV2-1..KV2-6 gemergt)
- **Quellen**: `tasks/kostenv2/spec-kv2-7.md` (autoritativ), Umbrella `tasks/PLAN-KOSTEN-V2.md` 2/3.5/3.6/4.3/4.5/4.6/4.7/7

---

## 1. Die Regel (Kern der Phase)

**Schliessregel (neu).** Ein Anruf wird geschlossen, wenn

* **(A)** jeder Pflicht-Traeger seines Profils *erledigt* ist, oder
* **(B)** die Frist `COST_SETTLE_DEADLINE_HOURS` (Default 48) seit `endedAt` abgelaufen ist.

*Erledigt* ist ein Traeger, wenn seine Belegzeile `reife=belegt` traegt — **oder** wenn er der **Sweep-Traeger** des Profils ist (`sweepTraegerFuerProfil`) und der Sweep fuer ihn fertig ist (`measured !== null || attempt >= COST_TRUING_MAX_ATTEMPTS`).

**Warum genau so.** Fuer die vier Ein-Traeger-Profile (`telnyx_budget`, `telnyx_assistant`, `telnyx_inbound_budget`, `telnyx_inbound_realtime`) ist der einzige Pflicht-Traeger zugleich der Sweep-Traeger; (A) faellt damit wortgleich auf den Bestandsausdruck `measured !== null || attempt >= max` zusammen (Abnahme (a): byte-identisches Bestandsverhalten). Fuer `el_convai_sip` ist `elevenlabs_convai` **kein** Sweep-Traeger: er ist nur ueber `reife=belegt` erledigt, also erst ab KV2-9 — Telnyx-SIP-Beleg allein schliesst nicht mehr ((b)), die Frist tut es ((c)), ein erschoepfter Telnyx-Zaehler beendet die EL-Nachreifung nicht ((d)).

**Verworfene Alternative:** „erledigt = jeder Pflicht-Traeger `reife=belegt`" ohne Sweep-Traeger-Klausel — haette einen unvollstaendigen Telnyx-Anruf (`source=incomplete` → `vorlaeufig`) nicht mehr geschlossen und `test/cost-truing-observe.test.js` (a) gebrochen.

**Endzustand ist eine reine Funktion**, kein neues Feld: `vollstaendig | unvollstaendig_final | beleg_strukturell_unbeschaffbar | profil_fehlt`, berechnet aus (Anruf-Datensatz, seine `call_cost_evidence`-Zeilen, Frist). Kein neues Anruf-Feld, keine DDL, kein `publicCall`-Strip. Abweichung vom Wortlaut der Spec-Zeile „Endzustaende am Beleg und am Anruf": `state-ops.js` wird angefasst, aber fuer zwei Mutatoren (schliessen ohne Messung / Nachlauf-Wiederoeffnung), nicht fuer ein Endzustands-Feld.

**Kein neuer `REIFE`-Wert, keine Terminalisierung von Belegzeilen** — Owner-Entscheidung 16 (Default (a)). Der Abbruchweg wird am vorhandenen Feld `nachreifbar=false` erkannt, nicht durch Umschreiben der Reife.

---

## 2. Plan (gekuerzt)

**Neue Dateien:**
- `src/billing/kosten-abschluss.js` — rein, kein Store/IO/`await`/`console`. Exports: `ENDZUSTAND`, `ABSCHLUSS_GRUND`, `LEERE_LISTE`, `faelligkeitsfensterMs`, `fristAbgelaufen`, `belegUnbeschaffbarAmAnruf`, `offeneTraeger`, `nichtNachreifbar`, `abschlussFuerAnruf`, `zaehlListe`.
- `src/billing/nachlauf-phasenschnitt.js` — Muster `backfill-profiles.js`; `NACHLAUF_SKIP`, `istImPhasenschnittGelatcht`, `oeffneGelatchteElAnrufe` (idempotent, `apply=false`=Dry-Run).
- `scripts/kv2-7-nachlauf-phasenschnitt.js` — einmaliger Migrations-Lauf, Dry-Run per Default, nicht in den Boot verdrahtet.

**Edits (Kern):**
- `src/config.js` / `.env.example` / `test/helpers.js` — neue Env `COST_SETTLE_DEADLINE_HOURS` (Default 48, min 1; Owner-Entscheidung 3); `render.yaml` bewusst nicht angefasst (Dashboard-managed, wie KV2-6).
- `src/utils/timer.js` — `MS_PER_HOUR` zentralisiert.
- `src/store/state-ops.js` — zwei neue Mutatoren `schliesseKostenAbgleich` (Set-Once, schliesst ohne Messung) und `oeffneKostenAbgleichErneut` (einzige Stelle, die `costTruedAt` zuruecksetzt, fuer den Nachlauf).
- `src/store/json.js`, `src/store/pg.js`, `src/store.js` — Wrapper-/Fassaden-Paritaet fuer beide Mutatoren (erzwungen durch `test/store-backend-parity.test.js`).
- `src/billing/kosten-deckung.js` — Lesregel: Abbruchweg + 6.10-Deploy-Fall (h) fliessen in `unbeschaffbar`-Zaehlung und werden aus Herzschlag ausgenommen; kein neuer Alarm, keine neue Zahl.
- `src/billing/cost-truing.js` (Datei mit gepinntem Lint-Budget, harte Nebenbedingung: Befundzahl je Regel darf sich NICHT aendern) — fuenf Edits: Versuchszaehler wird vom Kandidaten-Riegel zum Mess-Riegel (`versucheUebrig`); Beleg-Schreiben und Buchen getrennt, Buchung nur im **schliessenden** Lauf (Doppelbuchungs-Riegel); `trueOneCall` nutzt `abschlussFuerAnruf`; neuer Faelligkeitslauf `schliesseFaelligeOffene` ueber alle Kandidaten; Sweep-Bilanz/Log um `erschoepft=`/`abschluesse=` erweitert. Rueckgabeobjekt von `runCostTruingSweep` bleibt unveraendert (`deepEqual`-Test).

**Tests (neu):** `test/kv2-7-schliessregel.test.js` (Abnahme a–h + reine Funktionstests, ohne Katalog-ID-Praefix), `test/kv2-7-nachlauf.test.js` (Abnahme g + Gegenproben). **Bestandstests bewusst nachgezogen:** `test/cost-truing-sweep-log.test.js`, `test/config-namespaces.test.js` (billing 49→50, Total 177→178, Blaetter 166→167) — sonst nichts, das ist der Regressionsbeleg fuer (a).

**Pre-Mortem (Plan):** Doppelbuchung (entschaerft: buchen nur im schliessenden Lauf, Drei-Sweep-Test), nie wieder schliessen (entschaerft: `schliesseFaelligeOffene` ueber alle Kandidaten), stille Erstattungs-Regression der Bestandsprofile (entschaerft: Sweep-Traeger-Klausel + unveraenderte Bestandssuite), 6.10-Fall erklaert gesunde Anrufe fuer unbeschaffbar (entschaerft: nur nach Fristablauf), Massen-Latch beim ersten Sweep nach Deploy (erwarteter, einmaliger, kostenloser Effekt).

---

## 3. Impl-Zusammenfassung

KV2-7 exakt gemaess Plan umgesetzt und committet (`f327bf7`). Zwei neue reine Regelwerk-Module plus Migrationsskript; funktionale Aenderungen in `cost-truing.js` (Mess-Riegel, Beleg/Buchung getrennt, neuer Faelligkeitslauf) und `kosten-deckung.js` (liest dieselbe Schliessregel); zwei neue Store-Mutatoren mit Wrapper-Paritaet in `json.js`/`pg.js`/`store.js`; neue Env `COST_SETTLE_DEADLINE_HOURS` (Default 48).

Regressionsschutz (Abnahme a) bestaetigt: alle Bestandstests fuer die vier Ein-Traeger-Profile bleiben unveraendert gruen, nur zwei exakt-byte-gepinnte Sweep-Log-Zeilen mussten um die neuen Endfelder ergaenzt werden. Volle Suite: **5559/5559 gruen** (0 fail); zwei zunaechst beobachtete Fehlschlaege (`al-p10-precall-research.test.js`, `request-tenant.test.js`) erwiesen sich in Isolation und im finalen Vollauf als unabhaengige, vorbestehende Suite-Flakes ausserhalb des Diffs.

Lint-Budget von `cost-truing.js`/`pg.js`/`state-ops.js` exakt gehalten durch gezielte Refactorings (Modul-Ebene-Helfer statt Closure-Wachstum, Spread-Fabrik-Muster `kostenAbschlussMutatoren`, ausgeschriebene Parameternamen) — `eslint-legacy-exceptions.json` im finalen Commit byte-identisch zum Ausgangsstand, keine selbst genehmigte Owner-Ausnahme.

Server-Smoke bestanden (Boot, `/healthz`, graceful shutdown). `GET /api/billing/kosten-deckung` nicht per curl erreicht (operator-only, im Smoke-Setup ohne Admin-Identitaet nicht gemountet — erwartetes fail-closed-Verhalten), aber `kostenBuchBericht`/`abschlussFuerAnruf` vollstaendig ueber die neuen Unit-/Integrationstests end-to-end im Sweep geprueft.

### Dateien
**Neu:** `src/billing/kosten-abschluss.js`, `src/billing/nachlauf-phasenschnitt.js`, `scripts/kv2-7-nachlauf-phasenschnitt.js`, `test/kv2-7-schliessregel.test.js`, `test/kv2-7-nachlauf.test.js`

**Editiert:** `src/billing/cost-truing.js`, `src/billing/kosten-deckung.js`, `src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/store.js`, `src/config.js`, `src/utils/timer.js`, `.env.example`, `test/helpers.js`, `test/cost-truing-harness.js`, `test/cost-truing-sweep-log.test.js`, `test/cost-truing-retrievable.test.js`, `test/config-namespaces.test.js`

### Deviations vom Plan
1. `kosten-deckung.js` importiert `zaehlListe` **nicht** (waere ungenutzt geblieben, G12) — nur `LEERE_LISTE`/`nichtNachreifbar` importiert.
2. Kein eigenstaendig benannter Wrapper `belegeMessung` in `cost-truing.js`; `schreibeSweepKostenbeleg` wird direkt in `trueOneCall` aufgerufen, um das gepinnte Lint-Budget ohne Owner-Freigabe fuer eine Pin-Anhebung zu halten. Kernlogik (Beleg vor Schliessentscheidung, Buchung nur im schliessenden Lauf) unveraendert umgesetzt.
3. **Selbst entdeckter Zwischenfehler:** ein Session-Zwischenschritt hat `eslint-legacy-exceptions.json` versehentlich ohne Owner-Freigabe angehoben und committet; entdeckt durch die „Altlast-Ratsche" im vollen Regressionslauf, vor Uebergabe exakt auf Ausgangsstand zurueckgefuehrt (`git diff a01a7d2..HEAD -- eslint-legacy-exceptions.json` leer im finalen Commit) und die betroffenen Dateien stattdessen ohne Pin-Aenderung umgebaut.
4. `test/cost-truing-retrievable.test.js` — vom Plan uebersehene zweite Fundstelle mit byte-gepinntem Sweep-Log-Assert, musste ebenfalls um die neuen Felder ergaenzt werden (Fund via vollem Regressionslauf).

---

## 4. Safety-Urteil

**Verdict: FREIGABE mit Auflagen zur Kenntnisnahme (keine Blocker).** `approved=true`, alle Einzelkriterien (`safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`) = true.

Unabhaengig im frischen Worktree nachgefahren: `npm test` 5559/5559 gruen; gezielte pg-Bahn (`*pg*`, `*parity*`, `kv2-*`, `cost-truing*`) 462/462 gruen; Lint/Format sauber. Kein Test gegen eine echte DB gefahren (die einzige erreichbare `DATABASE_URL` zeigt auf Produktion) — pg-Pfad stattdessen strukturell (CC-6 Parity) und verhaltensseitig (gleiche `ops.*`-Delegation) abgedeckt.

Sicherheitskritische Flaechen byte-identisch zu `master`: `src/claude.js`, `src/bridge.js`, `src/outbound-gates.js`, `src/auth.js`, `src/web-auth.js`, `src/route-policy.js`, `src/middleware.js`, `src/boot-guard.js`, `src/server.js`, `src/mcp-tools.js`. Kein neuer Endpunkt (beide neuen Mutatoren haben je genau einen Aufrufer: Sweep bzw. Dry-Run-CLI). Kein Secret in Diff/Log. Keine neue npm-Abhaengigkeit, kein selbst angehobenes Lint-Budget. Doppelbuchungs-Riegel unabhaengig nachgerechnet: fuer die vier Ein-Traeger-Profile identisches `closed`-Verhalten, fuer `el_convai_sip` ohnehin `sweepDarfKorrigieren=false`. Deckungs-Alarm bleibt scharf (`costTruedSource` wird im Faelligkeitslauf bewusst nicht gesetzt).

### Concerns (kein Blocker)
1. **Massen-Latch beim ersten Sweep nach Deploy:** jeder bis heute offene Anruf mit `endedAt` > 48h alt wird im ersten Lauf geschlossen (je eigener `save()`, eigene Log-Zeile). Fachlich korrekt (Kriterium c), ohne Geldwirkung, aber von der Spec nicht als Bulk-Effekt benannt. Empfehlung: vor Deploy einmal zaehlen, wie viele offene Anrufe > 48h in Produktion stehen.
2. **`profil_fehlt` fuer Altanrufe:** `endzustandVon` prueft das rohe `call.costProfile` vor dem Legacy-Rueckfall, den `offeneTraeger`/`belegUnbeschaffbarAmAnruf` nutzen. Jeder Altanruf ohne gesetztes `costProfile` schliesst als `profil_fehlt`, nie als `vollstaendig`, obwohl seine (aus dem Legacy-Profil abgeleiteten) Pflicht-Traeger erfuellt waeren. Fail-closed und testgepinnt, aber eine Kennzeichnungs-Entscheidung, die die Spec nicht ausdruecklich trifft — Owner-Rueckfrage empfohlen.
3. `warnOnCostDrift`/`bookTtsCharactersFor` jetzt hinter `closed` statt hinter `measured` — fuer die vier Ein-Traeger-Profile identisch, fuer `el_convai_sip` theoretisch eine stille Verengung des TTS-Kontingent-Zaehlers (praktisch 0, da EL-Weg keine Telnyx-TTS macht).
4. Mehrfach-Messung statt Einmal-Latch bei `el_convai_sip`: bis zu 5x so viele Telnyx-Pool-Anfragen je EL-Anruf, bis `costTruingMaxAttempts` erschoepft ist. Der Bruchpunkt-Waechter `reportFetchVolume` bemerkt das erst ueber der Schwelle.
5. `COST_SETTLE_DEADLINE_HOURS` fehlt in `render.yaml` (wie schon `KOSTEN_HEARTBEAT_FENSTER_H` in KV2-6) — harmlos, aber Doku-Drift, die sich aufsummiert.
6. Kleine Formatierungs-Eingriffe ausserhalb des KV2-7-Gegenstands (Zeilen zusammengezogen in `pg.js#markInboxEntry`, `cost-truing.js`), um gepinnte Zeilengrenzen zu halten — kein Verhalten geaendert, aber Scope-Blutung in fremde Funktionen.
7. Skalierung: `store.callCostEvidence(call.id)` wird je Anruf aufgerufen und filtert/sortiert jedes Mal das gesamte Array — O(n_Anrufe × n_Belegzeilen). Heute belanglos, spaeter ein Indexierungspunkt.

---

## 5. Clean-Code-Audit (S1–S4)

- **S1: keine Befunde**
- **S2: keine Befunde**
- **S3 (1 Befund, nicht blockierend, trivial):** `zeileFuerTraeger`-Praedikat (`belege/zeilen.find(z => z.traeger === traeger)`) steht dreimal wortgleich (`kosten-abschluss.js:36`, `kosten-deckung.js:117,166`). Kann-Fix: exportieren und importieren statt dreimal neu schreiben — nicht blockierend, da trivialer Ein-Zeiler und Lesbarkeit gegen zusaetzliche Kopplung spricht.
- **S4: keine weiteren Befunde.** Die Einzeiler-Zusammenzuege in `cost-truing.js`/`pg.js` sind konventionskonform (etabliertes Spread-Fabrik-Muster gegen gepinnte Zeilen-/Komplexitaets-Obergrenzen, in `eslint-legacy-exceptions.json` dokumentiert), keine neue Stilabweichung.

**Verdict: PASS.** `kosten-abschluss.js` ist tatsaechlich rein (kein Store/Netz/`console`/`await`), Import-Richtung bleibt einseitig, Geld bleibt Ganzzahl, `costTruedAt` bleibt Set-Once ausser an der einen dokumentierten Nachlauf-Ausnahme. Safety-Gates unberuehrt. Volle Suite nach isoliertem Rerun 5559/5559 gruen (ein Fail im ersten Lauf war im zweiten sauberen Lauf nicht reproduzierbar — kein Regressionsbeleg gegen diesen Diff). Duplizierungs-Reduktion (`MS_PER_HOUR`, `LEERE_LISTE` zentralisiert) ist echter Fortschritt.

**Top-TODOs (optional, kein Blocker):**
1. `zeileFuerTraeger` aus `kosten-abschluss.js` exportieren und in `kosten-deckung.js` wiederverwenden statt Dreifach-Duplikat.
2. Vor Merge `npx eslint --suppressions-location eslint-suppressions.empty.json --format json src/billing/cost-truing.js src/billing/kosten-deckung.js` laufen lassen, um zu pruefen, ob die gepinnten Budgets dieser zwei Dateien gestiegen sind (aus dem Diff selbst nicht entscheidbar, da diese Konfig-Datei nicht im Diff steht).

---

## 6. Fix-Runden

Keine separate Fix-Runde noetig — der Impl-Agent hat den selbst entdeckten Zwischenfehler (versehentliche Anhebung von `eslint-legacy-exceptions.json`) innerhalb derselben Umsetzung selbst gefunden (ueber die „Altlast-Ratsche" im vollen Regressionslauf) und vor Uebergabe korrigiert, ohne dass ein externer Fix-Zyklus angestossen werden musste. Safety- und Clean-Code-Review liefen beide direkt auf dem finalen Commit `f327bf7` und ergaben PASS ohne Blocker.
