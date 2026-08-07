# C-P3 — Detailbericht: Twilio-Zweig aus Header-Dispatch und Signaturpruefung

**Track C, Schritt 4.** Basis: `master` @ `ea48e0e`. Autoritativ: `tasks/c-p3-spec.md`.
Gate: **PASS**. finalBranch: `phase/c-p3-signatur-dispatch`. headCommit: `68b20ee0cd057c9094e46e9c413e3b13a334d92f`.

---

## Plan (gekuerzt)

Ziel: `providerFromHeaders` erkennt `x-twilio-signature` nicht mehr; `inboundSignatureVerifier`
dispatcht nur noch auf den Telnyx/Ed25519-Verifizierer; `src/telephony/adapters/twilio/signature.js`
wird geloescht (kein Aufrufer mehr, Spec §1 verlangt es explizit — "drei Stellen, ein Zug").

Zwei vorab gemeldete Spec-Abweichungen (Plan Abschnitt 0):

- **Befund 1** — der gemessene Sprengradius (9 rote Tests/6 Dateien) hatte das Loeschen von
  `signature.js` selbst nicht erfasst; drei Dateien importieren sie
  (`test/voice-signature.test.js`, `test/telephony-contract.test.js`, `src/telephony/registry.js`).
  Die Spec verlangt das Loeschen trotzdem.
- **Befund 2** — `test/signature-dispatch.test.js` wuerde ohne Eingriff gruen bleiben, aber zur
  Tautologie werden: der erste Test behauptet, `false` beweise das Betreten des Twilio-Pfads;
  nach C-P3 kommt dasselbe `false` aus dem fall-through. Aktiv behandelt statt ignoriert.

Kern-Edits:

1. `src/telephony/registry.js` — Twilio-Import raus, `providerFromHeaders` erkennt
   `x-twilio-signature` nicht mehr, `verifyInboundSignature` dispatcht nur noch auf Telnyx.
2. `test/security.test.js` — Ersatz-Positivbeleg: neuer e2e-Test "Provider-Signaturpruefung
   (Telnyx/Ed25519) fuer /voice/*" mit 3 Unterfaellen (ohne Signatur -> 403, falsche Signatur ->
   403, gueltige Signatur -> 200 + TeXML), ueber die echte HTTP-Route. **Reihenfolge-Auflage**:
   dieser Test musste zuerst zusaetzlich eingefuegt und gruen verifiziert werden, BEVOR der alte
   Twilio-Test entfernt wurde.
3. `test/provider-threading.test.js` — Aussage umgekehrt (Twilio-Header -> `null` statt
   `PROVIDER.TWILIO`), Twilio-Inbound-e2e-Test entfernt.
4. `test/inbound-routing.test.js` — DE/FR/EN-Sprachtests auf Telnyx-Renderer umgezogen
   (Polly -> Azure-Stimmen), `language`/`call.language`-Assertions woertlich unveraendert
   (kommen fuer beide Renderer aus derselben Quelle, `voice-locale.js`).
5. `test/telnyx-elevenlabs-inbound.test.js` — Twilio-Arm entfernt, Helper entparametrisiert.
6. `test/telnyx-p9-flag-matrix.test.js` — eine Orthogonalitaets-Matrixzelle (NICHT-Telnyx-Inbound)
   entfaellt; Outbound-Zelle bleibt (ausserhalb dieser Phase).
7. `test/voice-signature-403-log.test.js` — Fall b) erwartet `provider=unknown` statt `provider=twilio`.
8. `test/signature-dispatch.test.js` — Befund 2 aufgeloest: tautologischer Test entfernt, Aussage
   in den dritten (fail-closed-)Test gefaltet.
9. `test/telephony-contract.test.js` — `VERIFIERS`-Tabelle (nur noch 1 Eintrag) entfernt.
10. `test/helpers.js` — neuer geteilter Rohstoff `makeTelnyxSigner()`/`nowSeconds()` (G5/S2:
    Ed25519-Signier-Rezept vorher 2x kopiert, jetzt an einer Quelle, 3x wiederverwendet);
    `TWILIO_TEST_SIGNATURE_HEADERS` geloescht (keine Konsumenten mehr, waere sonst eine Falle
    fuer kuenftige Tests); `postTelnyxIncoming` entparametrisiert.
11. `test/telnyx-signature.test.js` — G5-Konsolidierung auf den neuen Helper (verhaltensneutral,
    alle 6 Assertions woertlich unveraendert).

Erwartete Test-Bilanz: `N_nachher = N_vorher − 3` (Details in Plan Abschnitt 3).

Deterministische Abnahme-Reihenfolge (Plan Abschnitt 4): 0) Baseline messen, 1) Ersatztest
zusaetzlich einfuegen + gruen, 2) Rest der Edits + `node --check`, 3) Datei weg + kein
`x-twilio-signature`-Treffer in `src/`, 4) volle Suite gruen mit `N_vorher − 3`, 5)
`route-auth-inventory` unberuehrt, 6) `test:gates` unveraendert. Zwei Gegenproben (Dispatch-
Wiedereinsetzung faengt Regression; verfaelschte Signatur faengt 403 statt 200) und ein
Smoke-Test (`curl` mit bogus `x-twilio-signature` -> 403 + genau eine PII-freie Logzeile mit
`provider=unknown`) als sichtbarer Beweis.

---

## Impl-Zusammenfassung

`providerFromHeaders` erkennt `x-twilio-signature` nicht mehr; `inboundSignatureVerifier`
dispatcht nur noch auf den Telnyx/Ed25519-Verifizierer; `src/telephony/adapters/twilio/signature.js`
ist geloescht (kein Aufrufer mehr). Der Positiv-Beleg des Gates (gueltige Signatur -> 200) ist auf
Telnyx umgezogen und existiert erstmals end-to-end ueber die echte HTTP-Route
(`test/security.test.js`), in der geforderten Reihenfolge zuerst gruen verifiziert, dann der alte
Twilio-Test entfernt. Beide vorab benannten Befunde wurden wie gefordert aktiv behandelt statt
stehen gelassen. Ed25519-Signier-Rezept auf eine Quelle konsolidiert (`test/helpers.js`).

Regressionssuite: **4040 -> 4037 Tests (-3), exakt wie im Plan bilanziert.**
`test testPassCount`: 4037, `testFailCount`: 0. `route-auth-inventory` unberuehrt gruen.
Beide Gegenproben bestaetigt und zurueckgenommen. Smoke-Test bestaetigt 403 + genau eine
PII-freie Logzeile mit `provider=unknown`. `PROVIDER.TWILIO` als Enum-Wert und der
Twilio-Outbound-Pfad bleiben im Code unangetastet (Spec C-P4, nicht Teil dieser Phase — siehe
aber Safety-Concern zum faktischen Status).

Geaenderte Dateien:
`src/telephony/registry.js`, `test/helpers.js`, `test/inbound-routing.test.js`,
`test/provider-threading.test.js`, `test/security.test.js`, `test/signature-dispatch.test.js`,
`test/telephony-contract.test.js`, `test/telnyx-elevenlabs-inbound.test.js`,
`test/telnyx-p9-flag-matrix.test.js`, `test/telnyx-signature.test.js`,
`test/voice-signature-403-log.test.js`. Keine neuen Dateien, `src/telephony/adapters/twilio/signature.js`
und `test/voice-signature.test.js` geloescht.

### Deviations (aus dem Impl-Report)

1. Befund 1 gemeldet und wie vom Plan verlangt behandelt (Datei trotz unterschaetztem
   Sprengradius geloescht, drei Importstellen bereinigt).
2. Befund 2 gemeldet und wie vom Plan verlangt behandelt (Tautologie aktiv aufgeloest statt
   stehen gelassen).
3. `npm run test:gates` konnte in dieser Session wegen massiver Fremd-Systemlast (zwei parallele
   Node-Prozesse anderer Sessions, durchgehend 100-106% CPU) nicht vollstaendig durchlaufen —
   blieb nach ~65 von ~400 Wrappern haengen. Ersatzbeleg: der einzige betroffene Katalog-Test
   (LANG-16 in `inbound-routing.test.js`, Logik unveraendert) wurde isoliert gruen verifiziert.
   `test:gates` ist laut CLAUDE.md kein Blocker ("DARF rot sein").

---

## Safety-Urteil

**approved: true** — alle Kernpruefungen bestanden: `testsPassIndependently`, `safetyGatesIntact`,
`disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`,
`behaviorAsIntended`. Keine Blocker.

Verdict: **FREIGABE mit Auflagen fuer den Report.** Der Umbau macht den Pfad strikt geschlossener,
nicht offener — der Twilio-Header ist keine Provider-Quelle mehr, faellt ueber
`providerFromHeaders=null` in den fail-closed-Zweig und endet mit 403, auch bei versehentlichem
Wiedereinsetzen des Header-Zweigs (gemessen). Die harte Spec-Auflage ist erfuellt: der
Telnyx-e2e-Positivbeleg existiert, laeuft ueber die echte HTTP-Route mit echter Ed25519-Signatur
und ist mutationsfest in beide Richtungen. Keine Aenderung an `claude.js`/`bridge.js`
(disclosureSentence unberuehrt), `route-policy.js`, `config.js`, `.env.example`, `render.yaml`,
`package.json` — keine neue Dependency, keine neue Auth-Ausnahme, `route-auth-inventory` gruen.
Kein Secret im Diff (Wegwerf-Ed25519-Testschluessel, `TELNYX_PUBLIC_KEY` ist oeffentlich).

Independent-Test-Zusammenfassung: eigener Lauf im frischen Worktree, `npm test` 4x
(1x mit 1 last-bedingtem Fehler, 3x sauber 4037/4037, exit 0). Baseline `master` (ea48e0e) im
selben Worktree: 4040 Tests, davon 1 rot (bekannter Last-Flake `AL-P10-1`) — Branch also nicht
schlechter. Testbestand 4040 -> 4037 = exakt -3, deckungsgleich mit den drei belegbar
entfallenen Tests. Zusaetzlich: Gegenprobe (Dispatch wieder eingesetzt -> 2 Tests rot, dann
zurueckgesetzt), Mutationstest A (Verifizierer hart `false` -> Positiv-Subtest rot),
Mutationstest B (Verifizierer hart `true` -> Negativ-Subtest rot), Smoke-Test gegen echten
Serverprozess (403 + `invalid inbound signature`, `/healthz` 200).

### Concerns (kein Blocker, aber Auflage fuer Report/Uebergabe)

1. **Veraltete Gate-Kommentare in `src/routes/voice.js`** — Zeile 221 sagt weiterhin "Die
   Krypto (Twilio-HMAC) lebt im Adapter", Zeile 252 "Die Twilio-Signatur ist hier bereits
   fail-closed geprueft". Beides ist nach C-P3 sachlich falsch (einzige Inbound-Krypto ist
   Telnyx/Ed25519). Code korrekt, Beschreibung nicht.
2. **Doku-Drift zur Absoluten Regel 1** — `CLAUDE.md` nennt weiterhin "Twilio HMAC + Telnyx
   Ed25519" als geschuetzte Provider-Signaturpruefung, ebenso `docs/RUNBOOK-AUTH-REVIEW.md:34`.
   `PLAN-SECURITY.md` wurde nicht angefasst, obwohl ein Signatur-Verifizierer entfernt wurde.
   Kein Sicherheitsverlust, aber Regel/Nachweistext beschreiben einen Zustand, den es nicht
   mehr gibt.
3. **Zwischenzustand groesser als die Spec ihn beschreibt** — Spec Abschnitt 2 behauptet, der
   Twilio-OUTBOUND-Pfad bleibe. De facto ist er ebenfalls tot: Twilio holt TwiML von
   `/voice/outbound` und meldet an `/voice/status`, beides mit `x-twilio-signature`, also jetzt
   403. Verifiziert unbedenklich (Max-Dauer haengt nicht am Webhook, In-Prozess-Timer,
   Reserve-Freigabe/Settlement laufen unabhaengig, kein Live-Verkehr auf Twilio laut C-P2), aber
   gehoert explizit in die C-P4-Uebergabe statt als "bleibt" zu firmieren.
4. **Test-Umfang leicht ueber dem gemessenen Sprengradius** — `test/telnyx-signature.test.js`
   wurde rein zur Entdopplung auf den neuen Helper-Signierer umgezogen; nach G5/S2 vertretbar
   und durch den gruenen Lauf gedeckt, war fuer C-P3 aber nicht zwingend.
5. **Neue Formatierungsabweichung** — `test/security.test.js` Zeile 6 (Import) reisst die
   Prettier-Printwidth; `npx prettier --check` meldet die Datei. Uebrige Treffer bestehen
   bereits auf `master`, diese eine ist neu.
6. **Umgebung** — node v26.4.0 statt der von `package.json` geforderten `>=22 <23` (gilt fuer
   Branch und `master` gleichermassen). eslint liess sich nicht fahren (`@eslint/js` fehlt im
   node_modules), deshalb nur `node --check` + prettier.

---

## Clean-Code-Audit (s1-s4)

**verdict: PASS — keine Verstoesse gefunden. blocker: false.**

- **s1**: []
- **s2**: []
- **s3**: []
- **s4**: []

C-P3 entfernt den Twilio-Inbound-Signaturpfad sauber: `providerFromHeaders` erkennt
`x-twilio-signature` nicht mehr, `twilio/signature.js` ist geloescht,
`inboundSignatureVerifier` hat nur noch den Telnyx-Zweig, der Fail-Closed-Pfad
(unbekannter Provider -> `false` -> 403) bleibt intakt und ist per Test gepinnt
(`voice-signature-403-log.test.js`, `provider-threading.test.js`-Gegenprobe-Kommentar).
Keine toten Imports, keine verwaisten Referenzen auf die geloeschte Datei oder
`TWILIO_TEST_SIGNATURE_HEADERS`. Alle 57 betroffenen Tests laufen isoliert gruen
(per git-archive-Checkout verifiziert). Der neue `makeTelnyxSigner()`-Helper beseitigt echte
Duplizierung (dieselbe Ed25519-Signier-Logik stand vorher dreifach). Voice-Erwartungen in
`inbound-routing.test.js` wechseln korrekt von Polly (Twilio-Renderer) auf Azure
(Telnyx-Renderer), stimmt mit der realen Voice-Tabelle in
`src/telephony/adapters/telnyx/render.js` ueberein. Keine Umlaute in neuen Kommentaren, keine
Magic Numbers ohne Konstante.

passNotes: Sicherheits-Invariante (Absolute Regel 1, Signaturpruefung fail-closed) bleibt
durchgaengig erhalten und ist mit expliziten Gegenproben getestet statt nur implizit
angenommen. `twilioVoice`/`twilioMessaging`/`twilioRender`/`twilioMedia` bleiben in
`registry.js` importiert und ueber die Port-Tabelle registriert (Outbound-/Rendering-Pfade
unberuehrt) — keine toten Imports trotz Loeschung von `twilio/signature.js`. Kommentare in
`registry.js` erklaeren explizit die Gefahr eines Wieder-Eintragens des Twilio-Headers ohne
Verifizierer.

topTodos:
- Keine Blocker offen — Merge kann erfolgen.
- Optional/nicht dieser Phase: `SKIP_TWILIO_SIGNATURE_CHECK` als Env-Name bleibt trotz
  Twilio-Inbound-Wegfall bestehen (steuert weiterhin das globale Signatur-Skip-Flag) — falls
  in einer spaeteren Track-C-Phase auch der Twilio-Outbound-Pfad faellt, waere eine
  Umbenennung sinnvoll, aber ausserhalb des C-P3-Scopes.

---

## Fix-Runden

Keine. Der erste Review-Durchlauf (Safety + Clean-Code) ergab direkt PASS/FREIGABE ohne Blocker;
es waren keine Fix-Runden noetig.
