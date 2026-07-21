# Prompt fuer die naechste Session — Ist-Kosten endgueltig zu Ende bringen

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen.

---

Es geht um die **Ist-Kosten-Erfassung** (PLAN-LIVE-COST-TRACING). Das Thema laeuft seit
Wochen, wurde zweimal fuer "fertig" erklaert und war beide Male kaputt. **Dein Auftrag ist
NICHT, sofort zu implementieren, sondern einen Strategie-Plan zu entwickeln, der das Thema
endgueltig abschliesst — und zwar auf Basis von Messungen, nicht von Annahmen.**

**Nutze dafuer einen dynamischen `Workflow`** (Multi-Agent-Orchestrierung, ich autorisiere
das hiermit ausdruecklich): fan-out zum Vermessen der offenen Fragen, danach Synthese zu
EINEM Strategie-Dokument. Der Lead schreibt am Ende `PLAN-KOSTEN-ENDSPIEL.md`.

## Die Kernregel dieses Auftrags

**Mach keine Annahmen. Jede Zahl, jeder Feldname, jedes API-Verhalten wird gemessen oder
als UNBELEGT gekennzeichnet.** Dieses Projekt ist bereits zweimal an genau dieser Stelle
gescheitert:

| Angenommen | Wirklichkeit (gemessen) |
| --- | --- |
| Kostenbelege tragen `leg_id`/`call_leg_id` | Gibt es nicht. 297 von 297 Belegen wurden verworfen, Deckung dauerhaft 0 % |
| API kennt nur `filter[record_type]` + `page[size]` | Falsch — es gibt Zeitfilter (s.u.) |
| `page[size]=250` holt alles | Telnyx deckelt hart auf **50**; es gibt 212 Belege allein bei `sip-trunking` |
| CDR-Latenz ~3 Stunden | Beleg war nach **17 Minuten** schon da (Obergrenze, echte Zahl unbekannt) |
| Tests gruen = funktioniert | Die Fixtures erfanden das Feld `leg_id` — sie testeten die eigene Annahme |

Wenn du etwas nicht gemessen hast, schreib **UNBELEGT** hin. Ein ehrliches Loch ist
brauchbar, eine plausible Zahl ist Gift.

## Was BELEGT ist (Stand 2026-07-21, nicht neu herleiten)

**Live-Stand:** `master` = `3516c31`, deployt und gebootet (`[boot] deployed commit=3516c31…`),
Suite 2861/0. Beide Remotes (origin + upstream) synchron.

**Der Join funktioniert.** Die Zuordnung Beleg->Anruf laeuft zweistufig: Anker ueber
`call_control_id === legId`, dann Aufspannen ueber `telnyx_session_id`/`call_session_id`.
Live verifiziert mit echten Leg-IDs und echtem Anrufsfenster: 7 / 7 / 10 Belege ueber beide
Anrufpfade. Session-Lokalitaet konto-weit gemessen: **0 von 54 Sessions** tragen mehr als
einen Anker — ABER nie unter Parallelverkehr (in der Stichprobe lief nie ein zweiter Call
gleichzeitig).

**Echte Kosten:** ein 57-s-Assistant-Anruf = **0,094267 USD** (sip-trunking 0,0401 +
ai-voice-assistant 0,05 + call-control 0,002 + recording 0,002 + TTS 0,000167). Der
Assistant-Aufschlag ist **flat 0,05 USD je ANGEFANGENER Minute, Minimum 1 Minute**.
STT wird auf dem Assistant-Pfad nicht zusaetzlich berechnet.

**Das Budget wird SOFORT belastet**, nicht erst vom Sweep: `finishCall` bucht bei
Gespraechsende `minuten * tariffCentsPerMin` ueber `addVoiceUsageCostCents`. Der Sweep
ersetzt diese Schaetzung spaeter durch den Ist-Wert. Die Sperre ist also nie blind — der
Sweep ist eine Praezisions-Korrektur, keine Abrechnung. **Das war ein Missverstaendnis in
der Vorsession; nicht erneut falsch darstellen.**

## Die vier offenen Defekte (alle heute gemessen, KEINE Vermutungen)

Der erste manuelle Sweep nach dem Deploy lieferte `gemessen=0` bei 33 Kandidaten. Ursachen:

**D1 — Rate-Limit.** Der Sweep stellt **7 API-Anfragen pro Anruf**; bei 32 Kandidaten sind
das 224. Gemessen im echten Sweep-Muster: `{"200":40, "429":184}`, erster Fehler bei
Anfrage #36, Telnyx-Code `10011` ("You have exceeded the maximum number of allowed
requests"). **Die Anfragen sind vollstaendig redundant**: `fetchCostRecordPage` filtert nur
nach `record_type`, hat also KEINEN anrufspezifischen Parameter — jeder der 32 Anrufe holt
exakt dieselben Daten. Fix-Richtung: einmal je Sweep holen, dann alle Kandidaten im
Speicher dagegen abgleichen.

**D2 — Paginierung wird ignoriert.** Antwort-`meta` liefert
`{"total_results":212,"total_pages":5,"page_size":50}`. Der Code holt nur Seite 1 und
behandelt sie als vollstaendig -> aeltere Anrufe sind strukturell unauffindbar (das sind
die `5x records=0` im Sweep).

**D3 — Die fail-closed-Sicherung dagegen ist TOT.** `COST_RECORDS_PAGE_SIZE = 250`, und der
Schutz lautet `if (page.raw.length === 250) -> page_truncated`. Telnyx deckelt bei 50, die
Bedingung wird also **nie** wahr. Die Sicherung, die stillen Datenverlust verhindern soll,
feuert niemals. S1.

**D4 — Der Fehlerpfad ist stumm.** `getVoiceCostRecords` loggt NUR auf dem Erfolgspfad
(`logCostRecordsOk`). Bei `ok:false` gibt es keine Zeile. Deshalb sah man im Live-Log nur
6 Aufrufe statt 30 und hielt den Rest fuer nicht existent. 24 Anrufe fielen still in
`provider_error`. Ohne diesen blinden Fleck waere D1 sofort sichtbar gewesen.

**Nebenbefund:** 3 Kandidaten liefern `params_missing` (fehlendes `startedAt`/`endedAt`) —
Ursache UNBELEGT, bitte klaeren statt wegzuwerfen.

## Was die API WIRKLICH kann (gemessen, korrigiert den Plan)

`PLAN-LIVE-COST-TRACING.md` Kap. 2.6 behauptet, nur `filter[record_type]` + `page[size]`
seien belegt. Das ist ueberholt:

```
filter[date_range]=last_7_days                 -> 200, 18 Treffer
filter[started_at][gte]=2026-07-20T00:00:00Z   -> 200,  4 Treffer
filter[created_at][gte]=2026-07-20T00:00:00Z   -> 200,  0 Treffer (Feld gibt es nur auf manchen Typen)
page[number]=2                                 -> 200, blaettert (Achtung: page_size fiel dabei auf 20)
meta                                           -> total_results / total_pages / page_number / page_size
```

Ein **zeitfenster-basierter Einzug mit Wasserstand** ist damit moeglich — die heutige
Pro-Anruf-Abfrage ist nicht alternativlos, sie war nur nie hinterfragt.

## Die strategische Frage, die der Plan beantworten muss

Der Owner will das fuer **Millionen Nutzer** tragfaehig (CLAUDE.md-Vision). Vorbewertung
aus dieser Session, die du pruefen und ggf. widerlegen sollst:

- **Pro Tenant pollen ist die falsche Richtung.** Das Rate-Limit ist KONTOWEIT (ein
  Telnyx-Konto fuer alle Tenants); Telnyx kennt unsere Tenant-Dimension ueberhaupt nicht
  (kein `filter[tenant]`), die Zuordnung lebt nur in unserer DB. Pro-Tenant-Polling
  multipliziert Anfragen mit der Nutzerzahl.
- **Skalierend waere:** EIN gemeinsamer, zeitfenster-basierter Einzug -> Belege in eine
  eigene Tabelle -> Zuordnung zu Anruf/Tenant als DB-Join, null API-Anfragen. Aufwand dann
  `neue Belege / 50`, unabhaengig von der Tenant-Zahl.
- **Ab welcher Groesse Polling grundsaetzlich bricht, ist UNBELEGT** und gehoert gemessen.

## Was gemessen werden MUSS, bevor der Plan steht

1. **Das Rate-Limit-Fenster.** Bekannt ist nur die Anzahl (~35 Anfragen bis 429). Pro
   Sekunde? Pro Minute? Gibt es `Retry-After`- oder `RateLimit-*`-Header? Ohne diese Zahl
   ist jede Kapazitaetsplanung geraten.
2. **Bietet Telnyx Push statt Poll?** Webhook fuer CDRs, Bulk-/Storage-Export, S3-Ablieferung?
   Bei Millionen-Skala ist Polling vermutlich das falsche Primitiv — aber das ist eine
   Vermutung, keine Messung. Nachsehen.
3. **Die echte CDR-Latenz.** Obergrenze 17 Minuten gemessen, echter Wert unbekannt. Sauber
   messen: einen Testanruf ausloesen und ab Gespraechsende sekuendlich pollen, bis der Beleg
   auftaucht. Davon haengen `COST_TRUING_DELAY_MINUTES` (heute 180, Env) und das
   Sweep-Intervall (heute 6 h, **hartkodiert** in `cost-truing.js`) ab.
4. **Bleibt eine Session call-lokal, wenn zwei Anrufe GLEICHZEITIG laufen?** Das ist die
   Invariante, auf der die ganze Zuordnung ruht; sie ist konto-weit gemessen, aber nie unter
   Parallelitaet. Ein Treffer (Session mit >1 Anker) waere fail-OPEN: fremde Belege auf dem
   eigenen Tenant.
5. **Paginierungs-Semantik unter Last.** `page[number]=2` lieferte unerwartet `page_size:20`.
   Was passiert, wenn waehrend des Blaetterns neue Belege dazukommen — Duplikate? Luecken?
6. **ElevenLabs pro Tenant.** Existiert heute NICHT: der Zaehler (`state-ops.js`, LCT P7) ist
   global ohne Tenant-Dimension UND wird nur vom budget-Pfad gefuettert
   (`tts/directive-synth.js`). Auf dem Assistant-Pfad synthetisiert Telnyx mit unserem dort
   hinterlegten Key — unser Zaehler sieht **null Zeichen**, waehrend das Kontingent
   verbraucht wird. Da ausgehend IMMER ueber den Assistant laeuft, ist das der Normalfall.
   Der Plan muss sagen, ob und wie das pro Tenant erfassbar ist (Telnyx-Belege? ElevenLabs-
   History-API? gar nicht?).

## Randbedingungen (nicht dagegen arbeiten)

- **Nicht deployen ohne meine ausdrueckliche Ansage.** Merge auf `master` ist kein
  Ausliefern. `autoDeploy` ist **AUS** (2026-07-21 nachgemessen: der Push auf upstream loeste
  KEINEN Deploy aus). `mcp__render__trigger_deploy` ist vom Classifier gesperrt — nur ich
  kann deployen. **Auf BEIDE Remotes pushen** (origin + upstream), sonst divergieren sie.
- **Bereits entschieden, nicht neu aufrollen:** der `ai-voice-assistant`-Pfad BLEIBT
  (Barge-in; der budget-Pfad kann das strukturell nicht). Damit bleibt
  `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` korrekt auf **10**. Korrekturbuchung laeuft
  unkonditional (kein Beobachtungsmodus, P8 hat den Schalter bewusst entfernt).
- **Safety-Gates, Disclosure, Auth fail-closed** bleiben unantastbar (CLAUDE.md).
- Der Geldpfad bleibt **fail-closed**: kein Anker gefunden heisst leere Liste. Ein fremder
  Beleg waere eine Fehlbuchung auf einen fremden Tenant; ein fehlender Beleg ist nur
  `incomplete`. Diese Asymmetrie ist der Kern und darf nicht aufgeweicht werden.

## Werkzeuge / Zugaenge

- **Prod-DB:** `psql "$(cat ~/.config/hermes/db-url)"` — FORCE-RLS, ein naives `SELECT`
  liefert 0 Zeilen. Vorher `SET app.current_tenant='<tenant>';`. Tenants: `owner` und
  `t_user_01KX600834GCJFV9GTZQKWZMTH`.
- **Render:** Workspace `tea-d8m0b9jeo5us73cvasg0`, Service `srv-d8m0fhflk1mc73bno570`.
  Voice-Webhooks erscheinen als **app**-Logs, nicht als request-Logs. Env ist per API
  **nicht lesbar** (nur schreibbar) — Werte erfragen, nicht raten.
- **Telnyx:** `TELNYX_API_KEY` liegt in `.env`. Read-only-Sonden gegen
  `GET /v2/detail_records` sind unbedenklich und kosten nichts. **Nach ~35 Anfragen kommt
  429** — Sonden drosseln, sonst misst du dein eigenes Rate-Limit statt der Sache.
- **Sweep manuell ausloesen:** `bash scripts/sweep-jetzt.sh` (Basic-Auth `admin`,
  `DASHBOARD_PASSWORD` liegt bereits in `.env`).
- **Vorarbeit lesen:** `tasks/lct-fix-1-report.md`, `tasks/lct-fix-1-spec.md`,
  `tasks/lct-DEPLOY-CHECKLIST.md`, `PLAN-LIVE-COST-TRACING.md` (Kap. 2.6 ist an den oben
  genannten Stellen ueberholt — beim Schreiben des neuen Plans korrigieren, nicht
  fortschreiben).

## Ergebnis, das ich erwarte

**`PLAN-KOSTEN-ENDSPIEL.md`** mit:

1. **Messprotokoll** — jede der sechs offenen Fragen oben beantwortet oder ausdruecklich als
   UNBELEGT markiert, mit dem Befehl/der Abfrage, die zur Zahl gefuehrt hat.
2. **Zielarchitektur** — wie die Ist-Kosten-Erfassung bei Millionen Nutzern aussieht,
   inklusive der Groesse, ab der der gewaehlte Ansatz bricht, und was dann kommt.
3. **Phasenplan** — kleine, einzeln verifizierbare Schritte mit je einem
   deterministischen Abnahmekriterium (Muster: "rot heute = X, gruen = Y"). D1-D4 sind
   Sofortmassnahmen und gehoeren nach vorn.
4. **Pre-Mortem** — ein Jahr in der Zukunft, die Sache ist gescheitert: was war die Ursache?
   Benenne die Risiken VOR der Umsetzung (CLAUDE.md).
5. **Owner-Entscheidungen** — was du NICHT allein entscheiden darfst, als Liste mit
   Optionen und Konsequenzen. Ich entscheide, du empfiehlst.

Erst wenn der Plan steht und ich ihn freigegeben habe, wird implementiert.
