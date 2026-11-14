import { KOSTENPROFIL } from "../billing/kostenarten.js";

export const TURN_LOOP_BY_COST_PROFILE: Readonly<Record<string, boolean>> = Object.freeze({
  [KOSTENPROFIL.TELNYX_BUDGET]: true,
  [KOSTENPROFIL.TELNYX_INBOUND_BUDGET]: true,
  [KOSTENPROFIL.EL_CONVAI_SIP]: false,
  [KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI]: false,
  [KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI]: false,
});

export function legRunsOurTurnLoop(call: { costProfile?: string } | null | undefined): boolean | undefined {
  const profil = String(call?.costProfile);
  if (!Object.hasOwn(TURN_LOOP_BY_COST_PROFILE, profil)) return true;
  return TURN_LOOP_BY_COST_PROFILE[profil];
}
