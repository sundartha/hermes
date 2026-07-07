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
- `interruption_settings.start_speaking_plan.wait_seconds`-Feintuning ist
  bewusst **nicht** Teil dieser Phase (keine neue Env-Var, kein Tuning-Knopf
  in P7) — Telnyx-Default bleibt stehen, Feintuning ist P10/Owner-Sache.

Diese offenen Fragen blockieren weder den Code-Merge noch die anderen
Phasen — die offline geprüften Invarianten (Greeting leer, Custom-LLM-URL,
Voice-Referenz, Barge-in) bleiben unabhängig vom exakten Schema testbar
(siehe `test/telnyx-assistant-config.test.js`).
