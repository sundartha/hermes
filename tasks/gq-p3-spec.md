# GQ-P3 — Inbound auf den Assistant-Pfad: der Handoff wird scharf

**Befund B-9, Owner-Entscheidung O-1 (bindend, Weg A).** Der Feldname ist seit dem
2026-08-04 **gemessen** — diese Phase raet nichts mehr.

## Der Beleg

Sonde B (GQ-S1) hat am echten Inbound-Anruf `call_mseqcvoh8bcx` protokolliert:

```
handoff_fallback  expectedField: "CallControlId"   lookalikeFields: []
bodyKeys: AccountSid, CallInitiatedAt, CallSessionId, CallSid, CallSidLegacy,
          CallStatus, CallerId, CallingPartyType, ConnectionId, Direction,
          From, FromSipUri, To, ToSipUri
```

**`CallControlId` existiert im TeXML-Body nicht** — und nichts, was ihm aehnelt. Telnyx
liefert **`CallSid`**.

**Gegenprobe, dass `CallSid` wirklich eine Call-Control-ID ist** (nicht nur ein aehnlich
aussehender Token): der Wert des Inbound-Anrufs, gegen die Call-Control-API gehalten:

```
GET /v2/calls/<CallSid>  ->  HTTP 200
   call_leg_id     : 828e29bc-900d-11f1-b…
   call_session_id : 828e1df0-900d-11f1-8…
```

Format `v3:…`, 57 Zeichen — identisch zur `call_control_id`, die Outbound-Anrufe tragen.
**Die API akzeptiert ihn.** Damit ist die Voraussetzung fuer den Handoff belegt, nicht
vermutet.

## Warum das der groesste offene Hebel ist

Inbound laeuft heute auf der Budget-Engine und ist am Log messbar eine **andere, schlechtere
Maschine** als Outbound:

| | Inbound heute | Outbound |
|---|---|---|
| Werkzeuge im Turn | `tools: []` — **keine** | `end_call`, `take_message`, `look_up` |
| Pausen zwischen den Runden | `stt_gap` **13 049 / 14 633 ms** | 1,4-5,5 s |
| Modell-Latenz derselben Anrufe | 1 048 / 1 076 / 1 553 ms | vergleichbar |
| Token-Streaming | wirkt **nicht** | `streamArmedRounds: 1` |
| Echtes Barge-in | prinzipiell unmoeglich (TeXML-Gather) | vorhanden |

Die 13-15 Sekunden Stille kommen **nicht** vom Modell — die Modell-Latenzen derselben Anrufe
liegen bei ~1 s. Sie entstehen in der Gather-/STT-Schicht.

## Was zu bauen ist

1. **`INBOUND_CALL_CONTROL_ID_FIELD` auf den gemessenen Namen setzen.** Der Kommentar
   "Doku-Stand, live unbestaetigt" faellt weg und wird durch den Beleg ersetzt
   (Anruf-ID + der `GET /v2/calls`-Nachweis).
2. **Ein Schalter**, der den Inbound-Handoff an- und abschaltet, in `src/config.js` **und**
   `.env.example`. Umlegen stellt die Budget-Engine ohne Deploy wieder her. Das ist der
   Rueckweg dieser Phase — und wegen der Kostenfolge (unten) **notwendig**, nicht optional.
3. **Der laute Rueckfall aus GQ-S1 bleibt.** Er ist jetzt der Waechter: schlaegt der Handoff
   fehl, muss das weiterhin im Log stehen. **Nicht** entfernen, weil "es jetzt ja
   funktioniert" — genau diese Annahme hat den Befund wochenlang verdeckt.
4. **Eine Boot-/Turn-Sonde**, an der ablesbar ist, ueber welchen Pfad ein Inbound-Anruf
   tatsaechlich lief. Heute meldet das Boot-Banner "Assistant-Pfad: AKTIV", waehrend inbound
   die Budget-Engine faehrt — diese Luege darf nicht zurueckkehren.

## Kostenfolge — ausdruecklich, nicht nebenbei

Der Assistant-Pfad kostet laut der eigenen Messung dieses Repos (KV-M1) **~5 US-Cent je
angefangener Minute** gegen **1,87 US-Cent** auf der Budget-Engine. **Inbound wird also rund
dreimal teurer.** Der Owner hat dem am 2026-08-04 zugestimmt.

Zwei Dinge folgen daraus, beide verpflichtend:

- **KV-M1 ist nach dieser Phase auf dem Assistant-Pfad zu wiederholen** und der Tarif neu zu
  kalibrieren (Uebergabepunkt 1 aus dem Kickoff). Im Kettenstand ankuendigen, nicht
  stillschweigend tun.
- **Das Kostenrisiko ist gedeckelt, aber nur weil KV-P2 Inbound an die Tenant-Kostendecke
  gehaengt hat.** Diese Kopplung wird **nicht** angefasst.

## Harte Randbedingungen

- **Safety-Gates unberuehrt:** pro-Tenant-Kostendecke (sperrt BEIDE Richtungen),
  `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, Max-Dauer, Signaturpruefung
  (Telnyx Ed25519, fail-closed), Offenlegungssatz, Auth. Der Handoff darf **keines** davon
  ueberspringen — insbesondere muss ein Inbound-Anruf weiterhin an der Kostendecke scheitern.
- **Das Richtungs-Gate fuer `look_up` bleibt.** `lookupProviderFor` schliesst Inbound per
  `direction !== "outbound"` aus; das ist ein bewusstes Sicherheits-Gate und **nicht** Teil
  dieser Phase. Wer es nebenbei oeffnet, gibt anonymen Anrufern eine Internet-Suche.
- **Kein Twilio-Umbau.** Stoesst der Capability-Waechter
  (`providerSupports(provider, CAPABILITY.AI_ASSISTANT)`) im Weg, wird das **gemeldet**, nicht
  entfernt — die Twilio-Ablösung ist O-2 und eine eigene Phase.
- **Fail-safe, nicht fail-open:** ist die Call-Control-ID nicht ermittelbar, faellt der Anruf
  weiterhin auf die Budget-Engine zurueck — laut, aber ohne den Anruf zu toeten.
- ESM, kein Build-Step. Kommentare deutsch **ohne** Umlaute.

## Pre-Mortem

*Ein Jahr spaeter stellt sich heraus, die Umstellung war falsch.* Drei Wege dorthin, alle zu
entschaerfen:

1. **Die Kosten sind explodiert**, weil Inbound oeffentlich waehlbar ist und dreimal teurer
   wurde. -> Gedeckelt durch die Tenant-Kostendecke (KV-P2); der Schalter erlaubt sofortigen
   Rueckbau ohne Deploy.
2. **Inbound bricht mitten im Gespraech ab**, weil die Decke frueher greift als vorher. Das
   ist seit KV-P2 moeglich und wird durch die Verdreifachung **wahrscheinlicher**. -> Im
   Kettenstand als erwartetes Verhalten festhalten, damit es beim naechsten Testanruf nicht
   als neuer Defekt fehlgedeutet wird.
3. **Der Handoff greift nur manchmal**, und niemand merkt es. -> Genau dagegen die Sonde aus
   Punkt 4; der stille Rueckfall bleibt verboten.

## Abnahme

1. `npm test` gruen (Vorbedingung, nicht das Ergebnis).
2. Neue Tests mit Gegenbeispiel:
   - Body mit `CallSid` -> Handoff wird versucht
   - Body **ohne** das Feld -> Rueckfall auf die Budget-Engine **und** die laute Logzeile
   - Schalter aus -> Budget-Engine, byte-identisch zum Bestand
3. **Das Ergebnis ist ein echter Inbound-Testanruf.** Ablesbar sein muss:
   - `assistant_id` und `telnyx_conversation_id` sind in der `call`-Zeile **gesetzt**
     (heute: NULL)
   - im Log stehen `[telnyx-shim] turn_ok`-Zeilen (heute: keine einzige)
   - `stt_gap` von 13-15 s taucht **nicht** mehr auf
   - `offeredToolNames` ist nicht leer (heute: `tools: []`)

## Rueckweg

Schalter umlegen — kein Deploy noetig. Der Rueckfallpfad auf die Budget-Engine bleibt
vollstaendig erhalten und wird durch die Tests abgesichert.
