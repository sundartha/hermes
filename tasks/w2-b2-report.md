# Phase W2-B2 — Telefonie-Render, STT/TTS, Assistant-Pfad

**Gate: PASS** | **finalBranch:** `phase/w2-b2-telefonie-render` | **Basis:** `master` = `80f788e` | **headCommit:** `ee31a5f8e292f2a0d8e7b456a6c90ee0896a6903`

---

## 1. Plan (gekuerzt)

Umfang: 11 IDs aus `tasks/i18n-tests/18-w2-scope.md` §W2-B2, ergaenzt um Baseline-Messung in `19-w2-baseline.md` §2.2/§3.4 (Regel R-G: gemessene Lage schlaegt Katalog-Erwartung). Regel R-A: kein Produktionscode, nur `test/*` + ein Kommentar in `package.json` + ein Blockreport.

Vorab-Messung ergab pro ID (Katalog-Erwartung -> gemessene Lage -> Konsequenz):

| ID | Katalog | Gemessen | Konsequenz |
|---|---|---|---|
| VOICE-05 | gruen | `GEO_ENABLED`-Fallback ungetestet | neuer Test (gruen) |
| VOICE-09 | unbekannt | Positive Haelfte end-to-end abgedeckt, Negativ-/Validierungshaelfte fehlt | neuer Test (gruen) |
| VOICE-12 | gruen | vollstaendig abgedeckt | Buchhaltung |
| VOICE-18 | rot | ueberholt, laengst korrekt (Fail-open auf `auto`) | Buchhaltung |
| VOICE-19 | rot | ueberholt, laengst korrekt (`{}` ohne `language`) | Buchhaltung |
| VOICE-22 | gruen | STT-Modell-Literal ungetestet als sprachuebergreifende Invariante | neuer Test (gruen) |
| VOICE-23 | gruen | kein Test fuer "kein Barge-in-Attribut" | neuer Test (gruen) |
| VOICE-24 | gruen | vollstaendig abgedeckt (Assistant-Pfad) | Buchhaltung |
| VOICE-25 | gruen | keine Verschraenkungs-/Leak-Pruefung zwischen Sprachen | neuer Test (gruen) |
| VOICE-29 | gruen | keine Paritaets-Aussage ueber beide Adapter | neuer Test (gruen) |
| GAP-24 | rot | TEIL: Ingest-Pfad reicht Sprache durch, Inbound-Pfad NICHT | neuer Test (**rot**, SOLL) |

Bilanz: 7 neue Tests (6 gruen, 1 rot) + 4 Buchhaltungen, Umfang bleibt 11 IDs.

Zwei bewusste Abgrenzungen (R-G):
1. GAP-24 wird NICHT in Katalogbreite gebaut: nur Teil (b) "jeder `startAssistant` traegt Sprach-Hint". Teil (a) "eigene Assistant-Instanz je Sprache" ist getragenes Risiko (`19-w2-baseline.md` §7), keine gefallene Entscheidung. Teil (c) "Provisioner bricht ohne Env ab" ist bereits durch `test/telnyx-assistant-config.test.js` abgedeckt (kein Duplikat).
2. VOICE-09 wird an `POST /api/settings` gemessen, nicht an der Self-Service-Route (gleiche Validierungslogik `OPTIONAL_ENUM_FIELDS`, aber ohne Web-Login/pglite-Overhead).

Neue Datei: `test/render-adapter-language-parity.test.js` (VOICE-23/25/29 gebuendelt, um adapteruebergreifende Duplizierung zu vermeiden, G5). Edits an: `test/geo-registry.test.js` (VOICE-05), `test/api.test.js` (VOICE-09), `test/directive-render.test.js` (VOICE-22), `test/telnyx-p8-inbound.test.js` (GAP-24, rot), plus Buchhaltungs-Kommentare in `test/telnyx-elevenlabs-render.test.js`, `test/telnyx-call-control.test.js` (VOICE-18/19), `test/telnyx-assistant-config.test.js` (VOICE-24). `package.json`-Kommentar um `VOICE-12/18/19/24` erweitert.

Erwartetes Ergebnis: `npm test` 3295/3295/0 (unveraendert), `npm run test:gates` 56/50/6 (Fail-Set: GAP-05, GAP-15 x2, LANG-15, LANG-19, GAP-24), ungefilterter Lauf 3351 = 3295+56 (Split-Invariante).

---

## 2. Impl-Zusammenfassung + Deviations

- 7 neue Tests umgesetzt exakt wie geplant: VOICE-05 (`test/geo-registry.test.js`), VOICE-09 (`test/api.test.js`), VOICE-22 (`test/directive-render.test.js`), VOICE-23/25/29 (neue Datei `test/render-adapter-language-parity.test.js`), GAP-24 (`test/telnyx-p8-inbound.test.js`, SOLL, rot).
- 4 Buchhaltungs-Kommentare (VOICE-12/18/19/24), kein neuer Test, keine Testnamen geaendert.
- `package.json`-Kommentar `_comment_i18nCatalogPattern` erweitert um `VOICE-12/18/19/24`.
- Kein Produktionscode geaendert: `git diff master --stat` zeigt ausschliesslich `test/*`, `package.json`, Blockreport.
- Messwerte reproduziert: `npm test` 3295/3295/0 (unveraendert), `npm run test:gates` 56/50/6, Fail-Set exakt GAP-05/GAP-15(x2)/LANG-15/LANG-19/GAP-24 (nur GAP-24 neu), ungefilterter Lauf 3351 = 3295+56.
- Blockreport `tasks/i18n-tests/21-w2-b2-bericht.md` geschrieben (Polaritaets-Tabelle, Abweichungen, Lauf-Zahlen, GAP-24/Byte-Identitaets-Kopplung explizit dokumentiert).
- Commit `ee31a5f` auf `phase/w2-b2-telefonie-render`.

**Deviations:**
- Keine inhaltlichen Abweichungen vom Plan; die im Plan selbst dokumentierten Abgrenzungen (GAP-24 nur Teil b, VOICE-09 an `/api/settings`) wurden 1:1 umgesetzt.
- Smoke-Test (best-effort) nicht erfolgreich: Server verweigert Start ohne geseedete aktive Nummer im Store (Boot-Guard). Laut Plan kein Blocker, da reine Test-Phase ohne Produktionscode-Aenderung; die betroffenen Verhaltensweisen sind durch die automatisierten Tests abgedeckt.

---

## 3. Safety-Urteil

**Verdikt: FREIGABE.**

- Unabhaengig gemessen im frischen Worktree (Branch `review-w2-b2` = `phase/w2-b2-telefonie-render`, `ee31a5f`; merge-base == master `80f788e`, kein Stale-Base).
- `npm test`: korrigiert 3295/3295/0. `npm run test:gates`: korrigiert 56/50/6, Fail-Set: LANG-19, GAP-05, GAP-15 (x2), LANG-15, GAP-24.
- Gegenprobe auf master-Basis: 49/44/5 (ohne GAP-24) — GAP-24 ist der einzige neue Rotbefund, +7/+6/+1 rechnet exakt auf.
- Split-Invariante unabhaengig geprueft: ungefilterter Lauf 3351 = 3295+56.
- `git diff master...HEAD -- src public apps scripts render.yaml .env.example package-lock.json` = 0 Zeilen -> Safety-Gates, Offenlegungssatz, Auth-Fail-closed, Secrets strukturell unberuehrt. Keine neue Dependency, kein `eslint-disable`, kein `.only`, kein Secret/PII im Diff.
- Zwei Flakes identifiziert, beide isoliert gruen, keiner von W2-B2 verursacht (`telnyx-shim-route.test.js` unter Volllast-Timeout, `PROMPT-07` Vorbestand aus W2-B1).

**Concerns (keine Blocker):**
- GAP-24 bewusst schmaler als Katalogtitel (nur Teil b); transparent im Bericht dokumentiert.
- Bericht-Verweis auf `19-w2-baseline.md` §7 zeigt auf falschen Paragraphen-Anker (Sachverhalt selbst belegt, rein dokumentarisch).
- `UNKNOWN_VOICE_PROFILE = "en-US-female-neural"` in der neuen Datei ist eine Wartungsfalle, falls dieser Wert spaeter in beide Adapter als legitimes Profil kommt (kein aktueller Defekt).
- Alle 7 neuen Tests laufen nur im `test:gates`-Lauf, nicht in `npm test` — dokumentierte Konvention, aber kuenftige Regressionen an gatherOpts/speechModel/Profil-Fail-closed fallen nur im Gate-Lauf auf.
- `package.json` liegt formal ausserhalb `test/` (R-A wortgetreu) — inhaltlich nur eine Kommentarzeile, gleiches Muster wie in W2-B1 bereits gemergt.
- `PROMPT-07`-Flake (aus W2-B1) flattert im Gate-Lauf; gehoert in eine eigene Runde, nicht W2-B2 anzulasten.

---

## 4. Clean-Code-Audit

- **S1 (Blocker):** keine.
- **S2 (Duplizierung):** keine.
- **S3 (kosmetisch):** VOICE-22 in `test/directive-render.test.js` — das STT-Modell-Literal `"deepgram_nova-2-general"` bleibt in mehreren Bestands-Snapshot-Assertions Rohstring, nur teilweise durch die neue Konstante `TWILIO_STT_MODEL` konsolidiert. Unkritisch, Fortsetzung bestehender Testdatei-Konvention, kein neuer Verstoss.
- **S4:** keine strukturellen Auffaelligkeiten. Alle neuen Tests kurz, flach (Verschachtelung <=2, Argumente <=2), Kommentare erklaeren G5-Abgrenzungen konsequent.

**Verdikt: FREIGABE.** Diff ist reine Testerweiterung, keine Sicherheits-/Auth-/Budget-/Telefonie-Logik veraendert. GAP-24 korrekt als bewusster SOLL-Test mit Katalog-Praefix erfasst (dadurch von `npm test` ausgeschlossen, nur in `test:gates` aktiv). Blast-Radius exakt wie im Bericht behauptet.

**Optionale TODOs (kein Blocker):** GAP-36-Flake unter Volllast im Blick behalten (ausserhalb dieser Phase); `TWILIO_STT_MODEL`-Konstante optional auch in aeltere Snapshot-Zeilen einsetzen statt Rohstring.

---

## 5. Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf auf FREIGABE ohne Blocker.
