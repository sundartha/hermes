import { config } from "../config.ts";

function istWahr(quelle, schluessel) {
  return Reflect.get(Object(quelle), schluessel) === true;
}

export function consultToreFor(profile) {
  const tenancy = Reflect.get(config, "tenancy");
  return {
    master: istWahr(tenancy, "consultEnabled"),
    kontext: istWahr(tenancy, "assistantContextEnabled"),
    mandant: istWahr(profile, "allowConsult"),
    in_call: istWahr(tenancy, "inCallConsultEnabled"),
  };
}

export function consultAllowedFor(profile) {
  const { master, kontext, mandant } = consultToreFor(profile);
  return master && kontext && mandant;
}

export function consultAllowedForCall(_call, profile) {
  return consultAllowedFor(profile);
}
