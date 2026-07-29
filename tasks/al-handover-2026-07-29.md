# AL-Kette — Uebergabe an die naechste Session (Stand 2026-07-29, 12:40 UTC)

Frische Session im Repo oeffnen, **diese Datei zuerst**, dann `tasks/al-chain-state.md`
(Verlauf) und `tasks/al-testcall-checklist.md` (offene Abnahmen).

---

## 1. Das Wichtigste zuerst: ein VERMUTETER Live-Defekt auf dem Geldpfad

**Der Budget-Gate lehnt Outbound-Anrufe ab, die rechnerisch hineinpassen.** Zweimal
reproduziert am 29.07. gegen den Live-Dienst (`POST /api/calls` an die eigene Nummer):

| Anrufdauer | Reserve | Meldung |
|---|---|---|
| 120 s | 6,00 € | „es fehlen **-4.77** EUR" |
| 60 s | 3,00 € | „es fehlen **-7.77** EUR" |

Daraus rekonstruiert: **Rest = 10,77 €**, benoetigt 6 € bzw. 3 € — **beide Anrufe passten**.
Der Fehlbetrag ist **negativ**, die Meldung widerspricht also ihrer eigenen Entscheidung.
Die Textformel steht in `src/telephony/outbound-gates.js` (`tenantReserveDenial`:
`missingEur = reserveCents - snapshot.remainingCents`) — sie wird auch dann erzeugt, wenn der
Rest groesser als die Reserve ist. **Das ist das Symptom.** Das Ja/Nein faellt in
`tryReserveOutboundBudget`; dort liegt die Ursache, und sie ist **NICHT gefunden**.

Gespeicherte Zahlen (Prod-DB, 29.07.), die dem Sperrverhalten widersprechen:

| | Verbrauch Spend-Monat | Deckel (Boot-Banner) |
|---|---|---|
| Plattform (3 Tenants zusammen) | 12,84 € | 30,00 € |
| Tenant `owner` (der Anrufer) | 0,00 € | 15,00 € |

### Die entscheidende Spur (vom Owner, 29.07.)

> „Ich habe vor ein paar Tagen schon angegangen, dass das alles live gemacht wird. Und diese
> ganze Logik sollte eigentlich gar nicht mehr existieren."

**Die erste Frage ist also NICHT „warum rechnet der Gate falsch", sondern „warum laeuft dieser
Pfad ueberhaupt noch".** Moegliche Richtungen, alle ungeprueft:
- Der Live-Dienst laeuft auf aelterem Code als der Owner annimmt (Deploy-Stand pruefen:
  `/healthz` gegen `git log`).
- Eine Umstellung der Budget-Achse (Perioden- statt Lebenszeit-Topf) ist im Code, aber ein
  Flag/Wert im Render-Dashboard steht noch auf dem alten Stand. Boot-Banner zeigt aktuell
  `Budget-Achse: Tenant Spend-Monat (BUDGET_MONTH_ENABLED=true) | Plattform Spend-Monat`.
- Ein alter Reserve-Pfad wurde bei der Umstellung nicht mit entfernt.

### Der konkreteste Verdacht: der Perioden-Anker fehlt in den DATEN

Die Umstellung, die der Owner meint, ist per `git log` datierbar:
```
2026-07-26  feat(budget): GAP-01 - Budget-Gate misst die laufende Abrechnungsperiode
2026-07-26  fix(i18n-p7): Kosten-Decken kohaerent machen (GAP-32/GAP-33)
2026-07-27  feat(billing): GAP-08 - ein gepflegter USD/EUR-Kurs fuer beide Kosten-Achsen
```
(Das Live-Kosten-Tracking selbst — LCT-Kette — war schon am 21.07. Seit dem 27.07. wurde an
der Kostenlogik **nichts** mehr geaendert ausser AL-P6.)

**In der `usage`-Zeile des anrufenden Tenants `owner` steht aber:**

| Feld | Wert |
|---|---|
| `budget_period_key` | **leer** |
| `budget_period_baseline_cents` | **0** |
| `spend_month_key` | **leer** |

**Hypothese (NICHT verifiziert):** der Code ist auf die Perioden-Achse umgestellt, die **Daten**
sind es fuer diesen Tenant nicht — der Perioden-Anker wurde nie gesetzt. Ein Gate, das gegen
einen undefinierten Periodenstart rechnet, erklaert das Symptom „Ablehnung mit **negativem**
Fehlbetrag" zwanglos: bei sauberen Werten kann diese Zahl nicht entstehen.
**Erster Pruefschritt:** wer setzt `budget_period_key`/`budget_period_baseline_cents`, und warum
ist das fuer `owner` nie passiert? (Bestandsdaten ohne Backfill sind in diesem Repo ein
wiederkehrendes Muster — vgl. `did-miete-ohne-preis.md`.)

**Zweiter, schwaecherer Verdacht:** AL-P6 ging am 29.07. live und fasst denselben Pfad an
(Budgetpruefung pro Tool-Loop-Runde). Ob der Fehler von dort kommt oder aelter ist, wurde
**nicht** festgestellt. Erst reproduzieren, dann zuordnen.

**Vorrang:** Wenn das Geld-Gate falsch sperrt, sind moeglicherweise ALLE Outbound-Anrufe live
blockiert. Das schlaegt jede offene Phase.

---

## 2. Stand der Kette

**11 von 17 Phasen gemergt, getestet, LIVE:** AL-P1, P3, P4, P5, P6, P8, P9, P10, P11, P12, P13.

| | |
|---|---|
| Live-Commit | `af4a66e` |
| Pruefen mit | `curl -s https://vodafone-agent.onrender.com/healthz` |
| Service | `srv-d8m0fhflk1mc73bno570`, Workspace `tea-d8m0b9jeo5us73cvasg0` |
| Deploy-Weg | `git push upstream master`, dann **manuell** `trigger_deploy` (`autoDeploy: no`) |

**Wirkt sofort, ohne Flag:** kuerzere Eroeffnung (AL-P5), frueherer Tool-Loop-Ausstieg (AL-P4),
Budget-/Fristpruefung pro Runde (AL-P6), Diagnostik `callerTurns`/Conversation-UUID (AL-P1).
**Bleibt AUS:** `PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`,
`THINKING_SIGNAL_ENABLED`, `CONSULT_ENABLED`, `EVIDENCE_RETENTION_DAYS=0`.

### ACHTUNG: master traegt noch den befristeten Spike-Schalter

`af4a66e` (cherry-pick von AL-P2) ist **noch auf master und live**. Er ist **inert** gestellt
(`TELNYX_SSE_SPIKE_DELAY_MS=0`, `TELNYX_SSE_SPIKE_CALLEE=""`) und wirkt konstruktionsbedingt nur
bei Anrufen an genau die konfigurierte Nummer. **Er muss trotzdem ersatzlos entfernt werden** —
das ist Plan-Vorgabe, nicht „Flag auf 0". Entweder vor dem Weiterbauen zurueckdrehen oder direkt
nach einer geglueckten Messung.

---

## 3. AL-P2 (SSE-Spike): blockiert die letzten 6 Phasen

**Die Frage:** verarbeitet der Telnyx-Assistant unseren SSE-Strom stueckweise (dann ist AL-P7
gerechtfertigt, 5-9 Tage Arbeit) oder puffert er bis `[DONE]` (dann wird AL-P7 **ersatzlos
gestrichen** und AL-P7b nimmt Weg B)? Davon haengen AL-P7, P7b, P10b, P14, P15 ab.

**Der einfache Weg — so und nicht anders (Owner-Ansage 29.07.):**
1. `TELNYX_SSE_SPIKE_CALLEE` = Mobilnummer des Owners, `TELNYX_SSE_SPIKE_DELAY_MS` = 8000.
2. Hermes ruft den Owner an. Er geht ran und **sagt nichts**.
3. **Erster Satz sofort, dann ~8 s Stille, dann der Rest** -> `incremental`, AL-P7 lohnt sich.
   **Erst ~8 s Stille, dann alles am Stueck** -> `buffered`, AL-P7 wird gestrichen.
4. Fuer den Turn-Timeout mit 5/10/20/30 s wiederholen, dann Schalter ersatzlos raus.

**Aktuell scheitert Schritt 2 am Budget-Gate (s. Abschnitt 1).**

**Sackgassen — nicht wiederholen:**
- Ein **Wegwerf-Dienst** scheitert am Boot-Guard (`STORE_BACKEND=json` ist im Hosting verboten).
  Er braeuchte eine eigene Postgres samt Migration plus `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TELNYX_SHIM_SHARED_SECRET`, `TELNYX_CALL_CONTROL_APP_ID`.
  Angelegter Dienst `hermes-spike-al-p2` (`srv-d9kt9bm1egvs738asd0g`) **bootet nicht — loeschen**.
- Die **autonome Variante mit Schweige-Route** (Anruf an eine eigene DID, die abnimmt und
  schweigt) wurde gebaut und ist **gescheitert**: der Anruf wurde nie angenommen
  (`call_ms6165ncegeb`, `answered_at` NULL). Ursache nie gefunden. Telnyx-App
  `AL-P2 Spike Silence (WEGWERF)` (`3014656686179747728`) ist Rest davon — **loeschen**.
- Der Spike-Treiber kann den **Assistant** nicht schreiben (`10015`/`10026`). Das Umhaengen der
  Nummern klappt trotzdem. Auf dem Live-Weg ist der Assistant-Schritt ohnehin unnoetig.

**Zustand der Telefonie sauber:** alle drei DIDs zurueck auf der TeXML-App `Hermes`
(`2982643896460248193`), direkt bei Telnyx verifiziert. `+17067101188` wurde nie angefasst.

---

## 4. Betriebsregeln, die diese Session teuer gelernt hat

1. **Autonomie ist Mittel, nicht Ziel.** Sobald der Owner ohnehin gebraucht wird (Secrets,
   Migration, Freigaben), die aufwendige Automatik **abbrechen** und den kuerzesten Weg zum
   Ergebnis nehmen. Aufwand vorher offenlegen („du gehst einmal ans Telefon" vs. „ich baue
   2 Stunden Infrastruktur"), nicht still das Aufwendigere bauen. **In dieser Session wurden so
   Stunden verbrannt fuer etwas, das ein Anruf geloest haette.**
2. **Migrationen laufen NICHT automatisch.** `applySchema` wird nur von Tests gerufen, es gibt
   kein `preDeploy`. Neue Spalten **vor** dem Deploy von Hand per `psql` anwenden, sonst bricht
   der erste Anruf danach. Eigene Phase wert: `applySchema` beim Serverstart aufrufen (Schema
   ist idempotent, ein Test pinnt das).
3. **`psql`-Fehler „SSL connection has been closed unexpectedly" ist meist die FIREWALL**, nicht
   TLS: die Prod-DB hat eine IP-Allowlist, nach Zwangstrennung fehlt die neue IP. Gegenprobe:
   antwortet der Live-Dienst weiter? Dann ist es nicht die DB (er verbindet intern).
4. **`git merge-base --is-ancestor master <finalBranch>` vor JEDEM Merge.** Ein abgebrochener
   Lauf hinterlaesst seinen Branch; der naechste weicht still auf `<branch>-impl` aus, meldet
   aber den **geplanten** Namen. Genau das haette hier einen halbfertigen Torso gemergt.
   **Branch einer abgebrochenen Phase vor dem Neustart loeschen.**
5. **Eine Bahn zur Zeit.** Zwei parallele Workflows erzeugten 35 gleichzeitige `node --test`
   und Load 32 auf 15 Kernen. Eigene Testlaeufe nur **zwischen** den Wellen.
6. **Nie mit `pgrep` messen** — sieht in dieser Sandbox keine fremden Prozesse, liefert stur 0.
   `ps` verwenden; `ps -o etimes` gibt es auf macOS nicht.
7. **Secrets nie durch Werkzeugaufrufe schleusen** (Regel 4) — sie landen im Sitzungsprotokoll.
   Env-Werte vom Owner im Dashboard setzen lassen.
8. **Ein Test, der nicht rot werden kann, ist kein Test.** Diese Session fand einen Vakuumtest,
   auf den sich `PLAN-SECURITY.md` als Nachweis berief. Gegenmittel: **Mutationsprobe** —
   Eigenschaft absichtlich kaputtmachen und pruefen, ob der Test es merkt.

---

## 5. Empfohlene Reihenfolge fuer die naechste Session

1. **Budget-Gate klaeren** (Abschnitt 1). Zuerst die Owner-Spur: laeuft der Pfad noch, den es
   nicht mehr geben sollte? Reproduzieren, Ursache, Regressionstest.
2. **Spike-Schalter entfernen** (`af4a66e` zurueckdrehen) — oder erst nach geglueckter Messung.
3. **AL-P2 messen** auf dem einfachen Weg (Abschnitt 3), Urteil eintragen.
4. Danach laufen AL-P7 (nur bei `incremental`), P7b, P10b, P14, P15 wieder ueber das
   Lean-Template.
5. **Reste aufraeumen:** Render-Dienst `hermes-spike-al-p2`, Telnyx-App `3014656686179747728`.

**Phasen fahren:**
```
Workflow({ scriptPath: ".claude/workflows/phase-impl-lean.js", args: {
  phaseId: "AL-P7", phaseTitle: "...", branch: "phase/al-p7-streaming",
  baseBranch: "master", planDoc: "PLAN-ASSISTANT-LEAP.md",
  specFile: "tasks/assistant-leap-chain.md", maxFixRounds: 2, highStakes: true }})
```
`highStakes` immer explizit setzen. Phasen-Spezifikationen: **Abschnitt 9** in
`tasks/assistant-leap-chain.md` (dort auch die Namensbruecke `AL-P<n>` -> `Phase <n>`).
**Bindend im Plan:** „Entscheidungen O1-O9"; „Herleitung der offenen Fragen" ist historisch.
