`src/telephony/` — Provider-Abstraktion (DIP): `ports.js` (Schnittstellen), `registry.js` (Dispatch nach
Provider), `directives.js`; Adapter unter `adapters/telnyx/*` (voice, render, messaging, numbers, signature).
**Owner-Entscheidung 2026-08-07 (C-P3): die Twilio-HMAC-Pruefung
ist entfernt, das Gate selbst bleibt unangetastet.**
**Preis, bewusst akzeptiert:** kommt je wieder ein Twilio-Account dazu,
muss der Verifizierer neu gebaut werden (Historie: dieser Commit).
Telefonie-Bugs lassen sich fast immer ohne echten Anruf reproduzieren: `/voice/*`
laesst sich lokal mit `SKIP_TWILIO_SIGNATURE_CHECK=true` und `curl` durchspielen.
