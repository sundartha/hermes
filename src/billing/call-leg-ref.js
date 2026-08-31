// Die Leg-Referenz EINES Calls - EINE Quelle (G5) fuer sweep-kostenbeleg.js und
// cost-truing.js. Beide Module lasen bislang dieselbe dreiwertige ODER-Kette an
// getrennten Stellen (Duplizierung, cost-truing.js#providerLegIdOf und
// sweep-kostenbeleg.js#legRefOfCall); ein neutrales drittes Modul loest das auf, ohne
// die Import-Richtung sweep-kostenbeleg.js -> cost-truing.js zu einem Zyklus zu machen.
//
// Die drei Werte koennen einander nicht treffen: 'CA...' (Twilio), 'v3:...'
// (Call-Control), 'otb_...' (SIP, KV2-5) - reine Feldablesung, keine Fachlogik.
export function legRefOfCall(call) {
  return call.twilioSid || call.callControlId || call.sipCallId || null;
}
