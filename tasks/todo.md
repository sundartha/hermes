# Track A — STT-Modellwahl: vier Orte, eine Entscheidung

Auftrag aus `tasks/kickoff-anbieter-austauschbarkeit-2026-08-07.md`, Track A.
Regel: nur Gemessenes; jede Aussage traegt einen Beleg oder ist als **unbelegt** markiert.

Der Vorgaenger-Auftrag (B-7, Kauderwelsch) ist erledigt und live abgenommen; sein Stand liegt
in `tasks/gq-chain-state.md`, Abschnitt "B-7". Track B/C (LLM-Anbieter-Port, Twilio-Ausbau)
sind **nicht** Teil dieser Datei — sie brauchen laut Kickoff zuerst ein gemeinsames
Plandokument (`PLAN-ANBIETER-PORT.md`), das dem Owner vorgelegt wird, bevor Code entsteht.

## Schritt 1 — Die offene Frage belegen. **ERLEDIGT, mit Ueberraschung**

**Erwartetes Ergebnis (vorab formuliert):** Anbieter-Doku/OpenAPI beantwortet, ob der
Pro-Call-`transcription`-Block die Konfiguration des Assistant-Objekts ersetzt oder
zusammenfuehrt — und damit, ob der Fix "die gueltigen Einstellungen mitfuehren" moeglich ist.

**Verifikationsmethode:** OpenAPI-Spezifikation von Telnyx abrufen und die beiden Schemata
gegenueberstellen; zusaetzlich Live-GETs gegen die Assistant- und Konversations-API.

**Ergebnis, gemessen** (Quelle `team-telnyx/openapi`, `spec3.json`, openapi 3.1.0):

| | Assistant-Objekt (`Assistant.transcription`) | Pro Call (`AIAssistantStartRequest.transcription`) |
|---|---|---|
| Schema | `TranscriptionSettings` | `TranscriptionConfig` |
| Felder | `model, language, api_key_ref, region, settings` | **nur `model, language`** |
| Modell-Enum | 12 Werte | 17 Werte |

**Der Pro-Call-Block kann `settings` gar nicht tragen.** Der im Kickoff erwogene Fix
("der Pro-Call-Block muss die gueltigen Einstellungen mitfuehren") ist an dieser API-Version
**strukturell unmoeglich** — unabhaengig davon, ob ersetzt oder gemerged wird.

**Ersetzen vs. zusammenfuehren bleibt OFFEN.** Die Doku sagt dazu nichts; der einzige
dokumentierte Fallback-Satz ("assistant's stored configuration will be used as fallback for
any omitted fields") steht ausdruecklich am `assistant`-Unterobjekt, NICHT am gleichrangigen
`transcription`. Entscheidbar bleibt sie — s. Schritt 7.

## Schritt 2 — Kontrolle und Gegenerklaerungen. **ERLEDIGT**

**Erwartetes Ergebnis:** die Beobachtung "erkannter Text kleingeschrieben, ohne Satzzeichen"
ist entweder echte STT-Ausgabe oder ein Darstellungsartefakt.

**Verifikationsmethode:** dieselbe Konversation, beide Rollen. Der Agentenkanal ist die
Kontrolle — dort kennen wir die Wahrheit (derselbe Kunstgriff wie bei der WER-Messung).

**Ergebnis, gemessen** (Konversation `93eab7b6-…`, 2026-08-06T11:51:27Z, Assistant-Version
`20260806T113555798821`):

- `role:user` (STT): *"ja genau und darum geht es ja dass du dass ich hier teste …"*
- `role:assistant` (unser Text): *"Ah, verstanden - du möchtest testen, ob ich die
  lookup-Funktion richtig nutze."*

Gross-/Kleinschreibung und Satzzeichen ueberleben die API. **Die Beobachtung ist echt.**
(Feldname ist `text`, nicht `content` — ein `m.content`-Zugriff liefert still Leerstring.)

| Gegenerklaerung | Urteil |
|---|---|
| Die Nachrichten-API normalisiert Text | **widerlegt** (Kontrolle oben) |
| Wir normalisieren im Repo | **widerlegt** — einziges `toLowerCase` auf Transkripttext ist `comparableWords` (`src/utils/text.js:42-49`), reiner Zitatvergleich, veraendert kein gespeichertes Transkript |
| `smart_format` war am Assistant-Objekt nie `true` | **widerlegt durch Live-Messung**, s. u. |

**Live-Messung der Assistant-Versionen** (`GET /v2/ai/assistants/<id>/versions/<ver>`):

| Version | model | language | settings.smart_format |
|---|---|---|---|
| 20260722T084506642573 | deepgram/flux | multi | null |
| 20260804T161002024484 | deepgram/flux | de | null |
| 20260806T074913520989 | deepgram/flux | de | null |
| **20260806T113555798821** | **deepgram/nova-3** | de | **true** |

`smart_format: true` galt bei genau den Anrufen, deren Transkript roh ankam. Die Kickoff-
Praemisse stimmt — sie war bis zu dieser Messung nur unbelegt. Nebenbefund: es gibt **keinen**
historischen Gegenversuch, denn `smart_format` wurde erst mit dem nova-3-Patch gesetzt.

**Was NICHT widerlegt ist und offen bleibt:** ob `smart_format` bei `deepgram/nova-3` auf
deutschem Telefon-Audio ueberhaupt wirkt. Solange das offen ist, ist "der Pro-Call-Block
ersetzt alles" die wahrscheinlichere, aber **nicht** die einzige Erklaerung.

## Schritt 3 — Tote Messung, festgehalten damit sie niemand wiederholt

`POST /v2/calls/<ungueltige-ccid>/actions/start_ai_assistant` mit (a) nur `model`+`language`,
(b) zusaetzlich `settings.smart_format`, (c) einem frei erfundenen Unsinnsfeld liefert
**dreimal identisch HTTP 404 / code 10005**. Telnyx prueft die Ressource **vor** dem Body.
Eine Schema-Validierung ohne aktiven Anruf ist ueber diesen Weg nicht zu bekommen.

## Schritt 4 — Kopplung Modell <-> Einstellung, aus der Spezifikation. **ERLEDIGT**

Quelle: `TranscriptionSettingsConfig`, Feld-Beschreibungen "Available only for …".

| Einstellung | gilt fuer |
|---|---|
| `eot_threshold`, `eot_timeout_ms`, `eager_eot_threshold` | `deepgram/flux` |
| `keyterm` | `deepgram/nova-3` **und** `deepgram/flux` |
| `end_of_turn_confidence_threshold`, `min_turn_silence`, `max_turn_silence` | `assemblyai/universal-streaming` |
| `interim_results`, `enable_endpoint_detection`, `max_endpoint_delay_ms` | `soniox/stt-rt-v4` |
| `smart_format`, `numerals` | **keine Einschraenkung in der Spec** |

Zwei Korrekturen an der Kickoff-Tabelle:

1. Kickoff und `tasks/gq-chain-state.md` (H3) behaupten, `smart_format`/`numerals` gelten
   "Deepgram **ausser** flux". **Die Spec sagt dazu nichts.** Die Einschraenkung steht nur auf
   der Doku-SEITE, und dort als Aussage ueber das **Portal** ("the Portal exposes these
   settings and enables both by default when you select the model") — also ueber die
   Bedienoberflaeche, nicht ueber die API-Semantik.
2. Die drei `soniox`-Felder fehlen im Kickoff. Sie stehen als `null` in unserer Live-Config.

**Konkreter Befund aus der Live-Config:** das Assistant-Objekt traegt `eot_threshold: 0.9` und
`eot_timeout_ms: 5000` — laut Spec **flux-only** — an einem `nova-3`-Objekt. Konfiguration,
die aussieht wie eine Entscheidung und keine Wirkung hat. **Kein Repo-Test kann das je sehen.**

Zusaetzlich gefunden: `GET /v2/speech-to-text/providers` ist eine **live abrufbare** Inventur
(18 Modelle mit `service_types` und Sprachlisten, u. a. `ai_assistant` und `in_call`). Sie
weicht an zwei Stellen von der OpenAPI ab — `nvidia/parakeet-v3` steht im Assistant-Enum der
Spec, hat live aber **keinen** `ai_assistant`-Diensttyp; `speechmatics/standard` hat ihn live,
fehlt aber im Assistant-Enum der Spec. Anbieter-Aussage gegen Anbieter-Verhalten, zum dritten
Mal in dieser Kette.

## Schritt 5 — Inventur gegengeprueft. **ERLEDIGT**

| Ort | Wert | Urteil |
|---|---|---|
| `src/telephony/adapters/telnyx/voice.js:241` (`STT_MODEL`, Assistant-Pfad) | `deepgram/nova-3` | bestaetigt |
| `src/telephony/adapters/telnyx/render.js:119-120` (TeXML-Gather) | `Deepgram` + `deepgram/nova-3` | bestaetigt |
| `src/telephony/adapters/twilio/render.js:40` (Twilio-Gather) | `deepgram_nova-2-general` | bestaetigt |
| Telnyx-Assistant-Objekt (`transcription`) | `deepgram/nova-3` | bestaetigt (Live-GET) |

**Korrekturen an der Kickoff-Fassung:**

- *"Kein einziger STT-Wert steht in `src/config.js`"* ist zu pauschal: `sttSpeechTimeoutSec`
  / `STT_SPEECH_TIMEOUT_SEC` steht dort (`config.js:1231`, `.env.example`). Praezise ist:
  **kein STT-MODELL-Wert**.
- **Keine fuenfte Fundstelle.** `scripts/telnyx-assistant-provision.mjs:141` fuehrt
  `transcription` in `PRESERVED_SAFETY_FIELDS` und sendet es **nie** — mit "vorher == nachher"-
  Guard. Der Provisionierer ist kein Drift-Erzeuger; das Assistant-Objekt wird ausschliesslich
  von Hand gepflegt. Genau deshalb ist es der Ort ohne jedes Netz.
- `src/bridge.js:197` setzt `model: "whisper-1"` — anderer Hersteller (OpenAI), andere Engine
  (`VOICE_ENGINE=realtime`, nicht der Live-Default), **eine** Fundstelle. Keine Duplizierung,
  **ausdruecklich nicht** Teil dieser Phase.

## Schritt 6 — Die Phase. **GEMERGT auf master (`2b3f741`), NICHT deployt**

Umgesetzt ueber `phase-impl-lean` (Spec und Report sind nach dem Merge geraeumt, s. Historie).

**Was steht:** `src/telephony/stt-profile.js` (neutrales Enum, heute ein Mitglied),
`src/telephony/adapters/telnyx/stt-model.js` (EINE Telnyx-Tabelle, von Gather UND Assistant
genutzt), Twilio-Tabelle in dessen `render.js`, `config.voice.sttProfile` als EINZIGER
Schluessel, lazy von der Registry injiziert, Boot-Guard gegen ungueltige Werte,
`scripts/telnyx-stt-drift.mjs` fuer den vierten Ort.

**Ergebnis der Abnahme durch den Lead (nicht nur durch das Gate):**

| Prüfung | Ergebnis |
|---|---|
| `npm test` | **4057/4057 gruen**, Exit 0 (drei eigene Volllaeufe; ein vierter hatte einen Flake — bekanntes ~12 %-Volllast-Muster, isoliert gruen) |
| Verhaltens-Erhaltung | **keine** Snapshot-Testdatei angefasst; Smoke-Test rendert beide Pfade byte-gleich, Attributreihenfolge unveraendert |
| Gegenprobe Zusicherung A | fail-closed entfernt -> **rot**; Durchreichen gekappt -> **rot**. Echter Verhaltens-Beleg |
| Gegenprobe Zusicherung B | in **beiden** Sabotagen gruen -> als Fangnetz umbenannt (`dc84238`), nicht als Beleg |
| Clean-Code-Audit | keine S1, keine S2 |
| Safety-Review | approved, Gates unberuehrt |
| Drift-Probe scharf gelaufen | **2 Befunde**, Exit 0 |

**Ein Defekt, den erst das scharfe Ausfuehren gefunden hat** (`e56b304`): die Probe las
`Object.keys(transcription)` statt `transcription.settings` — die Einstellungen liegen eine
Ebene tiefer. Sie konnte damit **nie** eine inerte Einstellung finden und endete stumm mit
Exit 0, was wie "alles in Ordnung" aussah. Der Test war blind, weil seine Fixtures dieselbe
falsche Verschachtelung benutzten wie der Code. Beides gefixt, Lehre in `tasks/lessons.md`.

**Was die Probe jetzt live meldet:**

```
[telnyx-stt-drift] geprueft: transcription.model='deepgram/nova-3' gegen Profil 'accurate' -> 2 Befund(e)
[telnyx-stt-drift] info: 'eot_threshold'=0.9 ist fuer Modell 'deepgram/nova-3' inert (gilt laut Spec nur fuer: deepgram/flux)
[telnyx-stt-drift] info: 'eot_timeout_ms'=5000 ist fuer Modell 'deepgram/nova-3' inert (gilt laut Spec nur fuer: deepgram/flux)
```

**Offen: Deploy + Abnahme-Anruf.** Render deployt `upstream/master` mit `autoDeploy: no`;
live laeuft weiter `b073e8d`. Erwartung nach dem Deploy: `node scripts/stt-wer.mjs
<call_session_id>` **unveraendert** gegenueber 8,9 % (`call_mshgg6ijtyul`), Eigenrauschen
~±1,5 Punkte — die Phase aendert keinen gesendeten Wert. Eine Verschlechterung waere ein
Defekt, keine Messschwankung.

**Abweichung vom Kickoff, bewusst und begruendet:** Kickoff-Punkt 3 ("die Kopplung Modell <->
gueltige Einstellungen an einer Stelle abbilden, ihr Bruch macht einen Test rot") ist als
Produktionstabelle **nicht baubar** — kein Code im Repo sendet je eine dieser Einstellungen
(gegruept ueber `src/` und `scripts/`), und der Pro-Call-Block kann sie nicht tragen. Eine
Tabelle ohne Aufrufer waere Vorratshaltung (Clean Code P15). Die Absicht dahinter bleibt und
bekommt einen echten Aufrufer: die **Drift-Probe** liest die Kopplung und meldet inerte
Einstellungen am Live-Objekt.

**Erwartetes Ergebnis, deterministisch:**

1. `npm test` gruen, und die gerenderten TeXML-/TwiML-Bytes sind **unveraendert** — die Phase
   ist verhaltens-erhaltend by construction (dieselben Strings, eine Quelle).
2. Ein neuer Test ist **ohne** den Fix rot: eine unbekannte STT-Wahl, in die Adapter injiziert,
   muss werfen (`assert.throws`). Heute ignorieren beide Renderer jede solche Angabe und
   rendern klaglos weiter — das ist ein Verhaltens-Rot, kein "Modul fehlt noch"-Rot.
3. Ein Test iteriert ueber **alle** Mitglieder des neutralen Enums und laesst jeden Adapter
   jedes Mitglied aufloesen. Ein neues Enum-Mitglied ohne Adapter-Uebersetzung macht ihn rot.
4. Boot mit ungueltigem `STT_PROFILE` bricht ab (Spawn-Test), Boot mit gueltigem kommt hoch.
5. `node scripts/telnyx-stt-drift.mjs` meldet Abweichungen zwischen konfigurierter Wahl und
   Live-Assistant-Objekt und endet dann mit Exit != 0.

**Verifikationsmethode:** `npm test`; Gegenprobe (Fix ausbauen -> Test rot -> Fix zurueck);
`node --check`; lokaler Smoke-Test (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` +
`curl /healthz` + betroffene `/voice`-Routen); der Drift-Probe-Lauf gegen die echte API.

**Abnahme mit Zahl (nach Deploy, braucht einen Testanruf des Owners):**
`node scripts/stt-wer.mjs <call_session_id>`. Vorher-Wert **8,9 %** (`call_mshgg6ijtyul`,
2026-08-06), Eigenrauschen ~±1,5 Punkte. Erwartung: **unveraendert** — die Phase aendert keinen
gesendeten Wert. Eine Verschlechterung waere ein Defekt, keine Messschwankung.

## Schritt 7 — Das Experiment fuer den naechsten Testanruf. **OFFEN, nicht Teil der Phase**

"Ersetzt der Pro-Call-Block oder wird gemerged" ist mit **einem** Anruf entscheidbar: den Anruf
einmal **ohne** den Pro-Call-`transcription`-Block fuehren (der Code tut das heute schon, wenn
die Sprache nicht aufloesbar ist — `voice.js:349`). Kommt das Transkript dann mit Satzzeichen
und Gross-/Kleinschreibung, greifen die Einstellungen des Assistant-Objekts, und der
Pro-Call-Block **ersetzt** sie. Kommt es weiter roh, wirkt `smart_format` bei `nova-3` nicht —
dann liegt die Ursache beim Anbieter, nicht bei uns.

**Der Preis, ausdruecklich:** ohne den Block faellt `TranscriptionConfig.model` auf den
Spec-Default `distil-whisper/distil-large-v2` (**englisch-only**). Der Versuchsanruf wird also
mit hoher Wahrscheinlichkeit schlecht erkannt — das ist erwartet und **kein** Fehlschlag;
gemessen wird nur die FORMATIERUNG, nicht die Erkennungsgenauigkeit.

## Offen / geparkt

| Punkt | Stand |
|---|---|
| `smart_format`/`numerals` sind vom Pro-Call-Pfad aus **unerreichbar** | belegt; kein Fix in dieser Phase moeglich, s. Schritt 7 |
| `keyterm` (laut Spec gueltig fuer nova-3) ist ungenutzt | ungenutzter Hebel, nicht Teil dieser Phase |
| `eot_threshold`/`eot_timeout_ms` stehen inert an einem nova-3-Objekt | die Drift-Probe macht es sichtbar |
| ~70 verwaiste Worktrees unter `.claude/worktrees/` | Altlast abgebrochener Laeufe, ausserhalb dieses Auftrags |

## Nicht vergessen

- Aufnahmen liegen NUR im Scratchpad, nie im Repo, nach Gebrauch loeschen (Absolute Regel 5).
- Eine Messung gilt nur fuer die Konfiguration, in der sie erhoben wurde.
- Ein gruener Test ist erst ein Beleg, wenn er OHNE den Fix rot ist.

---

# Track C — Restarbeit nach Session-Abbruch 2026-08-07 (Lead: Session 2bd10950)

Rekonstruiert: Session 8ec76d98 baute C-P4 DIREKT im Working-Tree (scope-bereinigt,
2x npm test 4025/4025 Exit 0), starb aber VOR Commit/Review/Report an einem API-Fehler.

## C-P4a — Stand sichern. ERLEDIGT
- Erwartet: Working-Tree committet auf `phase/c-p4-adapter-raus`, nur src/+test/.
- Verifikation: `git log --oneline master..phase/c-p4-adapter-raus` zeigt genau 310c78a;
  `git status` sauber (bis auf neue Prozessdateien). BEOBACHTET: 90 Dateien, +489/-1013.

## C-P4b — Nachgelagerter dualer Review. LAEUFT (Workflow wf_ff179540-31e)
- Skript: `.claude/workflows/runs/c-p4-review.js` (Review-only-Derivat von phase-impl-lean:
  Safety=opus/high + Clean-Code=sonnet, Self-Fix max 2 Runden, Report sonnet).
- Erwartet: gate=PASS, registryInvariantUntouched=true, gegenprobeDone=true,
  unabhaengige Testzahl genannt; Report in `tasks/c-p4-report.md` inkl. Behandlungs-Tabelle.
- Verifikation Lead (VOR Merge, Pflicht): `git log master..<finalBranch>` +
  `git diff master...<finalBranch> --stat` selbst ansehen (Lehre C-P2: PASS != Merge-Freigabe).

## C-P4c — Merge auf lokalen master. OFFEN (nach PASS)
- Erwartet: Merge-Commit auf master, KEIN Push auf upstream (Deploy wartet auf Track-A-Abnahmeanruf,
  Begruendung: Messisolation — s. Uebergabe/Session 8ec76d98).
- Verifikation: `npm test` auf master gruen; Zahl im Merge-Umfeld notiert.

## C-P5a — Spezifikation. ERLEDIGT (tasks/c-p5-spec.md, 429 Zeilen)
- BEOBACHTET: 685 twilio-Treffer, alle klassifiziert (197 C-P5 / 268 bleiben bewusst /
  220 -> neue Phase C-P6 Kommentar-Nachlese). Abnahme enthaelt den Boot-Smoke OHNE
  TWILIO_*-Env (Punkt 4, leer GESETZT wegen dotenv) + Uebergangszustand MIT Keys (Punkt 5).
- Spec korrigiert die Uebergabe am Bestand: check-setup.js/set-webhooks.js/START-DEMO.command
  + npm-Dependency `twilio` MUESSEN in C-P5 (Config-Proxy-Guard wirft sonst TypeError,
  test/check-setup-script.test.js wird rot). Phasen-Schnitt neu: C-P6=Kommentar-Nachlese,
  C-P7=Abnahme mit echtem Anruf.
- Nebenbefund umgesetzt: veraltete "Twilio-Signaturpruefung"-Zeile (Falsch-Blocker-Quelle)
  aus phase-impl-lean.js/phase-impl.js/runs/c-p5.js entfernt (Telnyx Ed25519 + Verweis auf
  Owner-Entscheidung C-P3). Uncommittet bis nach der Welle.

## C-P5b — Umsetzung via phase-impl-lean. OFFEN (nach C-P4c + Spec)
- HIGH_STAKES=true (Boot-Pflicht = Live-Dienst-Risiko): Impl auf opus, Safety xhigh.
- Erwartet: Server bootet lokal OHNE TWILIO_*-Env; npm test gruen; BASE_ENV ohne Twilio-Keys.
- Verifikation: Abnahme-Abschnitt der Spec, ausgefuehrt vom Reviewer + Lead-Stichprobe.

## C-P4c — Merge auf lokalen master. ERLEDIGT (eccbafd + Doku 9ddf1df)
- BEOBACHTET: Review-Gate PASS (1 Fix-Runde: Betreiber-Skripte lasen PROVIDER.TWILIO=undefined,
  Filter still abgeschaltet - gefixt + Regressionstest); eigener Volllauf auf master
  danach 4026/4026, Exit 0 (deckungsgleich mit unabhaengiger Reviewer-Messung).

## C-P5b — Umsetzung. ERLEDIGT (gemergt 90db553, Impl 6f871eb)
- BEOBACHTET: Gate PASS ohne Fix-Runde (wf_1db9f4b1-6c9); 50 Dateien, +267/-719;
  Boot-Pflicht gefallen, npm-Dependency twilio raus (Lock regeneriert),
  set-webhooks.js -> set-public-url.js, BASE_ENV im selben Commit (Drift-Falle vermieden).
- Lead-Stichprobe: Boot OHNE TWILIO_*-Env -> /healthz 200 nach 2 s; einziger
  Twilio-Treffer im Log ist die SKIP_TWILIO_SIGNATURE_CHECK-Warnung (bleibt bewusst).
  Achtung Messmethode: erster Versuch scheiterte an fehlendem COST_TRUING_REQUIRED_RECORD_TYPES
  in der lokalen .env (vorbestehend, KEIN C-P5-Defekt; gueltige Werte z.B. call-control).
- Eigener Volllauf auf master nach Merge: 4027/4027, Exit 0 (= Workflow-Messung).

## C-P6a — Spezifikation Kommentar-Nachlese. ERLEDIGT (tasks/c-p6-spec.md, 526 Zeilen)
- BEOBACHTET: 198 Treffer einzeln klassifiziert (125 BLEIBT / 4 FAELLT / 69 UMFORMULIEREN),
  abgeschlossene Liste, Baseline 9ddf1df (beim Bau neu erheben - C-P5 verkleinert die Menge).
- Nebenbefund: 4 Kommentare behaupten "Default = Twilio" ueber lebenden Code, der auf
  DEFAULT_PROVIDER=Telnyx defaultet (in der UMFORMULIEREN-Liste).

## C-P6b — Umsetzung. ERLEDIGT (gemergt f1bdee5, Impl bb88482)
- BEOBACHTET: Gate PASS ohne Fix-Runde (wf_e2278554-d37); 44 Dateien, +99/-93, reine
  Kommentar-Phase. Lead-Gegenprobe: 12 Nicht-Kommentar-Praefix-Zeilen = 6 Zeilenend-
  Kommentar-Paare mit zeichengleichem Code-Anteil.
- Rest-Erhebung auf master danach: verbliebene twilio-Treffer in src/scripts/Env sind
  ausschliesslich Kategorie (b) (Bypass-Schalter, twilioSid-Feldname) plus wahre
  Protokoll-/Historien-Kommentare gemaess C-P6-Spec-BLEIBT-Liste.

## Kettenstand Track C (2026-08-08): C-P1 bis C-P6 KOMPLETT und LIVE.
Deploy 2026-08-08 (manuell durch den Owner, dep-d9re8fqjnfac73fh3p30), verifiziert:
/healthz liefert commit 27c8579, Boot-Banner der neuen Instanz ohne Twilio, alle
Flags aktiv. Kein funktionaler Twilio-Code mehr im Repo oder im Betrieb.
Die drei TWILIO_*-Keys in der Render-Env sind seither KOSMETIK (gesetzt+ungelesen
= harmlos) - loeschen jederzeit moeglich, Dashboard-Handgriff des Owners.
WER-Nachmessung (Track A) vom Owner zurueckgestellt; ab jetzt misst jeder Anruf
den Stand mit BEIDEN Aenderungen (STT-A1 + Track C) - bewusst akzeptiert.

## Danach offen (braucht Owner)
- Track-A-Abnahmeanruf (+1 706 710 1188), DANN Deploy von Track C (push upstream).
- Render-Env: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN loeschen ERST nach Deploy+Verify von C-P5.
- Track B (LLM-Anbieter-Port): blockiert an DeepSeek-Key + Kostenmodell-Gespraech.

---

# Track B — Phase B1: DeepSeek an der echten API messen

Spec: `tasks/b1-spec.md` (autoritativ). Umbrella: `PLAN-ANBIETER-PORT.md` Teil 2.
Bindend: es zaehlt, **was der Anbieter dem Schluessel tatsaechlich abbucht** (Owner-Korrektur
2026-08-07), nicht die Form der Preistabelle.

## B1-a — Weisse Flecken der Spec schliessen. ERLEDIGT (Lead, 2026-08-08)
- Die Spec nennt nur die Preis-STUFEN `v4-flash`/`v4-pro`, keine API-Modell-IDs.
- BEOBACHTET (WebFetch https://api-docs.deepseek.com/quick_start/pricing, 2026-08-08):
  IDs sind `deepseek-v4-flash` und `deepseek-v4-pro`; Preise je 1M USD deckungsgleich mit
  Spec Abschnitt 4 (0.0028 / 0.14 / 0.28 bzw. 0.003625 / 0.435 / 0.87); kein Off-Peak-Fenster.
- BEOBACHTET (api/list-models, api/create-chat-completion): `GET /models` ->
  `{object:"list", data:[{id,object,owned_by}]}`; `POST /chat/completions`;
  `usage.completion_tokens_details.reasoning_tokens`; `stream_options:{include_usage}`;
  Werkzeug-Rueckgabe `{id,type:"function",function:{name,arguments}}`, im Stream in `delta`.

## B1-b — Messskript bauen. FIX-RUNDE LAEUFT (Branch phase/b1-messung)
- Impl (3b355a5, Sonnet): 1347 Zeilen, 1 Datei. Lead-Gegenprobe reproduziert:
  node --check Exit 0; --selftest 22 Zusicherungen 0 Fehler; --dry-run 0 Netzaufrufe,
  80 Aufrufe geplant, ~0,1446 USD; scharf mit Falsch-Schluessel -> GET /models 401 ->
  Abbruch fail-closed, Verzeichnis blieb LEER.
- Safety-Review (Opus, Offline-Attrappe der DeepSeek-API, 14 Sabotage-Gegenproben):
  **NICHT SCHARFSCHALTEN**, 5x S1, 9x S2. Die drei schwersten, alle GEMESSEN:
  (1) Skala wird abgeschnitten - dieselbe Abbuchung erscheint als -1000000 je Aufruf und
      -6 gesamt (Faktor 10^6), wenn der Anbieter zwischen 2 und 8 Nachkommastellen
      wechselt; M2a meldet dann faelschlich {"USD":2}. Trifft die Kernzahl der Phase.
  (2) /user/balance durchgehend HTTP 500 -> Exit 0, key_leak_check clean, M2
      "beantwortet" mit leeren Objekten = liest sich als Entscheidungszweig 3
      ("keine Ist-Quelle"), obwohl nie gemessen wurde.
  (3) Verbindungsabbruch beim 3. Aufruf -> Exit 1, KEIN summary.json, KEINE Leak-Pruefung.
- BELEGT SAUBER (nicht kaputtmachen): minorUnitsDelta rechnet korrekt in BigInt, kein
  parseFloat auf Geld; genau 2 Schreibstellen, beide mit Redaktor intern (end-to-end an
  einem Anbieter belegt, der den Authorization-Header spiegelt); Bremse als Choke-Point
  vor dem Aufruf; kein Retry; M3-Verdrahtung (base 12144 Zeichen, Kontrolle A teilt 12098,
  Kontrolle B teilt 0, 10 Wiederholungen byte-identisch).
- Operativ: die 30-min-Cache-Pause steht INNERHALB der Modellschleife -> laeuft zweimal.
  Lauf dauert ~80-95 min statt 45-60. Fix zieht sie hinter beide Schleifen.
- Fix-Runde 1 (bb61de7, Sonnet): alle 5 S1 + 9 S2 + operativ behoben, 1348 -> 1949 Zeilen.
  Selftest 22 -> 41 Zusicherungen. Schlafzeit 71 -> 41 min (Lauf ~45-55 min).
- Re-Review (Opus, dieselbe Attrappe, 16 Gegenproben): **SCHARFSCHALTEN OK**, kein S1 mehr.
  Alle fuenf S1 einzeln gegengemessen, u.a.: Guthaben-Endpunkt 500 -> M2 "nicht beantwortet,
  Grund: in 96 von 96 Abfragen keinen Erfolg"; 2<->8 Nachkommastellen -> je Aufruf
  {minor_units:-1000000, scale:8} und gesamt {minor_units:-6, scale:2} rechnen jetzt AUF;
  Verbindungsabbruch -> Fehlversuch protokolliert, Lauf laeuft zu Ende, Exit 0, und Block A
  meldet weiter 6 Aufrufe (kein Retry eingeschlichen).
- Regressionsflaeche geprueft: alle 5 "belegt sauber"-Punkte halten. Verbessert: die
  M5-Fehlerproben laufen jetzt ueber denselben Bremsen-Choke-Point, der letzte Bypass ist weg.
- SPEC-KONFLIKT M1 - ERLEDIGT durch Owner-Entscheidung 2026-08-08 (0d76e99).
  Befund war: M1s Abnahme verlangt Verteilung "ueber beide Modelle und beide Betriebsarten",
  ein Kreuzprodukt war aber unerfuellbar, weil Block E nur BLOCK_E_MODEL (=flash) streamte -
  `pro x stream` kam NIE vor (empirisch 23/17/4/0). Zwischenloesung waren zwei Randpruefungen.
  **Owner: "ich verstehe den Sinn nicht, dass man pro Modell irgendwie was machen muss".**
  Praemisse am Code geprueft und WIDERLEGT: es gab nie Code pro Modell. `BLOCK_E_MODEL =
  MODEL_FLASH` war EINE Konstante; das Modell ist ein durchgereichter Wert, A/B/C fahren
  laengst beide ueber dieselbe Schleife. Die Festlegung kam allein daher, dass die
  Spec-Tabelle bei E "8 Aufrufe" ohne den Zusatz "je Modell" nennt.
  Umgesetzt: Block E faehrt beide Modelle (8 -> 16 Aufrufe, 0.1446 -> 0.1447 USD),
  `ERROR_PROBE_MODEL` fuer die M5-Fehlerproben abgetrennt, M1 prueft wieder das VOLLE
  Kreuzprodukt und nennt eine leere Zelle namentlich. Neue Selftest-Gruppe
  "M1-Kreuzabdeckung" (6 Zusicherungen, gesamt 50 -> 56).
  Sabotage-Beleg (Zelle startet bei 1 statt 0): manipuliert 2 Fehler/Exit 1, Original
  0 Fehler. Suite nach dem Commit 4007/4007 Exit 0.
  **Die B2-Uebergabe-Luecke "M1 gilt fuer pro nur nicht-stream" ist damit GESCHLOSSEN.**
- Fix-Runde 2 LAEUFT: 4 verbliebene S2 (M6-Leermenge, M2a-Parserkonsistenz,
  messbar/nicht-messbar, SSE-Doppelung) + 3 S3.

## B1-b (alt) — Auftrag an den Impl-Agenten
- Erwartetes Ergebnis (deterministisch): genau EINE neue Datei
  `scripts/deepseek-b1-messung.mjs`; `git status --porcelain` zeigt nichts sonst.
- Verifikation (Lead fuehrt selbst aus, VOR dem Scharfschalten):
  1. `node --check scripts/deepseek-b1-messung.mjs` -> Exit 0
  2. `node scripts/deepseek-b1-messung.mjs --selftest` -> Exit 0, Anzahl Zusicherungen > 0
  3. `DEEPSEEK_API_KEY=sk-testdummy... --dry-run` -> Exit 0, 0 Netzaufrufe, Kostenplan
  4. `git log master..phase/b1-messung` + `git diff --stat` (Lehre C-P2: PASS != Diff)
- Lead-Zusatz zur Spec: `--selftest` im Skript selbst. Begruendung: Spec verbietet einen Test
  unter `test/`, aber die Ganzzahl-Guthaben-Arithmetik darf nicht unbelegt bleiben
  (Pre-Mortem 3 + Regel "kein parseFloat auf Geld").

## B1-c — Scharfer Lauf. BLOCKIERT (Owner: DEEPSEEK_API_KEY fehlt in der lokalen .env)
- GEMESSEN 2026-08-08: `dotenv` + `process.env.DEEPSEEK_API_KEY` -> FEHLT.
  Der Key liegt in der Render-Env, ist dort aber unlesbar (MCP-Zugang schreibend) und
  ungelesen (kein Code liest ihn).
- Erwartetes Ergebnis: Protokoll unter `data/evidence/deepseek-probe/<ts>/` mit
  `summary.json`, das fuer M1-M8 je ein `answer`-Feld traegt; `key_leak_check: clean`;
  Ist-Ausgabe unter 1 USD, belegt durch die Guthaben-Differenz (nicht die Schaetzung).
- Verifikation: Spec Abschnitt 7 (sechs Punkte), Punkt fuer Punkt abgehakt.

## B1-d — Entscheidungsvorlage an den Owner. OFFEN (nach B1-c)
- Messergebnisse gegen die Wenn-Dann-Tabelle der Spec (Abschnitt 10) halten.
- Liefert KEINE Empfehlung (Spec Abschnitt 7: "Nicht Teil der Abnahme: eine Empfehlung").
