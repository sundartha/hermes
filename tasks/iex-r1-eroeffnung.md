# IEX-R1 — Inbound-Eroeffnung als EIN Satz, Fehlersatz statt Budget-Rueckfall (Recherche)

Stand 2026-09-15, master `2893367`. Nur gelesen. Einzige Anbieter-Zugriffe: `npm run elevenlabs:drift`
(GET, Exit 1 wegen bekannter Abweichungen) und `scripts/anruf-unterbrechungen.mjs` (GET, nur Zahlen),
Render-Logs (lesend), Telnyx-Doku.

Bindend: Owner-Entscheidungen 2026-09-15 (1) EIN Eroeffnungssatz als `first_message`, kein Pflichtsatz davor;
(2) Uebergabe scheitert -> fester Fehlersatz + Auflegen, keine Owner-Benachrichtigung, kein Budget-Rueckfall.

---

## 1. Gesprochene Texte heute

Unterstuetzte Locales: **de, fr, en** (`src/i18n/locales.js#SUPPORTED_LANGUAGES` = `Object.keys(LOCALES)`).
`pt` ist NICHT auf master (Branch `phase/p4b-portugiesisch-fix3` ungemergt, Memory `anrufdefekte-chain`:
"pt-Offenlegungssatz nicht freigegeben"). Die Agent-Vorlage fuehrt `language_presets` de/fr/**es**
(`es.first_message = null`, `elevenlabs/agent_configs/outbound-agent.template.json`) — fuer Inbound irrelevant,
weil die Init-Antwort `first_message` immer uebersteuert.

| Baustein | de | en | fr | Quelle |
|---|---|---|---|---|
| (a) Inbound-Pflichtsatz | "Hinweis: Sie sprechen mit einer KI, das Gespräch wird transkribiert und zusammengefasst." | "Please note: you are speaking to an AI, and this call is transcribed and summarised." | "Information : vous parlez à une IA, cet appel est transcrit et résumé." | `i18n/inbound-notice.js#INBOUND_NOTICES` (Commit 0320649, GAP-14/O7) |
| (b) Begruessung Default (Pflichtsatz davor, at rest) | "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht für {owner} aufnehmen. Wie kann ich helfen?" | "Hi, this is the AI assistant of {owner}. {owner} can't take the call right now. I can take a message for {owner}. How can I help?" | "Bonjour, vous êtes en relation avec l'assistant IA de {owner}. {owner} n'est pas disponible pour le moment. Je peux prendre un message pour {owner}. Comment puis-je vous aider ?" | `store/defaults.js#DEFAULT_GREETING`, `locales.js` `greetingDefault` |
| (b) Variante [0] | "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht für {owner} auf. Wie kann ich helfen?" | "Hello, you're through to {owner}'s AI assistant. I'll take a message for {owner}. How can I help?" | "Bonjour, vous êtes bien en ligne avec l'assistant IA de {owner}. Je prends note de votre message pour {owner}. Comment puis-je vous aider ?" | `locales.js` `greetingVariants` |
| (b) Variante [1] | "Hallo! Der KI-Assistent von {owner} hier. Wie kann ich Ihnen weiterhelfen?" | "Hi there! This is {owner}'s AI assistant. How can I help you?" | "Bonjour ! Ici l'assistant IA de {owner}. Comment puis-je vous aider ?" | dito |
| (b) EL-`first_message` heute | Begruessung ohne fuehrendes `notice + " "` (`begruessungOhnePflichtsatz`); live belegt: "Hallo, hier ist der KI-Assistent von …" | analog | analog | `elevenlabs/inbound-initiation.js#inboundOverride`, `tasks/iel-cutover-protokoll.md` Schritt 11 (M11) |
| (c) Outbound-Offenlegung | "Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${owner}. Das Gespräch wird für meinen Auftraggeber zusammengefasst." | "Hello, this is an AI assistant calling on behalf of ${owner}. This conversation will be summarised for the person I represent." | "Bonjour, ceci est un assistant IA mandaté par ${owner}. Cette conversation sera résumée pour mon mandant." | `locales.js#LOCALES.<l>.disclosure` (`makeDisclosure`, Fallback `disclosureOwnerFallback`) |
| (c) Owner-Eroeffnung (OC) | "Hallo ${firstName}, hier ist dein KI-Assistent." | (analog je Bundle) | (analog) | `locales.js#ownerOpening` |
| (d) Technischer Fehler | "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es später erneut." | "Sorry, a technical problem occurred. Please try again later." | "Désolé, un problème technique est survenu. Veuillez réessayer plus tard." | `locales.js#turnErrorSpeech`; gesprochen von `routes/voice.js#sendTechnischesEnde` (catch `/voice/incoming` und `/voice/el-rueckfall`) |
| (d) Rueckfall-Begruessung | `quelle=dial_ende` -> (b) ohne Pflichtsatz; jede andere Quelle -> (a)+(b) | | | `i18n/inbound-notice.js#rueckfallBegruessung`, `routes/voice.js#starteRueckfall` |
| (d) Owner-Wortlaut "…bitte rufen Sie später noch einmal an." | **fehlt** | **fehlt** | **fehlt** | grep `src/i18n`: kein Treffer |

**Freigabe-Status:** Outbound-Offenlegung de/en/fr = fest verdrahtet, "kuratiert (R8)" (Kommentare `locales.js`),
per Absolute Regel 2 geschuetzt. Inbound-Pflichtsatz und Katalog-Vorlagen: seit 0320649 live, eine
ausdrueckliche Owner-Freigabe-Notiz fand ich nicht -> UNBELEGT (Bestand, nicht beanstandet).
Owner-Entscheidung 2026-09-15 liefert den **DE**-Wortlaut von Eroeffnung und Fehlersatz; en/fr dazu gibt es nicht.

**Marker-/Riegel-Pruefungen auf Inbound-Texten heute:**
- `store/state-ops.js:5165` `FIELD_GUARDS.greeting = hasInboundNotice` — `updateSettings` verwirft ein Greeting ohne KI- UND Transkriptions-Marker (Regex `AI_MARKERS`/`TRANSCRIPT_MARKERS`, `inbound-notice.js:24-30`; Transkript-Staemme enthalten bereits `aufgezeichnet|aufzeichnung|recorded|enregistr`).
- `store/greeting-notice-migration.js` (Boot) und `greeting-catalog.js#buildTemplates` — `withInboundNotice` stellt den Satz voran, wenn Marker fehlen.
- `routes/voice.js#sendBudgetBegruessung` — `withInboundNotice` (idempotent).
- EL-Weg: Pflichtsatz wird von UNS per Play gesprochen (`voice.js#sendElUebergabe:132-151`). Die Init-Antwort prueft nur Weissliste, kein `{{`, `first_message` nicht leer (`inbound-initiation.js#assertAntwortSicher`) — **kein Marker- und kein startsWith-Riegel auf `first_message`**.
- Art.-50-startsWith-Riegel (`elevenlabs/convai.js#assertDisclosureCarried`/`pflichtsatzFehlt`) greift NUR in `startOutboundCall` (Outbound, und nur bei Sprachabweichung). Nicht auf Inbound.
- Tests: `test/inbound-disclosure-mandatory.test.js` (ex GAP-14 a/b, Budget-Weg), `test/web-greeting-templates-i18n.test.js` ("jede Vorlage traegt den Pflichtsatz", ex WEB-04), `test/iel-init-webhook.test.js` IEL-B6-6b/13a, `test/iel-b8-weiche.test.js` IEL-B8-2..5/12/18/19.

---

## 2. Zusammensetzung aus vorhandenen Bausteinen

Vorschlag (nur vorhandene Saetze, Reihenfolge nach Entscheidung 1: Name -> KI-Hinweis -> Frage):

| Locale | Satz 1 (Name, traegt "KI") | Satz 2 (KI + Transkription) | Satz 3 (Frage) |
|---|---|---|---|
| de | "Hier ist der KI-Assistent von {owner}." (Owner-Wortlaut; nah: `greetingDefault` S1 "Hallo, hier ist …") | `INBOUND_NOTICES.de` | "Wie kann ich Ihnen weiterhelfen?" (`greetingVariants[1]` S2; Owner-Wortlaut "Wie kann ich weiterhelfen?" ohne "Ihnen" existiert nicht woertlich) |
| en | "Hi, this is the AI assistant of {owner}." (`greetingDefault` S1) oder "This is {owner}'s AI assistant." (`greetingVariants[1]` S2) | `INBOUND_NOTICES.en` | "How can I help you?" (`greetingVariants[1]`) |
| fr | "Ici l'assistant IA de {owner}." (`greetingVariants[1]` S1) | `INBOUND_NOTICES.fr` | "Comment puis-je vous aider ?" |

- Satz 1 traegt "KI/AI/IA" -> der erste gesprochene Satz ist Art.-50-kennzeichnend; `hasInboundNotice(ganzer Satz)` = true.
- Umsetzungshinweis: Saetze als eigene Konstanten im Bundle (G5), NICHT aus Katalog-Strings herausschneiden; die Katalog-Vorlagen (Self-Service) bleiben unberuehrt, solange der Budget-Weg fuer ungepinnte Tenants lebt.
- **Fehlt je Locale:** Fehlersatz im Owner-Wortlaut (de/en/fr), en/fr-Fassung von Satz 1 in Owner-Form ohne Gruss, Namens-Rueckfall (s. u.). Ohne neuen Text machbar: Satz 1 + `turnErrorSpeech` (alle drei Locales vorhanden).
- **Namens-Rueckfall fehlt:** `tenantContext.ownerName` kann `""` sein (`state-ops.js:2076-2080`); heute ergaebe das "…KI-Assistent von . . kann gerade nicht…" (latenter Bestandsdefekt, Inbound hat kein Identitaets-Gate). `disclosureOwnerFallback` passt grammatisch nicht ("der KI-Assistent von meinem Auftraggeber").
- **Wahrheit "Aufzeichnung":** Live `record_voice = true` und `retention_days = -1` (Drift-Lauf heute, als bewusste Ausnahme seit 2026-08-15, "vor dem ersten Fremdkunden zurueckdrehen"). Der heutige Hinweis nennt nur "transkribiert und zusammengefasst" — ein Audio-Mitschnitt beim Anbieter wird nicht erwaehnt. TeXML zeichnet nicht auf (`render.js#renderDialSip` setzt kein `record`).
- Gates/Tests fuer neue gesprochene Strings: `GAP-31` (SOLL, rot; `test/locale-field-consumers.test.js`: jedes Bundle-Feld braucht Produktionskonsumenten) — `npm run test:gates`; `P1-U1/U2` (`test/de-umlaut-orthography.test.js`, SPOKEN_DE_FIELDS: neues DE-Feld eintragen, echte Umlaute "später/Gespräch") — `npm test`; `PROMPT-14`/`PROMPT-03` (EN-Call frei von Deutsch, Greeting) — `npm test` (ex-IDs); `WEB-04`-Katalogtests nur, wenn Vorlagen angefasst werden. Umzuschreiben: IEL-B6-6b, IEL-B6-13a, IEL-B8-2..5, -12, -18, -19 (pinnen Pflichtsatz-vor-Dial und Rest-`first_message`).
- Neuer Riegel noetig (fail-closed, Muster `assertDisclosureCarried`): Init-Antwort wirft, wenn `first_message` nicht mit Satz 1 der Anrufsprache beginnt oder `hasInboundNotice` false ist. Heute fehlt er, weil der Pflichtsatz nicht im `first_message` stand.
- Kleinigkeit: `inboundOverride` nimmt die Begruessung aus `call.language`, `bundle`/`language` aus `inboundElLocaleOf(...).language` — zwei Quellen; der neue Satz sollte nur eine lesen.
- `EN_PROMPT.inboundSituation` (`i18n/prompts/en.js:79-84`): "Your greeting and the notice … have already been said … before you took over. Do NOT repeat them." — bleibt inhaltlich richtig (first_message laeuft vor dem ersten Modellzug), kein Pflicht-Push.

---

## 3. Unterbrechbarkeit

- **Live heute belegt:** `npm run elevenlabs:drift` (2026-09-15, GET) meldet 5 Abweichungen (retention_days, record_voice x2, drei Werkzeug-Felder), **nicht** `disable_first_message_interruptions` und nicht `transcribe_on_disabled_interruptions`, bei "0 nicht pruefbare Stellen" -> live = Vorlage: `disable_first_message_interruptions = true`, `transcribe_on_disabled_interruptions = false` (Vorlage `agent.conversation_config`, Besitz-Eintraege Z. 467/478; Test `test/elevenlabs-anrufstart.test.js` EL-START T5).
- **Gilt es fuer einen `first_message`-OVERRIDE?** Anbieter-Schema: "If true, the user will not be able to interrupt the agent while the first message is being delivered" (zitiert im Test, openapi 2026-08-18) — nennt keine Quelle. **UNBELEGT -> Messfrage.** Einzige Stichprobe: Inbound-Anruf `conv_0801m2j0ydhwef7b2t171csdf3xn` (Override-`first_message`): `anruf-unterbrechungen.mjs` -> 5 Agenten-Turns, **0 unterbrochen** — nicht diskriminierend (kein Unterbrechungsversuch belegt).
- **Outbound belegt die vollstaendige Zustellung heute NICHT maschinell.** `assertDisclosureCarried` prueft vor dem Netz nur den gesendeten Wortlaut (startsWith, bei Sprachabweichung). `transcript[0].interrupted` wird im Code nirgends gelesen (grep `interrupted` in `src/`: 0; nur Analyse-Skript `scripts/anruf-unterbrechungen.mjs`). Memory `offenlegung-ist-unterbrechbar`: Rotsignal ist `transcript[0].interrupted === true`, nicht als Testdefinition ausdrueckbar.
- Folge fuer Entscheidung 1: der KI-Hinweis wird kuenftig vom Anbieter gesprochen (heute von uns per Play, nicht unterbrechbar durch den Agenten-Turn). Der laengere Satz (~3 Saetze) ist gesperrt; Rede des Anrufers waehrenddessen wird verworfen (`transcribe_on_disabled_interruptions=false`, Preis seit 2026-09-04 akzeptiert).
- Messfrage M-U1: an einem Inbound-Anruf mit gezieltem Dazwischenreden `transcript[0].interrupted` lesen (Skript ohne Werte, E22).

---

## 4. Stille beim Verbindungsaufbau (Testanruf `call_mu2dlfnebk9c`)

Render-Logs 07:54:00–07:54:20 UTC (alle Typen, eigener Abruf): genau 4 App-Zeilen; **keine Request-Logs** (Filter `type=request`: 0) -> der Abruf der Play-Datei durch Telnyx ist nicht datierbar.

| Zeit (UTC) | Ereignis | Delta |
|---|---|---|
| 07:54:07.612 | `[inbound-path] elevenlabs` (vor Synthese) | 0 |
| 07:54:08.920 | `[play-tts] Synthese vollstaendig (erstes Audio 444 ms, Gesamt 1306 ms)` -> TeXML-Antwort | +1,31 s |
| ≈07:54:08.98 | Traeger-Annahme, abgeleitet: `completed` 07:55:07.980 − `callDurationS 59` (±1 s Rundung) | ≈+1,37 s |
| 07:54:15.572 | `[el-bein] in-progress` (SIP-Bein beantwortet) | +6,65 s nach Synthese-Ende |
| 07:54:16.031 | `[el-init] gebunden` | +0,46 s |
| ≈07:54:16–17 | EL-Gespraechsbeginn, abgeleitet aus `call_duration_secs 51` | — |

- **Aufteilung:** die 1,31 s Synthese lagen VOR der Annahme (Anrufer hoert das Klingeln seines Netzes). Die 6,65 s danach = Play-Abruf + Pflichtsatz-Wiedergabe + SIP. SIP-Anteil gemessen in M1 (J3/J4): INVITE -> 407 -> re-INVITE (+0,29 s) -> 200 OK, gesamt < 1 s. => Pflichtsatz-Wiedergabe ≈ 5,7–6,4 s (abgeleitet; Audiodauer nicht geloggt -> Messfrage M-S1).
- **Ohne Pflichtsatz** zwischen Annahme und Agentenstimme: SIP ≈ 0,7–1 s + Init ≈ 0,46 s + EL-Zeit bis erstes Audio der `first_message` (**UNBELEGT -> Messfrage M-S2**, z. B. Mitschnitt/`sip-messages`-Zeitstempel). Synthese (1,3 s) und Wiedergabe (≈6 s) entfallen.
- **Was hoert der Anrufer waehrend `<Dial>`?** Telnyx-Doku Dial (abgerufen 2026-09-15): `ringTone` "The ringback tone played back to the caller", Default **`us`**; `audioUrl` "custom ringback tone … while waiting for the call to be answered"; `answerOnBridge` "If set to true, the inbound call will not be answered until the dialed call is answered. This preserves the ringing state on the caller's side. **Only takes effect when the inbound call has not yet been answered.**" (Default false). Unser Renderer setzt weder `ringTone` noch `answerOnBridge` (`telephony/adapters/telnyx/render.js#renderDialSip`) -> heute US-Freizeichen, falls Telnyx es nach dem Play noch spielt (am Anruf nicht beobachtet).
- **Muss vor dem Dial angenommen werden?** Technisch nein: `markAnswered` (`routes/voice.js:491`) ist ein Server-Anker (Start-Anker Buchung, aeussere Frist E9), unabhaengig vom Traeger. Mit `<Dial answerOnBridge="true">` als ERSTEM Verb bleibt der Anruf bis zum SIP-200 unbeantwortet (eigenes Netz-Klingeln, keine Traeger-Minuten); Nebenwirkungen: Traeger-Start liegt ≈1–1,5 s nach `answeredAt` (Buchung konservativ zu hoch). **UNBELEGT -> Messfrage M-S3:** was passiert nach einem gescheiterten, nie beantworteten Dial — laeuft `<Redirect>` weiter und beantwortet der folgende `<Play>` (Fehlersatz) den Anruf? M1 F-F hat den Weiterlauf nur fuer bereits beantwortete Anrufe belegt. Fall J5 (unbekannte Kennung, 200 OK + Stille) wird auch mit `answerOnBridge` beantwortet -> Stille bis Frist.
- Konstanten mit Pflichtsatz-Annahme: `EL_DIAL_RING_TIMEOUT_S=10` (`inbound-rueckfall.js:12-19`), `EL_BRIDGE_START_DEADLINE_MS=30000` (`inbound-bridges.js`, Kommentar "Synthese bis 3,3 s + Wiedergabe etwa 6 s") — Startwerte, koennen nach Wegfall schrumpfen.

---

## 5. Fehlerpfade heute und Aenderung fuer Entscheidung 2

Entscheidung: `inbound-rueckfall.js#rueckfallEntscheidungFuer` (rein, Zustand aus `bridgeStateOf` + `elBoundAt`), Wirkung: `routes/voice.js#RUECKFALL_ANTWORT`.

| Ausloeser | Quelle / Zustand | Heute | Anrufer hoert heute | Nach Entscheidung 2 | gemessen |
|---|---|---|---|---|---|
| Dial scheitert (404 allowed_numbers, 407, Ring-Timeout) | `dial_ende`, WARTET | `RUECKFALL_STARTEN` -> Budget | Begruessungsrest, Budget-Gespraech | Fehlersatz + Hangup | M1 J4/J6 (TeXML laeuft weiter, Harness-Rueckfallsatz gehoert); an der Live-Route nicht (N3 nicht gebaut) |
| EL nimmt an, Init 404 (keine Bindung) -> Abbruch | `dial_ende`, WARTET | Budget | dito | Fehlersatz + Hangup | N1 (07:00 UTC): `status failed`, "Missing required dynamic variables in first message", 1 s (`tasks/iel-nachdeploy-messung.jsonl` Z. 1) |
| Bindung, Abbruch < `EL_MIN_CONVERSATION_MS` (5 s) | `dial_ende`, GEBUNDEN jung | Budget | dito | Fehlersatz + Hangup | nein |
| Bindung >= 5 s, EL-Bein endet | `dial_ende`, GEBUNDEN alt | `AUFLEGEN` | nichts | unveraendert | **ja**, live 07:55:07.914 `quelle=dial_ende entscheidung=auflegen` |
| 200 OK + Stille (J5), Init 429/500 | Frist innen 8 s ab answered / aussen 30 s ab `answeredAt` -> `redirectCall` `quelle=frist`, WARTET | Budget, volle Begruessung mit Pflichtsatz | Stille <= Frist, dann Begruessung | Fehlersatz + Hangup (nach <= Frist Stille) | J5 nur Stille belegt; Umleitung live ungemessen |
| `redirectCall` scheitert | `inbound-bridges.js#umleitenOderAuflegen` | `endCall` | Auflegen ohne Satz | unveraendert | nein |
| Handler `/voice/el-rueckfall` wirft | catch | `sendTechnischesEnde` (`turnErrorSpeech` + Hangup) | Fehlersatz (Bestand) | Satz auf neuen Fehlersatz | Test voice-incoming-catch-path |
| Wiederholte Zustellung nach Rueckfall | RUECKFALL | `FOLGE_GATHER` (Budget) | Mikro offen | Hangup (kein Budget-Turn) | nein |
| Call nicht aktiv | — | `AUFLEGEN` | — | unveraendert | Test |
| `/voice/incoming` wirft (vor Uebergabe) | catch | `turnErrorSpeech` + Hangup | — | nicht Teil von "Uebergabe scheitert" | Test |

**Noetige Aenderungen:**
1. `RUECKFALL_ENTSCHEIDUNG.RUECKFALL_STARTEN` -> neue Entscheidung "Fehlersatz + Auflegen"; `FOLGE_GATHER` nur noch `KEIN_EL_INBOUND` (Budget-Bein, 3.3). `markInboundElFallback` (set-once) behalten: er stoppt Poll/Abschluss (E7e), verweigert spaete Bindung (E5) und laesst `/voice/status` direkt abschliessen.
2. `starteRueckfall`/`rueckfallBegruessung`/`begruessungOhnePflichtsatz` und die E1-Ausnahme `dial_ende` vs. `frist` entfallen; Fehlersatz fuer alle Quellen gleich (Play-TTS in Agentenstimme wie heute E19).
3. `sendElUebergabe`: kein `sayWithVoiceId(pflichtsatz)`, kein `addTranscript(notice)`; `inboundOverride.first_message` = neuer Satz + Riegel (Abschnitt 2).
4. **Keine Owner-Benachrichtigung ist heute NICHT gegeben:** `/voice/status` -> `finishCall` (`telephony/call-finish.js:250-390`): mit Transkriptzeile und `completed` -> `summarizeCall` (LLM-Token), `addNotification`, Zusammenfassungs-SMS, Mail; ohne Transkript/nicht `completed` -> `failedTitle`-Notification + `reportFailedCall` (Mail/Ausfall-Melder). Beide Wege benachrichtigen -> expliziter Zweig noetig (z. B. `elFallbackAt` gesetzt -> keine Summary/Notification/SMS/Mail; Buchung bleibt). Inbox-Eintrag entsteht nicht (`inbox-entry.js#hasInboxSubstance` braucht Anrufer-Zeilen).
5. **Unterscheidung "Gespraech fand statt" vs. "Uebergabe gescheitert"** ist heute rein zeitlich: `GEBUNDEN` UND `now − elBoundAt >= 5000 ms` (`inbound-rueckfall.js#gespraechLiefLangGenug`). Bindung = Init-Webhook beantwortet, NICHT "Agent hat gesprochen". Luecke: ein Anbieterfehler > 5 s nach Bindung (vor oder nach der `first_message`) endet ohne Fehlersatz; ein echtes Gespraech < 5 s ist praktisch ausgeschlossen (die `first_message` allein dauert laenger). Diskriminierendes Signal (Conversation-Status/`transcript[0]` beim Anbieter) waere ein Abruf im `<Redirect>`-Pfad — Latenz UNBELEGT -> Messfrage M-F1.

---

## 6. Owner-Selbstanruf (Absolute Regel 2, OC)

Kein Inbound-Sonderfall: `calleeIsOwner`/`ownerOpening` werden nur im Outbound-Start gelesen (`elevenlabs/outbound.js:701/1157-1163/1284`, `convai.js`); `inbound-initiation.js`, `routes/voice.js` und `EN_PROMPT.inboundSituation` kennen keinen "Anrufer = Owner"-Zweig. Die OC-Ausnahme betrifft ausschliesslich Anrufe AN die eigene Nummer. Ruft der Owner seine DID an (so der Testanruf), hoert er den Dritt-Satz — keine Kollision mit dem neuen Ein-Satz.

---

## 7. Offene Owner-Fragen (nur neue Formulierungen)

- **F1 Aufzeichnung im KI-Hinweis:** `record_voice` ist live AN, der Hinweis sagt nur "transkribiert und zusammengefasst". Satz unveraendert lassen ODER ergaenzen: de "Hinweis: Sie sprechen mit einer KI, das Gespräch wird aufgezeichnet, transkribiert und zusammengefasst." / en "Please note: you are speaking to an AI, and this call is recorded, transcribed and summarised." / fr "Information : vous parlez à une IA, cet appel est enregistré, transcrit et résumé." (Marker-Regex deckt es bereits ab.)
- **F2 Fehlersatz en/fr:** de laut Owner "Hier ist der KI-Assistent von {owner}. Es ist ein technischer Fehler aufgetreten, bitte rufen Sie später noch einmal an." Vorschlag en "This is {owner}'s AI assistant. A technical error has occurred, please call again later." / fr "Ici l'assistant IA de {owner}. Une erreur technique est survenue, veuillez rappeler plus tard." Alternative ohne neuen Text: Satz 1 + `turnErrorSpeech`.
- **F3 Eroeffnung en/fr + Frage:** Freigabe der Zusammensetzung aus Abschnitt 2 (en "This is {owner}'s AI assistant." + Hinweis + "How can I help you?"; fr "Ici l'assistant IA de {owner}." + Hinweis + "Comment puis-je vous aider ?"); de "Wie kann ich Ihnen weiterhelfen?" statt "Wie kann ich weiterhelfen?".
- **F4 Name fehlt:** de "Hier ist ein KI-Assistent." / en "This is an AI assistant." / fr "Ici un assistant IA." — oder EL-Weg nur mit gesetztem Namen.

## Messfragen

M-U1 `transcript[0].interrupted` bei Override-`first_message` unter Dazwischenreden · M-S1 Audiodauer Pflichtsatz · M-S2 Zeit SIP-200 bis erstes Agent-Audio · M-S3 Verhalten `answerOnBridge` + gescheiterter Dial + nachfolgender `<Play>` · M-F1 Anbieter-Status im `<Redirect>`-Pfad abrufbar und schnell genug.
