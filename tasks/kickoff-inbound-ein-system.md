# Kickoff: EIN Gesprächs-System für Inbound und Outbound

> **Stand 2026-09-14: in Teilen überholt.** Was die Nacht gemessen, gebaut und korrigiert
> hat (IE1 nicht messbar ohne Owner, IE6 Stufe 1+2 gemergt, drei falsche Aussagen unten),
> steht in `tasks/inbound-ein-system-stand.md`. Bei Widerspruch gilt jene Datei.

Geschrieben am 2026-09-13 als Übergabe an die nächste Sitzung.
**Jede Aussage hier ist entweder am Code, am Live-Log oder an einer Anbieter-Antwort
gemessen. Was nicht gemessen ist, steht unter „Nicht belegt" — von dort darf nichts als
Prämisse in eine Umsetzung wandern.**

---

## 0. SCHRITT 1, und er braucht den Owner NICHT

**Fang mit IE1 an. Das ist eine MESSUNG, kein Produktionscode — und sie ist die einzige
Sache, die noch zwischen dem heutigen Stand und dem Ziel steht.**

Eine frühere Fassung dieses Dokuments nannte „Testnummer + Test-Trunk vom Owner" als
Blocker. **Das war falsch, am 2026-09-13 gegengeprüft:**

- Bei ElevenLabs sind **vier Nummern registriert**, alle US (`+1`), alle dem Agenten
  „Hermes" zugewiesen, keine davon trägt heute `inbound_trunk_config`. Eine heisst
  wörtlich `Spike2 Telnyx` und stammt aus einem früheren Versuch.
  Gemessen: `GET /v1/convai/phone-numbers` und je `GET .../{id}`.
- Die **deutsche DID, die der Owner anruft, ist KEINE davon**. IE1 fasst sie nicht an.
- `TELNYX_API_KEY` und `TELNYX_CONNECTION_ID` sind in `.env` gesetzt,
  `ELEVENLABS_API_KEY` ebenfalls.

**Also: eine der vier Ersatznummern nehmen, `inbound_trunk_config` dort einschalten,
die sechs Fragen messen, danach zurückstellen.** Nichts kaufen, die produktive DID nicht
anfassen, keine Owner-Handlung.

**Danach laufen IE5 und IE6 in einem Rutsch**, je eine Lean-Workflow-Phase, ohne
Rückfrage. Der Owner will genau das: nicht Phase für Phase gefragt werden, sondern am
Ende ein System.

**Warum die Messung nicht ans Ende darf** (die Frage hat der Owner gestellt, sie ist
berechtigt): sie entscheidet nicht OB gebaut wird, sondern WIE. Drei Dinge hängen daran —
über welchen Befehl die Übergabe läuft (TeXML-`<Dial><Sip>` gegen Call-Control-`dial`
mit `custom_headers`), ob der Hangup-Griff auf das Bein danach noch wirkt, und was
passiert, wenn die Übergabe scheitert. Der Fehlerfall ist der wichtigste: wird er
geraten, hört ein Anrufer im schlechtesten Fall Stille. Zuerst bauen und danach messen
heisst, den Fehlerfall zu raten.

---

## 0b. Der Owner schläft — arbeite durch, weck ihn nicht

Er hat am Abend des 2026-09-13 Feierabend gemacht. **Arbeite alles ab, was ohne ihn
geht, und lass liegen, was ohne ihn nicht geht. Frag ihn nachts nichts.**

**Geht ohne ihn:** IE1 messen, IE5 bauen, IE6 bauen, je über den Lean-Workflow, nach
jeder Phase `git diff --stat` lesen, mergen, Suite mit `--test-concurrency=4` grün
fahren. Alles landet lokal auf `master`.

**Geht NICHT ohne ihn, und das ist in Ordnung:**

1. **Der Push auf `upstream`.** Der Classifier verweigert ihn dem Agenten jedes Mal
   („Production Deploy"). Der Owner führt ihn selbst aus (`! git push upstream master`).
   Danach löst der Agent den Deploy über die Render-Env-API aus — der Service hat
   `autoDeploy = nein`, ein Push allein ändert live nichts.
2. **Ein echter eingehender Testanruf.** Das Abnahmekriterium von IE5 verlangt ihn, und
   niemand ausser dem Owner kann ihn führen.

**Also der Sollzustand am Morgen:** IE1 gemessen und dokumentiert, IE5 und IE6 gebaut,
gemergt, Suite grün — **lokal, nicht live**. Der Schalter von IE5 steht dabei auf AUS,
Flag aus ist byte-identisch zum Bestand; selbst ein sofortiger Deploy würde also nichts
am Verhalten ändern, bis jemand ihn bewusst umlegt.

Schreib ihm morgens EINE Zusammenfassung: was gemessen wurde, was gebaut ist, was der
Push und der Testanruf noch brauchen. Nicht drei Statusmeldungen über Nacht.

---

## 1. Was der Owner will (Entscheidung, nicht Vorschlag)

**Inbound und Outbound laufen über DASSELBE System: den ElevenLabs-ConvAI-Agenten.**
Ein Agent, eine Stimme, ein Kostenpfad, EIN Ort, an dem Gesprächslogik lebt.

Der Owner hat das mehrfach und ausdrücklich gesagt, zuletzt gereizt, weil es sich
hinzieht. Zwei Gesprächs-Systeme dauerhaft zu pflegen ist der Preis, den er **nicht**
zahlt — und er beruft sich dabei zu Recht auf `.claude/refs/clean-code.md`: zwei Systeme
für dieselbe Aufgabe sind die zweite Wahrheit, die der Katalog verbietet (G5).

**Daraus folgt für jede Entscheidung in dieser Kette:** es gewinnt der Weg, der am Ende
am WENIGSTEN eigenen Gesprächs- und Buchhaltungscode bei uns zurücklässt. „Schnell zu
bauen" ist ein Tiebreaker, kein Kriterium. Eine Lösung, die ein zweites System
zementiert, ist kein Ergebnis, sondern ein Rückschritt.

Sein Kostenargument ist geprüft und richtig: der Umstieg löscht für Inbound unsere
eigenen Kostenarten (Modell-Token je Turn, TTS-Zeichen, Carrier-Spracherkennung) und
führt alle Minuten in einen Mengenrabatt statt in zwei Töpfe.

---

## 2. Ehrlicher Stand: was fertig ist und was NICHT

Die vorige Sitzung hat „acht Phasen live" gemeldet. Das war missverständlich und hat den
Owner zu Recht verärgert. **Fertig ist die Vorbereitung. Das Ziel ist nicht gebaut.**

### Gebaut, gemergt und LIVE (Stand `db4c312`)

| Phase | Was sie tut |
|---|---|
| IP1 | Deutsche Begrüssung spricht Umlaute, auch die at rest gespeicherte Fassung |
| IP2 | `npm run inbound:hoerprobe` misst den Sprechpfad ohne echten Anruf |
| IP3 | Defekter ElevenLabs-Relay am TeXML-`<Say>` entfernt; `render.yaml`-Drift behoben |
| IP4 | Boot-Banner nennt den Sprechpfad; Tests binden beide Richtungen an einen Stimm-Resolver |
| IE2 | Wiederkehrender Geld-Wächter je aktivem Anruf (schliesst eine Lücke, die auch Outbound betraf) |
| IE3 | Kostenprofil `telnyx_inbound_el_convai` + vierter Boot-Riegel (FATAL) |
| IE4 | Wiederholungs-Riegel antwortet nach Zustand des Beins statt nach Engine |
| IE7 | Inbound-Webhook wartet nur noch auf das ERSTE Audio-Paket, nicht auf die fertige Datei |

Alle acht sind auf `master`, auf `upstream/master` gepusht und live. Suite: **6045 grün**
(`NODE_ENV=test node test/testbaenke-run.mjs regression --test-concurrency=4`; ohne das
Concurrency-Limit flaked die Bank, das ist Bestandsverhalten).

### NICHT gebaut — das ist das eigentliche Ziel

| Phase | Was fehlt | Blockiert durch |
|---|---|---|
| **IE1** | Sechs Messungen am Anbieter-Vertrag (kein Produktionscode) | **nichts** — alles da, s. Abschnitt 0 |
| **IE5** | Der Umstieg: Inbound am EL-Agenten, hinter einem Schalter | IE1 |
| **IE6** | Die überzähligen Gehirne LÖSCHEN | IE5 |

**Ohne IE6 ist die Kette nicht erfüllt.** Eine Konsolidierung, die nichts entfernt, ist
keine. Im Repo stehen heute vier Gesprächs-Gehirne: Budget-Engine (Inbound live),
EL-ConvAI (Outbound live), Telnyx-AI-Assistant (gebaut, Schalter aus) und eine
OpenAI-Realtime-Bridge (`src/bridge.js`, Schalter aus). Am Ende soll **eines** übrig sein.

---

## 3. Warum Inbound heute noch auf unserer Engine läuft

Nicht aus Bequemlichkeit: der neue Weg existiert noch nicht. Ihn vorher abzuschalten
hiesse, eingehende Anrufe gehen gar nicht mehr.

**Die Richtung entscheidet heute die Engine** (live belegt, Logzeile
`[telnyx-inbound] inbound_path {"path":"budget","reason":"handoff_disabled"}`):

- **Outbound**: `POST /v1/convai/sip-trunk/outbound-call`, der Anbieter führt das
  Gespräch mit SEINEM Sprachmodell. Unser LLM-Konto ist dabei irrelevant.
- **Inbound**: `POST /voice/incoming` + `/voice/turn`, TeXML-Gather, `src/claude.js` als
  Gehirn — ruft UNSER Sprachmodell.

Genau diese Asymmetrie hat am 2026-09-13 den Defekt erzeugt, den der Owner erlebt hat
(s. Abschnitt 5).

---

## 4. Der gewählte Weg (K1) und warum der einfachere ausscheidet

**K1, beschlossen:** unser `/voice/incoming` nimmt an, durchläuft alle sieben
Sicherungen unverändert, rendert den Pflichtsatz — und übergibt das Bein DANACH per SIP
an denselben EL-Agenten. Das Carrier-Bein bleibt UNSER, deshalb bleibt der Hangup-Griff
unser. Danach lebt Gesprächslogik bei uns nirgends mehr: kein Turn-Loop, kein eigener
STT-Seam, kein Prompt je Richtung.

**K3 („Nummer zeigt direkt auf ElevenLabs") ist ausgeschieden, und das ist keine
Abwägung.** Es wäre der wörtlich einfachste Weg und wurde deshalb ZUERST geprüft. Vier
Anbieter-Belege, drei davon Wegfall einer Sicherung:

1. Der Gesprächs-Initiations-Webhook ist **nicht signiert** (HMAC gibt es beim Anbieter
   nur für `post_call_transcription` und die `voice_removal`-Ereignisse). Die einzige
   Authentifizierung wäre ein statisches Header-Geheimnis — kein Ersatz für Ed25519 mit
   Wiederholungsschutz.
2. Die angerufene Nummer käme aus dem Body dieses unsignierten Webhooks. Tenant-Spoofing
   ist damit möglich, und der Tenant entscheidet Begrüssung, Sprache, Kontext und
   Postfach — das ist ein Datenweg zwischen Mandanten, nicht nur Geld.
3. Es gibt **keinen Ablehnungs-Vertrag**. Die Doku sagt nur, ein fehlgeschlagener
   Webhook „könne" den Start verhindern. Kein Reject-Feld, kein Statuscode, keine Zusage
   im Fehlerfall. Ohne Sperrwirkung: keine Kostendecke, keine Denylist.
4. **Kein benutzbarer Abbruch-Kanal**: die Monitoring-WebSocket mit `end_call` ist laut
   Doku enterprise-only und verlangt Verbinden NACH Gesprächsbeginn.

Die volle Herleitung steht in `PLAN-INBOUND-PARITAET.md` Abschnitt 2.3. **Wer K3 wieder
aufmachen will, braucht neue Anbieter-Belege, nicht ein neues Argument.**

---

## 5. Der Live-Defekt vom 2026-09-13, und was daran schon gefixt ist

Der Owner rief zweimal an. Beide Male: Begrüssung kam, dann „technisches Problem",
dann Auflegen. Log (`call_mu04voq5q6r3`, `call_mu095l83ybhf`):

```
[turn] 400 "Your credit balance is too low to access the Anthropic API"
[voice/turn] ALARM_LLM_BILLING
```

**Zwei Ursachen, nicht eine:**

1. Das Anthropic-Konto hat kein Guthaben (mit dem lokalen Schlüssel gegengeprüft: 400,
   dieselbe Meldung).
2. **Live war der Anbieter auf `anthropic` gestellt, der Modellname aber auf
   `deepseek-v4-pro`.** `DEFAULT_LLM_PROVIDER` in `src/llm/provider.js` ist `anthropic`;
   `render.yaml` trägt `LLM_PROVIDER: anthropic` als festen Wert. Selbst mit Guthaben
   hätte dieser Anruf scheitern müssen — Anthropic kennt dieses Modell nicht.

**Am 2026-09-13 um 20:21 gesetzt:** `LLM_PROVIDER=deepseek` auf Render. Der Dienst ist
danach sauber hochgekommen (Instanz `...-4pb9z`, Banner `CLAUDE_MODEL=deepseek-v4-pro`),
der Boot-Riegel für den DeepSeek-Schlüssel hat NICHT angeschlagen — der Schlüssel ist
also live gesetzt.

**Nicht belegt: ob damit ein eingehender Anruf jetzt durchläuft.** Seit dem Flip gab es
keinen Anruf. Erste Aufgabe der nächsten Sitzung, wenn der Owner es wünscht: ihn um einen
Testanruf bitten und das Log prüfen.

**Der Gegenbeweis, dass Outbound gesund ist:** Testanruf `call_mu099j471pla` am selben
Abend. Der Owner hörte gut, der Agent antwortete normal. Outbound benutzt unser
Sprachmodell nicht — deshalb war er nie betroffen. **Nach dem Umstieg auf K1 gilt das
auch für Inbound; die ganze Anthropic-/DeepSeek-Frage fällt für Inbound ersatzlos weg.**

---

## 6. Gemessene Anbieter-Fakten (nicht neu messen, nicht raten)

Alles am 2026-09-13 am echten Konto/Anbieter erhoben.

**Der Live-Agent** (`GET /v1/convai/agents/<id>`):

| Feld | Wert |
|---|---|
| `tts.model_id` | `eleven_v3_conversational` |
| `tts.voice_id` | gesetzt (Dashboard-Stimme) |
| `agent.language` | `en` |
| Override erlaubt | `voice_id: true`, **`model_id: false`** |
| `language_presets` | `de`, `fr`, `es` |

**`model_id` ist je Anruf NICHT übersteuerbar.** Outbound spricht daher immer
`eleven_v3_conversational`. Für IE5 heisst das: die Modellwahl des Agenten ist gesetzt,
nicht verhandelbar je Anruf.

**TTS-Modelle mit Deutsch** (aus `GET /v1/models`), Vollsynthese des echten
Begrüssungstextes mit der kuratierten Stimme:

| Modell | Dauer |
|---|---|
| `eleven_turbo_v2_5` | 650 ms |
| `eleven_flash_v2_5` | 1174 ms |
| `eleven_multilingual_v2` | 1970 ms |
| `eleven_v3_conversational` | 2572 ms |
| `eleven_v3` | 9000–10000 ms |

Die beiden Modelle mit `can_do_voice_conversion` sind **Voice Conversion**, kein
Gesprächsmodell. **ElevenLabs hat kein End-to-End-Speech-to-Speech-Modell** — ihre
Agenten-Plattform ist laut eigener Doku eine Kette aus ASR, LLM, TTS und einem
Turn-Taking-Modell.

**Vollsynthese vs. Streaming, `eleven_v3_conversational`, je drei Läufe:**

| Sprache | Vollsynthese, schlechtester Fall | erstes Audio gestreamt, schlechtester Fall |
|---|---|---|
| de | 3940 ms | 496 ms |
| fr | **6370 ms** | 265 ms |
| en | 3140 ms | 205 ms |

Das ist die Begründung von IE7 und gleichzeitig die Erklärung, warum derselbe Modellname
bei Outbound gut klingt: der Anbieter streamt.

---

## 7. Live-Konfiguration, die diese Sitzung gesetzt hat

Render-Service `vodafone-agent` (`srv-d8m0fhflk1mc73bno570`), **autoDeploy = nein**.
Ein Push allein deployt NICHT; der Deploy wird über `update_environment_variables`
ausgelöst und nimmt dabei den aktuellen Branch-HEAD.

| Schlüssel | Wert |
|---|---|
| `ELEVENLABS_PLAY_TTS_ENABLED` | `true` |
| `ELEVENLABS_MODEL` | `eleven_v3_conversational` |
| `ELEVENLABS_SYNTH_TIMEOUT_MS` | `2000` (Frist bis zum ERSTEN Paket) |
| `ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS` | `10000` |
| `LLM_PROVIDER` | `deepseek` |

**Die Render-Services sind Dashboard-verwaltet. `render.yaml` ist NICHT die Live-Wahrheit
— es ist die Absicht.** Wer einen Live-Wert braucht, misst ihn am Boot-Banner oder setzt
ihn ausdrücklich.

---

## 8. Nicht belegt — nichts davon als Prämisse verwenden

- Ob ein eingehender Anruf seit dem `LLM_PROVIDER`-Flip durchläuft. Kein Anruf seither.
- Ob das DeepSeek-Konto Guthaben hat. Der Boot beweist nur, dass der Schlüssel gesetzt
  ist. Der lokale DeepSeek-Schlüssel in `.env` ist **ungültig** (401), der Live-Schlüssel
  ist ein anderer.
- Alle sechs IE1-Fragen (F-A bis F-F): Agenten-Zuordnung eines ad-hoc-INVITE,
  Variablenkanal, Elternbein-Griff, zweites Telnyx-Bein und seine Abrechnung, Nummer
  doppelt belegbar, **Fehlerfall der Übergabe**. Details in `PLAN-INBOUND-PARITAET.md`
  unter „Phase IE1".
- Ob `get_consult` kaputt ist. **Beobachtung** aus `call_mu099j471pla`: der Tool-Aufruf
  schlug mit `kein_laufender_anruf` fehl, obwohl das Gespräch lief. Einmal gesehen, nicht
  reproduziert, keine Diagnose. Eigener Befund, gehört nicht in diese Kette.

---

## 9. Was die nächste Sitzung tun soll

1. **IE1 fahren, sofort und ohne Rückfrage** — sechs Messungen an einer der vier
   Ersatznummern, KEIN Produktionscode, produktive DID nicht anfassen, Konfiguration
   danach zurückstellen. Alles Nötige liegt bereit (Abschnitt 0).
2. **IE5 bauen**, hinter einem Schalter, Schalter aus = byte-identisch.
3. **IE6 bauen**: die überzähligen Gehirne entfernen, bis genau eines übrig ist.
4. Erst danach ist die Kette erfüllt.

**Schritt 2 bis 4 laufen in einem Rutsch**, je eine Lean-Workflow-Phase, ohne
Zwischenfrage an den Owner. Er meldet sich, wenn er etwas anders will. Melde dich bei
ihm, wenn die Messung steht und wenn Inbound am Agenten hängt — nicht dazwischen.

**Arbeitsweise, verbindlich:**
- `CLAUDE.md` und `.claude/refs/workflow.md` gelten. Nicht-triviale Phasen laufen über
  `.claude/workflows/runs/inbound-paritaet-lean.js` (Phase im `A`-Block HART pinnen).
- **`.claude/refs/clean-code.md` ist hartes Gate**, nicht Empfehlung. Der Clean-Code-
  Auditor im Workflow blockiert bei S1/S2. Der Owner liest den Code nicht, aber er merkt,
  wenn zwei Systeme entstehen.
- Nach jedem Merge: Suite mit `--test-concurrency=4`, dann `git diff --stat` gegen
  `master` lesen, BEVOR gemergt wird. Ein Workflow-PASS ist keine Merge-Freigabe.
- Der Push auf `upstream` wird dem Agenten vom Classifier verweigert. Der Owner führt ihn
  selbst aus (`! git push upstream master`); den Deploy löst danach der Agent über die
  Render-Env-API aus.
- **Dem Owner den Stand nicht beschönigen.** „Phasen live" ist nicht „Ziel erreicht".
  Was offen ist, wird zuerst genannt.
