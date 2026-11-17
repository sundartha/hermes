export function uebergabeEroeffnung({ eroeffnungGesagt, eroeffnung, perCallEroeffnung }) {
  if (eroeffnungGesagt) return { variable: "", agentFelder: { first_message: "" } };
  return { variable: eroeffnung, agentFelder: perCallEroeffnung ? { first_message: perCallEroeffnung } : {} };
}
