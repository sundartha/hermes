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

## B1-c — Scharfer Lauf. ERLEDIGT (2026-08-08, 11:03-11:47 UTC)
- Abnahme 6/6. 90 Aufrufe, 0 Fehlversuche, Ist-Ausgabe 0,01 USD (1,12 -> 1,11),
  key_leak_check clean (5 Dateien, 393990 Bytes). Protokoll gitignored unter
  data/evidence/deepseek-probe/2026-08-08T11-03-09-007Z/.

## B1-d — Entscheidungsvorlage. ERLEDIGT (tasks/b1-report.md, b85072d)

## OWNER-ENTSCHEIDUNG 2026-08-08 (bindend fuer B2/B4)
> "ich will dass die echten kosten abgebucht werden keine [...] annahmen"

1. **Raten je Token-Sorte** (Cache-Treffer / Cache-Fehltreffer / Ausgabe) statt der einen
   pauschalen Eingabe-Rate. Begruendung: `inputTokensOf` faltet drei Sorten auf eine Rate
   und liegt damit GEMESSEN um Faktor 5,1x (flash) / 6,0x (pro) daneben. Cache-Treffer sind
   der NORMALFALL (11 von 13), nicht die Ausnahme - pauschal-teuer waere kein konservatives
   Polster, sondern ein systematischer Abrechnungsfehler auf jeder Rechnung.
2. **Taegliche Perioden-Gegenprobe** gegen `GET /user/balance`. Je Anruf ausgeschlossen
   (Aufloesung 0,01 USD, Verzug ~2 min). Zweck: die veroeffentlichte Preisliste ist die
   EINZIGE verbleibende Annahme - die Gegenprobe prueft genau sie. Die Anbieterseite
   kuendigt eine deutliche Preiserhoehung an.
3. **Modellwahl (flash vs. pro) VERTAGT bis B5.** B1 kann Qualitaet nicht messen
   (max_tokens war 64, Antworten abgeschnitten). Praezedenz B-7: dokumentierte
   Deutsch-Unterstuetzung, gemessen 97 % Wortfehlerrate.

Nicht mehr zu entscheiden (durch die Messung erledigt): Buchungs-ID = angeforderte ID
(0/88 Abweichungen); `reasoning_tokens` sind enthalten, nicht additiv; kein Off-Peak-Fenster;
`include_usage` wird erzwungen (kostet nichts, auch wenn es gemessen ohne ginge);
Timeout-Werte je Adapter statt global (pro erreicht 3183 ms bei 3500 ms Seam-Timeout).

**Wichtig fuers Verstaendnis der Owner-Vorgabe:** "echte Kosten" heisst NICHT ein Kostenfeld
des Anbieters - das existiert nicht (alle 90 Antworten rekursiv geprueft, nur Token-Zaehler;
Guthaben loest nur 0,01 USD auf). Es heisst: anbieter-gemeldete Token-Zahlen je Sorte
(0 Verletzungen beider Summengleichungen ueber 88 Aufrufe) mal veroeffentlichte Rate = reine
Arithmetik, plus die Gegenprobe als Beleg, dass die Rate stimmt.

## B2 — Der LLM-Port-Vertrag. ERLEDIGT + GEMERGT (2026-08-08, Merge 50ba426)

`src/llm/ports.js`, 233 Zeilen, reine JSDoc-Typdefs + `export {};`. Gate PASS nach 2
Fix-Runden (11 Agenten, ~1,08 M Subagent-Token). Lead-Verifikation selbst gefahren:
1 Datei / +233 / -0, `node --check` Exit 0, **einzige Nicht-Kommentar-Zeile ist Zeile 233
`export {};`**, alle 7 genannten Aufrufer-Symbole per `grep` im Bestand gefunden, alle 11
B1-usage-Feldnamen erwaehnt, 0 Zeilenverweise, keine Secrets, keine Umlaute,
`prettier --check` gruen.

**Plan-Grounding: 0 falsche Belege** ueber 60+ Spec-Angaben (5 Bereichsangaben um 1-2
Zeilen zu weit/eng, keine Aussage dadurch veraendert). Details: `tasks/b2-report.md`
(im Merge-Commit, danach geloescht — Historie in `git`).

### Die drei Befunde, die WEITERWIRKEN

1. **BEFUND 1 — `toolChoice` ist DREIWERTIG, nicht zweiwertig.** Die Spec 3.2 schrieb
   `"auto" | "required"` vor und belegte das mit `precall-briefing.js:236`. Gemessen:
   `:236` ist `tool_choice:{type:"any"}`, aber **`:235` ist `{type:"tool", name:
   BRIEFING_TOOL_NAME}`** — ein BENANNTER Werkzeug-Zwang, den ein zweiwertiges Feld nicht
   ausdruecken koennte. Der Vertrag traegt jetzt `"auto"|"required"|{tool:string}`.
   *Das ist kein Vorratsfeld, sondern ein Live-Aufrufer, den die Spec uebersehen hat.*
   **Fuer B5 bindend:** ein Adapter, der `toolChoice` nur zweiwertig umsetzt, bricht das
   Precall-Briefing.
2. **Die groesste offene Kante des Vertrags (Safety-Concern 1) — der B3-Auftrag im
   Klartext:** `LlmRequest.system/messages/tools` sind als `*` typisiert, mit dem Zusatz
   "innere Form ist NICHT Teil dieses Vertrags". **An genau dieser Kante ist der Port heute
   noch nicht anbieter-neutral** — ein zweiter Adapter bekaeme Anthropic-geformte
   Strukturen durchgereicht. Bewusst nach B3 verschoben; es ist die Stelle, an der der
   Vertrag reisst, wenn B3 sie nicht schliesst.
3. **`npm run lint` ist repo-weit kaputt** (Bestandsbefund, NICHT von B2 verursacht):
   `npx eslint src/llm/ports.js` bricht mit `ERR_MODULE_NOT_FOUND: Cannot find package
   '@eslint/js' imported from eslint.config.js` ab. `@eslint/js` steht in `package.json`
   (devDependency), ist aber nicht installiert. **Gegenprobe gefahren:** `npx eslint
   src/llm.js` scheitert identisch — es ist also kein Worktree-Artefakt, wie der
   Safety-Review vermutete, und kein Befund dieser Phase. Abdeckung fuer die neue Datei
   liefern `node --check` (Exit 0) und `prettier --check` (gruen).

### Offene Punkte, die aus `tasks/b2-spec.md` in den Kettenstand gerettet wurden

Die Spec wird nach diesem Commit geloescht (CLAUDE.md-Aufraeumregel); ihre weissen Flecken
sind Befunde und bleiben deshalb hier stehen:

| # | Offen | Wer beantwortet es |
|---|---|---|
| W1 | Taugt der Eingangs-Uebersetzer des Shims fuer die AUSGANGS-Seite? `grep -c tool_calls src/telnyx-llm-shim.js` = **0** — er uebersetzt heute nur die Eingangsseite | **B3**, erste Frage |
| W2 | Was passiert bei unparsebaren Werkzeug-Argumenten? B1 hat den Fall nie beobachtet | **B5** (erster Adapter, der wirklich parst) |
| W3 | **Anthropics Raten je Token-Sorte stehen im Repo NIRGENDS.** Nur die Faustformel "rund ein Zehntel" in `PLAN-ANBIETER-PORT.md` 1.2 — eine Faustformel ist kein Preis | **B4**: frisch abrufen, mit `asOf` + `source` |
| W4 | Gehoeren alle Anbieter in EINE `modelPricesUsd`-Tabelle? `mostExpensivePrice` ist nur INNERHALB einer Preiswelt eine Obergrenze | **B4** |
| W5 | Wie weit muss die Aufschluesselung in den Store reichen? Bucket kennt 2 Zaehler (`defaults.js` `emptyUsage`), `usage_event.quantity` ist eine Summe. Beruehrt `src/db/schema.sql` | **B4** |
| W6 | Schwaecht der Betrag-Rueckgang bei Anthropic das Gate praktisch? Richtung klar, Groesse nicht — haengt am realen Cache-Treffer-Anteil im Live-Verkehr | **B4**, Vorher/Nachher an echtem Verkehr |
| W7 | Der Perioden-Gegenprobe fehlt ein TRAEGER. Render-Tarif hat keinen Cron | **B4** oder eigene Phase |
| W8 | Tragen `deepseek-v4-flash`/`-pro` das Gespraech ueberhaupt? B1 konnte das nicht messen (`max_tokens` war 64) | **B5** (`convo-bench`, n>=5, plus echter Anruf) |

**Form der Preistabelle, die B4 bauen muss** (Vertragsfolge, damit B4 keinen Vier-Sorten-
Bericht in eine Zwei-Raten-Tabelle kippt): je Modell-ID `inPerMTok`, `cacheWritePerMTok`,
`cacheReadPerMTok`, `outPerMTok`, `asOf`, `source`. **Vier Raten sind Pflicht je Eintrag,
kein Feld optional** — additiv-nullable ist verworfen, weil der vergessene Eintrag dann
still im alten, falschen Verhalten weiterliefe (dieses Repo hat den Fall schon bezahlt:
alle Bestandsnummern ohne `monthlyCostCents`).

**B4s gefaehrlichster Schritt, vorab benannt:** sobald Anthropic vier Raten hat, wird
`cache_read_input_tokens` nicht mehr zur vollen Eingabe-Rate gebucht. **Der live gebuchte
Betrag SINKT** — auf dem Kundenbeleg richtiger, auf dem Budget-Gate aber spaeter greifend,
also weniger schuetzend (Absolute Regel 1). Eigener gemessener Schritt mit Vorher/Nachher
an echtem Verkehr, Owner sieht die Zahl. **Kein Seiteneffekt von "wir haben DeepSeek
dazugebaut".**

## B2 — Auftrag (erledigt, Verifikation unten belegt)

Spec: `tasks/b2-spec.md` (autoritativ). Skript: `.claude/workflows/runs/b2.js`.
Ausgangsstand gemessen: master = origin = upstream `5f296ef`, Suite 4007/4007 Exit 0,
live `6aec118`, 1 Worktree, `DEEPSEEK_API_KEY` in der lokalen `.env` vorhanden.

- **Erwartetes Ergebnis (deterministisch):** genau EINE neue Datei `src/llm/ports.js`;
  `git diff --stat master..<branch>` zeigt nichts sonst; die Datei enthaelt ausser
  `export {};` keine Anweisung.
- **Verifikation (Lead fuehrt sie SELBST aus, vor dem Merge - Lehre C-P2: PASS != Diff):**
  1. `git log master..<finalBranch>` + `git diff --stat` selbst ansehen
  2. `node --check src/llm/ports.js` -> Exit 0
  3. `grep -nE "function|=>|\bconst\b|\blet\b" src/llm/ports.js` -> jeder Treffer liegt
     in einem Kommentar
  4. `npm test` -> 4007/4007, Exit 0 (beweist nur, dass nichts kaputt ist; die Spec haelt
     ausdruecklich fest, dass gruene Tests die Richtigkeit des Vertrags NICHT belegen)
  5. jede im Vertrag genannte Aufrufer-Bezeichnung per `grep` im echten Code auffindbar

### Lead-Entscheidung zur Belegform (Abweichung von der Spec, bewusst)

Spec-Abnahme Punkt 4 verlangt Aufrufer-Belege als `datei.js:zeile`. **Gemessen:**
`grep -cE '\.js:[0-9]' src/telephony/ports.js` -> **0** - der Nachbar-Port fuehrt KEINE
Zeilenverweise, und clean-code C2 verbietet brittle Datei:Zeile-Kommentare.

**Aufgeloest zugunsten der Bestandspraxis:** die Vertragsdatei nennt Datei + SYMBOLNAME
(`claude.js` `agentTurn`), die Zeilenbelege stehen im Report. Ein Symbolname ist grepbar
und bricht sichtbar; eine verrottete Zeilennummer zeigt still auf die falsche Zeile - die
Symbol-Variante ist also robuster, nicht nur konventionstreuer. Die Zeilenangaben der Spec
werden trotzdem EINZELN am Code nachgeschlagen (Abnahme-Punkt 4); Abweichungen sind
Befunde und kommen in den Report, nicht in einen stillen Fix.

## B3 — Die Werkzeug-Schleife neutralisieren. SPEC STEHT, B3a LAEUFT (2026-08-08)

Spec: `tasks/b3-spec.md` (1018 Zeilen, code-gegroundet).

### BLOCKER (Owner informiert 2026-08-08): das Anthropic-Guthaben ist leer

Gemessen: ein minimaler Live-Call gegen `claude-haiku-4-5` liefert **HTTP 400 "Your credit
balance is too low to access the Anthropic API"**. Render-Logs zeigen dasselbe Symptom am
**2026-08-04** bei echten Anrufen (`[turn] 400`, `[summary] 400`); seither gab es **keinen
einzigen Anruf**, der Live-Zustand ist also ungeprueft, nicht gesund. Der Basismess-Bench
heute hat 1,84 USD Anthropic-Token verbraucht und ist an genau diesem Fehler gestorben.

**Owner-Entscheidung: "B3 bauen, Abnahme spaeter."** Der Code braucht kein Guthaben, nur der
Nachher-Bench (~2,1 USD) und B5s echter Anruf.

**Der Spec-Zuschnitt loest den Blocker groesstenteils auf:**

| Schnitt | Abnahme | Guthaben noetig? |
|---|---|---|
| **B3a** — Antwortseite, Seam+Adapter, `LlmTurn`/`LlmTokenUsage`, E5. Der Adapter baut den Body weiter aus den heutigen Anthropic-Strukturen. | A1-A5 + A9 (Suite, Byte-Gleichheit des Drahts, Greps, Smoke) | **NEIN** — voll abnehmbar und mergefaehig |
| **B3b** — Anfrageseite neutral (`system`/`messages`/`tools`/`toolChoice`/`cachePrefix`), `bridge.js`-Nachzug | A1-A5 + **A6-A8 (Bench)** + A9 | **JA** — wartet |

B3a ist ausserdem die **Vorbedingung fuer B4** (Raten je Token-Sorte brauchen die
aufgeschluesselte Verbrauchsform). Faellt B3b spaeter aus, war B3a kein Verlust.

### Drei Lead-Entscheidungen, die die Spec ausdruecklich angefordert hat

**E6 — `LlmRequest.cachePrefix` (Boolean, Default false): GENEHMIGT.**
B2 hatte Cache-Steuerung als *"Vorratshaltung ohne zweiten Aufrufer"* ausgeschlossen. B3 misst
am Code das Gegenteil: es gibt genau **einen** heutigen Aufrufer (`claude.js agentTurn` setzt
`cache_control`, `summarizeCall` und `fetchPrecallBriefing` **nicht**) und einen zweiten
Anbieter mit belegter Semantik (DeepSeek cacht ohne client-seitigen Marker, B1-gemessen).
Damit ist das B2-Kriterium "nichts ohne Aufrufer" **erfuellt, nicht umgangen**. Die
Alternative — eine adapter-interne Faustregel — wuerde den Draht-Body von `summarizeCall`
und `fetchPrecallBriefing` veraendern und damit die Kernabnahme A3 (Byte-Gleichheit) brechen.
**Auflage:** die Ergaenzung wird in `src/llm/ports.js` mit Aufrufer (Datei+Symbolname) UND
mit diesem Grund dokumentiert — sonst entfernt sie spaeter jemand mit Verweis auf B2.

**E5 — `PrecallResearchProvider.searchCount(providerTurn)` statt `searchCount(usage)`:
GENEHMIGT.** Ohne die Aenderung liest `searchCount` gegen eine neutrale `LlmTokenUsage`
immer `null` (das Feld `server_tool_use.web_search_requests` existiert dort nicht) — und
`null` heisst vertraglich "unbekannt", also bucht **jedes** Briefing den harten Deckel
`config.research.researchMaxUses` statt der Ist-Zahl, auf `addResearchFeeCostCents`, also auf
**dieselbe Tenant-Achse wie die Kostendecke** (Absolute Regel 1). Die Fail-safe-Richtung
bliebe zwar sicher (ueberbuchen), aber Ueberbuchung ist auf dem Kundenbeleg ein
Abrechnungsdefekt — dieselbe Begruendung, mit der B2 die Faltung `inputTokensOf` verworfen
hat. Der Bestandstest `test/al-p10-precall-research.test.js` bleibt **unveraendert** und ist
damit der Beweis, dass die Umstellung die Buchung nicht verschiebt.

**providerTurn traegt die GANZE Anbieter-Antwort, nicht nur die `content`-Liste: ENTSCHIEDEN.**
E5 braucht `usage.server_tool_use`; ein Feld, das nur `content` traegt, erzwaenge einen
zweiten Rohform-Kanal. Vertragskonform bleibt es, weil B2 nur dem **Aufrufer** das Lesen
verbietet: `precall-briefing.js` reicht die Struktur durch, gelesen wird sie ausschliesslich
von anbieter-spezifischen Adaptern (`anthropic-web-search.js`, LLM-Adapter).

### Die Vorher-Werte waren teilweise falsch — korrigiert

`tasks/b3-vorher-werte.md`: **8 der 80 Basismess-Laeufe sind keine Messung** (Guthaben lief
mitten im Lauf leer). `d3-fremde-recherche` starb 5/5 mit `turns: 0` und meldete trotzdem
`checks 10/10` = **100 %**; `d3-nachschlag-auftrag` hat nur 2 gueltige Laeufe. Gueltiger
Nenner ist **72, nicht 80**; `look_up` ist **2/72 statt 3/80**. Beide Szenarien muessen vor
dem B3b-Vergleich neu erhoben werden. Als **vierter Bench-Bestandsdefekt** dokumentiert:
ein Lauf, der am LLM-Fehler stirbt, meldet gruene Checks statt eines Fehlers — er produziert
ein falsches Ergebnis, das wie ein perfektes aussieht.

## B3a — Antwortseite neutralisiert. ERLEDIGT + GEMERGT (2026-08-08, Merge a8a8733)

Gate PASS **ohne Fix-Runde** (5 Agenten, ~1,05 M Subagent-Token). Ergebnis: der LLM-Seam ist
anbieter-frei — `src/llm.js` importiert das Anthropic-SDK nicht mehr, das Anbieter-Wissen der
Antwortseite liegt in `src/llm/adapters/anthropic.js` (neu, 244 Zeilen).

### Lead-Verifikation, selbst gefahren (PASS ist keine Freigabe)

| Abnahme | Ergebnis |
|---|---|
| A2 Suite | **4026/4026** gefiltert (roh 4046), Exit 0 — Baseline 4007, also **+19**, nicht gesunken |
| A3 **Byte-Gleichheit** | derselbe Golden-Master ist gruen gegen den **alten** Produktionscode (`42a2fe5` = master + nur der Test) UND gegen den neuen |
| A3 **Rotprobe selbst gefahren** | `max_tokens` 300 -> 999 im Adapter-Body macht ihn **rot** (`deepStrictEqual` auf dem rohen Body-String inkl. System-Prompt), zuruecknehmen -> wieder gruen |
| A4 sieben Draht-/Buchungs-Pins | **leerer Diff** |
| A5 Antwortseiten-Marker | `claude.js` **0**, `precall-briefing.js` **0**, `llm.js` **0** |
| A5 **Positiv-Kontrolle** | Adapter **9** — die Null ist echt, nicht ein defekter Ausdruck (B2-Lehre angewandt) |

**Der Golden-Master ist die eigentliche Leistung dieser Phase.** Er wurde in einem eigenen,
VORHERIGEN Commit gegen den unveraenderten Bestandscode aufgenommen — dadurch ist "der Draht
hat sich nicht verschoben" nicht behauptet, sondern beweisbar, und der Beweis laesst sich von
jedem nachvollziehen, der beide Commits auscheckt.

**Eine begruendungspflichtige Testaenderung, geprueft und akzeptiert:**
`test/kv-p1-cost-ledger-map.test.js` (Geldpfad) stellt die Fixture auf die neutrale
Verbrauchsform um — **dieselben Zahlen** (5 Eingabe / 5 Ausgabe), `billingModelId` ersetzt den
`model`-Parameter von `bookTokenUsage`. Die eigentliche Assertion gegen `aiCostCents` bleibt
unveraendert. Signaturanpassung, kein Aufweichen.

**E5 ist umgesetzt und geschlossen:** `searchCount` nimmt die opake Ruecktrage statt der
Verbrauchsform. `test/al-p10-precall-research.test.js` ist unveraendert und gruen — und wird
rot, sobald man die Umstellung zurueckdreht. Damit ist belegt, dass die Recherche-Gebuehr
weiter die Ist-Zahl bucht und nicht still auf den Deckel faellt.

### Was B3b uebernimmt (die Grenztabelle, vollstaendig in `tasks/b3a-report.md`)

Jeder in B3a stehengelassene Marker ist namentlich mit Grund gefuehrt — Kurzfassung:

| Datei | Marker | Grund |
|---|---|---|
| `claude.js` | `input_schema` (4x), `cache_control` (2x), `max_tokens` (2x), `system` als Blockliste | Anfrageseite; `input_schema` zieht `bridge.js` `realtimeTools` zwingend mit |
| `precall-briefing.js` | `input_schema`, `tool_choice` (dreiwertig!), `max_tokens` | Anfrageseite |
| `research/adapters/anthropic-web-search.js` | `web_search_20250305`, `server_tool_use` | **benannte Ausnahme**: anbieter-spezifisch IST der Zweck dieser Datei |
| `src/llm/ports.js` | **kein `cachePrefix`** | Lead-Auflage eingehalten: was B3a nicht braucht, gehoert nach B3b. In B3a hat es keinen Aufrufer |

Bewusst NICHT gebaut: Registry/`LLM_PROVIDER` (B5), `LlmProvider.limits` (B5), Preisstaffel je
Token-Sorte (B4), Umbenennung der zwei Metrik-Schluessel (E7 — zwei Bestandstests pinnen sie
woertlich).

**B3b bleibt blockiert**, bis Anthropic-Guthaben da ist (Nachher-Bench ~2,1 USD). Zusaetzlich
muessen `d3-fremde-recherche` und `d3-nachschlag-auftrag` **vor** dem Vergleich neu erhoben
werden — ihre Vorher-Werte sind Artefakte gestorbener Laeufe.

## B4 — Preisquelle und Gate. SPEC STEHT, B4a LAEUFT (2026-08-08)

Spec: `tasks/b4-spec.md` (807 Zeilen).

### W3 ist GESCHLOSSEN — Anthropics Raten sind abgerufen, nicht abgeleitet

Quelle `https://platform.claude.com/docs/en/about-claude/pricing.md`, `asOf` **2026-08-08**.
Die Seite druckt alle vier Sorten je Modell explizit aus (USD je 1 Mio. Token):

| Modell | Input | 5m Cache Write | 1h Cache Write | Cache Read | Output |
|---|---|---|---|---|---|
| `claude-haiku-4-5` | 1.00 | 1.25 | 2.00 | 0.10 | 5.00 |
| `claude-sonnet-5` **bis 2026-08-31** | **2.00** | **2.50** | 4.00 | **0.20** | **10.00** |
| `claude-sonnet-5` **ab 2026-09-01** | 3.00 | 3.75 | 6.00 | 0.30 | 15.00 |

Die 5m-Rate ist die richtige: `CACHE_CONTROL_EPHEMERAL` (`claude.js`) traegt kein `ttl`.
Nebenbefund: Cache-Read ist exakt 0,1x der Basisrate — die Faustformel des Plans stimmte,
ist aber jetzt erstmals belegt statt geraten.

### DREI BEFUNDE, vom Lead am Code nachgeprueft

**1. `claude-sonnet-5` wird derzeit 50 % zu hoch gebucht.** `config.js` fuehrt 3.0/15.0 —
das ist der Preis AB dem 2026-09-01. Bis dahin gilt 2.00/10.00. Betroffen ist das
**Precall-Briefing** (`briefingModel`), das vor Outbound-Anrufen live laeuft; die
Ueberbuchung trifft Budget-Gate UND Stripe-Kundenbeleg (auf dem Beleg ein
Abrechnungsdefekt — dieselbe Begruendung, mit der B2 `inputTokensOf` verworfen hat).
Groessenordnung ~0,32 ct je Outbound-Anruf. **Realisierter Schaden heute: 0 EUR** — seit
2026-08-04 gab es keinen Anruf. Am 2026-09-01 wird die Zahl von selbst richtig.

**2. F-1: der gerade gemergte B2-Vertrag enthaelt eine falsche Behauptung.**
`src/llm/ports.js:76` nennt `inputUncachedTokens` die *"teuerste Eingabeklasse"*. Mit den
echten Raten ist das falsch — die 5m-Schreibrate liegt in **allen drei** Preiszeilen
darueber (1.25>1.00, 2.50>2.00, 3.75>3.00). Das Verhalten bleibt richtig, die Aussage nicht.

**3. WF-4: der Realtime-Pfad bucht seine Token ueberhaupt nicht.** `grep -c
"bookTokenUsage\|trackUsage\|meterAiTokens" src/bridge.js` -> **0**. Gebucht wird nur aus
`llm-usage.js`, `claude.js`, `precall-briefing.js`. **Nicht scharf**, weil `VOICE_ENGINE`
per Default `budget` ist und live auch so laeuft — aber wer auf `realtime` umstellt, faehrt
mit einer blinden Gate-Achse. Bestandsbefund, gehoert NICHT in B4, braucht eine
Owner-Entscheidung.

**Zusatzfund des Leads:** `tokenCostUsd` (`state-ops.js:2249-2252`) liest `price.inPerMTok`
**ohne Null-Check**. Ohne Preis-Fallback endet ein unbekanntes Modell dort im `TypeError`
(Ausfall im Buchungspfad) oder in `NaN` — und `NaN > limit` ist immer `false`, also
**fail-open am Gate**. Genau deshalb wird der Fallback nicht gestrichen (s. W4).

### Lead-Entscheidungen

- **Zuschnitt B4a / B4b: ANGENOMMEN.** B4a (Tabellenform, vier Raten, Boot-Abbruch,
  `worstCasePrice`, alle Tests inkl. Gegenprobe) laeuft vollstaendig gegen Attrappen und ist
  **jetzt abnehmbar**. B4b (der gemessene Betrag-Rueckgang an echtem Verkehr, W6) ist
  blockiert — kein Verkehr seit 08-04, kein Anthropic-Guthaben — und braucht laut Spec
  **keinen neuen Code**: die vier Sorten stehen je Aufruf schon in der LLM-Metrik.
- **W4 `worstCasePrice` (punktweises Maximum jeder der vier Raten): ANGENOMMEN.** Eine
  Tabelle je Anbieter scheidet aus (der B2-Vertrag kennt nur `billingModelId`, kein
  Anbieterfeld). Fallback streichen scheidet aus (fail-open, s. Zusatzfund). Heute
  verhaltens-identisch, weil Sonnet in allen vier Raten dominiert; ab dem zweiten Anbieter
  garantiert es die obere Schranke, die `mostExpensivePrice` nur zufaellig hatte.
- **W5 keine Store-Migration: ANGENOMMEN.** Die Aufschluesselung reicht bis zur
  Preisrechnung; Bucket-Zaehler und `usage_event.quantity` bleiben Summen mit identischem
  Zahlenwert. Tragende Tatsache: die Gate-Kette (`budgetExceeded` -> `tenantSpendOrDeny`)
  liest ausschliesslich Cent-Achsen — kein Token-Zaehler kommt darin vor.
- **Sonnet-Korrektur bleibt IN B4a, kein Sonderschritt.** Der Befund ist nicht "eine Zahl
  ist falsch", sondern "die Tabelle kann keinen terminierten Wechsel ausdruecken"; ein
  Einzelfix verfehlt die Wurzel. **Auflage:** geht vor dem B4a-Merge wieder Verkehr live,
  wird die Korrektur als Ein-Zeilen-Fix vorgezogen (Owner-Entscheidung).
- **F-1 wird in B4a mitkorrigiert** — eine falsche Behauptung im bindenden Vertrag ist
  teurer als der Ein-Zeilen-Fix.
- **WF-4 und der fehlende Null-Check in `tokenCostUsd`** kommen in den Kettenstand, nicht in
  den B4a-Scope. WF-4 braucht den Owner.
- **W7 (Traeger der Perioden-Gegenprobe): NICHT in B4.** Die Praemisse "Render hat keinen
  Cron" ist am Code widerlegt — `setInterval().unref()` ist Hausmuster (`boot.js`). Es
  fehlen Endpunkt (DeepSeek -> B5; ein Anthropic-Aequivalent ist **unbelegt**) und
  Verbraucher.

## B4a — Preisstaffel + Boot-Abbruch. ERLEDIGT + GEMERGT (2026-08-08, Merge 1edf66c)

Gate PASS **ohne Fix-Runde** (5 Agenten, ~1,1 M Subagent-Token). 23 Dateien, +1063/-128.

### Was gebaut wurde

- **`MODEL_PRICE_SCHEDULES`** in `config.js`: je Modell-ID eine Liste von Staffeln mit
  `validFrom` + `asOf` + `source` und **vier Pflichtraten**. `resolveModelPrices` loest sie
  **genau einmal beim Boot** auf den heutigen Kalendertag auf; `config.llm.modelPricesUsd`
  bleibt fuer alle Leser eine flache Abbildung — kleiner Blast-Radius.
  **Die Buchungskante bleibt zeitfrei.** Ein `nowIso` in `tokenCostUsd` waere eine zweite Uhr
  an derselben Buchung gewesen. Der Staffel-Vergleich laeuft ueber ISO-Strings **mit
  Formpruefung** (Regex, nicht Laenge — "08.08.2026" ist auch 10 Zeichen), ohne `Date`-Objekt
  und ohne Zeitzonenrechnung (Repo-Lehre zu fremden Uhrzeiten angewandt).
- **Damit traegt die Tabelle den terminierten Preiswechsel**: `claude-sonnet-5` bis
  2026-08-31 auf 2.00/2.50/0.20/10.00, ab 2026-09-01 auf 3.00/3.75/0.30/15.00. Die
  50-Prozent-Ueberbuchung des Briefing-Modells ist damit behoben — als Folge der Form, nicht
  als Einzelfix.
- **`worstCasePrice`** statt `mostExpensivePrice`: punktweises Maximum JEDER der vier Raten.
- **Boot-Abbruch** bei `claudeModel`/`briefingModel` ohne Staffel. **`realtimeModel` ist
  bewusster Nicht-Ausloeser** — der Pfad bucht keine Token (WF-4), ein Abbruch dafuer haette
  keine Schutzwirkung und wuerde jeden normalen Start verhindern.
- **F-1 korrigiert** — und zusaetzlich begruendet, warum das Verhalten richtig bleibt: eine
  Schaetzung auf `inputCacheWriteTokens` wuerde eine Token-Sorte behaupten, die nie geflossen
  ist (Vollstaendigkeits-Invariante).

### Lead-Verifikation, selbst gefahren

| Probe | Ergebnis |
|---|---|
| Suite | **4057/4057**, fail 0, Exit 0 (vorher 4026, also **+31**) |
| **A-3 Owner-Abnahme, Gegenprobe** | Buchung entfernt -> **3 Tests rot**, darunter `B4A-BUCH-4`: die Kostendecke greift auf dem NEU gerechneten Betrag |
| **A-4 Rotprobe** | `exit(1)` entschaerft -> **3 Boot-Tests rot**, u.a. "eine DATIERTE Snapshot-ID ist ein anderer Schluessel" |
| **A-5 Rotprobe (die wichtigste)** | Abbruch auf `realtimeModel` ausgeweitet -> **SIEBEN Bestandstests rot**, darunter "vollstaendige Config bootet, kein Fehl-Refusal" |
| W5 | `git diff -- src/db/` **leer** — keine Migration, kein Schema-Diff |
| Scope | `bridge.js` unberuehrt |

**A-5 ist der wertvollste Beleg dieser Phase:** ein zu breiter Boot-Abbruch wird nicht von
einem Spezialtest gefangen, sondern von der gesamten Bestands-Boot-Suite. Ein Dienst, der
nicht hochkommt, nimmt keine Anrufe an — dieses Risiko ist jetzt siebenfach vernagelt.

### Ein offener Rest, ehrlich benannt

Der **erste** Suite-Lauf auf dem Branch meldete `fail 1`. Der Wiederholungslauf war gruen
(4057/4057). **Welcher Test rot war, ist unbekannt** — das Hintergrund-Kommando hatte
`| tail -10`, damit war die `not ok`-Zeile weg (Lehre in `tasks/lessons.md`). Das Repo hat
einen dokumentierten Volllast-Flake (~12 %), und der Lauf lief unter paralleler Last, aber
**"Flake oder Regression?" ist fuer diesen Vorfall dauerhaft unbeantwortbar.** Kein Blocker
(zweiter Lauf gruen, alle Rotproben bestanden), aber es bleibt ein Datenpunkt, kein Beweis.

### Was offen bleibt

- **B4b** (gemessener Betrag-Rueckgang an echtem Verkehr, W6): blockiert — kein Anruf seit
  2026-08-04, Anthropic-Guthaben leer. Braucht laut Spec **keinen neuen Code**: die vier
  Sorten stehen je Aufruf schon in der LLM-Metrik.
- **WF-4** (Realtime-Pfad bucht keine Token): Bestandsbefund, braucht den Owner. Wer auf
  `VOICE_ENGINE=realtime` umstellt, faehrt mit blinder Gate-Achse.
- **W7** (Traeger der Perioden-Gegenprobe): nicht in B4. Die Praemisse "Render hat keinen
  Cron" ist widerlegt (`setInterval().unref()` ist Hausmuster) — es fehlen Endpunkt und
  Verbraucher.
- **B3b** (Anfrageseite) und **B5** (DeepSeek-Adapter): warten auf Guthaben.

## Track B — Stand nach der Live-Abnahme (2026-08-09)

### Deploy + Live-Abnahme: ERLEDIGT

`ee8e43b` ist live (Owner hat manuell deployt). Beleg: `/healthz` liefert
`commit=ee8e43b...` = `git rev-parse master`, und das Boot-Log traegt
`deployed commit=ee8e43b...` **ohne** `[boot] Start abgebrochen`.

**Der Deploy-Blocker V-3 war unkritisch:** Render-Env traegt `CLAUDE_MODEL=claude-haiku-4-5`
(Alias, bepreist), `PRECALL_BRIEFING_MODEL` ist NICHT gesetzt -> Code-Default
`claude-sonnet-5`, ebenfalls bepreist. `assertPricedModels` ist damit erstmals gegen die echte
Render-Env gelaufen und hat gehalten.

**B3a/B4a sind live abgenommen** (zwei echte Outbound-Anrufe, Sprechpfad laeuft, keine
`[turn] 400`, `look_up` und Exa funktionieren).

**Kein Vorher-Anruf gefahren, bewusst.** Ein Vorher-Anruf liefert ANDERE Token als der
Nachher-Anruf; aus einem Anruf auf dem neuen Stand lassen sich beide Betraege (alte Faltung,
neue Aufschluesselung) auf DERSELBEN Token-Basis rechnen. Sauberer, nicht nur billiger.

### B4b — BLOCKIERT, und die Kickoff-Praemisse war falsch

Der Kickoff behauptet: *"Braucht keinen neuen Code. Die vier Token-Sorten stehen je Aufruf
schon in der LLM-Metrik (`llm.js`, `metricsExtra`)."* **Am Code widerlegt:**

| Token-Sorte | erreicht das Log? | Beleg |
|---|---|---|
| `inputCacheWriteTokens` | ja | `metrics.js:47` |
| `inputCacheReadTokens` | ja | `metrics.js:49` |
| `inputUncachedTokens` | **nein** | fehlt in der Whitelist `metrics.js:35-43` |
| `outputTokens` | **nein** | dito |

`metrics.llmCall` hat eine bewusste Feld-Whitelist. Die Buchung selbst kennt alle vier
(`llm-usage.js` `billedTokens`), aber sie gehen in `store.trackUsage` und werden dort laut
W5-Entscheidung zu Summen gefaltet. `convo-bench` gibt gar keine Token aus (geprueft: kein
`usage`-Feld in 183 Zeilen). **Ohne die zwei fehlenden Sorten ist weder der alte noch der neue
Betrag rechenbar.**

**Zweiter, wichtigerer Befund:** ueber den ganzen Anruf `call_mslm38yfw5xb` traegt **keine
einzige** der 9 erfolgreichen `[metrics] llm`-Zeilen ein Cache-Feld. Die Metrik meldet
Cache-Zaehler nur, wenn sie > 0 sind — es gab also **keinen einzigen Cache-Treffer**.
Falls das reproduzierbar ist, ist W6 damit beantwortet: der gebuchte Betrag sinkt um **null**,
weil nichts gecacht wird, und die Kostendecke wird nicht geschwaecht. Das deckt sich mit dem
Altbefund "Prompt-Caching tot" ([[conversation-optimization-plan]]). **Noch nicht bewiesen** —
ein Schluss aus Abwesenheit, n=1 Anruf.

### B3-Spike (W8): GO, mit einem scharfen Vorbehalt fuer B5

Branch `spike/b3-deepseek-toolloop` (`5e0ee0c`), **wird NIE gemergt**. Report:
`git show spike/b3-deepseek-toolloop:tasks/b3-spike-report.md` (323 Zeilen, zitiert jede rohe
deutsche Modellantwort).

- **`deepseek-v4-pro` traegt den deutschen Mehrrunden-Werkzeug-Loop** (6 Runden, fluessiges
  Deutsch, keine Abschneidung, 8/8 Werkzeug-Aufrufe mit parsebarem JSON). B-7 wiederholt sich
  hier NICHT.
- **BLOCKER fuer B5:** das Modell laeuft per Default im *Thinking mode*, und dort scheitern
  `tool_choice: "required"` **und** die namentlich erzwungene Form mit **HTTP 400
  "Thinking mode does not support this tool_choice"** (reproduzierbar 2/2). Genau darauf
  stuetzt sich `precall-briefing.js:235` live. Abhilfe belegt: `thinking:{"type":"disabled"}`
  im Body -> beides HTTP 200, dazu 7-10x weniger Latenz (2,1-3,1 s -> ~0,31 s). **Nur isoliert
  getestet (n=2), nicht ueber den vollen Loop**, und in dem Modus kam kein gesprochener
  Fuelltext neben dem erzwungenen Aufruf (stille Leitung waehrend der Werkzeug-Ausfuehrung).
- **B3-W4 beantwortet:** mit `stream:true` kommen `tool_calls` **fragmentiert ueber viele
  SSE-Chunks** und muessen ueber `index` zusammengesetzt werden — eine durchreichende Sink
  wuerde kaputte JSON-Fragmente weitergeben. `reasoning_content` streamt als eigener Kanal
  VOR dem sichtbaren Text (undokumentiert).
- **Verbrauchsfelder:** `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`,
  `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`
  (nur im Thinking mode, Teilmenge von `completion_tokens`, zum normalen Output-Satz).
- **W2 (unparsebare Werkzeug-Argumente) weiter unbeobachtet** — nicht widerlegt, nur nie
  eingetreten.
- Kosten des Spikes: **~0,0017 USD**.

### Neu offen (aus der Live-Abnahme, NICHT aus Track B)

- **Precall-Briefing und Gespraechs-Zusammenfassung sterben beide an `retries-exhausted`.**
  Briefing: 1 Versuch, 6007 ms -> das ist ein **Timeout**, kein Fehler. Summary: 3 Versuche,
  10766 ms. Folge: `get_transcript` liefert keine Zusammenfassung. **Und es werden
  GESCHAETZTE Kosten gebucht** (`grund=retries-exhausted, in~816, out~700`) fuer einen
  Aufruf, der nichts geliefert hat.
- **`configHash` deckt die Preistabelle nicht ab.** Der Hash ist ueber ALLE Deploys hinweg
  identisch (`90c7d824...`), auch ueber diesen, der `config.js` um 194 Zeilen Preisstaffeln
  geaendert hat. Er taugt damit nicht als Drift-Anzeiger fuer Preise.
- **Testzahl-Differenz zum Kickoff:** `npm test` meldet **4077** (fail 0, Exit 0), der Kickoff
  behauptete 4057. Der Katalog-Filter ist intakt (0 Katalog-IDs im Regressionslauf gemessen),
  die Suite ist gruen — die Zahl in der Kickoff-Notiz ist ungenau, kein Defekt.

## B3b — Anfrageseite neutralisiert. ERLEDIGT + GEMERGT (2026-08-09, Merge 48b9617)

Gate PASS **ohne Fix-Runde** (5 Agenten, ~756k Subagent-Token, ~70 min). 13 Dateien, +441/-84.
Spec: `tasks/b3b-spec.md`. Impl-Commit `f2b3920`.

### Was gebaut wurde

- **Der Adapter uebersetzt jetzt auch die ANFRAGE.** `toAnthropicRequest` (vormals
  `withAnthropicMessages`) bildet `system` / `tools` / `maxTokens` / `toolChoice` /
  `cachePrefix` schluesselweise an Ort und Stelle ab. `claude.js` und `precall-briefing.js`
  sprechen **kein Anthropic-Vokabular mehr**.
- **`src/llm/tool-choice.js`** — dreiwertiges `LlmRequest.toolChoice` (`AUTO` / `REQUIRED` /
  `forcedTool`) als eigene kleine Quelle.
- **`LlmRequest.cachePrefix`** (E6) — ein boolescher Anbieter-HINWEIS statt Anthropics
  `cache_control`-Marker im Fachcode. Der Fachcode sagt "cache diesen Vorspann", der Adapter
  weiss, wie das bei Anthropic aussieht.
- **`bridge.js`** folgt dem K22-Nachzug (`realtimeTools` liefert `parameters` statt
  `input_schema`).

### Lead-Verifikation, selbst gefahren

| Probe | Ergebnis |
|---|---|
| Restmenge `claude.js` | `input_schema`/`cache_control`/`max_tokens`/`tool_choice` = **0/0/0/0** |
| Restmenge `precall-briefing.js` | **0/0/0/0** |
| `bridge.js` | `input_schema` 0; das eine `tool_choice` ist **OpenAI-Realtime**-Vokabular am OpenAI-Draht (kommentiert), kein Anthropic-Leck |
| **Golden-Master `42a2fe5`** | **NICHT angefasst und gruen** — der ausgehende Body ist byte-identisch geblieben trotz Komplettumbau |
| Suite im Worktree | 4086 tests, **fail 1** -> `AM6` isoliert **5/5 gruen** |
| B3B-Tests | **9/9**, inkl. Positiv-Kontrolle (B3B-1) und fail-closed bei unbekannter Wahl (B3B-4) |
| Syntax | `node --check` auf allen sechs Produktionsdateien ok |
| Auf `master` nachgefahren | B3b + Golden-Master **17/17 gruen** |

**Der Golden-Master ist der wertvollste Beleg dieser Phase:** eine Datei, die NICHT im Diff
steht und trotzdem gruen bleibt, beweist mehr als jeder neu geschriebene Test — der Draht nach
aussen hat sich nicht bewegt.

### Zwei Fallen bei der Abnahme (Lehren in `tasks/lessons.md`)

1. `git checkout <branch>` scheiterte STILL am belegten Worktree -> `npm test` lief auf
   `master` und meldete 4077 gruen. Aufgefallen nur durch die Gegenfrage "kommen die NEUEN
   B3B-Tests ueberhaupt vor?" (`grep -c` -> 0).
2. Workflow meldete `fail 0`, eigener Lauf fand `fail 1` — **zum zweiten Mal in diesem Repo.**
   Flake-Beleg ist nicht das gruene Isoliert-Ergebnis, sondern die Laufzeit (321 ms isoliert
   gegen 3449 ms unter Volllast) plus das Bereichsargument (B3b fasst OAuth/MCP nicht an).

### Was jetzt noch fehlt, damit der Anbieterwechsel real ist

**Nur noch B5**: DeepSeek-Adapter + Registry (`LLM_PROVIDER`), also K20/K21 der Grenztabelle.
Bindend aus dem Spike (2026-08-09): `deepseek-v4-pro` lehnt im Thinking-Mode
`tool_choice:"required"` UND die benannte Form mit **HTTP 400** ab; Abhilfe
`thinking:{"type":"disabled"}` ist belegt, aber nur isoliert (n=2). Ausserdem kommen
`tool_calls` beim Streaming **fragmentiert ueber viele SSE-Chunks** und muessen ueber `index`
zusammengesetzt werden — eine durchreichende Sink gaebe kaputte JSON-Fragmente weiter.

## B5 — DeepSeek-Adapter + Registry. ERLEDIGT + GEMERGT (2026-08-09, Merge f2f4927)

Gate PASS **ohne Fix-Runde** (5 Agenten, ~897k Subagent-Token, `highStakes:true`).
17 Dateien, +1376/-72. Spec: `tasks/b5-spec.md`. Impl-Commit `ca8a14f`.

### TRACK B IST DAMIT ABGESCHLOSSEN

Der Anbieterwechsel ist eine **reine Env-Operation**: `LLM_PROVIDER=anthropic|deepseek`.
Default `anthropic` — der Live-Betrieb aendert sich durch diese Kette NICHT.

### Was gebaut wurde

- **`src/llm/adapters/deepseek.js`** — zweiter Adapter, nacktes `fetch` + eigener SSE-Leser,
  **KEINE neue Dependency** (`package.json` unberuehrt).
- **`src/llm/registry.js`** — Wahl aus dem config-Singleton, Schluessel lazy je Anbieter,
  fail-closed ueber `Object.hasOwn` (faengt auch `__proto__`).
- **`src/llm/provider.js`** (Enum) und **`src/llm/transient-errors.js`** — die
  anbieter-unabhaengige Fehlerklassifikation, aus dem Anthropic-Adapter extrahiert (G5/S2).
- **`createLlmClient` verliert den `apiKey`-Parameter.** Der Fachcode kennt keinen Schluessel
  mehr; die Registry entscheidet. Das ist die gesamte Aenderung an `claude.js` (2 Zeilen).

### Lead-Verifikation, selbst gefahren

| Probe | Ergebnis |
|---|---|
| Suite **im Worktree** | **4110/4110**, fail 0, 0 `not ok` |
| **Merkmal der Aenderung** | 24 B5-Tests gruen — der Lauf lief nachweislich auf dem richtigen Stand |
| Golden-Master `42a2fe5` | nicht im Diff, **8/8 Formen gruen** — der Anthropic-Draht hat sich nicht bewegt |
| Fachcode anbieter-frei | `claude.js`/`precall-briefing.js`: alle vier Marker **0** (case-sensitiv) |
| Syntax | `node --check` auf allen neun Produktionsdateien ok |
| Offline-Invariante | keine echte URL, kein direkter `fetch`-Aufruf in den Tests |
| Regel 1 (Preis) | `deepseek-v4-pro` hat eine Staffel mit `source`; `cacheWrite==in` ist begruendet, **kein Platzhalter** |

### Der Smoke-Test, der die Phase beweist (Dreierprobe am laufenden Dienst)

| `LLM_PROVIDER` | Ergebnis |
|---|---|
| `deepseek` | **laeuft**, `/healthz` 200 |
| nicht gesetzt (Default) | **laeuft** |
| `anthropic` | **laeuft** |
| `nicht-existent` | **Boot abgebrochen**: `LLM_PROVIDER="nicht-existent" ist unbekannt (gueltig: anthropic\|deepseek)` |

Die Gegenproben sind der eigentliche Beleg: ein Boot-Abbruch allein zeigt nur, dass der Dienst
nie startet. Erst die drei laufenden Faelle machen den vierten aussagekraeftig.

**Nebenbefund aus dem Smoke-Test (kein B5-Defekt):** die lokale `.env` setzt
`COST_TRUING_REQUIRED_RECORD_TYPES` nicht — der Boot bricht deshalb ab. `BASE_ENV`
(`test/helpers.js`) setzt `"sip-trunking,call-control"`. Wer lokal einen Server startet,
braucht den Wert; `.env.example` fuehrt ihn leer.

### W2 ist ENTSCHIEDEN

Unparsebare Werkzeug-Argumente werden **fail-closed abgelehnt**, mit benanntem Werkzeug in
der Meldung (B5-6), inkl. Randfall "parst zu einem Nicht-Objekt" (B5-7). Begruendung: B5 ist
der erste Adapter, der Argumente wirklich parst (Anthropic liefert Objekte, DeepSeek
JSON-Strings). Ein still verschluckter Parse-Fehler waere im Telefonpfad eine falsche
Handlung.

### Die Spike-Befunde sind im ADAPTER geloest, nicht im Vertrag

- `thinking:{"type":"disabled"}` gegen den HTTP-400 der Werkzeugwahl im Thinking-Mode
- `tool_calls` werden ueber `index` aus SSE-Fragmenten zusammengesetzt (B5-11)
- `reasoning_content` erreicht **weder Sink noch `turn.text`** (B5-12) — der Anrufer hoert
  keinen Denk-Text
- `reasoning_tokens` sind Teilmenge von `completion_tokens`, werden **nicht doppelt gebucht**

### Gates-Lauf (2026-08-09, auf dem B3b-Stand)

`npm run test:gates` -> 603 Tests, **5 rot**, Exit 0. Alle fuenf sind **Bestandsbefunde**,
keiner beruehrt LLM/Adapter/Anbieter: `auth-p9a-cache-headers`, `GAP-05`
(Stripe-Promo-Codes), **`GAP-15` zweimal (traegt "SOLL rot" im Namen** — fehlende
EN-Rechtstexte/Platzhalter), `E2E-03` (Sprachumstellung im Anruf). Rot ist hier der
dokumentierte Sollzustand, kein Regressionsfang.

## FIX-1 + GQ-P17 — ERLEDIGT + GEMERGT (2026-08-09)

Beide Gate PASS ohne Fix-Runde. Merges `cd23fc9` (FIX-1) und `6ef065c` (GQ-P17).

### FIX-1: die Zusammenfassung konnte strukturell nie gelingen

An der echten API gemessen: 800 Output-Token brauchen **7745 / 8856 / 8985 ms**, der
Timeout war **3500 ms** je Versuch. Drei Versuche scheiterten IMMER, wenn die Antwort den
Platz ausnutzte — im Live-Anruf als `attempts:3, latencyMs:10766` sichtbar. Der Defekt traf
genau die LANGEN Gespraeche, wo die Zusammenfassung am wertvollsten ist; kurze Antworten
kamen durch, deshalb fiel es nie als "immer kaputt" auf.

Die 3500 ms sind mit dem 15-s-Webhook-Hardcut begruendet — aber `summarizeCall` laeuft gar
nicht im Webhook-Antwortpfad (`bill()` ist fire-and-forget, `call-termination.js:31`).
**Loesung: eigener `CALL_SUMMARY_TIMEOUT_MS` (Default 20000, 1 Retry).** Sprechpfad-Timeout
unveraendert 3500, `briefingTimeoutMs` unveraendert 6000, `turn-budget.js` unberuehrt.

Teil 2: die Metrik-Whitelist trug nur zwei der vier Token-Sorten. `input_tokens` und
`output_tokens` ergaenzt — **damit ist W6 (B4b) ueberhaupt erst beantwortbar.** Die Whitelist
BLEIBT eine Whitelist (`LLM_OPTIONAL_FIELDS`); `FIX1-5` belegt, dass weiterhin nur Zahlen
durchkommen, nie Transkript/Prompt/Modelltext.

### GQ-P17: die Doppelantwort — Wurzel war NICHT konfigurierbar

Belegt an der Telnyx-Doku: `eot_threshold`/`eot_timeout_ms`/`eager_eot_threshold` gelten
**nur fuer `deepgram/flux`**, `min_turn_silence`/`max_turn_silence` **nur fuer AssemblyAI**.
**Fuer `deepgram/nova-3` existiert KEIN Turn-End-Regler.** Die Werte in unserer Live-Config
sind Flux-Parameter und tun seit dem STT-Wechsel am 08-08 nichts. Das erklaert die
Verschaerfung: 4 Fragmentierungen auf 13 Turns mit Flux, **5 auf 8** mit nova-3.

Verworfen: zurueck auf Flux (englisch-only, 97 % WER auf Deutsch, B-7), AssemblyAI
(Modellwechsel mit ungemessener Deutsch-Qualitaet — braeuchte erst eine WER-Messung).

**Gebaut: `src/telnyx-turn-hold.js` + Schritt 7.5 im Shim.** Ein Request, dessen Text den
gehaltenen Vorgaenger fortschreibt, ueberholt ihn; der Vorgaenger ruft NIE `agentTurn` und
antwortet mit einer leeren, gueltigen Completion — kein Token-Burn, keine zweite Recherche,
keine Transkriptzeile. Die Registry speichert je Call **nur den Freigeber**, nie Text.

`TELNYX_SHIM_EXTEND_HOLD_MS`: Default **3000** (deckt die weiteste gemessene Fragment-Luecke
von 2926 ms), max 3500 (darueber liefe die Frist in Telnyx' eigenes Anstoss-Fenster,
`user_idle_reply_secs`=4 s), **0 = aus als Rueckweg ohne Code-Deploy**.
**PREIS: jede FERTIGE Aeusserung wird um die Frist spaeter beantwortet.**

### Die widerlegte Praemisse — bindend festgehalten

`gq-chain-state.md` nannte eine Haltefrist *"den falschen Hebel — sie tauschte Latenz gegen
ein Doppelsprechen, das es nicht gibt"*. **Es gibt es** (zwei gesprochene Wetterberichte mit
widersprechenden Zahlen, in Telnyx' Protokoll nachweisbar). Die alte Begruendung galt fuer
den Flux-Stand, auf dem der Provider die Fragmente selbst zusammenhielt.

### Lead-Verifikation, selbst gefahren

| Probe | FIX-1 | GQ-P17 |
|---|---|---|
| Suite im Worktree | **4116/4116**, fail 0 | **4135/4135**, fail 0 |
| Merkmal der Aenderung | 6 FIX1-Tests | **19/19** GQ-P17-Tests |
| Rueckweg belegt | — | `GQ-P17-12`: Frist 0 -> Bestandsverhalten |
| Gate nicht verzoegert | — | `GQ-P17-14`: gesperrte Kostendecke antwortet SOFORT |
| nichts verschluckt | — | `GQ-P17-10` (`same`), `GQ-P17-16` (gesprochene Zeile ueberlebt) |
| Boot-Probe am neuen Stand | — | Dienst startet, `/healthz` 200, keine neue Startpflicht |

### Offen: die Abnahme braucht einen Anruf

Beide Fixes sind **ungemessen am echten Gespraech**. Der naechste Testanruf muss liefern:
1. eine Zusammenfassung (vorher: keine),
2. `hold`-Zeilen mit `outcome extended` (unterdrueckte Fragment-Turns) UND `elapsed`
   (Frist scharf) — ohne den zweiten Wert ist "wirkungslos" von "nicht scharf" nicht zu
   unterscheiden,
3. alle vier Token-Sorten in den `[metrics] llm`-Zeilen,
4. das Owner-Urteil zur Latenz (3000 ms sind zum Trimmen gedacht).

### GQ-P17 LIVE-ABNAHME: Mechanismus wirkt, Latenz vom Owner ABGELEHNT (2026-08-09)

Anruf `call_mslz71hv6ogm` auf dem Stand `97c7b95`.

**Der Mechanismus wirkt:** 6 `hold`-Zeilen, davon **2 `outcome: extended`** (turnSeq 5+6,
~2 s auseinander) — zwei Fragment-Turns unterdrueckt, keine zweite `look_up`-Recherche.

**Der Preis ist inakzeptabel.** Owner woertlich: *"latenz war extrem lange absolut
inakzepatable"*. 4 von 6 Fristen liefen komplett ab (`elapsed`), und **`shim_turn` misst die
Frist NICHT mit**:

| `shim_turn` | + Frist | tatsaechliche Wartezeit |
|---|---|---|
| 1321 ms | 3000 | 4,3 s |
| 5099 ms | 3000 | 8,1 s |
| **7607 ms** | 3000 | **10,6 s** |

Vorher (ohne GQ-P17): `shim_turn` 1306-4911 ms ohne Aufschlag.

**Sofortmassnahme:** `TELNYX_SHIM_EXTEND_HOLD_MS=0` in der Render-Env gesetzt (per
`mcp__render__update_environment_variables`, merged, loest Restart aus). Der Rueckweg war
dafuer eingebaut.

**Der Denkfehler des Leads, benannt:** die Annahme, die Frist sei "nur spuerbar, wenn der
Anrufer fertig geredet hat". Genau dann kostet sie voll — und das ist der Normalfall (4 von
6). Sie zahlt sich nur in den 2 Faellen aus, in denen wirklich ein Fragment nachkam. Eine
pauschale Frist bestraft die Mehrheit fuer die Minderheit.

**Umbau-Ansaetze (ungeprueft, in `tasks/kickoff-latenz-und-gespraech-2026-08-10.md`):**
adaptiv statt pauschal; deutlich kuerzer (800-1200 ms); Satzzeichen als Fragment-Signal —
dafuer muesste `smart_format` bis in den Call kommen, was der Pro-Call-Block
(`voice.js:343`, nur `{model, language}`) heute verhindert.

### FIX-1 LIVE ABGENOMMEN — beide Teile belegt

1. **Die Zusammenfassung kommt wieder.** `get_transcript` lieferte einen echten
   `result_summary` (inhaltlich ein vernichtendes Urteil ueber das Gespraech — aber DASS er
   kommt, ist der Beleg; vorher kam gar nichts).
2. **Alle vier Token-Sorten stehen im Log**, am Anruf gemessen: `input_tokens: 4207`,
   `output_tokens: 49`, an anderen Zeilen `cache_creation_input_tokens: 4192` und
   **`cache_read_input_tokens: 4192`**.

**Damit ist eine frueher notierte Vermutung WIDERLEGT:** es gibt sehr wohl Cache-Treffer.
Die Annahme "kein einziger Cache-Treffer" vom selben Tag beruhte auf der Abwesenheit der
Felder — die aber schlicht nicht geloggt wurden. **B4b ist ab jetzt messbar und braucht
keinen neuen Code mehr.**
