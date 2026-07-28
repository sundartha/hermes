# RUNBOOK: Telnyx AI Assistant provisionieren (P7)

Ziel: Den Telnyx AI Assistant deterministisch anlegen/aktualisieren — Ela-Stimme
(ElevenLabs via Telnyx-Integration-Secret), Custom-LLM auf unseren Brain-Shim
(`POST /v1/chat/completions`), Barge-in an, **kein** eigenständiges Greeting.
Das Provisioning-Skript (`scripts/telnyx-assistant-provision.mjs`) ist reines
Owner-CLI-Werkzeug, kein neuer HTTP-Endpunkt — keine neue Auth-Oberfläche.

## 1. Zweck + Owner-Gating

Dieser Lauf braucht echten Telnyx-Zugang und ist deshalb **Owner-gated**:

- Telnyx-Guthaben **> 2 USD** — darunter liefert Telnyx historisch einen
  **stillen HTTP 402** ohne aussagekräftige Meldung (siehe
  Provisioning-Historie, `tasks/telnyx-provisioning-state.md`-Vorgänger).
- Der Code-Merge dieser Phase ist **nicht** an einen erfolgreichen Live-Lauf
  gebunden — die **produktive** Assistant-Aktivierung schon.

## 2. Voraussetzungen

| Wert | Herkunft |
|---|---|
| `TELNYX_API_KEY` | Render-Env / lokale `.env` |
| `PUBLIC_URL` | Render-Env (`RENDER_EXTERNAL_URL`) / lokale `.env` |
| `elevenlabs_prod`-Integration-Secret | **IN Telnyx** angelegt (nicht im Repo, hält den ElevenLabs-API-Key) |
| `TELNYX_ELEVENLABS_VOICE_ID` | Render-Env / lokale `.env` |
| `TELNYX_ELEVENLABS_API_KEY_REF` | `elevenlabs_prod` (Referenz auf das Telnyx-Secret oben) |
| `TELNYX_ELEVENLABS_MODEL` | optional, Default `"Default"` |
| `TELNYX_SHIM_API_KEY_REF` | NAME eines zweiten Telnyx-Integration-Secrets fuer `external_llm.llm_api_key_ref` — **WERT-gleich** mit `TELNYX_SHIM_SHARED_SECRET` (Server-Bearer-Pruefung) |
| `TELNYX_SHIM_SHARED_SECRET` | Render-Env / lokale `.env` — vom Server als Bearer geprueft (SECRET, Boot-Pflicht bei aktivem Flag) |

Ohne diese Werte bricht das Skript sofort ab: `smokePass=false` + Grund
(nur die **Namen** der fehlenden Werte, nie ein Wert).

## 3. Ausführung

```
node scripts/telnyx-assistant-provision.mjs
```

Legt einen neuen Assistant an (POST). Für ein **Update** eines bestehenden
Assistants vorher `TELNYX_ASSISTANT_ID` setzen (PUT):

```
TELNYX_ASSISTANT_ID=assistant_xyz node scripts/telnyx-assistant-provision.mjs
```

Erwartete Ausgabe bei Erfolg:

```
smokePass=true
Grund: assistant_id=assistant_xyz (in TELNYX_ASSISTANT_ID uebernehmen)
```

Das Skript gibt **ausschließlich** die opake `assistant_id` aus — nie einen
Key, nie einen Roh-Response-Body.

**Update-Sicherheitscheck (afix-p1):** Bei einem Update (bestehende
`TELNYX_ASSISTANT_ID`) sendet das Skript **nur** `telephony_settings.
user_idle_reply_secs` — ob der Telnyx-Update-POST das restliche
Assistant-Objekt dabei feldweise mergt oder ersetzt, ist live
**unbestätigt** (Abschnitt 7). Das Skript verlässt sich deshalb nicht
blind darauf: Es liest den Assistant **vor und nach** dem Update per GET
und vergleicht `time_limit_secs`, `recording_settings`,
`default_texml_app_id`, `transcription` (`PRESERVED_SAFETY_FIELDS`,
`time_limit_secs` ist der assistant-seitige Sicherheits-Cap, Absolute
Regel 1). Drei dieser vier Felder liegen live per GET verifiziert
**verschachtelt unter `telephony_settings`** (nur `transcription` liegt
top-level) — der Vergleich liest deshalb über den vollen Pfad, nicht nur
`assistant.<feld>`, sonst würde er für die verschachtelten Felder nie
etwas verlieren *sehen*, egal was der Update-POST tatsächlich tut. Ist
danach ein Feld verschwunden oder verändert, bricht das Skript mit
`smokePass=false` ab (Feldname in der Meldung, nie ein Wert) — dann die
Assistant-Config im Telnyx-Portal prüfen und ggf. manuell
wiederherstellen, statt den Lauf zu wiederholen.

## 4. `assistant_id` in die Env übernehmen

Die ausgegebene `assistant_id` in `TELNYX_ASSISTANT_ID` übernehmen (Render-Env
bzw. lokale `.env`), damit spätere Läufe des Skripts als Update statt Neuanlage
laufen. Die endgültige Formalisierung dieser Env-Var (Nutzung durch die
Live-Engine) ist P10 — hier nur Provisioning.

## 5. Abnahmekriterium (Regel 2 — hart, kein KI-Ermessen)

**Greeting / First-Message des Assistants ist deaktiviert (`greeting: ""`)** —
nur der deterministische Disclosure-Speak-Node (P4.5/P5) spricht bei Outbound-
Calls den fest verdrahteten Offenlegungssatz zuerst. Der Assistant selbst hat
kein freies Prompt-/Instructions-Feld, das die Disclosure umgehen könnte.

Verifikation:

1. Im Telnyx-Portal die Assistant-Konfiguration öffnen und bestätigen, dass
   das Greeting-Feld leer ist.
2. Im Live-Testanruf (P11) hören, dass der Disclosure-Satz zuerst kommt —
   nicht ein Assistant-eigenes Greeting.

## 6. Sicherheitshinweise

- Das Skript loggt **nie** `TELNYX_API_KEY`, den ElevenLabs-Key oder einen
  Roh-Response-Body — Fehler laufen ausschließlich über `assertTelnyxOk`
  (allowlisted: HTTP-Status + Telnyx `code`/`title`).
- `api_key_ref` in der Assistant-Config ist eine **Referenz** auf das in
  Telnyx liegende `elevenlabs_prod`-Secret, **kein** Klartext-Key.
- Der ElevenLabs-API-Key liegt ausschließlich in Telnyx, nie in diesem Repo
  oder in Render-Env.

## 7. Caveat — live unbestätigt

Der exakte Telnyx-AI-Assistant-REST-Schema-Slot ist bislang **live
unbestätigt** und wird beim ersten echten Lauf mit dem Owner an der echten
API fixiert (Muster: `src/telephony/adapters/telnyx/voice.js`, Kommentar
Z. 6-12, dieselbe Ehrlichkeits-Konvention):

- Exakter Create/Update-Endpunkt (`/v2/ai/assistants`) + `external_llm`-
  Sub-Schema (Append-Verhalten der Custom-LLM-URL).
- Voice-Slot-Casing `ElevenLabs` vs. `elevenlabs` (dieser Lauf setzt
  `ElevenLabs`, spec-autoritativ — beim Live-Lauf abgleichen).
- `start_speaking_plan` ist seit **AL-P3 erledigt** und nicht mehr offen: der
  Schema-Slot ist per GET auf das Live-Objekt bestätigt (siehe Abschnitt 9).
  Weiterhin **keine** Env-Var — die Werte sind Modul-Konstanten.
- Ob der Update-POST das Assistant-Objekt feldweise mergt oder als Ganzes
  ersetzt (relevant für den Teil-Update von `telephony_settings.
  user_idle_reply_secs`, s. Abschnitt 3), ist ebenfalls live unbestätigt —
  dagegen abgesichert durch den GET-Vorher/Nachher-Vergleich im Skript
  (`PRESERVED_SAFETY_FIELDS`), nicht durch eine ungeprüfte Annahme.

Diese offenen Fragen blockieren weder den Code-Merge noch die anderen
Phasen — die offline geprüften Invarianten (Greeting leer, Custom-LLM-URL,
Voice-Referenz, Barge-in) bleiben unabhängig vom exakten Schema testbar
(siehe `test/telnyx-assistant-config.test.js`).

## 8. Custom-LLM-Schema + Shim-Auth (Phase telnyx-fix-live-schema-auth)

Die `external_llm`-Config folgt jetzt dem realen Telnyx-Schema:

```json
{
  "model": "<config.claudeModel>",
  "external_llm": {
    "base_url": "<PUBLIC_URL>/v1",
    "model": "<config.claudeModel>",
    "llm_api_key_ref": "<TELNYX_SHIM_API_KEY_REF>",
    "forward_metadata": true
  }
}
```

Telnyx hängt `/chat/completions` selbst an `base_url` an; `forward_metadata: true`
legt die `call_control_id` im **`extra_metadata`-Objekt** des Shim-Request-Bodys ab
(LIVE bestätigt 2026-07-11, P2 `call_mrgj8trkypk8` — getrennt von OpenAIs `metadata`,
das leer bleibt; siehe `callControlIdFromForwardedMetadata` in
`src/telnyx-llm-shim.js`). Der Server korreliert ausschließlich darüber, ohne
spoofbaren Top-Level-Fallback. Auth des Shims: **statisches Telnyx-Integration-Secret**
als `Authorization: Bearer <TELNYX_SHIM_SHARED_SECRET>` (nicht mehr per-Call).

Cutover-Reihenfolge:

1. Diese Fixes deployen.
2. Render-Env setzen: `TELNYX_AI_ASSISTANT_ENABLED=true` + `TELNYX_ASSISTANT_ID=<Platzhalter>`
   + `TELNYX_SHIM_SHARED_SECRET` + `TELNYX_SHIM_API_KEY_REF` — Boot muss grün bleiben,
   der Shim ist ab hier erreichbar (404 fällt weg).
3. Provisioning-Skript ausführen (Abschnitt 3).
4. Die ausgegebene `assistant_id` in `TELNYX_ASSISTANT_ID` übernehmen (Abschnitt 4).
5. Live-Testanruf (P11).
6. Rollback = `TELNYX_AI_ASSISTANT_ENABLED=false` (sofortiger 404, Budget-Engine bleibt Live-Default).

## 9. Endpointing (`start_speaking_plan`) — AL-P3

Live per GET verifizierte Form (2026-07-28), kein Rateschluss:

    interruption_settings.start_speaking_plan.wait_seconds
    interruption_settings.start_speaking_plan.transcription_endpointing_plan.on_punctuation_seconds
    interruption_settings.start_speaking_plan.transcription_endpointing_plan.on_no_punctuation_seconds
    interruption_settings.start_speaking_plan.transcription_endpointing_plan.on_number_seconds

Vor AL-P3 stand das Feld auf `null` — Telnyx entschied mit unbekannten internen
Defaults, und diese Wartezeit sitzt vor **jedem** Turn.

Gesetzte Werte und der Grund je Wert: siehe die Modul-Konstanten in
`scripts/telnyx-assistant-provision.mjs` (`START_SPEAKING_WAIT_SECONDS`,
`ENDPOINTING_ON_*`). Anker ist Telnyx' eigenes „Order collection"-Preset;
abgewichen wird an genau einem Knopf (`on_no_punctuation_seconds`).

**Reihenfolge der Abnahme — nicht vertauschbar:**
1. Basislinie **vor** dem Provisioning: `start_speaking_plan_extra_wait_duration_ms`-Median
   über >= 5 Anrufe (`node scripts/telnyx-call-latency.mjs --call <call_id>`).
   Ohne sie ist „sinkt um >= 200 ms" nicht entscheidbar.
2. Provisioner laufen lassen. Meldet er
   `K1/K2-Verifikation fehlgeschlagen: … start_speaking_wait_seconds …`,
   hat Telnyx das Feld still verworfen — Schema-Slot erneut per GET prüfen,
   nicht raten.
3. Nachher-Messung: Rest-Anteil, `chars`-Median, `turns/Anruf`, `Tokens/Anruf`.

**Abbruch/Zurückdrehen:** `turns/Anruf` +15 % oder sinkender `chars`-Median
(= abgeschnittene Anrufer) -> Werte zurückdrehen. Höchstens **zwei**
Parameter-Runden, danach Phase beenden statt weiter tunen.

**Env-Falle beim Provisioner-Lauf:** `TELNYX_ASSISTANT_ID` **und**
`TELNYX_ELEVENLABS_MODEL` müssen explizit gesetzt sein. Ohne ID entsteht ein
neuer Assistant, ohne Voice-Model wird die Live-Stimme still umgestellt —
das Skript schreibt die ganze Config aus der lokalen `.env`.

## 10. Idle-Nudge (`user_idle_reply_secs`) — AL-P5

Wert und Grund: Modul-Konstante `USER_IDLE_REPLY_SECS` in
`scripts/telnyx-assistant-provision.mjs` (AL-P5: 4 -> 2 s). Keine Env-Var.

Die Stille zählt nach jeder Agenten-Äußerung; läuft sie ab, stößt Telnyx den
Assistant mit einer `[long silence]`-System-Message an — das ist ein **vollständiger
Shim-Turn mit `bookTokenUsage`**, kein Gratis-Nachhaken.

**Abnahme (Reihenfolge wie in Abschnitt 9):**

1. Basislinie `turns/Anruf` und `Tokens/Anruf` **vor** dem Provisioner-Lauf (AL-P1-Sonde
   `turn_ok`, >= 5 Anrufe).
2. Provisioner laufen lassen — **Env-Falle**: `TELNYX_ASSISTANT_ID` **und**
   `TELNYX_ELEVENLABS_MODEL` explizit setzen.
3. Nachher-Messung über >= 5 Anrufe.

**Abbruch/Zurückdrehen:** `turns/Anruf` +15 % oder hörbares Ins-Wort-Fallen ->
zurück auf 4 (Zwischenstufe 3), Provisioner erneut laufen lassen. Höchstens zwei Runden.
