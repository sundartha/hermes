export const VORLAGE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";

const BESITZ_SCHLUESSEL = "_besitz";
const FELDER_SCHLUESSEL = "felder";
const REGELN_SCHLUESSEL = "regeln";
const NICHT_BESESSEN_SCHLUESSEL = "_nicht_besessen";
const AUSNAHME_SCHLUESSEL = "ausgenommen";
const AUSNAHME_GRUND_SCHLUESSEL = "grund";
const AUSNAHME_SEIT_SCHLUESSEL = "seit";
const AUSNAHME_DATUM_MUSTER = /^\d{4}-\d{2}-\d{2}$/;
export const AUSNAHME_MARKE = "BEWUSST AUSGENOMMEN seit";
export const NICHT_PRUEFBAR_MARKE = "NICHT PRUEFBAR";
export const AUSNAHME_UEBERFAELLIG_MARKE = "AUSNAHME UEBERFAELLIG";
export const AUSNAHME_HOECHSTALTER_TAGE = 90;
const MS_PRO_TAG = 86_400_000;
const REGEL_ART_VERBOTEN_JE_EINTRAG = "verboten_je_eintrag";
export const ART_WERT = "wert";
const ART_NAMEN = "namen";
const ART_VARIABLEN = "variablen";
const ART_TEXTE = "texte";
const JE_EINTRAG_SCHLUESSEL = "je_eintrag";
const JE_EINTRAG_LIVE_SCHLUESSEL = "je_eintrag_live";
export const SCHREIBWEG_SCHLUESSEL = "schreibweg";
export const SCHREIBWEG_BESITZ_SCHLUESSEL = "schreibweg_besitz";
export const SCHREIBWEG_JE_SCHLUESSEL = "je_schluessel";
const SCHREIBWEGE = new Set([SCHREIBWEG_JE_SCHLUESSEL]);
const TEXT_ZUWEISUNG = " = ";
const DOKU_PRAEFIX = "_";
const VARIABLEN_MUSTER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
export const PFAD_TRENNER = ".";
export const PFAD_VERBINDER = " + ";

const WERT_VORSCHAU_ZEICHEN = 200;

const FEHLT_MARKE = "(fehlt)";

export function wertAnPfad(wurzel, pfad) {
  let aktuell = wurzel;
  for (const segment of pfad.split(PFAD_TRENNER)) {
    const istBehaelter = aktuell !== null && typeof aktuell === "object";
    if (!istBehaelter || !(segment in aktuell)) return { gefunden: false };
    aktuell = aktuell[segment];
  }
  return { gefunden: true, wert: aktuell };
}

export function setzeAnPfad(wurzel, pfad, wert) {
  const segmente = pfad.split(PFAD_TRENNER);
  const blatt = segmente.pop();
  let aktuell = wurzel;
  for (const segment of segmente) {
    const istBehaelter = aktuell[segment] !== null && typeof aktuell[segment] === "object";
    if (!istBehaelter) aktuell[segment] = {};
    aktuell = aktuell[segment];
  }
  aktuell[blatt] = wert;
}

export function eintraegeAus(wert) {
  if (Array.isArray(wert)) {
    return wert
      .filter((eintrag) => typeof eintrag?.name === "string")
      .map((eintrag) => [eintrag.name, eintrag]);
  }
  if (wert === null || typeof wert !== "object") return [];
  return Object.entries(wert).filter(([schluessel, kind]) => {
    return !schluessel.startsWith(DOKU_PRAEFIX) && kind !== null;
  });
}

function namenAus(wert) {
  return eintraegeAus(wert).map(([name]) => name);
}

function textDarstellung(wert) {
  return typeof wert === "string" ? wert : JSON.stringify(wert);
}
function texteAus(wert, jeEintrag) {
  return eintraegeAus(wert).map(([name, inhalt]) => {
    const treffer = wertAnPfad(inhalt, jeEintrag);
    const text = treffer.gefunden ? textDarstellung(treffer.wert) : FEHLT_MARKE;
    return `${name}${TEXT_ZUWEISUNG}${text}`;
  });
}

function variablenAus(wert) {
  if (typeof wert !== "string") return [];
  return [...wert.matchAll(VARIABLEN_MUSTER)].map((treffer) => treffer[1]);
}

function sortierteMenge(namen) {
  return [...new Set(namen)].sort();
}

function zeigeMenge(menge) {
  return `[${menge.join(", ")}]`;
}

function zeigeWert(wert) {
  const text = JSON.stringify(wert);
  if (text.length <= WERT_VORSCHAU_ZEICHEN) return text;
  const anfang = text.slice(0, WERT_VORSCHAU_ZEICHEN);
  return `${anfang}... (gekuerzt, ${text.length} Zeichen)`;
}

const VERGLEICHS_ARTEN = new Map([
  [ART_WERT, { einPfad: true, sammle: (werte) => werte[0], zeige: zeigeWert }],
  [
    ART_NAMEN,
    {
      einPfad: false,
      sammle: (werte) => sortierteMenge(werte.flatMap(namenAus)),
      zeige: zeigeMenge,
    },
  ],
  [
    ART_VARIABLEN,
    {
      einPfad: false,
      sammle: (werte) => sortierteMenge(werte.flatMap(variablenAus)),
      zeige: zeigeMenge,
    },
  ],
  [
    ART_TEXTE,
    {
      einPfad: false,
      brauchtJeEintrag: true,
      sammle: (werte, eintrag, seite) => {
        const jeEintragLive = eintrag[JE_EINTRAG_LIVE_SCHLUESSEL];
        const jeEintrag =
          seite === "live" && istPfad(jeEintragLive)
            ? jeEintragLive
            : eintrag[JE_EINTRAG_SCHLUESSEL];
        return sortierteMenge(werte.flatMap((wert) => texteAus(wert, jeEintrag)));
      },
      zeige: zeigeWert,
    },
  ],
]);

function istPfad(pfad) {
  return typeof pfad === "string" && pfad !== "";
}

function istPfadListe(pfade) {
  return Array.isArray(pfade) && pfade.length > 0 && pfade.every(istPfad);
}

function pfadListeFehler({ feld, seite, pfade, einPfad }) {
  if (!istPfadListe(pfade)) {
    return `${feld}: "${seite}" ist keine nicht-leere Liste von Pfaden`;
  }
  if (einPfad && pfade.length !== 1) {
    return `${feld}: art "${ART_WERT}" braucht genau EINEN Pfad je Seite, "${seite}" hat ${pfade.length}`;
  }
  return null;
}

function ausnahmeZeitpunkt(seit) {
  return Date.parse(`${seit}T00:00:00Z`);
}

function ausnahmeFormFehler(eintrag) {
  const ausnahme = eintrag[AUSNAHME_SCHLUESSEL];
  if (ausnahme === undefined) return null;
  const istObjekt = ausnahme !== null && typeof ausnahme === "object" && !Array.isArray(ausnahme);
  if (!istObjekt) {
    return `${eintrag.feld}: "${AUSNAHME_SCHLUESSEL}" ist kein Objekt mit "${AUSNAHME_GRUND_SCHLUESSEL}" und "${AUSNAHME_SEIT_SCHLUESSEL}"`;
  }
  const grund = ausnahme[AUSNAHME_GRUND_SCHLUESSEL];
  if (typeof grund !== "string" || grund === "") {
    return `${eintrag.feld}: "${AUSNAHME_SCHLUESSEL}" ohne "${AUSNAHME_GRUND_SCHLUESSEL}" - eine Ausnahme ohne Begruendung ist von einem Versehen nicht zu unterscheiden`;
  }
  const seit = ausnahme[AUSNAHME_SEIT_SCHLUESSEL];
  const istDatum =
    typeof seit === "string" &&
    AUSNAHME_DATUM_MUSTER.test(seit) &&
    !Number.isNaN(ausnahmeZeitpunkt(seit));
  if (!istDatum) {
    return `${eintrag.feld}: "${AUSNAHME_SCHLUESSEL}.${AUSNAHME_SEIT_SCHLUESSEL}" ist kein gueltiges Datum JJJJ-MM-TT - ohne Datum ist "vorerst" weder nachpruefbar noch befristbar`;
  }
  return null;
}

function ausnahmeAus(eintrag) {
  const ausnahme = eintrag?.[AUSNAHME_SCHLUESSEL];
  if (!ausnahme) return null;
  return {
    grund: ausnahme[AUSNAHME_GRUND_SCHLUESSEL],
    seit: ausnahme[AUSNAHME_SEIT_SCHLUESSEL],
  };
}

function veralteteAusnahmeZeile({ eintrag, heute }) {
  const ausgenommen = ausnahmeAus(eintrag);
  if (!ausgenommen) return null;
  const alterTage = Math.floor(
    (heute.getTime() - ausnahmeZeitpunkt(ausgenommen.seit)) / MS_PRO_TAG,
  );
  if (alterTage <= AUSNAHME_HOECHSTALTER_TAGE) return null;
  return `${AUSNAHME_UEBERFAELLIG_MARKE} ${eintrag.feld} | ausgenommen seit ${ausgenommen.seit}, das sind ${alterTage} Tage und damit mehr als die Hoechstfrist von ${AUSNAHME_HOECHSTALTER_TAGE} Tagen. Entweder das Feld auf den Vorlagen-Wert zurueckdrehen oder die Ausnahme mit neuem Datum und neuem Grund erneuern - "vorerst" ist abgelaufen.`;
}

function jeEintragFormFehler({ feld, art, brauchtJeEintrag, eintrag }) {
  if (!brauchtJeEintrag) return null;
  if (!istPfad(eintrag[JE_EINTRAG_SCHLUESSEL])) {
    return `${feld}: art "${art}" braucht "${JE_EINTRAG_SCHLUESSEL}" - ohne den Unterpfad steht nicht fest, WELCHER Text je Eintrag verglichen wird`;
  }
  const jeEintragLive = eintrag[JE_EINTRAG_LIVE_SCHLUESSEL];
  if (jeEintragLive !== undefined && !istPfad(jeEintragLive)) {
    return `${feld}: "${JE_EINTRAG_LIVE_SCHLUESSEL}" ist gesetzt, aber kein gueltiger Pfad`;
  }
  return null;
}

function schreibwegFormFehler(eintrag) {
  const weg = eintrag[SCHREIBWEG_SCHLUESSEL];
  if (weg === undefined) return null;
  if (!SCHREIBWEGE.has(weg)) {
    const bekannt = [...SCHREIBWEGE].join(", ");
    return `${eintrag.feld}: unbekannter "${SCHREIBWEG_SCHLUESSEL}" "${weg}" (bekannt: ${bekannt})`;
  }
  const besitz = eintrag[SCHREIBWEG_BESITZ_SCHLUESSEL];
  if (!istPfadListe(besitz)) {
    return `${eintrag.feld}: "${SCHREIBWEG_SCHLUESSEL}" "${weg}" braucht "${SCHREIBWEG_BESITZ_SCHLUESSEL}" - die Liste der Blaetter, die an einem BESTEHENDEN Schluessel ueberschrieben werden duerfen`;
  }
  return null;
}

function eintragsFormFehler(eintrag) {
  const { feld, art, vorlage, live } = eintrag ?? {};
  if (typeof feld !== "string" || feld === "") {
    return `${BESITZ_SCHLUESSEL}.${FELDER_SCHLUESSEL}: Eintrag ohne "feld"-Namen`;
  }
  const vergleich = VERGLEICHS_ARTEN.get(art);
  if (!vergleich) {
    const bekannt = [...VERGLEICHS_ARTEN.keys()].join(", ");
    return `${feld}: unbekannte Vergleichs-Art "${art}" (bekannt: ${bekannt})`;
  }
  const jeEintragFehler = jeEintragFormFehler({
    feld,
    art,
    brauchtJeEintrag: vergleich.brauchtJeEintrag,
    eintrag,
  });
  if (jeEintragFehler) return jeEintragFehler;
  const schreibwegFehler = schreibwegFormFehler(eintrag);
  if (schreibwegFehler) return schreibwegFehler;
  const ausnahmeFehler = ausnahmeFormFehler(eintrag);
  if (ausnahmeFehler) return ausnahmeFehler;
  const seiten = [
    { seite: "vorlage", pfade: vorlage },
    { seite: "live", pfade: live },
  ];
  for (const { seite, pfade } of seiten) {
    const fehler = pfadListeFehler({
      feld,
      seite,
      pfade,
      einPfad: vergleich.einPfad,
    });
    if (fehler) return fehler;
  }
  return null;
}

function fehlendePfade(wurzel, pfade) {
  return pfade.filter((pfad) => !wertAnPfad(wurzel, pfad).gefunden);
}

function seiteVergleichswert({ vergleich, eintrag, wurzel, pfade, seite }) {
  const werte = [];
  for (const pfad of pfade) {
    const treffer = wertAnPfad(wurzel, pfad);
    if (treffer.gefunden) werte.push(treffer.wert);
  }
  if (vergleich.einPfad && werte.length === 0) return { vorhanden: false };
  return { vorhanden: true, wert: vergleich.sammle(werte, eintrag, seite) };
}

function istGleich(links, rechts) {
  const gleichVorhanden = links.vorhanden === rechts.vorhanden;
  return gleichVorhanden && JSON.stringify(links.wert) === JSON.stringify(rechts.wert);
}

function ausnahmeAnhang(ausgenommen) {
  if (!ausgenommen) return "";
  return ` [${AUSNAHME_MARKE} ${ausgenommen.seit}: ${ausgenommen.grund}]`;
}

function abweichungsBefund({ eintrag, vergleich, links, rechts }) {
  const anzeige = (seite) => (seite.vorhanden ? vergleich.zeige(seite.wert) : FEHLT_MARKE);
  const vorlagePfade = eintrag.vorlage.join(PFAD_VERBINDER);
  const livePfade = eintrag.live.join(PFAD_VERBINDER);
  const sollAnzeige = anzeige(links);
  const istAnzeige = anzeige(rechts);
  const ausgenommen = ausnahmeAus(eintrag);
  return {
    feld: eintrag.feld,
    art: eintrag.art,
    livePfade: eintrag.live,
    vorlagePfade: eintrag.vorlage,
    schreibweg: eintrag[SCHREIBWEG_SCHLUESSEL] ?? null,
    schreibwegBesitz: eintrag[SCHREIBWEG_BESITZ_SCHLUESSEL] ?? null,
    soll: links,
    ist: rechts,
    sollAnzeige,
    istAnzeige,
    ausgenommen,
    zeile: `ABWEICHUNG ${eintrag.feld}${ausnahmeAnhang(ausgenommen)} | Vorlage ${vorlagePfade} = ${sollAnzeige} | Live ${livePfade} = ${istAnzeige}`,
  };
}

function vergleicheFeld({ eintrag, vorlage, live }) {
  const formFehler = eintragsFormFehler(eintrag);
  if (formFehler) return { fehler: formFehler };

  const vergleich = VERGLEICHS_ARTEN.get(eintrag.art);
  const fehlend = fehlendePfade(vorlage, eintrag.vorlage);
  if (fehlend.length > 0) {
    return {
      fehler: `${eintrag.feld}: besessener Pfad fehlt in der Vorlage (${fehlend.join(PFAD_VERBINDER)}) - Besitz-Erklaerung und Vorlage sind auseinander, dieses Feld wuerde nichts vergleichen`,
    };
  }

  const links = seiteVergleichswert({
    vergleich,
    eintrag,
    wurzel: vorlage,
    pfade: eintrag.vorlage,
    seite: "vorlage",
  });
  const rechts = seiteVergleichswert({
    vergleich,
    eintrag,
    wurzel: live,
    pfade: eintrag.live,
    seite: "live",
  });
  if (istGleich(links, rechts)) return {};
  return { abweichung: abweichungsBefund({ eintrag, vergleich, links, rechts }) };
}

function nichtPruefbarZeile(eintrag, live) {
  const fehlend = fehlendePfade(live, eintrag.live);
  if (fehlend.length === 0) return null;
  return `${NICHT_PRUEFBAR_MARKE} ${eintrag.feld} | Live ${fehlend.join(PFAD_VERBINDER)} fehlt im Agenten - dieses Feld wurde gegen nichts gehalten und zaehlt nicht als geprueft`;
}

function vergleicheFelder({ besitz, vorlage, live, heute }) {
  const eintraege = besitz?.[FELDER_SCHLUESSEL];
  if (!Array.isArray(eintraege) || eintraege.length === 0) {
    return {
      geprueft: 0,
      soll: 0,
      abweichungen: [],
      nichtPruefbar: [],
      veralteteAusnahmen: [],
      fehler: [
        `${VORLAGE_REL}: keine Besitz-Erklaerung (${BESITZ_SCHLUESSEL}.${FELDER_SCHLUESSEL}) mit mindestens einem Feld - ohne sie wuerde NICHTS verglichen`,
      ],
    };
  }

  const abweichungen = [];
  const fehler = [];
  const nichtPruefbar = [];
  const veralteteAusnahmen = [];
  let geprueft = 0;
  for (const eintrag of eintraege) {
    const ergebnis = vergleicheFeld({ eintrag, vorlage, live });
    if (ergebnis.fehler) {
      fehler.push(ergebnis.fehler);
      continue;
    }
    if (ergebnis.abweichung) abweichungen.push(ergebnis.abweichung);
    const luecke = nichtPruefbarZeile(eintrag, live);
    if (luecke) nichtPruefbar.push(luecke);
    else geprueft += 1;
    const veraltet = veralteteAusnahmeZeile({ eintrag, heute });
    if (veraltet) veralteteAusnahmen.push(veraltet);
  }
  return {
    geprueft,
    soll: eintraege.length,
    abweichungen,
    nichtPruefbar,
    veralteteAusnahmen,
    fehler,
  };
}

function regelFormFehler(eintrag) {
  const { regel, art, live, verboten, meldung } = eintrag ?? {};
  if (typeof regel !== "string" || regel === "") {
    return `${BESITZ_SCHLUESSEL}.${REGELN_SCHLUESSEL}: Eintrag ohne "regel"-Namen`;
  }
  if (art !== REGEL_ART_VERBOTEN_JE_EINTRAG) {
    return `${regel}: unbekannte Regel-Art "${art}" (bekannt: ${REGEL_ART_VERBOTEN_JE_EINTRAG})`;
  }
  if (typeof live !== "string" || live === "") {
    return `${regel}: "live" ist kein Pfad auf die gepruefte Sammlung`;
  }
  if (!istPfadListe(verboten)) {
    return `${regel}: "verboten" ist keine nicht-leere Liste von Pfaden`;
  }
  if (typeof meldung !== "string" || meldung === "") {
    return `${regel}: "meldung" fehlt - ein Fund wuerde seinen Grund nicht nennen`;
  }
  return null;
}

function istGesetzt(wurzel, pfad) {
  const treffer = wertAnPfad(wurzel, pfad);
  return treffer.gefunden && treffer.wert !== null;
}

function verletzungsZeile({ eintrag, name, gesetzt }) {
  const pfade = gesetzt.join(PFAD_VERBINDER);
  return `VERLETZUNG ${eintrag.regel} | Live ${eintrag.live}."${name}" setzt ${pfade} | ${eintrag.meldung}`;
}

function keinRegelFund(zusatz) {
  return { geprueft: 0, verletzungen: [], fehler: [], nichtPruefbar: [], ...zusatz };
}

function pruefeRegel(eintrag, live) {
  const formFehler = regelFormFehler(eintrag);
  if (formFehler) return keinRegelFund({ fehler: [formFehler] });

  const treffer = wertAnPfad(live, eintrag.live);
  const sammlung = treffer.wert;
  const istSammlung = treffer.gefunden && sammlung !== null && typeof sammlung === "object";
  if (!istSammlung) {
    return keinRegelFund({
      fehler: [
        `${eintrag.regel}: Sammlung ${eintrag.live} fehlt im Live-Agenten oder ist kein Objekt - dieses Verbot wuerde nichts pruefen`,
      ],
    });
  }

  const eintraege = eintraegeAus(sammlung);
  if (eintraege.length === 0) {
    return keinRegelFund({
      nichtPruefbar: [
        `${NICHT_PRUEFBAR_MARKE} ${eintrag.regel} | Live ${eintrag.live} fuehrt keinen einzigen Eintrag - dieses Verbot wurde gegen nichts gehalten. Nicht pruefbar ist nicht erfuellt`,
      ],
    });
  }

  const verletzungen = [];
  for (const [name, wert] of eintraege) {
    const gesetzt = eintrag.verboten.filter((pfad) => istGesetzt(wert, pfad));
    if (gesetzt.length > 0) verletzungen.push(verletzungsZeile({ eintrag, name, gesetzt }));
  }
  return { geprueft: eintraege.length, verletzungen, fehler: [], nichtPruefbar: [] };
}

function pruefeRegeln({ besitz, live }) {
  const regeln = besitz?.[REGELN_SCHLUESSEL];
  if (!Array.isArray(regeln) || regeln.length === 0) {
    return {
      geprueft: 0,
      angewandt: 0,
      soll: 0,
      verletzungen: [],
      nichtPruefbar: [],
      fehler: [
        `${VORLAGE_REL}: keine Regeln (${BESITZ_SCHLUESSEL}.${REGELN_SCHLUESSEL}) mit mindestens einem Verbot - ohne sie wuerde KEIN Verbot durchgesetzt`,
      ],
    };
  }

  const verletzungen = [];
  const fehler = [];
  const nichtPruefbar = [];
  let geprueft = 0;
  let angewandt = 0;
  for (const eintrag of regeln) {
    const ergebnis = pruefeRegel(eintrag, live);
    verletzungen.push(...ergebnis.verletzungen);
    fehler.push(...ergebnis.fehler);
    nichtPruefbar.push(...ergebnis.nichtPruefbar);
    geprueft += ergebnis.geprueft;
    if (ergebnis.geprueft > 0) angewandt += 1;
  }
  return { geprueft, angewandt, soll: regeln.length, verletzungen, fehler, nichtPruefbar };
}

export function vergleicheBesitz({ vorlage, live, heute = new Date() }) {
  const besitz = vorlage?.[BESITZ_SCHLUESSEL];
  const felder = vergleicheFelder({ besitz, vorlage, live, heute });
  const regeln = pruefeRegeln({ besitz, live });
  const fehler = [...felder.fehler, ...regeln.fehler];
  const nichtPruefbar = [...felder.nichtPruefbar, ...regeln.nichtPruefbar];
  const sauber = felder.abweichungen.length === 0 && regeln.verletzungen.length === 0;
  const vollstaendig = nichtPruefbar.length === 0 && felder.veralteteAusnahmen.length === 0;
  return {
    ok: sauber && fehler.length === 0 && vollstaendig,
    geprueft: felder.geprueft,
    felderSoll: felder.soll,
    geprueftRegeln: regeln.geprueft,
    regelnAngewandt: regeln.angewandt,
    regelnSoll: regeln.soll,
    abweichungen: felder.abweichungen,
    verletzungen: regeln.verletzungen,
    nichtPruefbar,
    veralteteAusnahmen: felder.veralteteAusnahmen,
    fehler,
  };
}

export function besesseneFeldNamen(vorlage) {
  const eintraege = vorlage?.[BESITZ_SCHLUESSEL]?.[FELDER_SCHLUESSEL];
  if (!Array.isArray(eintraege)) return [];
  return eintraege.map((eintrag) => eintrag?.feld).filter((feld) => typeof feld === "string");
}

export function livePfadeVon(vorlage, feld) {
  const eintraege = vorlage?.[BESITZ_SCHLUESSEL]?.[FELDER_SCHLUESSEL];
  const eintrag = Array.isArray(eintraege) ? eintraege.find((kandidat) => kandidat?.feld === feld) : undefined;
  return Array.isArray(eintrag?.live) ? eintrag.live : [];
}

export function nichtBesessen(vorlage) {
  const besitz = vorlage?.[BESITZ_SCHLUESSEL];
  const liste = besitz?.[NICHT_BESESSEN_SCHLUESSEL];
  return Array.isArray(liste) ? liste.filter((zeile) => typeof zeile === "string") : [];
}
