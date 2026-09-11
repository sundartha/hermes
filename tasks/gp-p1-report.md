# Phase GP-P1 — Ablehnungsgrund des Holds: Diagnose UND Steuerung

**Gate: PASS** · **finalBranch: `gp/p1`** · **headCommit: `2172680c42b696df00860d48d29a7812f426bec1`**

## Ablehnungsgrund des Holds: Diagnose UND Steuerung

Der Ablehnungsgrund einer Stripe-Ablehnung (z.B. `insufficient_funds`) muss beides
gleichzeitig leisten: **Diagnose** fuer Menschen (lesbare Meldung/Log) und **Steuerung**
fuer Code (GP-P4 muss darauf verzweigen koennen). Ein Text allein reicht fuer Steuerung
nicht (fragil bei Wortlaut-Aenderungen), ein reines Enum-Feld allein reicht fuer Diagnose
nicht (Log-Zeilen sollen selbsterklaerend sein). Loesung: **einmal erheben, zweimal
liefern** — als getyptes Feld `err.providerDecline` (Steuerung, Vertrag fuer GP-P4) und
als Enum-Anhang an `err.message` (Diagnose). Beide entstehen aus **einer** Sicht
(`declineOf`), ein Auseinanderlaufen ist strukturell ausgeschlossen.

Zusaetzlich Frage 6 (Owner-Entscheidung): `createSubscription` faellt von Stufe 3
(Provider-Rohtext, potenziell PII) auf Stufe 2 (schmale Enum-Ausgabe) zurueck — Wurzel des
PII-Vorfalls vom 11.09.2026, an dem Name/E-Mail/Anschrift des Kunden ueber
`err.message` in `console.error` landeten.

## Plan (gekuerzt)

Basis `master` @ `b401031`. Groesse S, `highStakes: false`.

| # | Teil | Datei |
|---|---|---|
| A | Ablehnungsgrund als schmale, getypte Sicht (Enum-Whitelist `code`/`decline_code`/`type`) | **NEU** `src/billing/decline.js` |
| B | Beide klassifizierenden Fehlergrenzen erheben ihn einmal, liefern ihn zweimal (`err.providerDecline` + Enum-Anhang an `.message`) | `src/billing/stripe.js` |
| C | Frage 6: `createSubscription` Stufe 3 -> Stufe 2 | `src/billing/stripe.js` |
| D | 3 falsch gewordene Kommentare korrigiert | `src/billing/stripe.js` (2x), `src/self-service-routes.js` (1x) |
| E | Verhaltenstests + Struktur-Waechter (niemand steuert ueber `.message`) | **NEU** `test/gp-p1-ablehnungsgrund.test.js` |

Keine neue Env-Variable, keine neue Dependency, `errors.js`/`placeHold`-Body/Gates/Geldrechnung unangetastet.

`src/billing/decline.js`: drei reine Funktionen — `declineOf(errorBody)` (Enum-Trio,
`Object.freeze`), `declineDetail(decline)` (Text `"code=x decline_code=y type=z"`),
`attachProviderDecline(err, decline)` (Nebeneffekt im Namen, N7). Nur Enum-Token
(`^[a-z0-9_]+$`, max. 64 Zeichen) werden uebernommen — Freitext faellt auf `null`, damit
die PII-Zusage an der FORM haengt, nicht am Wohlverhalten des Anbieters.

`stripe.js`: neue gemeinsame `classifiedError({body, op, status, detail})` als einzige
Stelle, an der beide klassifizierenden Stufen (`assertOkClassified`, `assertOkWithDetail`)
den Ablehnungsgrund erheben und anhaengen (G5). `createSubscription` ruft ab GP-P1
`assertOkClassified` statt `assertOkWithDetail`.

Test-Plan: 12 Faelle in `test/gp-p1-ablehnungsgrund.test.js`, Praefix `GP-P1` (kein
Katalog-Praefix, bleibt im Regressionslauf) — Abschnitt 1 Verhalten (Abnahme 1-3, inkl.
Frage 6 und Frage 8 ueber den echten In-Process-Provisioning-Orchestrator), Abschnitt 2
Struktur-Waechter (Abnahme 4) inkl. Positiv-Kontrolle und Korrektur der SEC-P6-Kommentar-
Filter-Reihenfolge (Block- vs. Zeilenkommentare).

## Impl-Zusammenfassung

GP-P1 exakt gemaess Plan umgesetzt. Neues Modul `src/billing/decline.js`
(`declineOf`/`declineDetail`/`attachProviderDecline`). `src/billing/stripe.js`: beide
klassifizierenden Fehlergrenzen laufen ueber die neue gemeinsame `classifiedError()`;
`createSubscription` faellt gemaess Frage 6 auf Stufe 2 zurueck. `src/self-service-
routes.js`: nur Kommentar korrigiert, Code unveraendert. Test mit 12 Faellen, alle gruen.

- headCommit: `2172680c42b696df00860d48d29a7812f426bec1`
- node --check: PASS (alle 4 geaenderten/neuen Dateien + `src/server.js`)
- Tests: PASS, 162 pass / 0 fail (17 betroffene Testdateien aus dem Plan, `gap-05-number-
  hold.test.js` ausgeschlossen — vorbestehender, plan-unabhaengiger roter i18n-Katalogtest,
  verifiziert bereits auf `master` rot)
- committed: true
- Dateien neu: `src/billing/decline.js`, `test/gp-p1-ablehnungsgrund.test.js`
- Dateien editiert: `src/billing/stripe.js`, `src/self-service-routes.js`
- ESLint (Pre-Commit-Hook): 0 Fehler auf allen betroffenen Dateien. Prettier: clean.

### Deviations (Plan -> Umsetzung)

1. `attachProviderDecline` setzt das Feld ueber `Object.assign(err, {providerDecline: decline})`
   statt direkter Property-Zuweisung `err.providerDecline = decline` — Repo-ESLint-Regel
   `no-param-reassign` (props:true, hartes Pre-Commit-Gate) verbietet die Mutation einer
   Parameter-Property. Beobachtbares Verhalten identisch.
2. `declineDetail` in zwei Anweisungen zerlegt statt einer verketteten
   `.filter().map().join()`-Kette — Repo-Regel `no-restricted-syntax` (G36, max. 4
   verschachtelte MemberExpressions) blockte die geplante Ein-Ausdruck-Form.
3. Im Test zwei Bezeichner von `s` auf `state` bzw. `(s) => s.pfad` auf
   `(stelle) => stelle.pfad` umbenannt — Repo-Regel `id-length` (min 2) kennt keine
   Ausnahme fuer `s`. Reine Umbenennung, kein Verhaltensunterschied.

## Safety-Urteil

**approved: true** — alle Einzelurteile true (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected,
behaviorAsIntended), **blockers: []**.

Unabhaengig nachgefahren auf `review-gp-p1` (= `gp/p1`, Commit `2172680`): 94 pass / 0 fail
ueber drei Testgruppen (eigener Test, Nachbarn der geaenderten Fehlergrenze,
Aufrufer-Seite). ESLint und `node --check` sauber.

Diff-Umfang exakt 4 Dateien, nichts darueber hinaus. Gegen die absoluten Regeln geprueft:
SAFETY-GATES unberuehrt (kein Gate-File im Diff), OFFENLEGUNG unberuehrt (`claude.js`/
`bridge.js` nicht im Diff), AUTH fail-closed unberuehrt (`self-service-routes.js`: 14
Zeilen, alle Kommentar, 0 Nicht-Kommentar-Zeilen), SECRETS/PII strikt verengt
(`createSubscription` Stufe 3 -> Stufe 2, PII-Zusage haengt an der Enum-FORM, nicht am
Anbieterverhalten). Keine neue Dependency, keine neue Env-Variable. Keine der drei
verbotenen Konstrukte (`payment_method_types`, `link`-Denylist,
`invoiceTotal===0`-Signalwechsel) im Diff.

### Concerns (nicht blockierend)

1. **Residuale PII-Reichweite (nicht test-gesichert):** die beiden Checkout-Session-
   Aufbauten (`createSetupCheckoutSession`, `createSubscriptionCheckoutSession`) bleiben
   auf Stufe 3 — Rohkoerper landet weiter ueber `err.message` in `console.error`. Die
   Begruendung ("noch keine Zahlungsmethode am Vorgang") ist eine Annahme ueber
   Stripe-Verhalten, keine erzwungene Invariante. Spec-konform (Frage 6 zielte nur auf
   `createSubscription`); gehoert als bekannter Rest in GP-P2/`PLAN-GELDPFAD.md`.
2. Der Struktur-Waechter (Abnahme 4) nennt seine eigenen Luecken (einbuchstabiger
   Fehler-Bezeichner, Auswertung ueber Hilfsfunktion) statt Vollstaendigkeit zu behaupten.
3. `attachProviderDecline` setzt `providerDecline` als aufzaehlbare eigene Property via
   `Object.assign` — ein spaeteres `JSON.stringify(err)`/Error-Spread wuerde das Feld
   mitausgeben. Inhaltlich unkritisch (nur formvalidiertes Enum-Trio); kein `...err`-Spread
   und keine Error-Serialisierung im Bestand gefunden. Hinweis fuer GP-P4.

## Clean-Code-Audit

**verdict: PASS**, `blocker: false`.

- **s1 (Blocker):** keine
- **s2 (Blocker):** keine
- **s3 (Hinweis, kein Pflicht-Fix):** GP-P1-N1 · `src/billing/decline.js:64-68`
  (`attachProviderDecline`) · entspricht dem Muster F2-Output-Argument (mutiert das
  uebergebene `err`-Objekt via `Object.assign` statt ein neues Objekt zurueckzugeben) —
  ehrlich benannt (N7) und wirkt nur auf ein frisch in derselben Expression erzeugtes
  Error-Objekt, kein geteilter/langlebiger State. Empfehlung fuer kuenftige Wiederverwendung:
  Error-Subklasse mit `providerDecline` im Konstruktor statt Mutation.
- **s4:** keine

EIN neues Modul mit klarer, einmaliger Verantwortung, sauber ueber `classifiedError()`
eingehaengt (G5, keine Duplikat-Klassifikationslogik). Kommentare korrigieren nachweislich
falsch gewordene Altkommentare (C2). Keine der drei verbotenen Konstrukte im Diff (per
grep bestaetigt). Test-Suite deckt Normalfall, PII-Ausschluss per Positiv-Kontrolle mit
echten PII-Strings, Freitext-Grenzfall, leerer/unparsbarer Body (byte-identisch zum
Bestand), 3DS-Sonderfall (Fehlertyp bleibt erhalten UND Feld kommt dazu),
Provisioning-Orchestrator-Pfad (`job.lastError`) sowie den Struktur-Waechter samt eigener
Positiv-Kontrolle. Zusaetzlich `billing-subscribe.test.js`,
`pay-19-sca-authentication-required.test.js`, `w4-self-service-subscribe.test.js`
gefahren (31/31 pass) wegen des geaenderten `createSubscription`-Verhaltens — keine
Regression. Keine Magic Numbers ohne benannte Konstante, keine Verschachtelungstiefe > 2,
F1 durch ein Objekt-Argument in `classifiedError` sauber geloest.

**topTodos:** kein Blocker. Optional (S3, nicht dringend): `attachProviderDecline()` bei
Bedarf spaeter als Error-Subklassen-Konstruktor statt `Object.assign`-Mutation bauen,
falls sie je auf ein von aussen hereingereichtes `err` angewandt wird.

## Fix-Runden

Keine — Impl, Safety und Clean-Code-Audit wurden jeweils direkt mit PASS/approved
abgeschlossen, keine Nachbesserungsrunde noetig.
