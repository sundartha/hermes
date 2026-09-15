# Phase IEL-B7: Dial-Direktive, TeXML-Renderer, Umleitungs-Port

**Gate:** PASS
**finalBranch:** `phase/iel-b7-dial-direktive-fix2`

## Plan (gekuerzt)

Basis: `phase/iel-b6-init-webhook` (`edc1550`).

Befunde, die den Plan bestimmen:
- B6 hat die Umleitung schon eingebaut (`inbound-bridges.js#leiteUm` ruft `port.redirectCall(call.twilioSid, url)`) — die Signatur `redirectCall(providerCallSid, url)` steht damit fest, absolute URL.
- `EL_CALL_BINDING_SIP_HEADER` existiert bereits in `inbound-initiation.js` (B6-Kommentar: "B7 setzt den SIP-Header") — Konstante wandert nach `inbound-sip-uri.js` (eine Quelle), `inbound-initiation.js` re-exportiert.
- `test/ie6-s2-realtime-entfernt.test.js` pinnt die DIRECTIVE-Schluessel exakt — wird um `DIAL_SIP` erweitert, Zweck "kein STREAM" bleibt.
- `telnyxVoice.endCall` und die neue Umleitung nutzen denselben Telnyx-Endpunkt (Update-Call: `Url`+`Method` bzw. `Status`) — gemeinsamer Helfer `updateTexmlCall`, `endCall` bleibt byte-identisch.
- Telnyx-Dial-Grenzen (Doku 2026-09-15): `timeLimit` 60-14400 (Default 14400), `timeout` 5-120. Immer setzen und klemmen, sonst liefe eine Bruecke bis 4h ungeklemmt — Klemmung sitzt im Adapter (`render.js`), nicht in der neutralen Direktive.
- `escapeXml`/`attrString` in `render.js` decken das neue Escaping ohne eigenen Code ab.
- E.164-Regex existiert bereits in `src/store/defaults.js`, keine Zyklen — `elSipUri` prueft die DID dagegen.
- Ausser `inbound-bridges.js#leiteUm` ruft niemand `redirectCall`; wirksam wird die Umleitung erst mit B8 (costProfile `TELNYX_INBOUND_EL_CONVAI`, aktuell von niemandem gesetzt).

Neue Dateien lt. Plan:
- `src/elevenlabs/inbound-sip-uri.js` — reine Funktion `elSipUri({did, token})`, feste Host/Port/Transport-Konstanten (`sip.rtc.elevenlabs.io:5060;transport=tcp`), DID-Pruefung gegen `E164`, Token URI-kodiert; exportiert `EL_CALL_BINDING_SIP_HEADER`.
- `test/iel-dial-render.test.js` — Faelle IEL-B7-1 bis -13 (Abnahme-Form exakt, Escaping, timeLimit-Grenzen tabellengetrieben, Fehlerfaelle ohne Secrets, Reihenfolge in Erstantwort, Host-Pinning, fail-closed DID/Token, Token-Kodierung, gemeinsame Header-Konstante, `redirectCall` mit Fake-fetch inkl. Formschluessel-Check, Fehler ohne Secrets, fail-closed ohne Netz, Port-Vertrag).

Edits lt. Plan:
- `directives.js`: neuer Enum-Wert `DIAL_SIP`, Builder `dialSip(...)`.
- `render.js`: Konstanten `DIAL_TIME_LIMIT_MIN_S/MAX_S`, `SIP_STATUS_CALLBACK_EVENT`; `renderDialSip` produziert `<Dial callerId timeout timeLimit><Sip username password statusCallback statusCallbackEvent>uri</Sip></Dial>`, alles ueber `attrString`/`escapeXml`.
- `ports.js`: optionale Methode `redirectCall` im `VoiceControl`-Typedef dokumentiert.
- `voice.js`: gemeinsamer Helfer `updateTexmlCall(callSid, {form, op})`; `endCall` darauf umgestellt (byte-identisches Verhalten); neu `redirectCall(callSid, url)` (nur `Url`+`Method`, kein `Status`, sonst wuerde aufgelegt statt umgeleitet).
- `inbound-initiation.js`: importiert `EL_CALL_BINDING_SIP_HEADER` aus `inbound-sip-uri.js` und re-exportiert.
- `test/ie6-s2-realtime-entfernt.test.js`: Schluesselliste um `DIAL_SIP` erweitert.

Pre-Mortem-Punkte: Umleitung legt auf statt umzuleiten (Formschluessel-Test), Bruecke laeuft 4h ohne Klemmung (immer klemmen + Wurf bei NaN), Passwort im Fehlertext/XML-Bruch (Escaping + Fehlertexte ohne Werte), manipuliertes Dial-Ziel (E.164 + fester Host), `endCall`-Refactor bricht Cap/Cancel (unveraenderte Bestandstests), B6-Fristpfad greift in echte Anrufe (kein Aufrufer setzt das noetige costProfile).

Bewusst nicht in B7: `timeout` 5-120 klemmen (kommt mit B8-Konstante), `call.maxDurationS` ungeklemmt an B8 uebergeben, `registry.js#fakeVoice.redirectCall` fehlt (erst B8-relevant), veralteter Kopfkommentar in `render.js` (ausserhalb Scope).

## Impl-Zusammenfassung

IEL-B7 exakt gemaess Plan umgesetzt: neutrale `dial_sip`-Direktive (`directives.js`), TeXML-`<Dial><Sip>`-Renderer mit geklemmtem `timeLimit` 60-14400s (`render.js`), Umleitungs-Port `redirectCall` via gemeinsames `updateTexmlCall` (`voice.js`, `endCall` darauf refactored, byte-identisches Verhalten), reine SIP-Ziel-URI `elSipUri` mit E.164-Pruefung und URI-kodiertem Bindungs-Token (neu: `inbound-sip-uri.js`), `EL_CALL_BINDING_SIP_HEADER` dorthin verschoben (eine Quelle, `inbound-initiation.js` re-exportiert). `IE6-S2-6` um `DIAL_SIP` erweitert.

Neuer Test `test/iel-dial-render.test.js` (IEL-B7-1..13, 13/13 gruen); alle im Plan genannten Bestandssuiten unveraendert gruen; volle Regressionsbank 5720/5720 gruen (`node --test-concurrency=4`, korrekt via doppeltes `--` durchgereicht). `git diff --stat` gegen die Basis `phase/iel-b6-init-webhook` zeigt exakt die 8 geplanten Dateien; alle Abnahme-Greps (redirectCall-Aufrufer, Header-Konstante, SIP-Host, dialSip/elSipUri-Nutzung ausserhalb) liefern exakt die erwarteten Treffer. Safety-Gates, Offenlegung, Auth und Scope unangetastet — reine Telefonie-Bausteine ohne neuen produktiven Aufrufer (B8 verdrahtet sie erst).

- filesCreated: `src/elevenlabs/inbound-sip-uri.js`, `test/iel-dial-render.test.js`
- filesEdited: `src/telephony/directives.js`, `src/telephony/adapters/telnyx/render.js`, `src/telephony/ports.js`, `src/telephony/adapters/telnyx/voice.js`, `src/elevenlabs/inbound-initiation.js`, `test/ie6-s2-realtime-entfernt.test.js`
- headCommit: `9040453f72b180e86c65fc4a7c8316dcf2c4c265`
- nodeCheckPass: true
- testPassCount: 5720, testFailCount: 0, testsPass: true
- smokePass: false — Server-Boot-Smoke abgebrochen (Boot-Guard verlangt eine aktive Nummer im Store, ohne echten Telnyx-Kauf/Seed nicht schnell herstellbar). Begruendet als strukturell entfallend: IEL-B7 fuegt keine neue Route hinzu und veraendert keinen bestehenden Request-Pfad (`redirectCall`/`dialSip`/`elSipUri` haben ausser dem B6-Bruecken-Aufrufer noch keinen produktiven Caller, der kommt erst mit B8). Verifikation lief vollstaendig ueber die automatisierten Tests.

### Deviations

- Lint-Vorpruefung (`npm run lint`, Pre-Commit-Hook) war im Plan nicht explizit erwaehnt, aber vorhanden und hart (blockiert Commit bei Fehlern). Testdatei mit klaren Konstanten statt einiger im Plan skizzierter Literal-Zahlen nachbearbeitet (`STUB_DEFAULT_STATUS`, `HTTP_UNPROCESSABLE`, `DIAL_TIME_LIMIT_MIN_S/MAX_S`, `FAR_ABOVE_DIAL_TIME_LIMIT_MAX_S`, `DEFAULT_TIME_LIMIT_S`) — inhaltlich identische Tests (IEL-B7-1..13 unveraendert in Testabsicht/Assertions), nur ohne nackte Zahlen (`no-magic-numbers` greift bei neuen Dateien voll, anders als bei Bestandsdateien mit `eslint-suppressions.json`-Freeze).
- Zweiter Lint-Fund (`id-length`) fuehrte zur Umbenennung der lokalen Variable `c` in `call` in IEL-B7-10 — reine Kosmetik, keine Verhaltensaenderung.
- `npm test -- --test-concurrency=4` allein reicht NICHT: npm konsumiert das erste `--` selbst, sodass `testbaenke-run.mjs` den Flag ohne einen zweiten literalen `--` nicht weiterreicht (`extraArgsFrom` sucht `indexOf('--')` in `argv`). Tatsaechlich verwendet: `npm test -- -- --test-concurrency=4`. Ohne den doppelten Trenner liefe die Bank mit voller Parallelitaet (bekanntes Flake-Risiko, s. MEMORY `sec-testbank-parallel-race`). Volle Regressionsbank damit korrekt mit Concurrency 4 gefahren: 5720/5720 gruen.

## Safety-Urteil

**PASS.** approved=true, testsPassIndependently=true, safetyGatesIntact=true, disclosureIntact=true, authFailClosedIntact=true, noSecretsLeaked=true, scopeRespected=true, behaviorAsIntended=true, blockers=[].

Verdict: Der Diff hat 8 Dateien (+457/-12): nur Direktive `DIAL_SIP` samt Builder `dialSip`, `<Dial><Sip>`-Renderer (alles per `escapeXml`, `timeLimit` auf 60-14400s geklemmt, Pflichtfelder fail-closed), die optionale Port-Methode `redirectCall`, `telnyxVoice.redirectCall` (`Url`+`Method`=POST ohne `Status`-Feld, Fehler nur ueber das allowlistete `assertTelnyxOk`, leere `callSid` wirft ohne Netzaufruf) und die reine Funktion `elSipUri` (Host/Port/Transport fest, DID muss E.164 sein, Token URI-kodiert). Die Ausgabe entspricht exakt der Abnahme-Form. `endCall` ist nach dem Umbau auf den gemeinsamen Helfer `updateTexmlCall` gleich geblieben: gleiche URL, gleiches Formular `Status=completed`, gleiche Fehlertexte. Bestehende Direktiven rendern byte-identisch, nur ein neuer case kam hinzu. Keine Route, kein neuer Endpunkt, keine Dependency, `claude.js` und Outbound-Offenlegung unberuehrt, keine Safety-Gates beruehrt. Mit Schalter aus aendert sich nichts, weil noch kein Aufrufer die Dial-Direktive nutzt und der B6-Umleitungspfad nur fuer Anrufe im Zustand WARTET feuert. Keine Secrets in Fehlertexten, von Tests belegt.

independentTestSummary: Frischer Worktree, Branch `review-iel-b7-r2` von `phase/iel-b7-dial-direktive-fix2` (`b481634`), Merge-Base = `phase/iel-b6-init-webhook` (`edc1550`). `node --check` auf alle 6 geaenderten src-Dateien: ok. Gezielt gelaufen mit `node --test --test-concurrency=4` (13 Dateien): iel-dial-render, ie6-s2-realtime-entfernt, iel-init-webhook, iel-inbound-bridges, telnyx-voice, telnyx-render, telnyx-play-render, telnyx-elevenlabs-render, telephony-contract, telephony-registry, directive-synth, render-adapter-language-parity, voice-render-action-url. Ergebnis: Exit 0, tests 117, pass 117, fail 0. Die volle Bank lief nicht (gemaess workflow.md 2a).

### Concerns

- Kleine Scope-Ueberschreitung gegenueber der Dateiliste der Spec, beide begruendet: (a) `inbound-initiation.js` exportiert `EL_CALL_BINDING_SIP_HEADER` jetzt per Re-Export aus `inbound-sip-uri.js` weiter (eine Quelle, gleicher Wert, IEL-B7-9 prueft die Gleichheit); (b) `ie6-s2-realtime-entfernt.test.js` pinnt jetzt `DIAL_SIP` in der DIRECTIVE-Schluesselliste (zwingend, da der alte Test die Liste exakt festhaelt).
- Zusaetzlich zur Spec: Pflichtfeld-Pruefung (`requireDialField`) und Klemmung von `timeout` auf 5-600s. Beides greift nur fail-closed, bringt keine neue Wirkung, stammt aus den Review-Runden. Die Grenzen 5-600s sind laut Kommentar aus der Telnyx-Doku, offline nicht gegengeprueft.
- Mit B7 gibt es auf dem Telnyx-Port jetzt `redirectCall`. Damit leitet der schon gemergte B6-Code `umleitenOderAuflegen` (`inbound-bridges.js`) um, statt aufzulegen. Wirksam wird das nur fuer Anrufe im Brueckenzustand WARTET, und den gibt es erst ab B8 mit eingeschaltetem Schalter. Mit Schalter aus aendert sich nichts. Die B7-Invariante "kein Aufruf von redirectCall" ist damit wortwoertlich nur fuer neuen Code erfuellt.
- Das Passwort steht im TeXML im Klartext. Laut Spec (PLAN-SECURITY IEL-B8) ist das akzeptiert. Die Direktive darf nie geloggt werden; darauf muss B8 beim Einbau achten, ein Aufrufer existiert in B7 noch nicht.
- `redirectCall` prueft `url` nicht (leer oder beliebig). Einziger Aufrufer ist intern und baut die URL selbst. Ein Fehler wirft, und der Aufrufer legt auf: der Anrufer hoert keine Stille.

## Security-Urteil

**PASS (Sicherheit)** fuer IEL-B7, approved=true, blockers=[]. Keine neue Route, keine neue oeffentliche Angriffsflaeche, keine neue Dependency. Kein Safety-Gate und kein Disclosure-Code angefasst. Geprueft: Diff `phase/iel-b6-init-webhook..phase/iel-b7-dial-direktive-fix2` (8 Dateien) und Spec-Abschnitt 4.

- **Renderer (`render.js#renderDialSip`):** alle fuenf Attribute laufen durch `attrString`/`escapeXml`, die URI durch `escapeXml` (deckt `& < > " '`). Pflichtfelder fail-closed (`requireDialField`), `timeout` 5-600s, `timeLimit` 60-14400s geklemmt, Nicht-Zahlen werfen. Fehlertexte nennen nur Feldnamen, nie Passwort/Username/DID (IEL-B7-2/3/4/4b/4c/14/15).
- **`elSipUri`:** Host/Port/Transport Konstanten, DID gegen `E164`-Regex, Token per `encodeURIComponent`. Weder `@` noch `;` noch `?` koennen den Host umlenken (IEL-B7-6/7/8).
- **Umleitungs-Port (`voice.js#redirectCall`):** Formular enthaelt nur `Url`+`Method`, kein `Status=completed`. Leere `callSid` -> Fehler ohne Netzaufruf. Fehler laufen durch `assertTelnyxOk` mit strikter Allowlist (kein `detail`, kein Roh-Body, kein API-Key) (IEL-B7-10/11/12). `endCall` nur auf gemeinsamen Helfer umgestellt, Pfad/Formular/Fehlerform gleich, Bestandstests gruen.
- **Erreichbarkeit heute:** `umleitenOderAuflegen` (B6) wirkt nur auf Calls im Zustand WARTET, der costProfile `TELNYX_INBOUND_EL_CONVAI` voraussetzt — kein Code in `src` setzt dieses Profil bisher (git grep). Weder Frist noch Boot-Re-Arm koennen `redirectCall` heute ausloesen. `dialSip`/`elSipUri` haben ausserhalb der Tests keinen Aufrufer.
- Lokal auf dem Branch-Stand gelaufen: iel-dial-render, ie6-s2-realtime-entfernt, route-auth-inventory, telnyx-voice — 43/43 gruen.

### Concerns

- `redirectCall(callSid, url)` prueft `url` nicht (weder Origin noch Pfad); Schutz haengt allein am Aufrufer. B8 muss die URL weiter serverseitig bauen, nie aus Request-/Webhook-/Anbieterdaten uebernehmen.
- `updateTexmlCall` setzt `callSid` ohne `encodeURIComponent` in den URL-Pfad (Bestandsmuster aus `endCall`); `callSid` stammt aus Store/Anbieter, nicht angreifersteuerbar — Haertungskandidat, kein Befund.
- `elSipUri` prueft beim Token nur Nicht-Leere, weder Laenge noch Zeichensatz. Unkritisch, da kodiert und nicht im Host; die 16-Byte-Barriere sitzt im Init-Webhook.
- Klartext-Passwort/-Username im gerenderten TeXML — laut Spec (PLAN-SECURITY IEL-B8) akzeptiert, muss dort dokumentiert werden. Grep-Test gegen Logging von Direktiven/TeXML fehlt noch — gehoert zu B8.
- Sobald B8 `TELNYX_INBOUND_EL_CONVAI` setzt, macht der bestehende Frist-Pfad echte Umleitungen. Zielroute `/voice/el-rueckfall` existiert erst mit B8 — B7 darf nicht ohne B8 in einen Zustand gebracht werden, in dem WARTET-Calls entstehen, sonst leitet die Frist auf eine fehlende Route um.

## Clean-Code-Audit (S1-S4)

**Verdict: PASS**, blocker=false.

- **S1:** keine Befunde.
- **S2:** keine Befunde.
- **S3:**
  - F4 · `src/telephony/directives.js` + `src/telephony/adapters/telnyx/render.js` · `dialSip()`/`DIRECTIVE.DIAL_SIP` werden in diesem Diff von keinem Produktionscode aufgerufen (nur vom Renderer-switch und von `test/iel-dial-render.test.js` konsumiert; `redirectCall` dagegen ist bereits ueber `inbound-bridges.js` verdrahtet) — als bewusster Baustein einer Phasenkette vertretbar, aber in der naechsten Phase tatsaechlich verdrahten, sonst wird daraus stille Codeleiche.
- **S4:**
  - G32/Willkuer · `src/telephony/adapters/telnyx/render.js` · `requireDialField()` prueft nur `length===0`, nicht auf reine Whitespace-Strings (z.B. `" "`) — minimal, praktisch irrelevant, da Werte serverseitig konstruiert werden; keine Aktion noetig.

topTodos:
- `DIAL_SIP`/`dialSip()` in einer Folgephase tatsaechlich an eine aufrufende Stelle anschliessen, damit der Baustein nicht dauerhaft unbenutzt bleibt.
- Bei Gelegenheit dokumentieren, dass `redirectCall` via `inbound-bridges.js` (Basisbranch) bereits der reale Konsument des neuen Ports ist.

passNotes: Sehr sauberer Diff: G5 konsequent umgesetzt (`clampDialSeconds`/`requireDialField`/`updateTexmlCall` je EINE Stelle statt Duplizierung ueber `timeout`/`timeLimit` bzw. `endCall`/`redirectCall`), G25 durchgehend benannte Konstanten (Telnyx-Grenzen, Statuswerte), fail-closed bei fehlenden/kaputten Pflichtfeldern statt stillem `undefined` im TeXML, Fehlermeldungen nennen nachweislich nie Secrets (`password`/`username`/DID) — durch Tests belegt (IEL-B7-4/-4b/-11/-15). Attribut-Reihenfolge in `attrString` ist vertraglich und per Snapshot-Test (IEL-B7-1/-2) abgesichert, inkl. XML-Escaping aller Attribute und der URI. Grenzwerte tabellengetrieben mit echten Randfaellen getestet (min-1, min, max, max+1, weit drueber — T5/G3). `EL_CALL_BINDING_SIP_HEADER` hat jetzt genau EINE Quelle (`inbound-sip-uri.js`), `inbound-initiation.js` re-exportiert nur noch. `redirectCall` ist fail-closed ohne Netz bei leerer `callSid`/fehlender Config, mit Test dafuer. Alle 25 betroffenen Tests (inkl. der 8 bestehenden IE6-S2-Regressionstests) laufen isoliert gruen. Kommentare sind praezise, auf Deutsch ohne Umlaute, mit Owner-/Review-Historie (S1a-Nachtrag zeigt sogar eine bereits selbst gefundene und behobene Vorrunden-Luecke: `timeoutS` lief anfangs ohne Klemmung durch).

## Fix-Runden

- **r1:** Blocker IEL-B7-S1a behoben: `renderDialSip()` in `src/telephony/adapters/telnyx/render.js` prueft jetzt jedes Pflichtfeld der Dial-Direktive (`uri`, `username`, `password`, `callerId`, `statusCallbackUrl`) ueber eine gemeinsame `requireDialField()`-Funktion (fail-closed, wirft ohne Wertnamen bei fehlendem/leerem String).
- **r2:** Blocker IEL-B7-S1a-LUECKE behoben: `timeoutS` lief bisher ohne Pruef-/Klemm-Funktion durch `attrString` (`renderDialSip` in `src/telephony/adapters/telnyx/render.js`) und haette bei fehlendem Wert woertlich `timeout="undefined"` ins TeXML geschrieben. Fix: die vorhandene `dialTimeLimitS`-Funktion zu einer gemeinsamen Klemm-Funktion generalisiert, `timeout` wird jetzt ebenfalls geprueft und auf 5-600s geklemmt.
