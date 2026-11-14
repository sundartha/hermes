export const RESEARCH_EGRESS_FIELDS = Object.freeze(["objective", "ownerNotes", "constraints"]);

export function researchEgressInput(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of RESEARCH_EGRESS_FIELDS) {
    if (input?.[field] != null) out[field] = input[field];
  }
  return out;
}
