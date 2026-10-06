import { config } from "../config.js";

export function consultAllowedFor(profile) {
  return (
    config.tenancy.consultEnabled === true &&
    config.tenancy.assistantContextEnabled === true &&
    profile?.allowConsult === true
  );
}

export function consultAllowedForCall(call, profile) {
  return consultAllowedFor(profile) && call.calleeIsOwner !== true;
}
