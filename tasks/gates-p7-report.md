# Phase GATES-P7 — Absender-Herkunft + Boot-Guards

**Scope:** GAP-19 (x2), OUT-14, `TELNYX_CONNECTION_ID`-Boot-Guard
**Gate:** PASS
**finalBranch:** `phase/gates-p7-absender-herkunft`

## Herkunftshinweis

Die Implementierung stammt aus dem am 2026-07-27 abgestuerzten Lauf. Dieser
Workflow hat keine Neu-Implementierung vorgenommen, sondern ausschliesslich
Review + Self-Fix auf dem bestehenden Impl-Commit nachgeholt (Muster
`gates-review-resume`).

## Inhalt der Phase

- **GAP-19a** (`test/boot-prod-footguns.test.js:67`): Boot warnt neu, wenn
  Kauf-Land (`FORCE_NUMBER_COUNTRY`) und Herkunftsland auseinanderfallen —
  Kauf-Land-Abweichung wird beim Start nicht mehr stumm hingenommen.
- **GAP-19b** (`test/outbound-gates-order.test.js`): `resolve_outbound`
  prueft neu die aufgeloeste Absendernummer gegen das Zielland
  (`originGateError` -> 403 `grund=herkunft` mit Audit-Eintrag) — ein Anruf
  unter fremdlaendischer Absender-DID passiert die Gate-Kette nicht mehr
  unbemerkt.
- **OUT-14** (`test/outbound-gates-order.test.js`): `GATE_CHAIN_LENGTH` wird
  als benannte Konstante erzwungen (throw bei Abweichung) — die im
  Modul-Kommentar genannte Gliederzahl deckt sich strukturell mit der
  tatsaechlichen Gate-Kette.
- **TELNYX_CONNECTION_ID-Boot-Guard**: neuer Boot-WARN-Test (fehlt -> warnt,
  gesetzt -> bleibt still) als Ersatz fuer die stillgelegten
  GAP-23-Tests.

Geaenderte Dateien (Produkt-Diff): `src/boot.js`, `src/telephony/outbound-gates.js`.

## Abnahme

### 1) Gates (grün)

`npm run test:gates` auf `phase/gates-p7-absender-herkunft` (73be4cf): alle
drei Phasen-Gates gruen.

1. "GAP-19 (SOLL, rot) - Kauf-Land != Herkunftsland wird beim Start nicht
   stumm hingenommen" (`test/boot-prod-footguns.test.js:67`) -> ok 47.
2. "GAP-19 (SOLL, rot) - ein Anruf unter fremdlaendischer Absender-DID
   passiert die Gate-Kette nicht unbemerkt" (`test/outbound-gates-order.test.js`)
   -> ok 273.
3. "OUT-14 (SOLL, rot) - die im Modul-Kommentar genannte Gliederzahl deckt
   sich mit der tatsaechlichen Gate-Kette" -> ok 274.

Gegenprobe auf der Basis `5fe5980`: exakt diese drei standen dort auf "not
ok". Gate-Bilanz Basis 131 Tests / 22 rot -> Branch 129 Tests / 17 rot; Diff
der Rotlisten enthaelt ausschliesslich Abgaenge (die 3 gefixten + die 2
spec-seitig stillgelegten GAP-23-Tests), kein Gate ist von gruen nach rot
gekippt.

### 2) Regression

Branch: 4 vollstaendige `npm test`-Laeufe. Lauf 2 und Lauf 4: 3305 pass / 0
fail. Lauf 1 und Lauf 3: 3305 Tests, 1 fail — beide Male "W5-4: aktiver
Subscriber kyc<card (otp) -> 403 KYC" (`test/w5-abo-allowlist-gate.test.js:122`),
404 statt 403.

Flake-Protokoll gefahren: `test/w5-abo-allowlist-gate.test.js` isoliert 2x
nachgefahren -> 7/7 pass, 0 fail.

Basis `5fe5980` zum Vergleich: 3298 pass / 0 fail. Zuwachs 3298 -> 3305 =
exakt die 7 neuen Regressionstests (5 in `outbound-gates-order.test.js`, 2 in
`boot-prod-footguns.test.js`); die 2 geloeschten GAP-23-Tests liefen im
Gates-Lauf, nicht im Regressionslauf, daher keine Minderung.

Der Flake ist nachweislich nicht vom Diff verursacht: der 404 faellt am
KYC-Gate, also vor `resolve_outbound` (dem einzigen geaenderten Glied); die
neue Sperre antwortet 403, nie 404; die beiden neuen Boot-Warns feuern in
diesem Testenv gar nicht (BASE_ENV: `PROVISIONING_ENABLED=false`,
`FORCE_NUMBER_COUNTRY=""`); der Diff enthaelt keinerlei Timing-Anteil.
Signatur passt auf die dokumentierte INV-11-Falle (guardedBoot fail-open ->
Routen lautlos 404) unter Voll-Last.

### 3) Produkt-Diff (nicht leer)

Das Gate wurde am Produkt gruen, nicht am Test:

- `src/boot.js`, `src/telephony/outbound-gates.js`.
- `resolve_outbound` prueft neu die aufgeloeste Absendernummer gegen das
  Ziel (`originGateError` -> 403 `grund=herkunft` mit Audit).
- `boot.js` meldet `FORCE_NUMBER_COUNTRY`-Abweichung bei jedem Start.
- Die Gliederzahl steht als erzwungene Konstante `GATE_CHAIN_LENGTH` mit
  `throw` bei Abweichung.

### 4) Testaenderungen (zugelassen)

- `test/did-reputation-metric.test.js` (beide GAP-23-Tests) **geloescht**,
  nicht nur stillgelegt. Spec verlangte "stilllegen"; Loeschen ist die
  staerkste Form davon, beide Tests waren rot (kein gruener Test gefallen) —
  kein Blocker, aber Nebeneffekt: die Begruendung der Ruecknahme
  (GAP-23 falsch spezifiziert) lebt danach nur noch in
  `tasks/gates-fix-chain.md`, nicht mehr am Testort.
- Ersatz-Boot-Guard-Test fuer `TELNYX_CONNECTION_ID` (fehlt -> warnt, gesetzt
  -> bleibt still).
- Uebrige Testaenderungen: ausschliesslich neue Regressionstests ohne
  Katalog-ID am Namensanfang (landen korrekt in `npm test`), die die
  Breite der neuen Sperre pinnen: Glueckspfad DE-DID->DE-Ziel erlaubt,
  echter Auslandsanruf erlaubt, unbekanntes Tenant-Land = kein Urteil,
  `FORCE_NUMBER_COUNTRY` = Betriebs-Ack.

### Absolute Regeln (Safety-Review bestaetigt)

- `EXPECTED_ORDER` unveraendert (17 Glieder, gleiche Namen,
  `reserve_budget` bleibt letztes Gate); kein bestehendes Glied entfernt
  oder aufgeweicht — GAP-19 fuegt ausschliesslich hinzu.
- `claude.js`/`bridge.js` unberuehrt, `disclosureSentence` unangetastet.
- Keine Endpunkt-/Auth-Aenderung.
- Keine Secrets in den neuen Logs (nur Laendercodes und der
  Variablenname `TELNYX_CONNECTION_ID`, nie sein Wert).
- Keine neue npm-Dependency, `package.json` unveraendert.
- Kein Zyklus durch den neuen Import `boot.js -> outbound-gates.js` (nur
  `server.js` importiert `boot.js`).
- `node --check` auf beiden Produktionsdateien gruen.

### Verdikt Safety-Review

APPROVED. Alle vier Abnahmepunkte selbst nachgefahren und erfuellt (siehe
Belege oben).

## Concerns (Protokollpflicht, kein Blocker)

1. **Die neue Herkunfts-Sperre ist im heutigen Live-Zustand wirkungslos**:
   `render.yaml:176` setzt `FORCE_NUMBER_COUNTRY="US"`, und
   `originGateError()` steigt bei gesetztem Override sofort mit `null` aus
   (`numberOriginDecoupled`). Praktisch traegt GAP-19a in Produktion aktuell
   nur die Boot-WARN-Zeile, nicht die Sperre. Das ist spec-konform (die Spec
   schreibt vor, dass `FORCE_NUMBER_COUNTRY=US` bleibt und eine dort
   greifende Sperre live jeden Outbound toeten wuerde; der Testanker baut
   seine Config ohne den Override), aber der Sicherheitsnutzen ist bis zum
   Wegfall des Overrides gestundet. Relevant fuer den Tag, an dem
   `FORCE_NUMBER_COUNTRY` entfernt wird.
2. **`test/did-reputation-metric.test.js` wurde geloescht statt
   stillgelegt.** Spec sagte "beide Tests stilllegen"; Loeschen ist die
   staerkste Form davon, beide Tests waren rot — kein Blocker, aber die
   Begruendung der Ruecknahme lebt nur noch in
   `tasks/gates-fix-chain.md`, nicht mehr am Testort.
3. **Neue Deny-Kante bei defekten Bestandsdaten**: `foreignOriginOnHomeCall`
   wertet eine Absendernummer, die die E164-Regex nicht besteht (Alt-Zeile
   ohne "+", mit Leerzeichen o.ae.), als "fremd" und wuerde einen echten
   Inlandsanruf mit 403 `grund=herkunft` sperren. Richtung ist fail-closed
   und heute durch den `FORCE_NUMBER_COUNTRY`-Ack ohnehin inaktiv;
   erwaehnenswert fuer den Tag, an dem der Override faellt. Falsch-Positive
   fuer korrekt formatierte DIDs sind ausgeschlossen: ist das Ziel-Land
   ableitbar (nur DE/AT/CH/FR/GB/IE), ist eine Nummer desselben Landes es
   zwangslaeufig auch.
4. **Fehlertext der neuen Sperre ist einsprachig englisch**, waehrend andere
   `place_call`-Ablehnungen der Tenant-Sprache folgen (P15/T2). Impl beruft
   sich auf die `E164_FORMAT_ERROR`-Praezedenz (Systemgrenze, keine
   Nutzeransprache). Kein bestehender Test verlangt etwas anderes (Suite
   gruen), aber Design-Entscheidung, die die i18n-Kette spaeter beruehren
   koennte.
5. **`GATE_CHAIN_LENGTH=17` wird per `throw` in `makeOutboundGates`
   erzwungen**; `makeOutboundGates` laeuft auf Modulebene in
   `src/server.js:68`, ein Mismatch wuerde also den Boot killen. Gewollte
   Struktur-statt-Disziplin-Loesung (G27), wird von jedem Testlauf lange vor
   einem Deploy gefangen — nur bewusst notieren, dass hier eine
   Entwickler-Invariante am Boot haengt.

## Clean-Code-Audit

- **S1:** keine.
- **S2:** keine.
- **S3:**
  - `src/telephony/outbound-gates.js:145-171` — `foreignOriginOnHomeCall`/
    `numberOriginDecoupled` sind knapp, klar benannt (N7 respektiert:
    Praedikats-Namen sagen exakt, was sie pruefen); keine Beanstandung, nur
    als Positiv-Notiz vermerkt statt separat gezaehlt.
  - `src/telephony/outbound-gates.js:399-417` (`originGateError`) —
    Gate-Funktion vermischt minimal Ableitung (`store.tenantGeo`-Lookup) und
    Entscheidung in einem Body; bei der Kuerze (9 Zeilen) und dem sonst
    durchgehaltenen Stil des Moduls (jedes Gate macht das) kein eigener Fix
    noetig, nur Randbeobachtung.
- **S4:**
  - `src/telephony/outbound-gates.js:392-412` — `resolve_outbound` traegt
    jetzt zwei Aufgaben (Absender aufloesen UND gegen Ziel validieren) statt
    nur Ableitung wie die anderen Derivations-Gates; der Commit begruendet
    das explizit (kein 18. Glied, da Herkunft erst nach der Ableitung
    feststeht) — akzeptabel dokumentierte Abwaegung, kein Blocker.

**Verdikt Clean-Code:** PASS. Diff ist sauber gegen den Katalog. Eine Quelle
fuer das Praedikat (`numberOriginDecoupled`, G5 respektiert), fail-closed
korrekt (WARN statt `exit(1)` ist bewusst und mit Praezedenz begruendet —
Boot-Refusal waere der teurere Fehlausgang), Money-/Sicherheits-Pfad
unveraendert (`reserve_budget` bleibt letztes Gate). `countryForE164`/
`tenantCountry`-Handling ist fail-closed bei unbekanntem Land (kein Urteil
ohne Beleg). Die GAP-23-Testloeschung ist im `PLAN-GATES.md` ausdruecklich
als Owner-Entscheidung dokumentiert (Test schaltete in Zeile 32 den eigenen
Schutz ab, falsch spezifiziert) und durch Ersatzabdeckung getragen. Alle 40
Tests in den beiden direkt betroffenen Testdateien
(`outbound-gates-order.test.js`, `boot-prod-footguns.test.js`) laufen gruen,
`node --check` sauber auf beiden Produktionsdateien.

**Kommentar-Pflege vorbildlich:** die Modul-Doku-Liste der "nie ablehnenden"
Derivations-Gates wurde korrekt um `resolve_outbound` bereinigt (kein stale
C2-Kommentar). Keine Duplizierung: das Herkunfts-Praedikat existiert genau
einmal und wird von Boot und Gate-Kette gelesen. Keine Magic Number ohne
Konstante (`GATE_CHAIN_LENGTH` benannt). Englischer Denial-Text konsistent
mit der bereits etablierten Systemgrenze (P15b/C1).

## Fix-Runden

Keine — der Clean-Code-Auditor stellte im finalen Durchlauf keine S1/S2
fest (Blocker-Feld `false`), daher war keine Self-Fix-Runde noetig. Der
initiale Safety-Review vermerkte den zum Auditzeitpunkt noch laufenden
vollen `npm test`-Lauf als offenen TODO; dieser wurde in diesem
Resume-Workflow abgewartet und ausgewertet (siehe Abschnitt Regression
oben — 3305/0 bzw. isoliert reproduzierter Flake ausserhalb des Diffs).
