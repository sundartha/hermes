# C-P6 — Kommentar-Nachlese nach dem Twilio-Ausbau

Spezifikation fuer **eine** Phase (`phase-impl-lean`). Umbrella: `PLAN-ANBIETER-PORT.md`,
Track C. Die Phase wurde von `tasks/c-p5-spec.md` Abschnitt 3, Kategorie (c) definiert und
dort ausdruecklich aus C-P5 herausgeschnitten:

> **Warum nicht in C-P5:** ein Kommentar-Diff ueber 200+ Zeilen ueberdeckt in der Pruefung
> genau die wenigen Zeilen, an denen Boot und Geld haengen.

Vorgaenger: C-P1, C-P1b, C-P2, C-P3, C-P4 (alle gemergt), C-P5 (parallel im Bau).

**Diese Phase aendert AUSSCHLIESSLICH Kommentare.** Kein Verhalten, kein Identifier, kein
String, der zur Laufzeit ausgewertet wird. Abschnitt 5 macht das hart.

---

## 0. Baseline und Baseline-Drift — ZUERST lesen

Die Trefferliste in Abschnitt 2 ist gegen **`master` = `9ddf1df`** (2026-08-07) erhoben.

**C-P5 merged VOR dem Bau dieser Phase.** C-P5 fasst `src/config.js`, `src/boot.js`,
`src/mcp-tools.js`, `src/route-policy.js` und 23 Testdateien an (Abschnitt 3.1) — Treffer
in genau diesen Dateien sind hier **bewusst nicht** klassifiziert, weil C-P5 sie selbst
raeumt. Ausserdem verschieben sich Zeilennummern in Dateien, die C-P5 anfasst.

**Erster Handgriff der Phase, vor jedem Edit:**

```
git grep -in twilio -- src/ test/ > /tmp/c-p6-ist.txt
```

und diese Liste gegen Abschnitt 2 abgleichen. Die Liste hier ist die **Vorlage**, nicht das
Messergebnis. Erlaubte Abweichungen:

- Ein Treffer **fehlt** -> C-P5 hat ihn geraeumt. Kein Befund, im Report vermerken.
- Eine **Zeilennummer** hat sich verschoben -> am Zitat wiederfinden, nicht an der Nummer.
- Ein Treffer ist **neu** -> nach derselben Regel (Abschnitt 1) klassifizieren und im
  Report als Zusatz ausweisen.

Was NICHT erlaubt ist: eine Zeile anfassen, die in Abschnitt 2 als **BLEIBT** steht, oder
eine Datei anfassen, die weder in Abschnitt 2 noch in der Neu-Erhebung vorkommt.

---

## 1. Die Regel — sie ist der ganze Inhalt dieser Phase

Aus `tasks/c-p5-spec.md` Abschnitt 3(c), woertlich:

> **wahr-und-tragend bleibt, falsch-geworden faellt.**

C-P5 nennt beide Handgriffe zusammen "faellt". C-P6 trennt sie, weil der Impl-Agent zwei
verschiedene Handgriffe braucht:

| Urteil | Bedeutung | Handgriff |
|---|---|---|
| **BLEIBT** | Die Aussage ist ueber die Welt weiterhin wahr **und** traegt Wissen: Protokollfakt, Anbieter-Doku-Referenz, Konventions-Herkunft, oder eine Entscheidungs-/Warn-Doku, die vor der Wieder-Einfuehrung schuetzt. | **nichts.** Ein Edit ist ein Befund. |
| **UMFORMULIEREN** | Die Zeile traegt Wissen, nennt aber einen toten Codepfad oder behauptet einen zweiten Anbieter. | Zeile bleibt, Aussage wird richtiggestellt (Vorschlag steht in der Tabelle). |
| **FAELLT** | Die Zeile beschreibt ausschliesslich Code, den es nicht mehr gibt, und traegt sonst nichts. | Zeile ersatzlos entfernen. |

### Die drei Trennschaerfen, an denen sich die Urteile in Abschnitt 2 entscheiden

1. **Protokollfakt vs. Adapter-Referenz.** *"TeXML ist Twilio-kompatibel (PascalCase-
   Formfelder)"* ist eine Aussage ueber Telnyx' Drahtformat und bleibt richtig, solange
   TeXML existiert -> **BLEIBT**. *"byte-identisch zum Twilio-Adapter"* verweist auf eine
   geloeschte Datei -> **UMFORMULIEREN/FAELLT**. Dieselbe Trennung hat `c-p5-spec` fuer
   `scripts/telnyx-ws-echo.mjs:19` (*"rohe u-law base64 (wie Twilio)"*) schon getroffen:
   Kategorie (b), bleibt.
2. **Hypothese vs. Unmoeglichkeit.** *"Ein Mapping-Bug telnyx->twilio darf nicht still
   durchrutschen"* beschreibt eine Fehlerklasse und bleibt lehrreich -> **BLEIBT**.
   *"ab dem Tag, an dem jemand CAPABILITY.AI_ASSISTANT fuer Twilio eintraegt"* beschreibt
   einen Vorgang, den das Enum nicht mehr zulaesst -> **UMFORMULIEREN** (auf "einen zweiten
   Carrier" verallgemeinern; die Sicherheits-Begruendung ist genau dann wieder wahr).
3. **Entscheidungs-Doku ist kein toter Kommentar.** Jede Zeile, die mit `C-P1`, `C-P1b`,
   `C-P3` oder `C-P4` beginnt, dokumentiert, **warum** etwas entfernt wurde, und ist die
   Bremse gegen die Wieder-Einfuehrung. Sie ist in Vergangenheitsform formuliert und
   deshalb wahr. **BLEIBT — ausnahmslos.** Dasselbe gilt fuer den C-P3-Eintrag in
   `CLAUDE.md` Absolute Regel 1: Historien-/Freigabe-Doku, bleibt woertlich.

### Faktisch falsche Kommentare — die vier wertvollsten Funde dieser Erhebung

Vier Zeilen behaupten heute etwas ueber **lebenden** Code, das nicht stimmt. Sie sind der
eigentliche Grund, warum diese Phase mehr ist als Kosmetik:

| Ort | Behauptung | Wirklichkeit |
|---|---|---|
| `src/bridge.js:136` | *"Fehlender Provider -> Twilio-Default"* | `voiceControl(provider = DEFAULT_PROVIDER)` = **Telnyx** (`registry.js:120`) |
| `src/telephony/voice-render.js:25` | *"undefined -> voiceRenderer-Default twilio"* | `voiceRenderer(provider = DEFAULT_PROVIDER)` = **Telnyx** (`registry.js:156`) |
| `test/place-call-error.test.js:48` | *"sonst liefe der Default (Twilio)"* | dito |
| `test/telephony-registry.test.js:72` | *"arg-los -> Twilio"* | dito — und der Kommentar **drei Zeilen darunter** (`:73`) sagt bereits das Richtige. Die Ueberschrift widerspricht ihrem eigenen Abschnitt. |

`bridge.js:136` liegt im Block **HEIKLE STELLE 2** (`CLAUDE.md`, Architektur). Der Edit ist
trotzdem zulaessig und noetig — aber ausschliesslich am Kommentartext, keine Zeile Code.

---

## 2. Die Klassifikationsliste

Erhoben am 2026-08-07 gegen `master` (`9ddf1df`):

```
git grep -in twilio master -- src/ test/          # 451 Treffer
```

Aufgeteilt nach denselben mechanischen Regel-Eimern wie `c-p5-spec` Abschnitt 3 (jede Zeile
faellt in genau einen, in dieser Reihenfolge geprueft):

| # | Regel auf der Trefferzeile | Treffer | Zustaendig |
|---|---|---|---|
| R1 | `SKIP_TWILIO_SIGNATURE_CHECK` / `skipTwilioSignatureCheck` | 47 | **Kategorie (b)** — bleibt fuer immer, eigene Owner-Entscheidung |
| R2 | sonst: `TWILIO_ACCOUNT_SID`\|`TWILIO_AUTH_TOKEN`\|`TWILIO_EDGE`\|`twilioToken`\|`twilioEdge`\|`telephony.twilioSid` | 68 | **C-P5** |
| R3 | sonst: `twilioSid` / `twilio_sid` (Call-Record-Feldname) | 104 | **Kategorie (b)** — Datenform, Migration, nicht hier |
| R4 | sonst: Prosa, Kommentare, CLI-/Testtexte | 232 | s. u. |
| | davon in Dateien, die **C-P5** ohnehin anfasst (Abschnitt 3.1) | 35 | **C-P5** |
| | **davon C-P6-Kern** | **197** | **diese Phase** |

Dazu `gitleaks.toml:29` (1 Treffer, aus `c-p5-spec` Kategorie (c) ausdruecklich hierher
verwiesen). **Gesamt klassifiziert: 198.**

**Gegenprobe zu R3, damit die Abgrenzung nicht auf Zuruf steht:** alle 24
Kommentarzeilen im R3-Eimer wurden gelesen. Jede beschreibt `call.twilioSid` als
**Bestandsfeldname des TeXML-Pfads** — keine einzige behauptet einen Twilio-Adapter. R3
bleibt vollstaendig ausserhalb von C-P6.

### 2.0 Legende

Zitate sind gekuerzt. Massgeblich ist das Zitat, **nicht** die Zeilennummer (Abschnitt 0).
Bei UMFORMULIEREN ist der Vorschlag ein Vorschlag: gleicher Sinn, andere Worte sind
erlaubt — falsch werden darf er nicht. Kommentare bleiben deutsch und **ohne Umlaute**
(`CLAUDE.md`, Konventionen).

---

### 2.1 `src/` — 79 Treffer (29 BLEIBT / 4 FAELLT / 45 UMFORMULIEREN / 1 ausserhalb)

| Ort | Zitat (gekuerzt) | Urteil | Begruendung / Vorschlag |
|---|---|---|---|
| `src/app.js:48` | "kein Endpunkt braucht mehr als 100kb (**Twilio**-Webhooks und API-Payloads sind klein)" | UMFORMULIEREN | -> "(Provider-Webhooks und API-Payloads sind klein)" |
| `src/app.js:61` | "rawBody fuer /voice (**Twilio**/Telnyx) UND den Stripe-Webhook erfassen" | UMFORMULIEREN | -> "/voice (Telnyx)" |
| `src/app.js:62` | "Der **Twilio-HMAC** nutzt weiterhin nur die geparsten Params" | UMFORMULIEREN | Teilsatz streichen; der tragende Rest ("die Erfassung aendert das Parsen NICHT — verify laeuft VOR dem Parsen, additiv") bleibt woertlich |
| `src/app.js:71` | "Rate-Limit fuer alle **Nicht-Twilio-Routen**" | UMFORMULIEREN | -> "fuer alle Routen ausser /voice" (der Code prueft `VOICE_PATH_PREFIX`, nicht einen Anbieter) |
| `src/app.js:72` | "/voice/* ist ausgenommen (**kommt von Twilio**, eigene Signaturpruefung)" | UMFORMULIEREN | -> "(kommt vom Provider, eigene Signaturpruefung)" |
| `src/app.js:83` | Zeilenend-Kommentar `// Twilio-Webhooks` am `urlencoded`-Parser | UMFORMULIEREN | nur der Kommentar: -> `// Provider-Webhooks (form-encoded)`. Codezeile unangetastet |
| `src/billing/cost-truing.js:554` | "nicht jeder Carrier liefert Einzelbelege (**bis C-P4 war Twilio genau dieser Fall**)" | BLEIBT | Entscheidungs-Doku in Vergangenheitsform; begruendet, warum die Port-Methoden OPTIONAL sind |
| `src/billing/webhook.js:2` | "trennt die Krypto ... (**wie der Twilio-Signatur-Adapter** die Krypto vom /voice-Gate trennt)" | UMFORMULIEREN | Verweisziel ist in C-P3 geloescht -> "wie der Telnyx-Signatur-Adapter" (`adapters/telnyx/signature.js`) |
| `src/bridge.js:1` | "Audio-Bridge: **Twilio Media Streams** <-> OpenAI Realtime API" | UMFORMULIEREN | -> "Provider-Media-Streams (Telnyx) <-> OpenAI Realtime API" |
| `src/bridge.js:29` | "C-P4: der frueher hier gefuehrte Twilio-Pfad '/media' ist mit dem Adapter entfallen" | BLEIBT | Entscheidungs-Doku; erklaert den fail-closed-Zweig |
| `src/bridge.js:130` | "(a) Gegenseite legt auf (**Twilio 'stop'**)" | UMFORMULIEREN | `stop` ist `MEDIA_EVENT.STOP`, providerneutral -> "(a) Gegenseite legt auf (Media-Event 'stop')". **HEIKLE STELLE 2 — nur der Kommentar** |
| `src/bridge.js:136` | "Fehlender Provider -> **Twilio-Default** (byte-identisch)" | UMFORMULIEREN | **faktisch falsch**: `voiceControl()` defaultet auf `DEFAULT_PROVIDER` = Telnyx (`registry.js:120`) -> "Fehlender Provider -> DEFAULT_PROVIDER (Telnyx)". **HEIKLE STELLE 2 — nur der Kommentar** |
| `src/i18n/locales.js:18` | "Die Render-Pfade sind UTF-8 (TeXML ..., **Twilio-SDK**)" | UMFORMULIEREN | SDK ist in C-P5 als Dependency raus -> ", Twilio-SDK" streichen |
| `src/i18n/locales.js:111` | Zeilenend-Kommentar "(Phase 3: **twilio**/telnyx Gather-Render)" | UMFORMULIEREN | -> "(Phase 3: Telnyx-Gather-Render)". Codezeile (`sttLocale: "de-DE"`) unangetastet |
| `src/middleware.js:64` | "/voice mit eigener **Twilio**-Signaturpruefung" | UMFORMULIEREN | -> "eigener Provider-Signaturpruefung" |
| `src/release-reconcile.js:138` | "non-telnyx bleibt unangetastet (**Twilio hat keinen releaseNumber**)" | UMFORMULIEREN | -> "(nur der Telnyx-Adapter hat releaseNumber; eine Altzeile mit fremdem provider bleibt manuell)" |
| `src/routes/api-calls.js:244` | "Max-Dauer hart durchsetzen. **Fuer Twilio redundant zum timeLimit-Param**, fuer Telnyx der einzige verlaessliche Cap" | UMFORMULIEREN | Teilsatz streichen; "fuer den TeXML-Pfad der EINZIGE verlaessliche Cap" bleibt — das ist die Aussage von Absolute Regel 1 (Max-Dauer) |
| `src/routes/api-calls.js:284` | "C-P4: der frueher hier angehaengte Twilio-Trial-Hint ist mit dem Adapter entfallen" | BLEIBT | Entscheidungs-Doku |
| `src/routes/api-calls.js:379` | "provider-aware ueber call.provider — **sonst Twilio-endCall auf einem Telnyx-Call**" | UMFORMULIEREN | -> "sonst endCall ueber den falschen Anbieter". Die Provider-Awareness selbst bleibt begruendet |
| `src/routes/voice.js:111` | "bedient beide Provider ohne den optionalen speak-Port (**den Twilio gar nicht hat**)" | UMFORMULIEREN | Klammer streichen; "ohne den optionalen speak-Port" traegt die Aussage allein |
| `src/routes/voice.js:167` | "callControlId fehlt (**Twilio ODER** TeXML-Feld absent) -> null" | UMFORMULIEREN | -> "(TeXML-Feld absent) -> null" |
| `src/routes/voice.js:224` | "C-P3: ... alles, was providerFromHeaders nicht als Telnyx erkennt (auch ein Twilio-Signatur-Header), faellt hier auf 403" | BLEIBT | Gate-Doku zu Absolute Regel 1, wahr und tragend |
| `src/server.js:1` | "Voice-Gateway: **Twilio-Webhooks** (Inbound/Outbound)" | UMFORMULIEREN | -> "Provider-Webhooks (Inbound/Outbound)" |
| `src/store/defaults.js:33` | "C-P4 (Track C, Schritt 5): TWILIO ist RAUS — gemeinsam mit den Adapter-Eintraegen" | BLEIBT | Entscheidungs-Doku, traegt die Kopplungs-Begruendung |
| `src/store/defaults.js:40` | "ein gespeichertes 'twilio' bricht nichts" | BLEIBT | Datenaussage, wahr (`provider TEXT` ohne CHECK) |
| `src/store/defaults.js:41` | "resolveSeedProvider('twilio') liefert null — fail-closed" | BLEIBT | am Code belegt |
| `src/store/defaults.js:43` | "C-P1: der Rueckfall ist TELNYX, nicht mehr Twilio" | BLEIBT | Entscheidungs-Doku |
| `src/store/defaults.js:45` | "keine einzige Zeile auf Twilio — der Flip leitet keinen echten Verkehr um" | BLEIBT | Messbeleg gegen die Produktions-DB |
| `src/store/state-ops.js:181` | "Zugangsgeheimnis fuer den /media-WebSocket (steht im **TwiML, das nur Twilio** sieht)" | UMFORMULIEREN | -> "(steht im TeXML, das nur der Provider sieht)" |
| `src/store/state-ops.js:1199` | "provider default DEFAULT_PROVIDER (seit C-P1 Telnyx); **ein Twilio-Seed**" | UMFORMULIEREN | Satzende ab "; ein Twilio-Seed" streichen; der erste Halbsatz bleibt |
| `src/store/state-ops.js:1200` | "reicht provider=twilio explizit mit." | FAELLT | Zeile entfaellt — `resolveSeedProvider("twilio")` liefert `null`, den Pfad gibt es nicht |
| `src/store/state-ops.js:2120` | "hold: ... provider!=='telnyx' (manuell — **kein Twilio-Release**)" | UMFORMULIEREN | -> "(manuell — fuer fremde/Alt-Provider gibt es keinen Release-Pfad)" |
| `src/store/state-ops.js:2157` | "Weiterhin Telnyx-only (**Twilio hat keinen releaseNumber-Pfad** -> non-telnyx bleibt unangetastet)" | UMFORMULIEREN | -> "(nur Telnyx hat einen releaseNumber-Pfad -> non-telnyx bleibt unangetastet)" |
| `src/store/state-ops.js:3416` | "eine **Twilio-Beimischung** waere kein Vergleich zwischen gleichen Groessen" | UMFORMULIEREN | -> "eine Beimischung von Altzeilen fremder Anbieter waere kein Vergleich zwischen gleichen Groessen". Der Filter bleibt damit begruendet |
| `src/telephony/adapters/telnyx/media.js:3` | "rohe u-law base64 **wie Twilio** ANGENOMMEN vs. RTP-gewrappt" | BLEIBT | Protokollfakt (identische Festlegung wie `c-p5-spec` fuer `scripts/telnyx-ws-echo.mjs:19`) |
| `src/telephony/adapters/telnyx/media.js:6` | "Protokoll-Unterschiede **zu Twilio**: snake_case stream_id statt streamSid" | BLEIBT | Protokollfakt ueber zwei Drahtformate; erklaert die Neutralisierung |
| `src/telephony/adapters/telnyx/render.js:4` | "**Fail-closed wie der Twilio-Renderer** (unbekanntes voiceProfile -> wirft)" | UMFORMULIEREN | Verweisziel geloescht -> "Fail-closed: unbekanntes voiceProfile -> wirft." |
| `src/telephony/adapters/telnyx/render.js:21` | "**Twilio-Renderer bleibt bewusst auf Polly.**" | FAELLT | beschreibt eine geloeschte Datei, traegt sonst nichts |
| `src/telephony/adapters/telnyx/render.js:114` | "speechModel/actionOnEmptyResult bleiben **Twilio-spezifisch** und ungesetzt" | BLEIBT | Protokollfakt ueber TwiML-Attribute — und von `test/provider-threading.test.js:101/128` gepinnt |
| `src/telephony/adapters/telnyx/render.js:144` | "**Symmetrisch zum Twilio-Renderer** (connect().stream({url}) + parameter(p))." | FAELLT | Satz entfaellt; "Parameter-Reihenfolge ist vertraglich (Snapshot-Test)" bleibt |
| `src/telephony/adapters/telnyx/signature.js:5` | "-> false (wirft nie), **Paritaet zum Twilio-Verifier**" | UMFORMULIEREN | -> "(wirft nie) — seit C-P3 der EINZIGE Inbound-Verifizierer" |
| `src/telephony/adapters/telnyx/voice.js:4` | "Telnyx erwartet **Twilio-kompatible** PascalCase-Formfelder" | BLEIBT | Protokollfakt |
| `src/telephony/adapters/telnyx/voice.js:10` | "-> **Twilio-kompatible** Call-Resource, sid = CallSid." | BLEIBT | Protokollfakt |
| `src/telephony/adapters/telnyx/voice.js:12` | "beendet den Call (**Twilio-kompatibel**)" | BLEIBT | Protokollfakt |
| `src/telephony/adapters/telnyx/voice.js:32` | "TeXML ist **Twilio-kompatibel** (PascalCase-Formfelder)" | BLEIBT | Protokollfakt — in `c-p5-spec` namentlich als Beispiel genannt |
| `src/telephony/adapters/telnyx/voice.js:720` | "**Twilio-kompatible** Call-Resource. sid = CallSid (Fallback call_sid)." | BLEIBT | Protokollfakt |
| `src/telephony/adapters/telnyx/voice.js:725` | "Laufenden Call beenden (**Twilio-kompatibel**: Status=completed)." | BLEIBT | Protokollfakt |
| `src/telephony/adapters/telnyx/voice.js:728` | "endCall bekommt nur den CallSid, **byte-identisch zum Twilio-Adapter**" | UMFORMULIEREN | Verweisziel geloescht -> ", byte-identisch zum Twilio-Adapter" streichen |
| `src/telephony/adapters/telnyx/voice.js:843` | "OPTIONAL am Port, Telnyx-only (**Twilios price deckt nur Connectivity** — dieselbe Signatur mit anderer Semantik waere schlimmer als keine)" | BLEIBT | Anbieter-Doku-Referenz; begruendet, warum die Methode OPTIONAL ist |
| `src/telephony/adapters/telnyx/webhook-events.js:63` | "Der TeXML-Pfad ist **Twilio-kompatibel** und liefert ebenfalls `AnsweredBy`" | BLEIBT | Protokollfakt |
| `src/telephony/answered-by.js:2` | "die AnsweredBy-Werte sind **Twilio-Konvention**, die Telnyx' TeXML spiegelt" | BLEIBT | Konventions-Herkunft — in `c-p5-spec` namentlich als Beispiel genannt |
| `src/telephony/answered-by.js:21` | "**Beide Adapter (Twilio + Telnyx/TeXML)** liefern denselben Feldnamen `AnsweredBy` — EINE Quelle (G5)" | UMFORMULIEREN | -> "Der TeXML-Pfad liefert den Feldnamen `AnsweredBy` (Twilio-Konvention). Der Parser sitzt bewusst NEUTRAL hier und nicht im Adapter, damit ein zweiter Carrier eintritt statt zu kopieren (G5)." — die G5-Begruendung darf nicht verschwinden, nur ihr Traeger wechselt von "zwei Adapter heute" auf "der Seam" |
| `src/telephony/call-lifecycle.js:64` | "ein Telnyx-Call wird ueber Telnyx beendet, **nicht ueber Twilio**" | UMFORMULIEREN | -> "nicht ueber einen fremden Anbieter" |
| `src/telephony/call-lifecycle.js:100` | "**TeXML/Twilio** byte-identisch ueber endCall(providerCallSid)" | UMFORMULIEREN | -> "TeXML byte-identisch ueber endCall(providerCallSid)" |
| `src/telephony/call-termination.js:74` | "ein **TeXML/Twilio**-Call ueber endCall(providerCallSid)" | UMFORMULIEREN | -> "ein TeXML-Call ueber endCall(providerCallSid)" |
| `src/telephony/failure-reason.js:3` | "**Telnyx UND Twilio senden dieselbe CallStatus-Vokabel**" | UMFORMULIEREN | -> "die CallStatus-Vokabel ist Twilio-Konvention, die Telnyx' TeXML spiegelt" — die Begruendung fuer "provider-agnostisch" bleibt damit erhalten |
| `src/telephony/media-events.js:2` | "der Adapter uebersetzt **Twilio start/media/stop bzw.** Telnyx-Events darauf" | UMFORMULIEREN | -> "der Adapter uebersetzt die Provider-Events (Telnyx start/media/stop) darauf" |
| `src/telephony/ports.js:2` | "P0 hat genau **einen Adapter (Twilio)**" | UMFORMULIEREN | in `c-p5-spec` namentlich als "faellt" genannt -> "Heute genau ein Adapter (Telnyx)." |
| `src/telephony/ports.js:17` | "@property sid — Provider-seitige Call-ID (**Twilio CallSid**)" | UMFORMULIEREN | -> "(CallSid im TeXML-Pfad)" |
| `src/telephony/ports.js:54` | "Request-Header (lowercase keys, **z.B. x-twilio-signature**)" | UMFORMULIEREN | irrefuehrendes Beispiel: genau dieser Header wird seit C-P3 NICHT erkannt -> "z.B. telnyx-signature-ed25519" |
| `src/telephony/ports.js:55` | "rawBody — unveraenderter Roh-Body; **fuer Twilio-HMAC ungenutzt**, fuer die Telnyx-Ed25519-Pruefung noetig" | UMFORMULIEREN | Teilsatz streichen |
| `src/telephony/ports.js:69` | "**Twilio: HMAC-SHA1 ueber url + sortierte params (rawBody ungenutzt).**" | FAELLT | beschreibt den in C-P3 geloeschten Verifizierer |
| `src/telephony/ports.js:135` | "Aktuell NUR Telnyx implementiert (wie NumberProvisioning); **Twilio hat kein Call-Control-Pendant**" | UMFORMULIEREN | Teilsatz streichen; "Aktuell NUR Telnyx implementiert — deshalb OPTIONAL am Port" bleibt |
| `src/telephony/ports.js:194` | "Provider-Antwort-Body (**Twilio: TwiML**). Der einzige Ort mit Provider-Markup." | UMFORMULIEREN | -> "(Telnyx: TeXML)" |
| `src/telephony/ports.js:241` | "streamRef — neutrale Stream-Referenz (**Twilio: streamSid**; Telnyx: stream_id)" | BLEIBT | Protokollfakt ueber zwei Drahtformate; genau er begruendet den neutralen Feldnamen |
| `src/telephony/ports.js:256` | "**Twilio braucht streamRef**, Telnyx nicht." | BLEIBT | Protokollfakt; begruendet, warum `streamRef` optional ist |
| `src/telephony/ports.js:259` | "({event:'clear'}) **bei beiden Providern**; Twilio mit streamSid, Telnyx ohne" | UMFORMULIEREN | "bei beiden Providern" setzt zwei Adapter voraus -> "({event:'clear'}; Telnyx ohne stream_id — streamRef bleibt optional, weil Twilio Media Streams dort streamSid verlangt)" |
| `src/telephony/registry.js:162` | "C-P3: x-twilio-signature wird BEWUSST nicht mehr erkannt" | BLEIBT | Gate-Doku zu Absolute Regel 1 |
| `src/telephony/registry.js:164` | "den Header hier wieder einzutragen, ohne einen Twilio-Verifizierer zu registrieren, oeffnet einen Zweig OHNE Signaturpruefung" | BLEIBT | die schaerfste Warnung im Repo zu diesem Gate |
| `src/telephony/registry.js:177` | "alles andere (auch ein Twilio-Signatur-Header) faellt fail-closed durch" | BLEIBT | wahr, beschreibt lebenden Code |
| `src/telephony/voice-locale.js:6` | "**Telnyx wie Twilio nutzen** DENSELBEN Wert fuer Say-TTS-Attribut und Gather-STT-Locale" | UMFORMULIEREN | -> "Telnyx nutzt DENSELBEN Wert ... — deshalb genuegt sttLocale (volles BCP-47, R9)" |
| `src/telephony/voice-render.js:25` | "undefined -> **voiceRenderer-Default twilio** -> jeder arg-lose render(x)-Aufruf bleibt byte-identisch" | UMFORMULIEREN | **faktisch falsch** (`registry.js:156`) -> "undefined -> voiceRenderer-Default DEFAULT_PROVIDER (Telnyx)" |
| `src/telephony/voice-render.js:34` | "Telnyx-TeXML loest relative URLs anders auf **als Twilio** -> absolute URL fuer Telnyx" | BLEIBT | Protokollfakt; begruendet die absolute Action-URL |
| `src/telephony/voice-render.js:60` | "provider-aware (**Twilio /media byte-identisch**, Telnyx eigener Pfad)" | UMFORMULIEREN | `MEDIA_PATH` kennt "/media" nicht mehr (`bridge.js:29`) -> "provider-aware ueber MEDIA_PATH; ein unbekannter Pfad wird fail-closed verworfen (bridge.js)" |
| `src/telnyx-inbound.js:17` | "Telnyx bedient mit EINEM Wert die **Twilio-kompatible SID** UND die Call-Control-ID" | BLEIBT | Protokollfakt, gemessen (GET /v2/calls) |
| `src/telnyx-inbound.js:93` | "Ein **Twilio-CallSid** ('AC...') ist KEINE call_control_id" | UMFORMULIEREN | -> "Ein fremder Provider-CallSid (Twilio-Form 'AC...') ist KEINE call_control_id" |
| `src/telnyx-inbound.js:95` | "ab dem Tag, an dem jemand CAPABILITY.AI_ASSISTANT **fuer Twilio** eintraegt" | UMFORMULIEREN | Vorgang ist heute unmoeglich -> "fuer einen zweiten Carrier eintraegt". Die REIHENFOLGE-IST-SICHERHEIT-Begruendung wird dadurch wieder wahr statt tot |
| `src/turn-budget.js:2` | "der Provider kappt einen unbeantworteten Voice-Webhook hart (**Twilio dokumentiert 15 s**)" | BLEIBT | Anbieter-Doku-Referenz — in `c-p5-spec` namentlich genannt |
| `src/telephony/call-finish.js:141` | `"(Trial: Zielnummer verifiziert? SMS-faehige Twilio-Nummer?)"` | **ausserhalb** | **KEIN Kommentar**, sondern ein `console.error`-Argument (Laufzeit-String). S. Abschnitt 3.3 — Befund fuer den Report, nicht fuer den Diff |

---

### 2.2 `test/` — 118 Treffer (64 BLEIBT-Kommentare / 23 UMFORMULIEREN / 31 Nicht-Kommentar)

**BLEIBT — 64 Kommentarzeilen.** Alle tragen entweder Entscheidungs-Doku aus C-P1/C-P1b/
C-P3/C-P4 (Vergangenheitsform, wahr, Bremse gegen Wieder-Einfuehrung) oder begruenden,
warum das String-Literal `"twilio"` als **Altzeilen-Stellvertreter** in einer Bestands-DB
bewusst so dasteht. Der Impl-Agent fasst **keine** davon an:

| Datei | Zeilen | Klasse |
|---|---|---|
| `api-cost-truing-sweep.test.js` | 13 | C-P4-Doku (Weg in den Zweig geaendert, Ergebnis nicht) |
| `bridge-hardening.test.js` | 7 | C-P4-Doku (Pfad aus `MEDIA_PATH` statt Literal) |
| `bridge-openai-event.test.js` | 58 | C-P4-Doku |
| `cost-truing-pool.test.js` | 29 | Begruendung der Literal-Wahl (Altzeile) |
| `directive-synth.test.js` | 18, 113, 116 | Literal-Wahl + C-P4-Doku + Kosten-Zusicherung fuer Altzeilen |
| `disclosure-outbound.test.js` | 18 | C-P4-Doku (Traeger gewechselt, Gegenstand nicht) |
| `g2-opening-turn.test.js` | 29 | C-P4-Doku (Ein-Element-Schleife bleibt bewusst) |
| `inbound-routing.test.js` | 142 | C-P3-Doku |
| `kv-m4-monthly-cross-check.test.js` | 25, 65 | Literal-Wahl + C-P4-Doku (`PROVIDER.TWILIO` waere `undefined` geworden) |
| `media-token.test.js` | 33 | C-P4-Doku |
| `media-transport.test.js` | 5, 51, 73 | C-P4-Doku (uebernommene Port-Aussagen, Herkunft belegt) |
| `onboarding-outbound.test.js` | 16 | Protokollfakt ("Twilio-kompatible Call-Resource") |
| `outbound-first-gather.test.js` | 16 | C-P4-Doku |
| `outbound-greeting.test.js` | 19 | C-P4-Doku |
| `outbound-premature-close.test.js` | 38 | C-P4-Doku |
| `owner-number-seed.test.js` | 18, 25, 27 | Fehlerklassen-Hypothese (s. Trennschaerfe 2) + C-P4-Doku |
| `provider-capabilities.test.js` | 16 | C-P4-Doku (Altzeile, fail-closed) |
| `provider-threading.test.js` | 19, 20 | C-P3-Doku (Gegenprobe-Halterung) |
| `render-adapter-language-parity.test.js` | 6, 10, 12 | C-P4-Doku (Paritaets-Aufloesung begruendet) |
| `security.test.js` | 26 | C-P3-Doku (loest den Twilio-Aequivalenttest ab) |
| `signature-dispatch.test.js` | 4, 28, 29 | wahr ("alles andere -> false") + C-P3-Doku |
| `stt-model-seam.test.js` | 2 | C-P4-Doku |
| `telephony-contract.test.js` | 24 | C-P3-Doku |
| `telephony-registry.test.js` | 11, 75, 120 | C-P4-Doku (Kopplung Enum<->Tabelle) + C-P1b-Doku |
| `telnyx-cost-records.test.js` | 1366, 1367 | C-P4-Doku (Gegenstand entfallen, Eigenschaft belegt) |
| `telnyx-numbers.test.js` | 222, 223 | C-P4-Doku (Nicht-Enum-Literal mit Begruendung) |
| `telnyx-p9-flag-matrix.test.js` | 102, 107 | C-P4-Doku (Zelle ohne Gegenstand) |
| `telnyx-voice.test.js` | 177 | C-P1b-Doku |
| `tenant-erasure-number-release.test.js` | 12 | Begruendung der Literal-Wahl |
| `turn-latency-budget.test.js` | 2 | Anbieter-Doku-Referenz (15-s-Hardcut), parallel zu `src/turn-budget.js:2` |
| `voice-incoming-catch-path.test.js` | 16 | **Kategorie (b)**: `SKIP_TWILIO_SIGNATURE_` steht hier ueber zwei Zeilen umbrochen und ist dem R1-Filter nur deshalb entkommen |
| `voice-play-tts.test.js` | 78, 79, 81, 85 | C-P4-Doku (Test entfallen, nicht gruen gemacht) |
| `voice-render-action-url.test.js` | 7, 63 | C-P4-Doku + festgehaltener Befund |
| `voice-signature-403-log.test.js` | 35, 38 | C-P3-Doku (Invariante am HTTP-Rand) |
| `voice-status-lifecycle.test.js` | 82, 87, 121 | C-P4-Doku **und ein offener Befund** (`:87`: Altzeile `provider='twilio'` -> `webhookEvents()` wirft -> 500). **Nicht loeschen** — s. Abschnitt 3.2 |
| `webhook-events.test.js` | 5, 6, 63, 66, 75 | C-P4-Doku + C-P1b-Doku |

**UMFORMULIEREN — 23 Zeilen:**

| Ort | Zitat (gekuerzt) | Vorschlag |
|---|---|---|
| `test/_outbound-harness.js:18` | "**Beide Renderer** oeffnen den Sprach-Turn mit '<Gather' (Twilio-TwiML + Telnyx-TeXML)" | "Der Renderer oeffnet den Sprach-Turn mit '<Gather' (Telnyx-TeXML)." |
| `test/_outbound-harness.js:25` | "Marker GATHER_OPEN ist providerneutral (**Twilio + Telnyx**)" | "Marker GATHER_OPEN ist providerneutral (`<Gather` ist TwiML und TeXML gemeinsam)." |
| `test/api-cost-truing-sweep.test.js:165` | Zeilenend-Kommentar "// **Twilio-Adapter ohne Beleg-Methoden** -> sauberes No-op" | "// nicht unterstuetzter Provider -> costRecordControlFor null -> sauberes No-op" (der richtige Weg steht bereits in `:12-15`) |
| `test/api.test.js:56` | "der **Twilio-Erfolgspfad** wird bewusst nicht getestet (echter API-Call)" | "der Provider-Erfolgspfad wird bewusst nicht getestet (echter API-Call)" |
| `test/cost-truing-observe.test.js:286` | "---- (f) Adapter ohne Beleg-Methoden (**Twilio-Form**) -> sauberer No-op ----" | "(Twilio-Form)" streichen |
| `test/cost-truing-observe.test.js:293` | Zeilenend-Kommentar "// **Twilio-Form**: keine fetchCostRecordPool/assignCostRecords-Methoden" | "// Control-Objekt ohne fetchCostRecordPool/assignCostRecords (beide OPTIONAL am Port)" |
| `test/g3-speech-timeout.test.js:6` | "der Override ist Telnyx-only (**Twilio byte-identisch, siehe directive-render**)" | zwei tote Verweise in einer Zeile: `directive-render.test.js` ist in C-P4 geloescht -> "Telnyx, weil der Override am TeXML-Gather haengt (dem einzigen Renderer)" |
| `test/gq-p3-inbound-handoff.test.js:70` | "Ein **Twilio-CallSid** ('AC...') wird nie zur call_control_id" | "Ein fremder Provider-CallSid (Twilio-Form 'AC...') wird nie zur call_control_id" — parallel zu `src/telnyx-inbound.js:93` |
| `test/outbound-greeting.test.js:6` | "Dieser Test pinnt fuer **BEIDE Provider (Twilio + Telnyx)**" | "Dieser Test pinnt fuer den Telnyx-Renderer" — steht sonst im Widerspruch zu `:18-20` derselben Datei |
| `test/outbound-premature-close.test.js:3` | "Pinnt fuer **BEIDE Provider (Twilio + Telnyx)**" | "Pinnt fuer den Telnyx-Pfad" — Widerspruch zu `:37-39` |
| `test/outbound-reserve-concurrency-http.test.js:5` | "FAKE_ORIGINATE haelt den Test netzfrei (**kein echter Twilio-Client**)" | "(kein echter Provider-Client)" |
| `test/outbound-tenant.test.js:23` | Zeilenend-Kommentar "// = **BASE_ENV.TWILIO_NUMBER** (config-basierte Owner-Absendernummer)" | `BASE_ENV` fuehrt kein `TWILIO_NUMBER` (seit P2b) -> "// = OWNER_TEST_NUMBER (Owner-Absendernummer aus dem Spawn-Store, test/helpers.js)". Codezeile unangetastet |
| `test/place-call-error.test.js:5` | "der **Twilio-Trial-Hint erscheint NUR bei Provider Twilio**" | Hint ist in C-P4 ersatzlos entfallen (`api-calls.js:284`) -> "der frueher hartkodierte Twilio-Trial-Hint ist mit dem Adapter entfallen; der Test pinnt, dass KEIN hint-Feld mehr kommt" |
| `test/place-call-error.test.js:48` | "sonst liefe **der Default (Twilio)**" | **faktisch falsch** -> "sonst liefe der Default (DEFAULT_PROVIDER)" |
| `test/provider-threading.test.js:117` | "so kann der Test nicht gruen bleiben, wenn der Rueckfall **zurueck auf Twilio kippt**" | "... wenn der Rueckfall auf einen anderen (TwiML-)Renderer kippt" |
| `test/rate-limit.test.js:1` | "Phase 2.1: Rate-Limiting fuer **Nicht-Twilio-Routen** (RATE_LIMIT_PER_MIN)" | "Rate-Limiting fuer alle Routen ausser /voice (RATE_LIMIT_PER_MIN)" — parallel zu `src/app.js:71` |
| `test/store-pg.test.js:370` | "deterministisch, ohne **config.twilioNumber**-Kopplung" | Key existiert nicht (mehr) -> "ohne Config-Kopplung fuer die Owner-Nummer" |
| `test/telephony-registry.test.js:72` | "---- Default-Byte-Identitaet: **arg-los -> Twilio** (numberProvisioning -> Telnyx) ----" | **faktisch falsch** und im Widerspruch zur eigenen naechsten Zeile -> "---- Default-Byte-Identitaet: arg-los -> DEFAULT_PROVIDER ----" |
| `test/telnyx-p5-gate-proof.test.js:191` | Zeilenend-Kommentar "// **ownerNumber-Default (Twilio)** reicht" | "// ownerNumber-Default reicht". Codezeile unangetastet |
| `test/telnyx-signature.test.js:1` | "Telnyx-Ed25519-Verifikation, fail-closed-**Paritaet zum Twilio-Verifier**" | "fail-closed (seit C-P3 der einzige Inbound-Verifizierer)" — parallel zu `adapters/telnyx/signature.js:5` |
| `test/tenant-erasure-number-release.test.js:4` | "Deckt: Selektor-Filter, Happy-Path, **Twilio-safe**, Idempotenz, ..." | "non-telnyx-safe" |
| `test/tenant-prolif-d-reconcile.test.js:3` | "Deckt: scharfer Happy-Path, Idempotenz, **Twilio-safe**, ..." | "non-telnyx-safe" |
| `test/voice-signature-403-log.test.js:1` | "Ein fehlgeschlagener Provider-Signatur-Check (**Twilio ODER Telnyx**)" | "(Telnyx bzw. unbekannter Provider)" — der Test belegt in Fall b) selbst, dass es keinen Twilio-Check mehr gibt |

**Nicht-Kommentar — 31 Zeilen, alle BLEIBT.** Identifier, String-Werte, Testnamen und
`assert`-Meldungen. Ausserhalb einer Nur-Kommentar-Phase; mehrere sind zusaetzlich
**absichtlich** so (die C-P4-Kommentare daneben begruenden genau diese Literal-Wahl):

`api-cost-truing-sweep.test.js:34` · `cost-truing-observe.test.js:296` ·
`cost-truing-pool.test.js:31, 193` · `directive-synth.test.js:21` ·
`kv-m4-monthly-cross-check.test.js:28` · `owner-number-seed.test.js:30, 31` ·
`place-call-error.test.js:45, 72` · `provider-capabilities.test.js:19, 20` ·
`provider-threading.test.js:22, 23, 101, 128` · `rate-limit.test.js:32` ·
`signature-dispatch.test.js:31` · `telephony-registry.test.js:123` ·
`telnyx-numbers.test.js:226` · `telnyx-voice.test.js:139` ·
`tenant-erasure-number-release.test.js:16` · `tenant-prolif-d-classify.test.js:38, 39` ·
`tenant-prolif-d-reconcile.test.js:87, 88` ·
`voice-signature-403-log.test.js:13, 39, 40, 53` · `webhook-events.test.js:76`

> **Testnamen sind ein Sonderfall mit eigener Begruendung.** `node:test` filtert ueber
> `--test-name-pattern` / `--test-skip-pattern`; `npm test` und `npm run test:gates`
> partitionieren die Suite genau darueber (`test/i18n-catalog-run.mjs`). Ein umbenannter
> Test ist eine **Laufzeit-Aenderung**, kein Kommentar-Fix (Memory-Lehre
> `catalog-id-prefix-misroutes-tests`). **Keine Testnamen anfassen.**

---

### 2.3 `gitleaks.toml:29` — 1 Treffer

| Ort | Zitat | Urteil | Vorschlag |
|---|---|---|---|
| `gitleaks.toml:29` | `# Defensiv: Test-Helfer ACtest..., test-anthropic-key, test-twilio-auth-token (deterministisch).` | UMFORMULIEREN | Nach C-P5 traegt `test/helpers.js` weder `ACtest...` noch `test-twilio-auth-token` (beide fallen mit `BASE_ENV`) -> `# Defensiv: Test-Helfer test-anthropic-key (deterministisch).` **Nur die `#`-Zeile.** Der Allowlist-Eintrag `'''test/helpers\.js$'''` bleibt unveraendert gueltig |

**Reihenfolge-Bedingung:** dieser Edit ist **erst nach dem C-P5-Merge** korrekt. Solange
`BASE_ENV` die beiden Twilio-Keys noch fuehrt, ist der Kommentar wahr. Vor dem Edit
verifizieren:

```
git grep -n 'ACtest\|test-twilio-auth-token' -- test/helpers.js   # muss LEER sein
```

Ist die Ausgabe nicht leer, bleibt `gitleaks.toml` unangetastet und der Fall geht in den
Report als "C-P5 noch nicht eingetroffen".

---

### 2.4 `.claude/workflows/` — geprueft, NICHTS zu tun

Erhebung auf `master` (`9ddf1df`): 22 Treffer, davon **null** fuer C-P6.

- `phase-impl-lean.js:109` und `phase-impl.js:64` — die Falsch-Blocker-Zeile ist **bereits
  gefixt** (Commit `9ddf1df`) und lautet jetzt *"Telnyx Ed25519; die Twilio-HMAC-Pruefung
  ist seit C-P3 per Owner-Entscheidung entfernt, ihr Fehlen ist KEIN Befund"*. **Wahr,
  bleibt.**
- `phase-impl-lean.js:172`, `phase-impl.js:126`, `.claude/refs/workflow.md:30` —
  `SKIP_TWILIO_SIGNATURE_CHECK` in der Smoke-Anleitung. **Kategorie (b), bleibt.**
- `runs/c-p4.js`, `runs/c-p4-review.js`, `runs/c-p5.js`, `runs/gq-welle0.js` (16 Treffer,
  darunter die alte Falsch-Blocker-Zeile in `runs/c-p4.js:101`) — **per-run-Skripte =
  Prozessmuell.** Sie verschwinden beim Aufraeumen der Kette (`CLAUDE.md`, "Aufraeumen nach
  einer gemergten Kette"), nicht durch einen Kommentar-Fix. **Nicht anfassen.**

Der Impl-Agent erhebt diesen Stand einmal neu (`git grep -in twilio -- .claude/`) und
bestaetigt im Report, dass nichts zu tun war. Findet er eine Abweichung, meldet er sie —
er fixt sie nicht.

---

### 2.5 Blockkohaerenz — 3 Zeilen OHNE den Suchbegriff, die trotzdem mitgehen

Ein Kommentarblock darf sich nach dem Edit nicht selbst widersprechen. Drei Zeilen stehen
im **selben Block** wie ein Treffer aus 2.1/2.2 und behaupten "beide Adapter/Renderer",
enthalten aber das Wort `twilio` nicht — der Grep findet sie deshalb nie:

| Ort | Zitat | gehoert zu | Vorschlag |
|---|---|---|---|
| `src/telephony/answered-by.js:3` | "weil **beide Adapter** denselben Feldnamen lesen" | `answered-by.js:2/:21` | "weil der Feldname nicht adapter-eigen ist" |
| `src/telephony/voice-locale.js:17` | "Fail-closed wie voiceAttrs **in beiden Renderern**" | `voice-locale.js:6` | "Fail-closed wie voiceAttrs im Renderer" |
| `test/outbound-first-gather.test.js:23` | "**beide Renderer** (kein Festnageln an self-closing-vs-paired-Gather-Syntax)" | `outbound-first-gather.test.js:16` | "den Renderer (kein Festnageln an self-closing-vs-paired-Gather-Syntax)" |

**Das ist eine abgeschlossene Liste von drei Zeilen, keine Lizenz zum Weitersuchen.** Vier
weitere Treffer der Formulierung sind geprueft und in Ordnung
(`src/billing/cost-cross-check.js:11`, `src/ui/widget-catalog.js:4`,
`test/max-duration-live-cap.test.js:14`, `test/telephony-contract.test.js:5`).

---

## 3. Ausdruecklich NICHT in dieser Phase

### 3.1 Dateien, die C-P5 raeumt

`src/config.js`, `src/boot.js`, `src/mcp-tools.js`, `src/route-policy.js` und
`test/`: `a4-default-profile-zero`, `audit`, `auth-p3-bootstrap-fallback`,
`boot-failclosed`, `check-setup-script`, `config-prod-footguns`,
`dial-target-normalization`, `did-07-onboard-retry-owner-gate`, `e164-trunk-zero-reject`,
`f1-p8-outbound-lang`, `helpers.js`, `kv-m0-boot-banner-config`, `number-gate`,
`outbound-frozen`, `outbound-reserve-gate`, `outbound-reserve-release-error`,
`p2-onboard-retry`, `prod-config-smoke`, `prod-env.js`, `profile-tenant-key`, `profiles`,
`single-origin-boot-guard`, `telnyx-p10-config`.

**Wenn nach dem C-P5-Merge dort noch Twilio-Kommentare stehen (35 R4-Treffer auf `9ddf1df`,
u.a. die `(bis Twilio)`-Assert-Meldungen in `number-gate.test.js`), sind sie ein
Report-Befund — kein Auftrag.** C-P5 hat eine eigene Berichtspflicht je Testdatei
(`c-p5-spec` 5.6); ein Nachfassen hier wuerde die Zustaendigkeit verwischen und den Diff
dieser Phase in genau die Dateien tragen, aus denen sie herausgeschnitten wurde.

### 3.2 Inhaltliche Sperren

- **`SKIP_TWILIO_SIGNATURE_CHECK` / `skipTwilioSignatureCheck`** in jeder Form (47 Treffer)
  — weder umbenannt noch "dokumentarisch aufgeraeumt". `boot-guard.js` haengt daran, ein
  Rename ist eine eigene Owner-Entscheidung (`CLAUDE.md` Absolute Regel 1).
- **`twilioSid` / `twilio_sid`** (104 Treffer) — Feldname am Call-Record, den der
  Telnyx-TeXML-Pfad benutzt. Datenform-Aenderung mit Migration.
- **Der C-P3-Eintrag in `CLAUDE.md` Absolute Regel 1** — Historien- und Freigabe-Doku,
  bleibt **woertlich**.
- **Prozess-/Historien-Doku** (`tasks/**`, `PLAN-*.md`, `.claude/workflows/runs/*`) — wird
  beim Aufraeumen der Kette geloescht, nicht umgeschrieben.
- **Der offene Befund in `test/voice-status-lifecycle.test.js:86-90`** (Altzeile
  `provider='twilio'` -> `webhookEvents()` wirft -> `/voice/status` 500). Er ist wahr,
  gemessen und ausdruecklich als offene Kante hinterlegt. **Nicht loeschen, nicht
  "erledigen".**
- **Kollateral-Unwahrheiten ohne den Suchbegriff**, ausser den drei Zeilen aus 2.5.
  Beispiel: `test/inbound-routing.test.js:144` (*"fuer beide Renderer"*) steht in einem
  Block, dessen Treffer BLEIBT lautet — dort wird nichts editiert, also entsteht auch kein
  Widerspruch.

### 3.3 Ein Befund, der KEIN Kommentar ist

`src/telephony/call-finish.js:141` gibt bei fehlgeschlagener Summary-SMS aus:

```js
console.error("[sms]", e.message, "(Trial: Zielnummer verifiziert? SMS-faehige Twilio-Nummer?)");
```

Das ist ein **Laufzeit-String** (Betreiber-Log), kein Kommentar — und er raet dem Betreiber
zu einer Twilio-Konfiguration, die es nicht gibt. Kein Test prueft ihn (verifiziert:
`git grep -n 'Trial:' -- test/` ist leer). **Er wird in dieser Phase NICHT geaendert**, weil
sonst die Abnahme-Regel aus Abschnitt 5 ("jede geaenderte Zeile ist ein Kommentar") ihre
Schaerfe verliert. Er gehoert **namentlich in den Report** als Vorschlag fuer eine
Folge-Phase.

---

## 4. Erwartete Aenderungen an Tests

**Keine.** Das ist die Aussage dieser Phase, nicht ihr Nebeneffekt.

Es faellt kein Test weg, es kommt keiner hinzu, keine Zusicherung wandert. Geaendert werden
in `test/` ausschliesslich **Kommentarzeilen** (23 UMFORMULIEREN aus 2.2, 1 aus 2.5) — der
`describe`/`test`-Baum, jede Assertion und jeder Testname bleiben Byte fuer Byte gleich.

**Ein neuer Test waere hier ein Befund**, kein Fleiss: es gibt kein neues Verhalten, das
einer belegen koennte (`CLAUDE.md`: "Neues Verhalten braucht einen Test" — und umgekehrt).

Die Berichtspflicht ist deshalb umgedreht: **im Report ist je beruehrter Testdatei zu
nennen, dass NUR Kommentarzeilen geaendert wurden**, mit der Zeilenzahl. Eine Testdatei mit
einer geaenderten Nicht-Kommentar-Zeile ist ein Blocker.

---

## 5. Abnahme

Die ersten beiden Punkte sind die eigentliche Abnahme dieser Phase — sie machen die
Nur-Kommentar-Zusage **pruefbar** statt behauptet.

1. **Neu-Erhebung vor dem ersten Edit** (Abschnitt 0). Die Liste aus Abschnitt 2 ist gegen
   den dann aktuellen `master` abgeglichen; Fehlende / Verschobene / Neue sind im Report
   benannt. Baseline dieser Spec: **`9ddf1df`**.

2. **JEDE geaenderte Zeile ist ein Kommentar.** Mechanisch, nicht per Augenschein:

   ```sh
   BASE=$(git merge-base HEAD master)
   # a) alle hinzugefuegten/entfernten Zeilen ansehen (ohne Datei-/Hunk-Koepfe)
   git diff $BASE..HEAD -U0 -- src/ test/ gitleaks.toml \
     | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
     | sed -E 's/^[+-][[:space:]]*//' \
     | grep -vE '^(//|\*|/\*|\*/|#)' | grep -v '^$'
   ```

   Die Ausgabe darf **nur** Zeilen enthalten, deren Kommentar-Anteil geaendert wurde
   (die sechs Zeilenend-Kommentare aus 2.1/2.2: `src/app.js:83`, `src/i18n/locales.js:111`,
   `test/api-cost-truing-sweep.test.js:165`, `test/cost-truing-observe.test.js:293`,
   `test/outbound-tenant.test.js:23`, `test/telnyx-p5-gate-proof.test.js:191`). **Fuer jede
   dieser sechs ist im Report der Code-Anteil vor/nach nebeneinander zu zeigen** — er muss
   identisch sein. Jede weitere Zeile in der Ausgabe ist ein **Blocker**.

3. **Testbestand identisch, nicht nur gruen.** `npm test` **vor** dem ersten Edit und
   **nach** dem letzten Edit auf demselben Branch; **beide Zahlen gehoeren in den Report**
   (pass/fail/total). Sie muessen **exakt gleich** sein. Eine gruene Suite mit einer
   anderen Testzahl ist ein Blocker — genau so faellt ein versehentlich umbenannter oder
   ausgefilterter Test auf.
   Zusaetzlich `npm run test:gates`: dieselbe Zahl vor und nach der Phase (der Katalog-Split
   laeuft ueber Testnamen — s. Kasten in 2.2).

4. **`node --check` auf jede geaenderte `.js`-Datei** in `src/` und `test/`. Ein
   unbalanciertes `/*`/`*/` ist der einzige Weg, wie eine Kommentar-Phase Syntax bricht.

5. **`git diff --stat`**: keine Datei ausserhalb von Abschnitt 2.1, 2.2, 2.3 und 2.5.
   Insbesondere: keine der C-P5-Dateien aus 3.1, kein `package.json`, kein `render.yaml`,
   kein `.env.example`, kein `CLAUDE.md`, kein `.claude/workflows/**`.

6. **`gitleaks`-Konfiguration weiterhin wirksam** (falls das Werkzeug lokal vorliegt):
   `gitleaks detect --config gitleaks.toml --no-git` liefert dasselbe Ergebnis wie vor der
   Phase. Nur die `#`-Zeile wurde angefasst, der `paths`-Block nicht — der Beleg ist ein
   `git diff gitleaks.toml`, der genau eine Zeile zeigt.

7. **Smoke-Test:** Server lokal starten, `/healthz` = 200. Ein Telnyx-Inbound mit gueltiger
   Ed25519-Signatur liefert weiterhin 200 + TeXML (`test/security.test.js` deckt es ab;
   der Handgriff ist die Gegenprobe, weil in `bridge.js` HEIKLE STELLE 2 und in
   `routes/voice.js`/`registry.js` Gate-Kommentare editiert wurden).

8. **Rest-Erhebung:** `git grep -in twilio -- src/ test/ gitleaks.toml .claude/` liefert
   danach nur noch Treffer der Kategorien **(b)** (R1/R3), der **BLEIBT**-Zeilen aus
   Abschnitt 2 und der Prozessdoku aus 2.4. **Jeder verbliebene Treffer ist im Report
   namentlich mit seiner Kategorie zu nennen** — die Zahl ist der Beleg, dass nichts
   uebersehen und nichts uebereifrig geloescht wurde.

9. **Stichprobe gegen Uebereifer:** im Report sind **drei** BLEIBT-Zeilen aus Abschnitt 2
   zu zitieren, die unveraendert im Baum stehen — je eine aus jeder Klasse: Protokollfakt
   (z.B. `adapters/telnyx/voice.js:32`), Anbieter-Doku-Referenz (`src/turn-budget.js:2`),
   Gate-/Entscheidungs-Doku (`src/telephony/registry.js:164`).

---

## 6. Pre-Mortem

| Ein Jahr spaeter ist es schiefgegangen. Was ist passiert? | Gegenmassnahme |
|---|---|
| *"Ein 'Kommentar-Fix' hat Verhalten geaendert."* Beim Umschreiben eines Zeilenend-Kommentars ist ein Template-String / ein Objekt-Literal mitgerutscht — der Diff sah aus wie Prosa. | Abnahme 2: der Diff wird **mechanisch** auf Nicht-Kommentar-Zeilen gefiltert; die sechs Zeilen mit Zeilenend-Kommentar sind namentlich bekannt und ihr Code-Anteil ist im Report Zeichen fuer Zeichen zu belegen. Abnahme 3 pinnt zusaetzlich die Testzahl vor/nach |
| *"Eine wahre Protokoll-Erklaerung ist mitgeloescht worden und das Wissen ist weg."* Jemand hat `grep -i twilio` gefahren und alles gestrichen — seither weiss niemand mehr, dass TeXML PascalCase-Formfelder erwartet, `AnsweredBy` eine Twilio-Konvention ist und der 15-s-Hardcut aus Twilios Doku stammt. | Abschnitt 1, Trennschaerfe 1+3 und die 93 namentlichen **BLEIBT**-Zeilen in Abschnitt 2: sie sind **einzeln aufgefuehrt**, damit der Impl-Agent nicht urteilen muss. Abnahme 9 verlangt drei davon als Zitat aus dem Baum zurueck |
| *"Der Diff war so gross, dass ein eingeschmuggelter Nicht-Kommentar-Edit im Review untergegangen ist."* ~70 geaenderte Zeilen ueber 45 Dateien liest kein Mensch Zeile fuer Zeile. | Genau dafuer ist Abnahme 2 eine **Maschine** und kein Augenpaar. Ergaenzend Abnahme 5 (Dateiliste ist geschlossen) und Abnahme 3 (Testzahl vor/nach identisch) — drei unabhaengige Netze, von denen keines Aufmerksamkeit voraussetzt |
| *"C-P5 und C-P6 haben dieselben Dateien angefasst und der Merge hat einen der beiden Fixes verschluckt."* | Abschnitt 3.1 listet die C-P5-Dateien **namentlich** und schliesst sie aus; Abnahme 5 prueft es am `--stat`. Abschnitt 0 verlangt die Neu-Erhebung gegen den frischen `master` **vor** dem ersten Edit |
| *"Ein Test ist still aus dem Lauf gefallen."* Beim "Aufraeumen" wurde ein Testname mitgeaendert; `npm test` blieb gruen, weil der Test seither in `test:gates` lief. | Kasten in 2.2 (Testnamen sind Laufzeit) + Abnahme 3: **beide** Laeufe mit identischer Zahl vor und nach der Phase. Memory-Lehre `catalog-id-prefix-misroutes-tests` |
| *"Die Suite war gruen, aber `/voice` nahm nichts mehr an."* Ein Edit in `registry.js` oder `routes/voice.js` hat mehr als den Kommentar erwischt — ausgerechnet an einem Gate aus Absolute Regel 1. | Diese drei Stellen (`registry.js:162/164/177`, `routes/voice.js:224`) sind **BLEIBT** — dort wird gar nicht editiert. Abnahme 7 faehrt zusaetzlich den echten Signatur-Smoke |
| *"Der Boot-Guard fiel auf die Nase, weil `SKIP_TWILIO_SIGNATURE_CHECK` beim Aufraeumen mit umbenannt wurde."* | Abschnitt 3.2 + Kategorie (b): 47 Treffer, unangetastet, per Owner-Entscheidung in `CLAUDE.md` |
| *"Ein offener Befund war ploetzlich weg."* Der Hinweis in `voice-status-lifecycle.test.js:86-90` (Altzeile `provider='twilio'` -> 500) las sich wie toter Twilio-Text und wurde mitgeloescht; die Kante fiel Monate spaeter im Betrieb auf. | Abschnitt 3.2 nennt ihn ausdruecklich, Abschnitt 2.2 fuehrt `:87` als **BLEIBT** |
| *"Der Diff hat einen Log-String geaendert und niemand hat es gemerkt."* `call-finish.js:141` sah aus wie ein Kommentar. | Abschnitt 3.3: er ist als **ausserhalb** markiert, mit Begruendung, und geht als Report-Befund weiter statt in den Diff |
| *"`gitleaks` liess ploetzlich echte Secrets durch."* Beim Aufraeumen des Kommentars ist der `paths`-Eintrag mitgegangen. | Abschnitt 2.3 (nur die `#`-Zeile) + Abnahme 6 (`git diff gitleaks.toml` zeigt genau eine Zeile) |
