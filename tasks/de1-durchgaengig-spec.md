# DE1 — Sprach-Rueckfall auf die englische EL-Basis beseitigen

## Ausloeser (am Live-Verkehr belegt, 2026-09-04)

Anruf `call_mtmpqje4clmh` (EL `conv_4501m1nsr1hhe2aa07pt5t38r0zy`), Tenant-Sprache `de`,
`callee_is_owner=true`. Der Agent sprach bei t=0s korrekt Deutsch und bei t=13s ENGLISCH:

> "Hello, this is an AI assistant calling on behalf of Antonio Fotiadis. This conversation
> will be summarised for the person I represent. I am leaving this message because nobody
> picked up. \<deutsche opening_line\> I will try again later. Goodbye."

Der Owner war am Apparat und hat das gehoert. Sein Urteil, woertlich: **"Wenn der User auf
Deutsch eingestellt ist, dann soll er NUR Deutsch reden. Englisch ist Default nur dann,
wenn unklar ist, welche Sprache der User will."**

## Gemessene Wurzel — gilt als BEFUND, nicht erneut erheben

Am Live-Agenten `agent_5301kwkh9vv3ezesf100pggfj9rs` per GET gemessen (2026-09-04):

- `conversation_config.agent.language` = `"en"`; der Basis-Prompt enthaelt woertlich
  `Begin the call in English.`
- `conversation_config.language_presets` fuehrt `de`/`es`/`fr`, aber das de-Preset
  ueberschreibt NUR `agent.first_message` (live zusaetzlich `language`; `prompt` ist
  `null`, Werkzeug-Overrides fehlen ganz).
- `voicemail_message` liegt statisch und englisch unter
  `conversation_config.agent.prompt.tools[voicemail_detection].params.voicemail_message`
  und ist byte-identisch mit `elevenlabs/agent_configs/outbound-agent.template.json`.
- **Folge:** alles, was ein Preset nicht ausdruecklich ueberschreibt, kommt bei einem
  de-Anruf englisch heraus — Voicemail-Text, Prompt-Verhalten, Zusammenfassung.
- **Historie:** `voicemail_detection` hat in 10 Anrufen seit 2026-08-20 GENAU EINMAL
  ausgeloest, bei genau diesem Anruf. Der englische Text lag seit 2026-08-14 als
  Blindgaenger da — deshalb ist der Defekt vorher nie aufgefallen.

## Ziel

Ein Tenant mit gesetzter Sprache hoert durchgaengig SEINE Sprache. Die englische Basis ist
nur noch Rueckfall fuer den Fall, dass die Sprache unbestimmt ist. Kein Rueckfall auf
Englisch, solange die Anrufsprache feststeht.

## Harte Vorgaben

1. **SCHRITT 0, blockierend, VOR jedem Entwurf: Anbieter-Faehigkeit MESSEN.**
   Nimmt die EL-API einen Werkzeug-/Prompt-Override innerhalb
   `language_presets.<lang>.overrides` ueberhaupt an? Das ist UNBELEGT — die Vorlage fuehrt
   es selbst unter ihren ungeklaerten Punkten. Nur LESENDE Messung (GET) plus Anbieter-Doku;
   **KEIN Schreibzugriff auf den Live-Agenten.** Faellt die Messung negativ aus, ist der
   Preset-Weg TOT — dann Entwurf auf dem tragfaehigen Weg, z.B. per-Anruf-Override ueber die
   bestehende Allowlist in `src/elevenlabs/convai.js`
   (`OVERRIDE_ALLOWED_LEAF_PATHS` / `OVERRIDE_OWNER_ONLY_LEAF_PATHS`).
   Der Bericht nennt Messung und Ergebnis. **Ein Entwurf ohne diese Messung ist ungueltig.**

2. **ARTIKEL 50 EU AI ACT ist unantastbar.** Der Anrufbeantworter-Text traegt die
   Offenlegung. Jede sprachliche Fassung MUSS woertlich und byte-identisch mit
   `LOCALES.<lang>.disclosure` aus `src/i18n/locales.js` beginnen — nicht selbst uebersetzen,
   nicht nachbauen, nicht kuerzen. Gleiches gilt fuer `first_message`. Die bestehende
   Verbotsregel im Drift-Gate (ein Preset darf die Offenlegung nicht durch eine selbst
   entstandene UEBERSETZUNG ersetzen) bleibt scharf und ist einzuhalten.

3. **KEIN LIVE-PUSH.** Diese Phase bereitet ausschliesslich das Repo vor: Vorlage, Code,
   Tests, Drift-Erwartung. `npm run elevenlabs:push` wird NICHT ausgefuehrt — der Push an den
   Live-Agenten ist eine getrennte Owner-Entscheidung mit eigener Freigabe (Vorbild:
   Abschnitt "ST2 Push-Protokoll" in `tasks/EL-STIMME-BEFUNDE.md`). Der Bericht liefert
   stattdessen die **Patch-Prognose**: welche Blattpfade ein spaeterer Push schreiben wuerde.

4. **Der Byte-Pin muss mit.** `test/el-stimme-abnahme.test.js` pinnt `voicemail_message`
   heute als EINEN englischen String (`VOICEMAIL_PIN`) und schreibt den Defekt damit als
   Soll fest, waehrend `first_message` bereits ueber `LANGS` je Sprache geprueft wird. Der
   Voicemail-Test ist auf dieselbe Je-Sprache-Pruefung umzustellen.
   **Ein gruener Lauf mit unveraendertem Byte-Pin ist KEIN PASS.**

5. **Scope-Grenze.** NUR der Sprach-Rueckfall. NICHT in dieser Phase, jeweils eigener Befund:
   - die Fehlausloesung der Voicemail-Erkennung, waehrend ein Mensch spricht
   - der SIP-Init-Timeout des Anrufs vom 2026-09-04 06:01 (`call_initialization_error`)
   - das leere DeepSeek-Konto (HTTP 402)

6. **Umlaut-Regel:** gesprochene deutsche Strings tragen echte Umlaute; Code-Kommentare
   bleiben ohne Umlaute (ue/oe/ae) wie im Bestand.

7. **Test-Benennung:** neue Tests duerfen KEIN Katalog-ID-Praefix am Namensanfang tragen
   (`GAP-`, `PROMPT-`, `ABNAHME-` o.ae.) — sonst wandern sie aus `npm test` in einen der
   Sonderlaeufe ab und schuetzen die Regressionsbahn nicht.

## Abnahme

- `npm test` gruen (Regressionsbahn).
- `npm run elevenlabs:drift` laeuft; seine Abweichungsliste ist im Bericht **erklaert**.
  Nach dieser Phase sind NEUE Soll-Abweichungen ERWARTET, weil das Repo-SOLL vorlaeuft und
  der Push aussteht — genau das benennen, nicht kaschieren.
- Ein Test, der belegt: bei Anrufsprache `de` entsteht KEIN englischer Voicemail-Text.
- Der Bericht nennt: Ergebnis der Anbieter-Messung aus Schritt 0, die geaenderten
  Blattpfade, die Patch-Prognose fuer den spaeteren Push, und was bewusst offen bleibt.
