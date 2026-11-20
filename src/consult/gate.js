import { config } from "../config.js";

export function consultToreFor(profile) {
  return {
    master: config.tenancy.consultEnabled === true,
    kontext: config.tenancy.assistantContextEnabled === true,
    mandant: profile?.allowConsult === true,
    in_call: config.tenancy.inCallConsultEnabled === true,
  };
}

export function consultAllowedFor(profile) {
  const { master, kontext, mandant } = consultToreFor(profile);
  return master && kontext && mandant;
}

export function consultAllowedForCall(_call, profile) {
  return consultAllowedFor(profile);
}
