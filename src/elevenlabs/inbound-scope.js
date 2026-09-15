// IEX-A9 (E9/A5): Wirkungsbereich des ElevenLabs-Inbound-Wegs - EIN Enum, Werte == Env-Werte von
// ELEVENLABS_INBOUND_SCOPE. Rein: kein IO, kein config-Import (config.js importiert dieses Modul,
// nicht umgekehrt; Muster telephony/stt-profile.js).
//   ALLOWLIST         - nur die Tenants aus ELEVENLABS_INBOUND_TENANT_IDS (heutiges Verhalten)
//   REGISTRIERTE_DIDS - jede aktive DID mit gueltigem Registrierungs-Beleg; die Tenant-Liste wirkt nicht
// Bewusst KEIN Wildcard-Mitglied: eine DID ohne Beleg waere ein Dial ins Leere.
export const INBOUND_EL_SCOPE = Object.freeze({
  ALLOWLIST: "allowlist",
  REGISTRIERTE_DIDS: "registrierte_dids",
});

// EINE Quelle des Defaults: Env-Fallback (config.js) und Boot-Befund (boot-guard.js).
export const DEFAULT_INBOUND_EL_SCOPE = INBOUND_EL_SCOPE.ALLOWLIST;

export function isInboundElScope(wert) {
  return Object.values(INBOUND_EL_SCOPE).includes(wert);
}
