export function uebergabeEroeffnung({ eroeffnungGesagt, eroeffnung, perCallEroeffnung }) {
  if (eroeffnungGesagt) return { variable: "", ersteNachricht: "" };
  return { variable: eroeffnung, ersteNachricht: perCallEroeffnung || null };
}
