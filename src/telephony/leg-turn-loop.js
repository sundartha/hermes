import { KOSTENPROFIL } from "../billing/kostenarten.js";

export const TURN_LOOP_BY_COST_PROFILE = Object.freeze({
  [KOSTENPROFIL.TELNYX_BUDGET]: true,
  [KOSTENPROFIL.TELNYX_INBOUND_BUDGET]: true,
  [KOSTENPROFIL.EL_CONVAI_SIP]: false,
  [KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI]: false,
});

export function legRunsOurTurnLoop(call) {
  const profil = call?.costProfile;
  if (!Object.hasOwn(TURN_LOOP_BY_COST_PROFILE, profil)) return true;
  return TURN_LOOP_BY_COST_PROFILE[profil];
}
