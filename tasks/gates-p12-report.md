# Phase GATES-P12: Deutsche Klartexte am Server (WEB-10, WEB-13)

- **Gate:** PASS
- **finalBranch:** `phase/gates-p12-server-klartexte`

## Hinweis zur Herkunft

Die Implementierung stammt aus dem am 2026-07-27 abgestuerzten Lauf. Dieser
Workflow hat KEINE Neu-Implementierung vorgenommen, sondern nur Review +
Self-Fix auf dem vorhandenen Impl-Commit nachgeholt (Wiederaufnahme-Modus).

## Abnahme

### 1. Gates gruen (in den ORIGINALEN Gate-Dateien)

Eigener Lauf `NODE_ENV=test node test/i18n-catalog-run.mjs gates` (der
npm-Wrapper scheiterte lokal an einer Shell-Eigenheit, Runner direkt
gefahren): korrigiert tests 131 / pass 111 / fail 20. Beide Phasen-Gates
gruen, unveraendert in ihren Original-Dateien:

- `ok 392 - WEB-10 (SOLL, rot) - fehlende PUBLIC_URL liefert einen
  sprachneutralen Code, keinen deutschen Klartext`
  (`test/self-service-error-codes.test.js:81`, Datei ueberhaupt nicht im
  Diff)
- `ok 514 - WEB-13 (SOLL, rot) - die Session-abgelaufen-Seite ist nicht
  hart deutsch` (`test/web-auth.test.js:352`, Test selbst unveraendert)

Isolierter Nachlauf der drei betroffenen Dateien: 58/58 pass, 0 fail.

Rot-vor-Fix am Produkt belegt: Basis lieferte
`{error:"PUBLIC_URL fehlt"}` (Leerzeichen + "fehlt") bzw. HTML mit
`lang="de"`.

### 2. Regression

npm-test-Aequivalent (`i18n-catalog-run` regression): tests 3302 / pass
3302 / fail 0. Kein roter Test, kein Spawn-Flake (keine Isolations-Nachfahrt
noetig). +4 gegenueber 3298 nach Welle 1 = genau die 4 neuen
Nicht-Katalog-Tests in `test/p12-server-error-codes.test.js`; die
Lauf-Trennung verliert nichts (Gates 131 unveraendert getragen).

### 3. Produkt-Diff nicht leer

Geaenderte Quelldateien (4):

- `src/billing/payment-gate.js`
- `src/routes/api-billing.js`
- `src/self-service-routes.js`
- `src/web-auth.js`

Die Gates gehen gruen WEIL sich das Produkt geaendert hat — kein
VOICE-12-Praezedenzfall (Gate-File im Diff manipuliert), das WEB-10-Gate-File
ist ueberhaupt nicht im Diff.

### 4. Testaenderungen

An `test/` nur die autorisierte Aenderung:

- `web-auth.test.js:337` — AM2-Ist-Pin auf `/Session expired/`
- Kommentar-Nachzug
- eine neue Regressionsdatei `test/p12-server-error-codes.test.js` ohne
  Katalog-ID-Praefix

Kein gruener Test ist gefallen.

## Safety-Review (final)

```json
{
 "approved": true,
 "gatesGreen": true,
 "testsPassIndependently": true,
 "regressionSummary": "npm-test-Aequivalent (i18n-catalog-run regression): tests 3302 / pass 3302 / fail 0. Kein roter Test, kein Spawn-Flake (keine Isolations-Nachfahrt noetig). +4 gegenueber 3298 nach Welle 1 = genau die 4 neuen Nicht-Katalog-Tests in test/p12-server-error-codes.test.js; die Lauf-Trennung verliert nichts (Gates 131 unveraendert getragen).",
 "productDiffNonEmpty": true,
 "productDiffFiles": [
  "src/billing/payment-gate.js",
  "src/routes/api-billing.js",
  "src/self-service-routes.js",
  "src/web-auth.js"
 ],
 "testChangesAllowed": true,
 "safetyGatesIntact": true,
 "disclosureIntact": true,
 "authFailClosedIntact": true,
 "noSecretsLeaked": true,
 "scopeRespected": false,
 "behaviorAsIntended": true,
 "blockers": [],
 "concerns": [
  "Dateiliste ueberschritten: die Phase aendert src/billing/payment-gate.js, das in der P12-Spec NICHT genannt ist (Spec: src/self-service-routes.js, src/routes/api-billing.js, src/web-auth.js). Kein Wellen-Konflikt (grep 'payment-gate' ueber tasks/gates-fix-chain.md: 0 Treffer, keine andere Phase haelt die Datei), Aenderung rein additiv (ein Kommentar, Konstante ERROR_SERVER_UNCONFIGURED, Funktion requirePublicUrl), requirePaymentEnabled unangetastet. Motiv ist G5: die Alternative waere die Duplizierung von Status+Code an zwei Call-Sites, die die Kette selbst (P13) als S2-Blocker behandelt. Deshalb Befund, kein Blocker - dem Lead zur Kenntnis.",
  "ERROR_SERVER_UNCONFIGURED wird produktiv nur innerhalb von requirePublicUrl gelesen; der Export dient dem Test. Kosmetischer Nit, kein toter Code.",
  "public/tenant.html traegt weiter deutsche 'Sitzung abgelaufen'-Strings (Zeilen 473/508/568) - korrekt NICHT angefasst, das ist P14s Datei; bleibt als offener Rest der Welle sichtbar."
 ],
 "verdict": "APPROVED. Alle vier Abnahmepunkte erfuellt und selbst nachgefahren: (1) WEB-10 und WEB-13 gruen in ihren unveraenderten Gate-Dateien; (2) Regression 3302/0; (3) Produkt-Diff nicht leer (4 src-Dateien) und die Gates gehen WEIL sich das Produkt geaendert hat - der VOICE-12-Praezedenzfall liegt hier nicht vor, das WEB-10-Gate-File ist ueberhaupt nicht im Diff; (4) an test/ nur die autorisierte Aenderung (web-auth.test.js:337 AM2-Ist-Pin auf /Session expired/) plus Kommentar-Nachzug und eine neue Regressionsdatei ohne Katalog-ID-Praefix - kein gruener Test gefallen. Absolute Regeln halten: claude.js/bridge.js unberuehrt (Offenlegungssatz intakt), web-auth-Aenderung ist reiner Text (kein Auth-Logik-, kein safeEqual-/Cookie-Pfad angefasst, Seite mintet weiter KEINE Session), der neue Guard ist fail-closed VOR jedem Stripe-/Store-/Tenant-Zugriff (belegt durch tenantResolverCalls()===0) und der glueckliche Pfad ist mitgetestet (403 Tenant-Reject = durchgelassen). Der Diff ENTFERNT einen Interna-Leak (Env-Name in Kunden-Antwort) statt einen zu schaffen; kein Frontend haengt am alten deutschen Klartext (grep public/ apps/web/src: kein Konsument). Keine neue npm-Dependency, package.json/-lock unberuehrt, keine untrackten Dateien, self-service-routes.js nur an der Guard-Zeile (keine Rueckkehr-Adressen = kein Vorgriff auf P14). Einziger Befund: die Zusatzdatei src/billing/payment-gate.js ausserhalb der Spec-Dateiliste - gut begruendet (G5), kollisionsfrei, deshalb Concern statt Blocker."
}
```

## Clean-Code-Audit (final)

- **s1:** []
- **s2:** []
- **s3:** []
- **s4:** []
- **blocker:** false
- **verdict:** PASS — GATES-P12 (sprachneutrale Server-Klartexte, WEB-10/WEB-13) sauber umgesetzt, keine S1/S2-Funde.

**passNotes:**

Diff (5fe5980 -> phase/gates-p12-server-klartexte): 6 Dateien, +133/-12.
WEB-10: neue Funktion `requirePublicUrl()` + Konstante
`ERROR_SERVER_UNCONFIGURED` in `src/billing/payment-gate.js` ersetzt den
bisher zweimal (`api-billing.js` + `self-service-routes.js`) duplizierten
deutschen Klartext-Fehler mit Env-Namen-Leak (`'PUBLIC_URL fehlt'`) durch
EINE Quelle (G5 sauber angewandt, exakt wie `requirePaymentEnabled` daneben —
konsistentes Muster, G11). WEB-13: `SESSION_EXPIRED_PAGE` in `web-auth.js`
von hart-deutsch auf hart-englisch (Weltdefault), mit begruendetem
Kommentar, warum bewusst NICHT ueber i18n-Catalog (`web-auth.js` bleibt
config-frei/DI-Naht) — nachvollziehbare, dokumentierte Design-Entscheidung,
keine Willkuer (G32).

Tests: neue Datei `test/p12-server-error-codes.test.js` deckt Guard isoliert
(glueck./Fehlpfad) UND den api-billing-Checkout-Zweig ab,
Build-Operate-Check-Struktur (P13), keine geteilte Mutable-State (P12/I);
vorbestehender WEB-10-SOLL-Test in `test/self-service-error-codes.test.js`
UND der WEB-13-SOLL-Test in `web-auth.test.js` springen jetzt von rot auf
gruen — echtes Verhalten, keine Kosmetik.

Verifiziert: `node --check` auf allen 5 geaenderten Quelldateien sauber;
`node --test` ueber `p12-server-error-codes.test.js` (4/4),
`web-auth.test.js` (56/56), `self-service-error-codes.test.js` (2/2),
`billing-*.test.js` (56/56) — alles gruen, keine neue Rot-Stelle. Keine
Magic Numbers, kein toter/auskommentierter Code, keine abgeschalteten
Sicherungen, keine Aufrufketten-Wildwuchs. Kommentare erklaeren WARUM
(Repo-Konvention), keine C1-C4-Verstoesse gesehen.

**topTodos:**

- Kein Blocker. Nice-to-have (nicht in dieser Phase gefordert): sobald
  `web-auth.js` irgendwann eine config-tragende Naht bekommt,
  `SESSION_EXPIRED_PAGE` ueber den i18n-Catalog statt hart-verdrahtetem
  Englisch fuehren — aktuell bewusst und dokumentiert akzeptiert.

## Fix-Runden

Keine — die uebernommene Implementierung erreichte bereits im ersten
Review-Durchlauf PASS (Safety approved, Clean-Code ohne S1/S2). Es wurde
keine Fix-Runde benoetigt.
