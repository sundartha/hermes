# Phase IE6-S2 — OpenAI-Realtime-Bridge (der vierte Zweig) ersatzlos entfernen

**Gate: PASS**
**finalBranch:** `phase/ie6-s2-realtime-bridge-entfernen`
**headCommit:** `13f24a8737a4487e9e29b04da9bdd3742bc7bd27`
**Basis:** `master` @ `6621039`

---

## Plan (gekuerzt)

Ziel: die OpenAI-Realtime-Bridge (`src/bridge.js`) samt `VOICE_ENGINE=realtime`, dem
MediaTransport-Port (Port 4), der Telnyx-Media-Adapter, der Stream-Direktive und allen
realtime-spezifischen i18n-/Prompt-Feldern ersatzlos entfernen — der vierte und letzte
Nicht-Budget-Voice-Zweig nach dem Telnyx-AI-Assistant (IE6-S1).

**Kern-Entscheidungen (E1-E8):**
- **E1:** `VOICE_ENGINE` wird zum festen Statuswert (`Object.freeze({ BUDGET: "budget" })`),
  aus der Umgebung nicht mehr gelesen. Anzeige-Leser (get_agent_status, Widget, Boot-Banner,
  check-setup) bleiben. Alte `VOICE_ENGINE=realtime`-Deploys booten fortan still als budget
  statt mit `exit(1)` abzulehnen — bewusst gekippter Vertrag (KV2-2-h5), begruendet: budget
  traegt alle Gates.
- **E2:** realtime-only i18n-Felder (`realtimeVoice`, `whisperLocale`, `realtimeOpener`,
  `prompt.realtimeSpeechStyle`) entfernt. `disclosureSentence`/`LOCALES.*.disclosure`
  byte-identisch.
- **E3:** `EINSAMMLER.NICHT_BELEGPFLICHTIG` bleibt (Registry-Vokabular, kein Profil vergibt
  ihn mehr nach S2 — Restbefund R-S2-4).
- **E4:** `call.streamToken`/DB-Spalte bleiben (Schema-Cutover ist eigene Entscheidung,
  Restbefund R-S2-1). Leck-Strip bleibt.
- **E5:** `ws`-Dependency bleibt (weitere Importeure: `scripts/stt-wer.mjs`,
  `spike1-ws-probe.mjs`, `spike1-b.mjs`).
- **E6:** `shouldSuppressEndCall`/`endCallWaitInstruction` bleiben exportiert (interne +
  Test-Konsumenten). Re-Export `shapeForSpeech` aus `claude.js` entfaellt — Konsumenten
  ziehen auf `speech-shape.js` um. `hatEinsammler` ohne Konsument geloescht.
- **E7:** Kostenarten-Katalog 17→16 Zeilen; **Spec-Spannung bewusst aufgeloest**: die
  Loeschschutz-Tests KV2-2-d1/d2 werden trotz "Kostenarten-Tests ohne Anpassung" angepasst,
  weil Scope Punkt 4 die Loeschung ausdruecklich anordnet.
- **E8:** `.claude/workflows/phase-impl*.js` und `.claude/refs/clean-code*.md` (nennen
  bridge.js) NICHT angefasst — laufende Workflow-Welle, Folge-Todo fuer den Lead (R-S2-3).

**Pre-Mortem (PM1-PM10):** u.a. Render-Dashboard-Wert `VOICE_TARIFF_GRUNDBETRAG_CENTS` mit
`telnyx_inbound_realtime:…` als Deploy-Vorbedingung (lesend pruefen), Altzeile mit
`costProfile="telnyx_inbound_realtime"` bleibt fail-closed unaufgeloest, kein WS-Upgrade
mehr moeglich (Node behandelt Upgrade-Request ohne Listener als normale HTTP-Antwort),
Offenlegung unveraendert (nur `realtimeOpener.outbound(disclosureSentence(...))` entfaellt,
nicht `disclosureSentence` selbst), Mid-Call-Kostendecke unveraendert (`roundStopReason`
bleibt, KV-P7-7 pinnt weiter).

**Geloeschte Dateien:** `src/bridge.js`, `src/telephony/media-events.js`,
`src/telephony/adapters/telnyx/media.js`, `scripts/telnyx-ws-echo.mjs`, sowie 6 Testdateien
(`bridge-event-unit`, `bridge-hardening`, `bridge-openai-event`, `media-transport`,
`telnyx-stream-render`, `kv2-2-realtime-riegel`) + `test/helpers/ws-openai-shim.mjs` — keine
davon trug eine Katalog-/ABNAHME-Kennung.

**Neuer Test:** `test/ie6-s2-realtime-entfernt.test.js` mit 8 Faellen (IE6-S2-1..8): Boot mit
alten Realtime-Schaltern laeuft sauber (kein Secret geloggt), In-/Outbound-TeXML
byte-identisch zu einem Server ohne die Schalter, kein WS-Upgrade auf `/media/telnyx`,
Boot-Re-Arm ohne Engine-Sonderfall, Render wirft fail-closed auf unbekannte
`stream`-Direktive, Altzeile `telnyx_inbound_realtime` bleibt unaufgeloest/fail-safe,
Config/Registry kennen die Realtime-Felder nicht mehr.

**Deterministische Pruefungen (Abschnitt 6 des Plans):** Abnahme-Grep (nur ein
Falsch-Treffer erwartet: `src/ui/widgets/call.html` via "widget-bridge.js"),
Konsumenten-Grep je Funktion, `ws`-Begruendung, `node --check` je geaenderter Datei,
volle Testbaenke, Boot-Smoke inkl. WS-Upgrade-Versuch.

---

## Impl-Zusammenfassung

- 39 Dateien editiert (config.js, boot-guard.js, boot.js, telephony/* [voice-render,
  call-lifecycle, call-finish, call-termination, directives, ports, registry,
  adapters/telnyx/render+speak-events, leg-turn-loop], research/consult in-call + registry,
  claude.js, billing/* [kostenarten, sweep-kostenbeleg, cost-calibration, kosten-deckung],
  i18n/* [locales, mcp-texts, prompts de/en/fr], call-duration.js, server.js,
  store/state-ops.js, store/views.js, scripts/check-setup.js,
  scripts/deepseek-b1-messung.mjs, scripts/convo-bench/runner.mjs, knip.json,
  .env.example, render.yaml, CLAUDE.md, README.md, ONBOARDING.md, PLAN-SECURITY.md,
  eslint-suppressions.json, eslint-legacy-exceptions.json).
- 8 Dateien geloescht (s.o.), 1 neue Testdatei erstellt.
- 33+ Bestandstestdateien angepasst (Parameter-/Zeilen-Entfernung ohne neue Erwartung, u.a.
  kv-p7-latent-paths, ie3-inbound-el-kostenprofil, kv2-2-kostenarten-katalog,
  kv2-2-kostenprofil-weichen, helpers/inbound-router-harness, ie6-s1-katalog-umzug,
  inbound-disclosure-mandatory, media-token [stark gekuerzt], voice-render-action-url,
  route-auth-inventory, telephony-registry, telnyx-p6-cap-callcontrol, ie2-geld-wache,
  ie4-wiederholung-uebergebenes-leg, kv2-5-telnyx-sip-beleg, kv2-6-deckung-herzschlag,
  al-p10b-lookup, al-p14-in-call-consult, b3b-request-neutrality, boot-failclosed,
  f1-i18n-locale, de-umlaut-orthography, p11-agent-language-contract, shape-for-speech,
  config-namespaces, claude-turn-guard, call-duration, l3-prompt-caching, claude-identity,
  callee-is-owner-opening, inbound-routing, helpers.js BASE_ENV,
  scripts-config-namespace, check-staged-suppressions LEGACY_FINGERPRINT).
- Kostenarten-Katalog 17→16 Zeilen, Kostenprofile 5→4, Boot-Guard latente Kosten-Befunde
  4→2 (`PLAY_TTS_UNPRICED`, `EL_INBOUND_CARRIER_UNCOLLECTED`).
- Testergebnis: 5532 pass / 4 fail im Concurrency-4-Lauf der Impl-Session — die 4 Fails
  waren bekannte, konkurrenzbedingte Flakes (AL-P10-1, EL-START T1/T2), isoliert (ohne
  Nebenlast) gruen verifiziert, nicht durch die Phase verursacht. Die unabhaengige
  Safety-Review lief dieselbe Suite frisch: 5543/5543 (bzw. bereinigt 5523/5523) gruen,
  0 Fail.
- `node --check` und `npm run lint`: 0 Fehler.
- Boot-Smoke bestanden: Banner "Voice-Engine: budget", `/healthz` 200, WS-Upgrade auf
  `/media/telnyx` → 404 (kein 101), auch mit `VOICE_ENGINE=realtime` gesetzt bootet
  identisch.

### Deviations (aus IMPL, wortgetreu)

1. `config.js`-VOICE_ENGINE-Kommentar/rawConfig exakt nach Plan geaendert (keine echte
   Abweichung, nur zur Vollstaendigkeit genannt).
2. **Plan-Luecke gefunden und behoben:** `test/al-p14-in-call-consult.test.js` nutzte
   `claude.shapeForSpeech` — nach Entfernen des Re-Exports schlug AL-P14-8 fehl. Fix:
   eigener `speech-shape.js`-Import ergaenzt, Testkoerper umgestellt (2 Fundstellen).
3. **Plan-Luecke gefunden und behoben:** `test/scripts-config-namespace.test.js` listete
   `scripts/telnyx-ws-echo.mjs` zum Einlesen von der Platte — nach dessen Loeschung waere
   der Test mit `ENOENT` gebrochen. Fix: Eintrag aus der SCRIPTS-Liste entfernt.
4. `CLAUDE.md`-Bullet zu `src/telephony/` (nennt weiterhin `media-events.js` und den
   Adapter `media` in der Aufzaehlung) bewusst NICHT angepasst — der Plan nannte fuer
   CLAUDE.md nur vier explizite Saetze/Bullets zur Aenderung, diese Zeile war keiner davon.
   Plan-treu belassen statt eigenmaechtig erweitert, obwohl sie jetzt nicht mehr
   existierende Dateien nennt (im Safety-Urteil als Concern aufgegriffen).
5. `eslint-legacy-exceptions.json`/`LEGACY_FINGERPRINT`: vier neue Eintraege
   (check-setup.js, al-p10b-lookup.test.js, boot-failclosed.test.js, media-token.test.js)
   ergaenzt — vom Plan als "aufraeumen ODER Legacy-Eintrag anlegen" offen gelassen, hier
   per Praezedenz IE6-S1 ("reine Loeschung verschiebt Meldungstext") als Legacy-Eintrag
   geloest, ohne Owner-Rueckfrage (gleiche Entscheidungsklasse wie der IE6-S1-Praezedenzfall).
6. Zwei bekannte, konkurrenzbedingte Suite-Flakes (AL-P10-1, EL-START T1/T2) traten im
   Concurrency-4-Lauf auf; beide isoliert gruen und damit als Bestandsflakes verifiziert
   (Lehre `suite-flake-p5-gate-proof-spawn-race.md`), nicht durch diese Phase verursacht.

---

## Safety-Urteil

**verdict: PASS** — `approved: true`, alle Kern-Flags gruen (`testsPassIndependently`,
`safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`,
`scopeRespected`, `behaviorAsIntended`), **keine Blocker**.

Unabhaengige Verifikation: frischer Worktree, Branch `review-ie6-s2` (=
`phase/ie6-s2-realtime-bridge-entfernen`, `13f24a8`, direkt auf `master` `6621039`
aufsetzend). `npm test -- --test-concurrency=4` exit 0: roh 5543/5543 pass, nach
Wrapper-Korrektur (20 Datei-Wrapper abgezogen) 5523/5523, 0 fail, 0 skip, 0 cancelled.
Die 8 neuen IE6-S2-1..8-Faelle bestehen. Server bootet in den Spawn-Tests, `/healthz` 200.
Der Abnahme-Grep traf nur Falsch-Positive (`widget-bridge.js` in
`src/ui/widgets/call.html`, der Begruendungstext in `check-staged-suppressions.test.js`).
Unberuehrt: `src/route-policy.js`, `test/security.test.js`,
`test/abnahme-ausgewandert.json`, `package.json`/`package-lock.json`. `claude.js`-Diff:
nur Kommentare plus Wegfall des `export { shapeForSpeech }`-Re-Exports (beide Konsumenten
importieren jetzt `src/speech-shape.js`); `disclosureSentence` byte-identisch.
Gate-Pruefung: in `voice.js` nur die realtime-Fruehausstiege in `/voice/incoming` und
`/voice/outbound` entfernt, Signatur, Idempotenz-Riegel, Tenant-Aufloesung, Kostendecke
und Offenlegungsreihenfolge im Budget-Pfad unveraendert. `api-calls.js` armiert
`armMaxDurationTimer` jetzt unbedingt (STRENGER). `rearmActiveCallTimers` verliert den
realtime-Fruehausstieg (STRENGER). Die fatalen Boot-Guards `REALTIME_*` verschwinden
zusammen mit dem Pfad, den sie schuetzten (Pfad nicht mehr erreichbar, `VOICE_ENGINE`
wird nicht gelesen). Kein Katalog- oder ABNAHME-Test geloescht. Entfernte Tests gehoeren
ausschliesslich zum entfernten Zweig.

### Concerns (nicht blockierend)

1. `README.md`: die verbliebene Engine-Tabelle traegt noch die Spaltenueberschrift
   `VOICE_ENGINE=budget` (Default), obwohl die Env-Variable nicht mehr gelesen wird
   (`config.voice.voiceEngine` ist fest `budget`). Reine Doku-Ungenauigkeit, kein
   Verhaltenswechsel.
2. `CLAUDE.md`-Architektur-Zeile nennt weiterhin `directives.js`/`media-events.js` und den
   Telnyx-Adapter `media`, beide Dateien sind aber geloescht. Plan-Punkt 7 verlangte
   die betroffenen Saetze zu aktualisieren, dieser wurde uebersehen (deckt sich mit
   Deviation 4 oben).
3. Das Alt-Kostenprofil `telnyx_inbound_realtime` faellt jetzt auf den Fail-Safe-Default
   `legRunsOurTurnLoop=true` zurueck (vorher `false`). IE6-S2-7 pinnt das. Harmlos, weil
   der Realtime-Pfad nie live lief, aber ein alter Datensatz mit diesem Profil bekaeme
   jetzt die Turn-Loop-Wiederholungsantwort auf `/voice/incoming`.
4. `eslint-legacy-exceptions.json` bekommt vier neue Datei-Eintraege (check-setup.js,
   al-p10b-lookup/boot-failclosed/media-token-Tests). Jede zugehoerige Zaehlung in
   `eslint-suppressions.json` sinkt nur, also reine Fingerprint-Buchhaltung ohne neue
   Schuld (gleiches Muster wie IE6-S1). Dennoch ein neuer Eintrag in der Ausnahmeliste.
5. `ws` bleibt in `package.json` — korrekt, weil `scripts/stt-wer.mjs`,
   `spike1-ws-probe.mjs` und `spike1-b.mjs` es weiter importieren. Keine
   Dependency-Aenderung.
6. Der Render-Dashboard-Env haelt vermutlich weiter `VOICE_ENGINE`/`OPENAI_*`. Diese
   Werte werden jetzt ignoriert (R-S2-2 in PLAN-SECURITY.md). Test IE6-S2-1 bestaetigt,
   dass der Key nicht geloggt wird.

---

## Clean-Code-Audit (S1-S4)

**verdict: PASS**, `blocker: false`.

- **S1 (Blocker):** keine Befunde.
- **S2 (Blocker):** keine Befunde.
- **S3:** keine Befunde.
- **S4 (kosmetisch):** ein Befund —
  - G11/G24, `scripts/check-setup.js`: der entfernte Abschnitt "OpenAI (nur bei
    realtime)" riss eine Luecke in die Abschnittsnummerierung (Abschnitt 4 "Oeffentlicher
    Tunnel" folgt jetzt direkt auf Abschnitt 2). Optional: Folgeabschnitte umnummerieren
    oder Nummern entfernen; rein kosmetisch, keine Funktionsauswirkung.

**Begruendung (Auszug):** Sauberer, disziplinierter Ausbau der OpenAI-Realtime-Bridge ueber
alle Schichten (config, boot-guard/boot, telephony/ports+registry+directives+render,
claude.js/consult/research, routes/voice+api-calls, i18n, billing/kostenarten). Kein
Rest-Import, kein toter Code, kein gebrochener Re-Export (`shapeForSpeech` sauber auf
`src/speech-shape.js` umgezogen, alle Aufrufer inkl. Tests mitgezogen). PLAN-SECURITY.md
dokumentiert Angriffsflaeche/Restrisiko korrekt. Neuer Testfile deckt genau die
Grenzfaelle ab, die bei so einer Entfernung brechen koennten. Volle Testsuite auf dem
Phasen-Branch gruen: 5543/5543 (bereinigt 5523/5523), lokal unabhaengig verifiziert.
Sicherheitsgates (Ed25519-Signatur, Offenlegung, Kostendecke, Max-Dauer) unberuehrt und in
PLAN-SECURITY.md so festgehalten.

**topTodos:** Keine Blocker. Optional: Abschnittsnummerierung in `scripts/check-setup.js`
nach der geloeschten Sektion begradigen (S4, kosmetisch).

---

## Fix-Runden

Keine — der erste Impl-/Review-Durchlauf erreichte direkt PASS in Safety und Clean-Code
ohne Blocker-Befunde. Es wurden 0 Fix-Runden benoetigt.

---

## Restbefunde (bewusst nicht in diesem Commit, aus dem Plan uebernommen)

- **R-S2-1:** `call.streamToken`/`stream_token TEXT NOT NULL` wird weiter erzeugt, aber
  nicht mehr geprueft. Entfernen ist ein Schema-Cutover, eigene Entscheidung.
- **R-S2-2:** Render-Dashboard-Werte `VOICE_ENGINE`, `OPENAI_API_KEY`, `REALTIME_MODEL`,
  `REALTIME_VOICE` bleiben stehen und sind wirkungslos. `OPENAI_API_KEY` beim Anbieter
  rotieren oder loeschen, falls gesetzt. **Deploy-Vorbedingung:** Live-Wert von
  `VOICE_TARIFF_GRUNDBETRAG_CENTS` lesend pruefen — darf `telnyx_inbound_realtime` nicht
  enthalten.
- **R-S2-3:** `.claude/workflows/phase-impl*.js` und `.claude/refs/clean-code*.md` nennen
  `bridge.js` noch. Erst nach der laufenden Workflow-Welle nachziehen.
- **R-S2-4:** `EINSAMMLER.NICHT_BELEGPFLICHTIG` bleibt Vokabular ohne vergebenes Profil;
  der Filter ist ohne realen Fall ungetestet.
- **R-S2-5:** `docs/architektur/02-telephony.dot` (untracked) zeigt noch
  `adapters/telnyx/media`.
- **Neu aus dem Safety-Urteil:** README.md-Tabellenkopf und CLAUDE.md-Telephony-Zeile
  nennen noch entfernte Bestandteile (siehe Concerns 1+2) — reine Doku-Nacharbeit.
