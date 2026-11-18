interface UebergabeEingabe {
  eroeffnungGesagt: boolean;
  eroeffnung: string;
  perCallEroeffnung: string;
}

interface UebergabeEroeffnung {
  variable: string;
  ersteNachricht: string | null;
}

export function uebergabeEroeffnung({
  eroeffnungGesagt,
  eroeffnung,
  perCallEroeffnung,
}: UebergabeEingabe): UebergabeEroeffnung {
  if (eroeffnungGesagt) return { variable: "", ersteNachricht: "" };
  return { variable: eroeffnung, ersteNachricht: perCallEroeffnung || null };
}
