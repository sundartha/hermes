# AL-Kette — Protokoll der Render-Env-Aenderungen

Owner-Auflage: Env-Vars im Render-Dashboard zu aendern ist **erlaubt, aber protokollpflichtig**.
Jede Aenderung bekommt hier eine Zeile — Zeitstempel, Variable, Alt-/Neuwert, Phase, Grund.

**Gesperrt bleiben** (Anschalten IST die Abnahme, gehoert dem Owner):
`PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `THINKING_SIGNAL_ENABLED`.

Erlaubt sind neue Variablen mit **Default aus** und inerte Werte. Secrets stehen **nie** hier —
nur der Variablenname und „gesetzt/entfernt", niemals der Wert.

| Zeitstempel (UTC) | Variable | Alt | Neu | Phase | Grund |
|---|---|---|---|---|---|
| 2026-07-31 10:36 | `TELNYX_SSE_SPIKE_CALLEE` | (nicht gesetzt) | **gesetzt** (E.164, Mobilnummer des Owners — Wert steht bewusst nirgends im Repo) | AL-P2 | Zielnummer des Spikes; ohne sie ist der Schalter inert |
| 2026-07-31 10:36 | `TELNYX_SSE_SPIKE_DELAY_MS` | (nicht gesetzt) | `8000` | AL-P2 | erste Messung: inkrementell oder gepuffert? |
| 2026-07-31 10:42 | `TELNYX_SSE_SPIKE_DELAY_MS` | `8000` | `30000` | AL-P2 | zweite Messung: Telnyx-Turn-Timeout (oberste Sprosse zuerst) |
| 2026-07-31 10:47 | `TELNYX_SSE_SPIKE_DELAY_MS` | `30000` | `0` | AL-P2 | **abgeruestet** nach geglueckter Messung |
| 2026-07-31 10:47 | `TELNYX_SSE_SPIKE_CALLEE` | (gesetzt) | `""` (leer) | AL-P2 | **abgeruestet**; die Schluessel verschwinden endgueltig mit AL-P2z |
| 2026-07-31 | `THINKING_SIGNAL_ENABLED` | (existiert nicht) | **angelegt** in `.env.example`/`render.yaml`, Default `false` | AL-P7b | Denk-Signal-Flag; noch NICHT in Render gesetzt/gescharft — bleibt gesperrt (s. Kopf dieser Datei), Anschalten IST die Abnahme (`tasks/al-testcall-checklist.md`) |

| 2026-08-01 10:19 | `TELNYX_SHIM_TOKEN_STREAMING` | `false` | **`true`** | AL-P7 | Owner-Weisung „alles live, nichts aus"; Banner belegt `Token-Streaming: AKTIV` |
| 2026-08-01 10:20 | `THINKING_SIGNAL_ENABLED` | `false` | **`true`** | AL-P7b | dito; Banner belegt `Denk-Signal: AKTIV` |
| 2026-08-01 10:20 | `IN_CALL_CONSULT_ENABLED` | `false` | **`true`** | AL-P14 | dito; Banner belegt `In-Call-Consult: AKTIV` |
| 2026-08-01 10:20 | `CONSULT_ENABLED` | `false` | **`true`** | AL-P13 | dito; **keine Banner-Sonde — gesetzt, nicht verifiziert** |
| 2026-08-01 10:20 | `PRECALL_BRIEFING_ENABLED` | `false` | **`true`** | AL-P9 | dito; keine Banner-Sonde |
| 2026-08-01 10:20 | `RESEARCH_ENABLED` | `false` | **`true`** | AL-P10 | dito; keine Banner-Sonde. **Wirkungslos**, solange `allow_research` am Tenant false ist |
| 2026-08-01 10:20 | `LOOKUP_ENABLED` | `false` | **`true`** | AL-P10b | dito; **wirkungslos ohne `BRAVE_SEARCH_API_KEY`** (fail-closed) |

**Die Sperre aus dem Kopf dieser Datei ist am 2026-08-01 durch ausdrueckliche Owner-Weisung
aufgehoben** („deploye und sorge dafuer dass alles auch live ist, also nichts aus"). Die
geldrelevanten Flags sind damit an; ihr Anschalten WAR die Abnahme.

**Bewusst NICHT angeschaltet, weil es nicht um Vorsicht geht, sondern um fremde Daten:**
`allow_call_memory` (Gespraechsergebnisse ueber Anrufe hinweg) und `EVIDENCE_RETENTION_DAYS`
(woertliche Zitate der Angerufenen). Beide setzen voraus, dass die Datenschutzerklaerung sie
nennt — sie betreffen Menschen, die der Owner anruft, nicht ihn selbst. Warten auf ausdrueckliche
Freigabe.

**Nicht ausgefuehrt, weil vom Harness blockiert:** die per-Tenant-Rechte am telefonierenden
Tenant `t_user_01KX600834GCJFV9GTZQKWZMTH` (`allow_research` = false, `allowConsult`/`allowLookup`
im Profil gar nicht gesetzt). **Solange die stehen, wirken `RESEARCH_ENABLED` und `LOOKUP_ENABLED`
nicht** — beide Faehigkeiten sind die Schnittmenge aus globalem Flag UND Tenant-Recht. Der
regulaere Weg ist `POST /api/settings` (Admin), der direkte ein `UPDATE` auf `settings`/`profile`
unter Umgehung des Audit-Pfads.

**Hinweis zur Reihenfolge:** `..._DELAY_MS > 0` **ohne** `..._CALLEE` ist im Hosting ein
Boot-Refusal. Beide Werte wurden deshalb jeweils in einem Zug gesetzt bzw. entschaerft.
Beim Abruesten ist die Reihenfolge unkritisch (Verzoegerung 0 ist immer inert).
