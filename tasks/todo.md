# Durchgang 2026-08-19: natuerlicher Anrufgrund (A) + Recherche am EL-Weg (B)

Auftrag des Eigentuemers vom 19.08.2026, autonom. Messlatte: Anruf 8 (49 s, 0,118 USD,
17,4 Z/s, ~1,6 s Stille). Kein Deploy, kein Engine-Flip, keine echten Anrufe, kein
Wortlaut-Eingriff an der Offenlegung.

## THEMA A — Eroeffnungszeile statt rohem {{objective}}

Entwurf: Vorab-Erzeugung EINER natuerlichen Grund-Zeile durch das Zweit-LLM
(Muster precall-briefing.js), Validierung fail-closed, Reise als NEUE dynamic
variable {{opening_line}}; {{objective}} bleibt roh im PROMPT (Aufgabentreue),
verschwindet aber aus first_message und voicemail_message (A5).
Rueckfall-Treppe: erzeugt+validiert -> bridgePhrase(objective) validiert
(= heutiger Anruf-8-Wortlaut) -> feste Kurzzeile je Sprache.

- [x] `src/elevenlabs/opening-line.js`: Erzeugung (secondary LLM, forcedTool,
      0 Retries, briefingTimeoutMs), Validierung (Kappe 120 Zeichen, keine
      eckigen/geschweiften Klammern, kein Zeilenumbruch, keine Offenlegungs-
      Wiederholung, keine Preisangabe), Rueckfall-Treppe, Kosten-Buchung
      (bookTokenUsage + Abbruch-Schaetzung), Hash-Gegenprobe fuer den Anrufstart.
      SOLL: jeder Verstoss faellt auf die naechste Stufe; nichts Ungeprueftes.
      PRUEFUNG: test/el-opening-line.test.js, je Waechter eine Rotprobe.
- [x] LOCALES: `openingReasonFallback` je Sprache (feste Kurzzeile).
      PRUEFUNG: Test prueft Existenz + Kuerze + korrekte Umlaute/Akzente.
- [x] `state-ops.js#createCall`: openingLine + openingLineSha256 (Hash im Store
      berechnet, nicht vom Aufrufer). pg: schema.sql (ADD COLUMN), pg.js
      (INSERT/UPSERT/rowToCall). SOLL: Restart-fest, json/pg-paritaetisch.
- [x] `api-calls.js`: nach dem Briefing, NUR bei elevenLabsOutbound.enabled,
      Zeile erzeugen und an createCall reichen. Sprache aus callLocaleFor
      (dieselbe Aufloesung wie der Anrufstart, kein zweiter Weg).
- [x] `outbound.js#dynamicVariables`: opening_line aus dem Call-Datensatz,
      davor Hash-Gegenprobe (A6): weicht sie ab -> LAUT + deterministischer
      Rueckfall, nie der veraenderte Text. PRUEFUNG: Rotprobe mutiert den
      gespeicherten Text -> Waechter schlaegt an.
- [x] `call-locale.js#providerOpening`: disclosure + "{{opening_line}}" +
      openingQuestion. Vorlage (EN-Basis, DE/FR-Presets, voicemail_message)
      nachgezogen. T5/Sprachwahl-Tests bleiben Riegel (startsWith(disclosure)).
- [x] Vorlage `_besitz`: language_presets_offenlegung bekommt schreibweg
      je_schluessel (schliesst die NICHT-SCHREIBBAR-Luecke strukturell).
- [x] Suite gruen + Lint; Commit + Push (origin).
- [x] Konto: Trockenlauf -> push (first_message, voicemail_message,
      language_presets_offenlegung, prompt) -> Ruecklese -> drift. 4 Werte je
      Feld in .fortschritt.md.
- [x] A2-Zahl nennen: Kappe 120 Z = 6,9 s bei 17,4 Z/s; Eroeffnung DE max
      132+1+120+1+33 = 287 Z ~ 16,5 s (heute UNBEGRENZT: 500-Z-objective
      moeglich = ~30+ s). Typisch erzeugt ~60-80 Z -> Eroeffnung ~13 s wie
      Anruf 8. Nach der Umsetzung gegenrechnen und im Bericht ausweisen.
- [x] A7: Kosten je Erzeugung messen (ein Echt-Aufruf ueber den Seam, falls
      das Provider-Konto zahlt; sonst ehrlich "nicht messbar" + Grund).

## THEMA B — Recherche (look_up) am ElevenLabs-Weg

Entwurf: Webhook /webhooks/elevenlabs/lookup in webhooks-elevenlabs.js (Bauart
= Consult-Kanal: Token fail-closed, Bindung ueber conversation_id, 404 fuer
"nicht berechtigt", 402 Geld, 400 Nutzlast), Ausfuehrung ueber BESTEHENDEN
Exa-Adapter + sanitizeLookupQuery/lookupFactsFrom, Gate = inCallSearchProvider
(Master LOOKUP_ENABLED + EXA_API_KEY + per-Tenant allowLookup) + Richtung
outbound + Deckel LOOKUP_MAX_PER_CALL=2. Torzustand reist als
{{lookup_available}}; Prompt bekommt Zuordnungs-Abschnitte (B7).

- [x] Gate `elevenLabsLookupProviderFor(call)` in research/in-call.js (EINE
      Quelle fuer Webhook UND Anrufstart-Variable).
- [x] Webhook-Handler + route-policy-Eintrag + PLAN-SECURITY-Abschnitt.
      Deckel-Fall: 200 {status:"declined"} mit sprechbarem Text (Gespraech
      laeuft weiter). Kein Treffer/zu langsam: 200 {status:"no_results"}.
- [x] B5-Protokoll: call.lookupLog persistiert (state-ops + pg + json),
      Eintrag {seq, query, askedAt, dauerMs, ok, factCount}. Deckel zaehlt
      lookupLog-Eintraege (restart-fest).
- [x] B6: bookLookupSearchFee VOR dem Absenden (Bestandsmuster). 1 ct/Suche,
      max 2 ct je Anruf.
- [x] turnControl-Texte fuer den EL-Weg (decline ohne take_message-Bezug),
      de/fr/en.
- [x] Tests: test/el-lookup-webhook.test.js (Token/Bindung/Gate/Geld/Nutzlast/
      Deckel/Egress/Erfolg/kein-Treffer; Fremd-Formen aus echten Aufzeichnungen
      wo vorhanden, sonst im Test als ausgedacht markiert).
- [x] Vorlage: Prompt-Abschnitte (dreiwertige Zuordnung, lookup_available-Tor,
      LOOKUP TOOL ohne get_consult-Nennung und ohne Platzhalter), tools.look_up
      (webhook, query + conversation_id via system__conversation_id, gleiche
      secret_id, kleine Antwortfrist), Testdefinitionen-Vokabular
      (+opening_line, +lookup_available in ALLEN test_configs).
- [x] Konto: look_up-Werkzeug anlegen (eng gefuehrtes Kommando mit Trockenlauf/
      Ruecklese), tool_ids am Agenten, prompt-Push, Messspiegel
      _live_gemessene_form aus echter GET-Messung nachziehen.
- [x] Beweis ohne Telefon: 4 Testdefinitionen am Konto (nur-Auftraggeber ->
      get_consult; oeffentlich -> look_up; steht-im-Auftrag -> kein Werkzeug;
      Deckel -> kein look_up) - alle gruen, bevor B fertig gemeldet wird.
- [x] PAID_PLAN_PROFILE.allowLookup -> false (Auftrag B4: Datenschutzerklaerung
      nennt den Suchdienst nicht; Owner-Entscheidung 2026-08-19, dreht die
      Entscheidung vom 2026-08-11 zurueck - im Bericht benennen).

## Abschluss
- [x] Unabhaengige Durchsicht Thema A (FAIL -> 7 Befunde behoben/adressiert);
      Thema-B-Durchsicht laeuft (Ergebnis im Abschlussbericht).
- [x] .fortschritt.md: Verlauf + BEREIT ZUM ANRUF geschrieben; Widersprueche/
      Spaeter-Liste folgen im Abschluss-Commit.
- [x] git push origin nach jeder Phase.
