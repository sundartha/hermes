# 27 - Welle W2 umgesetzt (Bericht)

Stand: 2026-07-27 | Basis: `ef16219` | Ergebnis: `59ca9cb` | Vorgaenger: [`15-w1-bericht.md`](15-w1-bericht.md)
Umsetzung in acht Bloecken, je Block ein Impl-Agent im eigenen Worktree, dualer Review
(Safety/Verhalten + Clean-Code), Self-Fix bei Blockern, Merge erst nach eigener Pruefung im Lead.

---

## 1. Ergebnis

| | vor W2 (`ef16219`) | nach W2 (`59ca9cb`) |
| --- | --- | --- |
| `npm test` (Regressionsschutz) | 3295 / **0 rot** | 3295 / **0 rot** |
| `npm run test:gates` (Launch-Gates) | 24 Tests / **3 rot** | **129 Tests / 34 rot** |
| Katalog-IDs abgearbeitet | 79 (W1) | **182** (79 + 103) |

**Der Regressionsschutz ist ueber acht Bloecke hinweg nicht ein einziges Mal rot geworden.**
Das ist die zentrale Invariante der Lauf-Trennung: rote Launch-Gates landen ueber ihren
Namenspraefix in `test:gates`, der Bestand bleibt unberuehrt (R-B/R-C).

**Kein Produktionscode.** In jedem Block per `git diff --name-only <base>..<branch> -- src/
public/ apps/ scripts/ render.yaml .env.example` gegengeprueft - immer leer. Der einzige
Nicht-Test-Edit ist der Kommentar-String `config._comment_i18nCatalogPattern` in
`package.json` (Ausnahmeliste der Buchhaltungs-IDs).

## 2. Die 34 roten Gates

| Kategorie | IDs |
| --- | --- |
| **getragen, kein Codedefekt** (3) | GAP-05 (Coupon-Allowlist, dauerhaft), GAP-15 x2 (wartet auf Rechtstext-Lieferung O13) |
| **Geld** (8) | GAP-06, GAP-08 x2, GAP-09 x2, GAP-11, FMT-15 x2 |
| **Provisioning / DID** (7) | DID-05, DID-09, GAP-19 x2, GAP-23 x2, GAP-34 x2 |
| **Web / Dashboard** (6) | WEB-07, WEB-08, WEB-10, WEB-13, WEB-19, GAP-30 |
| **Sprache / MCP** (5) | LANG-15, LANG-19, MCP-14, VOICE-12, GAP-24 |
| **Ops / Vertraege** (5) | OUT-14, GAP-26, GAP-31, GAP-37 |

Vor W1 existierte fuer **keinen** dieser Sachverhalte ein Test. Damit ist Punkt 10 des
Kurzurteils in `PLAN-I18N-TESTS.md` abgearbeitet: "nicht die Zahl der roten Tests ist das
Problem, sondern dass keiner davon heute existiert".

## 3. Was die Welle inhaltlich korrigiert hat

Die Bloecke haben den Katalog nicht nur abgearbeitet, sondern an sieben Stellen berichtigt.
Alle nach **R-G** dokumentiert statt stillschweigend gedreht:

| Befund | Block |
| --- | --- |
| **OUT-14 verschaerft**: Katalog erwartete gruen; der Modul-Kommentar in `outbound-gates.js` nennt 16 Gate-Glieder, die Kette traegt 17. Ein gruener Pin haette die Doku-Drift zum Sollzustand erklaert. | B3 |
| **PAY-06 umformuliert**: der Katalog verwechselt Reserve-Freigabe (`releaseOutboundReserve` bei Call-Ende) mit Kosten-Korrektur (Cost-Truing-Sweep) - zwei Mechanismen, im Katalog zu einem verschmolzen. | B4 |
| **PAY-25 entfaellt**: `VOICE_TARIFF_DOMESTIC_PREFIXES` ist eine Code-Konstante, keine Env-Variable - es gibt keine Env-Doku-Kohaerenz zu pruefen. | B4 |
| **PAY-20 widerlegt**: der unterstellte fehlende Drift-Alarm existiert (`providerRateOutOfBand` + `cost-calibration.js`). | B4 |
| **DID-08 geteilt**: `orderNumber` ruft `assertTelnyxOk` ohne `attachStatus` - eine Regulatory-Ablehnung traegt deshalb keinen `providerStatus`, maschinenlesbar bleibt nur `err.providerCode`. Steht in keinem Katalogtext. | B5 |
| **GAP-37 gerettet**: siehe K4 in [`19-w2-baseline.md`](19-w2-baseline.md) - die Baseline behauptete faelschlich, `buildFilter` existiere nicht. | B6 |
| **GAP-26 halbiert**: nur die maschinenlesbare Cap-Kennzeichnung ist testbar; Hold-Musik-Erkennung und no-speech-Eskalation sind Produktaenderungen ohne heutiges Subjekt. | B7 |

## 4. Was schiefging (und was daraus folgt)

### F1 - Ein Launch-Gate wurde lautlos zu einer Bestaetigung des Defekts (B2)

**VOICE-12** landete als Referenz-Kommentar an einem *gruenen Ist-Pin* ("eine Voice-ID fuer
alle drei Sprachen - das IST der Beweis"). Damit stand die Achse "EINE globale
ElevenLabs-Stimme" ohne Gate da: der Defekt als Sollzustand bestaetigt. Genau die Falle aus
**R1** der kanonischen Liste, die in diesem Repo bereits zweimal zugeschnappt ist.

Beide Reviews hatten den Block freigegeben - die Begruendung stuetzte sich plausibel auf G5
(kein Duplikat) und verwechselte dabei *"die Tatsache ist bewiesen"* mit *"der Sollzustand ist
gepinnt"*. Gefunden hat es erst die Lead-Pruefung gegen die kanonische Liste.

**Nachgezogen** (`b1bd854`): ein SOLL-Test am gerenderten `<Say>` fuer DE/FR/EN, der drei
verschiedene Voice-IDs verlangt (Sollzustand aus Owner-Entscheidung 7.5). Am Ergebnis
formuliert, nicht an einer Signatur - der Fix darf die Stimme aus dem Locale-Bundle, einer
Env-Tabelle oder vom Tenant ziehen.

**Lehre:** eine Buchhaltungs-Referenz ist nur dann zulaessig, wenn der Bestandstest den
SOLLZUSTAND pinnt. Pinnt er den Ist-Zustand, ersetzt er kein Gate. Gegenbeispiel aus
demselben Lauf: **PAY-01** ist eine legitime Buchhaltung - der Bestandstest importiert beide
Pakete (`src/plans.js` + `apps/web/src/lib/plans.js`) und pinnt die Invariante wirklich.

### F2 - Der Return-Wert nannte einen Branch, den es nicht gab (B6)

`finalBranch: phase/w2-b6-web-dashboard-ui`, tatsaechlich gearbeitet wurde auf
`phase/w2-b6-web-dashboard-widget`. Ein Blindmerge nach dem Return-Wert waere ins Leere
gelaufen. Bestaetigt die Regel: vor jedem Merge `git branch --list` + `git diff --stat`.

### F3 - Der Impl-Agent committete den Per-Run-Wrapper mit (B5)

`.claude/workflows/w2-b5-run.js` lag auf dem Branch, waehrend dieselbe Datei lokal untracked
war - der Merge haette sie geklobbert. Byte-Gleichheit geprueft, lokale Kopie vor dem Merge
entfernt. **Ab B6 wird der Wrapper VOR dem Lauf committet.**

### F4 - Eine falsche Baseline-Aussage wurde zweimal durchgereicht (B0 -> B6)

Die B0-Baseline behauptete, `buildFilter` existiere nicht im Repo; der Lead uebernahm das in
die Scope-Datei und in den B6-Wrapper. Erst der Impl-Agent mass nach (`grep -c buildFilter
render.yaml` = 2) und baute GAP-37 entgegen der Vorgabe. Zurueckgezogen als **K4**.

**Lehre:** ein Negativbefund muss am richtigen Artefakt erhoben werden. `buildFilter` ist ein
Blueprint-Schluessel, kein JS-Symbol - ein `grep` ueber `src/` findet ihn nie.

### F5 - Ein Voll-Last-Flake, dessen Datei nicht mehr feststellbar war (B6)

Der erste Regressionslauf zeigte 1 rot, der zweite Vollauf 0. Der Lead hatte die Ausgabe
bereits in der Pipe auf die Zusammenfassung gefiltert - der Rohtext war weg, die Datei nicht
mehr benennbar. Ab B7 wird das Log in eine Datei geschrieben und dann gefiltert.

## 5. Stand des Katalogs

| | |
| --- | --- |
| Arbeitsvorrat (nach K2 und Owner-Zuschnitt 7.14) | 216 - 11 gestrichen = **205** |
| umgesetzt | **182** (79 aus W1 + 103 aus W2) |
| offen | **~16 in Welle W3** (4 echte Anrufe, Rest Browser/Dashboard/Stripe-Testmodus) |

W3 braucht den Owner: Live-Freigabe je Anruf, Render-Dashboard, echter Browser-Login,
claude.ai-Connector. Und sie misst live - also **nach dem Deploy**; vor dem Deploy misst jeder
dieser Tests den alten Stand.
