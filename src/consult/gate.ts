import { config } from "../config.ts";

interface Tore {
  master: boolean;
  kontext: boolean;
  mandant: boolean;
  in_call: boolean;
}

function istWahr(quelle: unknown, schluessel: string): boolean {
  return Reflect.get(Object(quelle), schluessel) === true;
}

export function consultToreFor(profile: unknown): Tore {
  const tenancy: unknown = Reflect.get(config, "tenancy");
  return {
    master: istWahr(tenancy, "consultEnabled"),
    kontext: istWahr(tenancy, "assistantContextEnabled"),
    mandant: istWahr(profile, "allowConsult"),
    in_call: istWahr(tenancy, "inCallConsultEnabled"),
  };
}

export function consultAllowedFor(profile: unknown): boolean {
  const { master, kontext, mandant } = consultToreFor(profile);
  return master && kontext && mandant;
}

export function consultAllowedForCall(_call: unknown, profile: unknown): boolean {
  return consultAllowedFor(profile);
}
