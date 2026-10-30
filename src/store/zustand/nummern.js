import { attachNumberRegistration } from "../state-ops.js";

export function registrierungAnhaengen(zustand, numberId, providerAgentPhoneNumberId) {
  const number = attachNumberRegistration(zustand, numberId, providerAgentPhoneNumberId);
  return { ergebnis: number, geaendert: number.providerAgentPhoneNumberId === providerAgentPhoneNumberId };
}
