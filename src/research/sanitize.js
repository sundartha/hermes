export const RESEARCH_EGRESS_FIELDS = Object.freeze(["objective", "ownerNotes", "constraints"]);

export function researchEgressInput(input) {
  const out = {};
  for (const field of RESEARCH_EGRESS_FIELDS) {
    if (input?.[field] != null) out[field] = input[field];
  }
  return out;
}
