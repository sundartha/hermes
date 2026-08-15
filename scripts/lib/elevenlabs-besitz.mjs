// Der reine Vergleichs-Kern zwischen der Repo-Vorlage und dem LIVE-Agenten bei
// ElevenLabs. Kein Netz, keine Datei, kein exit - nur Daten hinein, Befund
// heraus.
//
// WARUM ALS EIGENE DATEI: es gibt zwei Kommandos an derselben Sache - das
// lesende Gate (npm run elevenlabs:drift) und das schreibende Reparieren
// (npm run elevenlabs:push). Zwei eigene Vergleicher wuerden gegeneinander
// driften, und genau Drift ist das Problem, das dieser Mechanismus ueberhaupt
// erst loesen soll: ein Push, der etwas anderes fuer abweichend haelt als das
// Gate, schreibt Felder, die niemand als abweichend gemeldet bekommen hat.
// Deshalb EIN Kern; die Kommandos sind nur Huellen darum.
//
// WARUM BESITZ STATT VOLLABGLEICH: ein Abgleich ueber alle Felder des Agenten
// wuerde auch tts.voice_id melden - und beim Reparieren ueberschreiben - eine
// Stimme, die der Eigentuemer im Dashboard gewaehlt hat und die in der Vorlage
// nie stand. In diesem Projekt hat schon einmal ein Provisionierer die ganze
// Live-Konfiguration aus lokalen Werten geschrieben und damit Live-Einstellungen
// zerstoert. Verglichen wird deshalb AUSSCHLIESSLICH, was die Vorlage
// ausdruecklich besitzt: die Liste steht als Datenfeld _besitz.felder in der
// Vorlage selbst (nicht hier im Code, nicht als Prosa) - eine Besitz-Liste, die
// nur ein Mensch liest, driftet genauso wie das, was sie beschreiben soll. Die
// Arten des Vergleichs (wert | namen | variablen | texte) sind dort an
// _art_hinweis begruendet.
//
// NEBEN DEM FELDVERGLEICH: Verbote (_besitz.regeln, dort an _regeln_hinweis
// begruendet). Ein Feldvergleich kann nur zwei bekannte Stellen gegeneinander
// halten; ein Verbot sagt "in dieser Sammlung darf NIRGENDS dieser Pfad
// gesetzt sein" und gilt damit auch fuer Eintraege, die es heute nicht gibt.
// Auch sie stehen als Daten in der Vorlage und nicht hier - fest verdrahtet
// waere die Regel fuer den unsichtbar, der die Vorlage pflegt.
//
// AUSNAHMEN (Feld "ausgenommen" am Besitz-Eintrag, mit Grund und Datum) sind
// KEINE Abschaltung des Vergleichs: die Abweichung wird weiter gemeldet, nur
// gekennzeichnet. Sie sagt dem schreibenden Kommando "nicht von selbst
// geradebiegen" - dort ist sie der Riegel (s. push). Hier ist sie eine Marke,
// damit rot nicht mit kaputt verwechselt wird.
//
// FAIL-CLOSED, weil ein gruener Befund, der nichts geprueft hat, wie ein
// bestandener aussieht: eine fehlende Besitz-Erklaerung, eine unbekannte
// Vergleichs-Art oder ein besessener Pfad, den die Vorlage gar nicht hat, wird
// zu einem Eintrag in fehler[] - nie zu einem stillen "kein Fund".

// Pfad der Vorlage, relativ zur Repo-Wurzel. Steht hier und nicht beim
// Datei-Zugriff, weil die Fehlermeldungen dieses Kerns die Datei beim Namen
// nennen muessen, wenn ihre Besitz-Erklaerung nicht traegt.
export const VORLAGE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";

const BESITZ_SCHLUESSEL = "_besitz";
const FELDER_SCHLUESSEL = "felder";
const REGELN_SCHLUESSEL = "regeln";
const NICHT_BESESSEN_SCHLUESSEL = "_nicht_besessen";
// Die AUSNAHME an einem Besitz-Eintrag: "dieses Feld weicht bewusst ab, und ein
// Push soll es vorerst NICHT von sich aus geradebiegen". Sie aendert den
// Vergleich nicht - die Abweichung wird weiter gemeldet, nur gekennzeichnet;
// wer sie stumm schalten wollte, muesste den Besitz aufgeben. Grund und Datum
// sind Pflicht (s. ausnahmeFormFehler): eine Ausnahme ohne Begruendung ist von
// einem Versehen nicht zu unterscheiden, und ohne Datum ist "vorerst" nicht
// nachpruefbar.
const AUSNAHME_SCHLUESSEL = "ausgenommen";
const AUSNAHME_GRUND_SCHLUESSEL = "grund";
const AUSNAHME_SEIT_SCHLUESSEL = "seit";
const AUSNAHME_DATUM_MUSTER = /^\d{4}-\d{2}-\d{2}$/;
// Die Marke, die eine ausgenommene Abweichung in der Meldung traegt: rot bleibt
// rot, aber "festgehaltene Entscheidung" darf nicht wie "kaputt" aussehen.
export const AUSNAHME_MARKE = "BEWUSST AUSGENOMMEN seit";
// Einzige heute bekannte Form eines Verbots: "kein Eintrag dieser Sammlung darf
// einen dieser Pfade gesetzt haben". Eine unbekannte art ist ein Fehler und
// kein stilles Ueberspringen - sonst pruefte das Gate genau das Verbot nicht
// mehr, das es zu pruefen behauptet.
const REGEL_ART_VERBOTEN_JE_EINTRAG = "verboten_je_eintrag";
// Die einzige Art, die genau EIN Feld je Seite vergleicht - und damit die
// einzige, aus deren Befund sich ein Schreibvorgang ableiten laesst (s. push).
export const ART_WERT = "wert";
const ART_NAMEN = "namen";
const ART_VARIABLEN = "variablen";
const ART_TEXTE = "texte";
// Unterpfad je Sammlungs-Eintrag, den art "texte" vergleicht (z.B.
// "description"). Steht als Datenfeld am Besitz-Eintrag, nicht hier: welcher
// Text besessen ist, gehoert zur Besitz-Erklaerung, nicht zum Vergleicher.
const JE_EINTRAG_SCHLUESSEL = "je_eintrag";
const TEXT_ZUWEISUNG = " = ";
// Schluessel-Praefix der reinen Entwickler-Doku in diesen JSON-Dateien (Bestand,
// s. scripts/check-elevenlabs-tests.js): kein Teil des ElevenLabs-Schemas,
// zaehlt deshalb bei art "namen" nicht als Werkzeug-/Preset-Name mit.
const DOKU_PRAEFIX = "_";
// ElevenLabs' dynamic-variable-Syntax, identisch zu check-elevenlabs-tests.js:
// "double curly braces {{variable_name}}".
const VARIABLEN_MUSTER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
export const PFAD_TRENNER = ".";
export const PFAD_VERBINDER = " + ";

// Der System-Prompt ist mehrere Kilobyte gross. Ungekuerzt waere die Meldung
// unlesbar - gekuerzt VERGLICHEN oder gar GESCHRIEBEN wird aber nie: Vergleich
// und Schreibwert laufen immer ueber den vollen Wert, gekuerzt ist
// ausschliesslich die Anzeige (sonst saehen zwei Prompts mit gleichem Anfang
// faelschlich gleich aus).
const WERT_VORSCHAU_ZEICHEN = 200;

const FEHLT_MARKE = "(fehlt)";

// --- Pfad- und Werte-Zugriff ---

// Loest einen Punkt-Pfad in einem geparsten JSON-Wert auf. Liefert ausdruecklich
// { gefunden }, nicht undefined: "Pfad gibt es nicht" und "Wert ist leer" sind
// verschiedene Sachverhalte, und nur der erste ist ein Erklaerungs-Fehler.
export function wertAnPfad(wurzel, pfad) {
  let aktuell = wurzel;
  for (const segment of pfad.split(PFAD_TRENNER)) {
    const istBehaelter = aktuell !== null && typeof aktuell === "object";
    if (!istBehaelter || !(segment in aktuell)) return { gefunden: false };
    aktuell = aktuell[segment];
  }
  return { gefunden: true, wert: aktuell };
}

// Setzt einen Punkt-Pfad in einem Objekt und legt fehlende Zwischenebenen als
// leere Objekte an. Gegenstueck zu wertAnPfad; gebraucht, um aus einem Befund
// einen minimalen Patch-Koerper zu bauen und um einen Schreibvorgang trocken zu
// simulieren. Veraendert wurzel an Ort und Stelle.
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

// Die Eintraege EINER Sammlung als [name, inhalt]-Paare. Zwei Formen, weil
// Vorlage und Anbieter dieselbe Sache verschieden formen: die Vorlage haelt
// Werkzeuge als Objekt-Karte, der Live-Agent als Liste. null-Werte zaehlen
// nicht als vorhanden - der Live-Agent fuehrt jedes bekannte Systemwerkzeug als
// Schluessel und setzt die nicht konfigurierten auf null; ohne diese Regel
// waere die Live-Menge immer die volle Anbieter-Liste.
function eintraegeAus(wert) {
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

// Die Namen EINER Sammlung (art "namen").
function namenAus(wert) {
  return eintraegeAus(wert).map(([name]) => name);
}

// Die Texte an EINEM Unterpfad JEDES Eintrags einer Sammlung (art "texte"), als
// "name = text". Noetig, wo Namen zu wenig und ein Vollwertvergleich zu viel
// waeren: der Anbieter haengt an jeden Eintrag Felder, die die Vorlage nicht
// besitzt (bei data_collection z.B. enum, is_system_provided, llm) - ein
// Wertvergleich waere dort dauerhaft rot und damit blind. Ein fehlender Text
// wird als (fehlt) gemeldet und nicht stillschweigend uebersprungen: sonst
// saehe "Beschreibung geloescht" wie "stimmt ueberein" aus.
function texteAus(wert, jeEintrag) {
  return eintraegeAus(wert).map(([name, inhalt]) => {
    const treffer = wertAnPfad(inhalt, jeEintrag);
    const text = typeof treffer.wert === "string" ? treffer.wert : FEHLT_MARKE;
    return `${name}${TEXT_ZUWEISUNG}${text}`;
  });
}

// Die {{name}}-Vorkommen EINES Texts (art "variablen"): bei dynamic_variables
// werden die NAMEN verglichen, nicht die Werte - die Werte sind
// auftragsspezifisch und bei jedem Anruf andere.
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

// Anzeige eines Einzelwerts: JSON-Schreibweise (Zeilenumbrueche werden zu \n,
// die Meldung bleibt EINE Zeile) und gekuerzt, s. WERT_VORSCHAU_ZEICHEN.
function zeigeWert(wert) {
  const text = JSON.stringify(wert);
  if (text.length <= WERT_VORSCHAU_ZEICHEN) return text;
  const anfang = text.slice(0, WERT_VORSCHAU_ZEICHEN);
  return `${anfang}... (gekuerzt, ${text.length} Zeichen)`;
}

// Die vier Vergleichs-Arten, begruendet in der Vorlage (_besitz._art_hinweis).
// einPfad: art "wert" vergleicht genau EIN Feld je Seite; die Mengen-Arten
// duerfen mehrere Ablagen zusammenfassen (z.B. eigene UND eingebaute Werkzeuge).
// brauchtJeEintrag: art "texte" sagt erst mit einem Unterpfad, WELCHEN Text sie
// vergleicht - fehlt er, ist der Besitz-Eintrag kaputt und nicht etwa leer.
// sammle bekommt den Besitz-Eintrag mit, damit dieser Unterpfad Daten bleibt.
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
      sammle: (werte, eintrag) => {
        const jeEintrag = eintrag[JE_EINTRAG_SCHLUESSEL];
        return sortierteMenge(werte.flatMap((wert) => texteAus(wert, jeEintrag)));
      },
      zeige: zeigeWert,
    },
  ],
]);

// --- Form der Besitz-Erklaerung ---

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

// Prueft die FORM einer Ausnahme. Sie ist freiwillig (fehlt sie, ist alles in
// Ordnung), aber wenn sie da ist, muss sie tragen: eine halbe Ausnahme wuerde am
// Push zum Riegel, ohne dass irgendwo staende, warum und seit wann - genau die
// unbelegte Sonderbehandlung, gegen die die Besitz-Erklaerung gebaut ist.
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
  if (typeof seit !== "string" || !AUSNAHME_DATUM_MUSTER.test(seit)) {
    return `${eintrag.feld}: "${AUSNAHME_SCHLUESSEL}.${AUSNAHME_SEIT_SCHLUESSEL}" ist kein Datum JJJJ-MM-TT - ohne Datum ist "vorerst" nicht nachpruefbar`;
  }
  return null;
}

// Die Ausnahme EINES Eintrags als Daten oder null. Erst nach bestandener
// Formpruefung aufzurufen - danach sind Grund und Datum garantiert da.
function ausnahmeAus(eintrag) {
  const ausnahme = eintrag?.[AUSNAHME_SCHLUESSEL];
  if (!ausnahme) return null;
  return {
    grund: ausnahme[AUSNAHME_GRUND_SCHLUESSEL],
    seit: ausnahme[AUSNAHME_SEIT_SCHLUESSEL],
  };
}

// Prueft die FORM eines Besitz-Eintrags. Ein kaputter Eintrag darf nicht still
// als "kein Fund" durchgehen: dann pruefte das Gate genau das Feld nicht mehr,
// das es zu pruefen behauptet.
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
  if (vergleich.brauchtJeEintrag && !istPfad(eintrag[JE_EINTRAG_SCHLUESSEL])) {
    return `${feld}: art "${art}" braucht "${JE_EINTRAG_SCHLUESSEL}" - ohne den Unterpfad steht nicht fest, WELCHER Text je Eintrag verglichen wird`;
  }
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

// --- Vergleich ---

function fehlendePfade(wurzel, pfade) {
  return pfade.filter((pfad) => !wertAnPfad(wurzel, pfad).gefunden);
}

// Der Vergleichswert EINER Seite. vorhanden=false gibt es nur bei art "wert":
// bei den Mengen-Arten ist die leere Menge ein gueltiger Wert, kein Fehlen.
function seiteVergleichswert({ vergleich, eintrag, wurzel, pfade }) {
  const werte = [];
  for (const pfad of pfade) {
    const treffer = wertAnPfad(wurzel, pfad);
    if (treffer.gefunden) werte.push(treffer.wert);
  }
  if (vergleich.einPfad && werte.length === 0) return { vorhanden: false };
  return { vorhanden: true, wert: vergleich.sammle(werte, eintrag) };
}

// Verglichen wird der VOLLE Wert, nie die gekuerzte Anzeige.
function istGleich(links, rechts) {
  const gleichVorhanden = links.vorhanden === rechts.vorhanden;
  return gleichVorhanden && JSON.stringify(links.wert) === JSON.stringify(rechts.wert);
}

// Die Kennzeichnung einer ausgenommenen Abweichung in der gedruckten Zeile.
// Steht HINTER dem Feldnamen, damit die Zeile ihren Anfang behaelt (wer nach
// "ABWEICHUNG <feld>" sucht, findet sie weiterhin) und die Marke trotzdem nicht
// zu uebersehen ist.
function ausnahmeAnhang(ausgenommen) {
  if (!ausgenommen) return "";
  return ` [${AUSNAHME_MARKE} ${ausgenommen.seit}: ${ausgenommen.grund}]`;
}

// Ein Abweichungs-Befund als DATEN, nicht als Satz: das lesende Gate druckt
// zeile, das schreibende Kommando braucht art, livePfade und soll.wert, um
// daraus einen gezielten Patch zu bauen. Wer nur den Satz zurueckgibt, zwingt
// den zweiten Aufrufer, ihn wieder auseinanderzunehmen - und damit zu einem
// zweiten, driftenden Vergleicher. Aus demselben Grund traegt der Befund die
// Ausnahme als Daten UND als Marke in der Zeile: das Gate druckt nur, das
// schreibende Kommando entscheidet daran.
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
    soll: links,
    ist: rechts,
    sollAnzeige,
    istAnzeige,
    ausgenommen,
    zeile: `ABWEICHUNG ${eintrag.feld}${ausnahmeAnhang(ausgenommen)} | Vorlage ${vorlagePfade} = ${sollAnzeige} | Live ${livePfade} = ${istAnzeige}`,
  };
}

// Vergleicht EIN besessenes Feld. Liefert { fehler } (die Besitz-Erklaerung
// passt nicht zur Vorlage - hier waere ein "kein Fund" eine Luege),
// { abweichung } oder {} bei Uebereinstimmung.
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
  });
  const rechts = seiteVergleichswert({ vergleich, eintrag, wurzel: live, pfade: eintrag.live });
  if (istGleich(links, rechts)) return {};
  return { abweichung: abweichungsBefund({ eintrag, vergleich, links, rechts }) };
}

// Alle BESESSENEN Felder und nur sie.
function vergleicheFelder(besitz, vorlage, live) {
  const eintraege = besitz?.[FELDER_SCHLUESSEL];
  if (!Array.isArray(eintraege) || eintraege.length === 0) {
    return {
      geprueft: 0,
      abweichungen: [],
      fehler: [
        `${VORLAGE_REL}: keine Besitz-Erklaerung (${BESITZ_SCHLUESSEL}.${FELDER_SCHLUESSEL}) mit mindestens einem Feld - ohne sie wuerde NICHTS verglichen`,
      ],
    };
  }

  const abweichungen = [];
  const fehler = [];
  for (const eintrag of eintraege) {
    const ergebnis = vergleicheFeld({ eintrag, vorlage, live });
    if (ergebnis.fehler) fehler.push(ergebnis.fehler);
    if (ergebnis.abweichung) abweichungen.push(ergebnis.abweichung);
  }
  return { geprueft: eintraege.length, abweichungen, fehler };
}

// --- Verbote (_besitz.regeln) ---

// Prueft die FORM eines Verbots. Wie bei den Feldern gilt: ein kaputter Eintrag
// darf nicht still als "kein Fund" durchgehen - sonst pruefte das Gate genau
// das Verbot nicht mehr, das es zu pruefen behauptet.
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

// "Gesetzt" heisst: der Pfad existiert UND traegt nicht null. Der Anbieter
// fuehrt die Felder eines Presets vollstaendig und setzt die ungenutzten auf
// null. Ein LEERER Text zaehlt dagegen als gesetzt - eine geleerte Offenlegung
// ist der schlimmste Fall des Verbots, nicht sein harmloser.
function istGesetzt(wurzel, pfad) {
  const treffer = wertAnPfad(wurzel, pfad);
  return treffer.gefunden && treffer.wert !== null;
}

// Nennt den Eintrag beim Namen und traegt die Begruendung aus der Vorlage mit:
// eine Verletzung ist kein Feldunterschied, den man wegvergleichen kann,
// sondern eine Aussage darueber, was hier ueberhaupt nicht stehen darf.
function verletzungsZeile({ eintrag, name, gesetzt }) {
  const pfade = gesetzt.join(PFAD_VERBINDER);
  return `VERLETZUNG ${eintrag.regel} | Live ${eintrag.live}."${name}" setzt ${pfade} | ${eintrag.meldung}`;
}

// EIN Verbot gegen EINE Sammlung des Live-Agenten. Geprueft wird jeder Eintrag,
// den der Agent wirklich fuehrt - damit auch kuenftig hinzugefuegte und
// unabhaengig davon, ob die Namen der Sammlung gerade abweichen.
function pruefeRegel(eintrag, live) {
  const formFehler = regelFormFehler(eintrag);
  if (formFehler) return { geprueft: 0, verletzungen: [], fehler: [formFehler] };

  const treffer = wertAnPfad(live, eintrag.live);
  const sammlung = treffer.wert;
  const istSammlung = treffer.gefunden && sammlung !== null && typeof sammlung === "object";
  if (!istSammlung) {
    return {
      geprueft: 0,
      verletzungen: [],
      fehler: [
        `${eintrag.regel}: Sammlung ${eintrag.live} fehlt im Live-Agenten oder ist kein Objekt - dieses Verbot wuerde nichts pruefen`,
      ],
    };
  }

  const verletzungen = [];
  const eintraege = Object.entries(sammlung);
  for (const [name, wert] of eintraege) {
    const gesetzt = eintrag.verboten.filter((pfad) => istGesetzt(wert, pfad));
    if (gesetzt.length > 0) verletzungen.push(verletzungsZeile({ eintrag, name, gesetzt }));
  }
  return { geprueft: eintraege.length, verletzungen, fehler: [] };
}

// Alle Verbote. geprueft zaehlt die wirklich angesehenen Paare (Regel x
// Eintrag) - eine Zahl, die 0 bleibt, waere sonst von "nichts gefunden" nicht
// zu unterscheiden.
function pruefeRegeln(besitz, live) {
  const regeln = besitz?.[REGELN_SCHLUESSEL];
  if (!Array.isArray(regeln) || regeln.length === 0) {
    return {
      geprueft: 0,
      verletzungen: [],
      fehler: [
        `${VORLAGE_REL}: keine Regeln (${BESITZ_SCHLUESSEL}.${REGELN_SCHLUESSEL}) mit mindestens einem Verbot - ohne sie wuerde KEIN Verbot durchgesetzt`,
      ],
    };
  }

  const verletzungen = [];
  const fehler = [];
  let geprueft = 0;
  for (const eintrag of regeln) {
    const ergebnis = pruefeRegel(eintrag, live);
    verletzungen.push(...ergebnis.verletzungen);
    fehler.push(...ergebnis.fehler);
    geprueft += ergebnis.geprueft;
  }
  return { geprueft, verletzungen, fehler };
}

// Vergleicht Vorlage und Live-Agenten ueber die BESESSENEN Felder und setzt die
// Verbote der Vorlage durch. Wirft nie an den Aufrufer weiter: jedes erwartbare
// Problem wird zu einem Eintrag in fehler[], abweichungen[] oder
// verletzungen[] (fail-closed). ok = alle drei leer.
export function vergleicheBesitz({ vorlage, live }) {
  const besitz = vorlage?.[BESITZ_SCHLUESSEL];
  const felder = vergleicheFelder(besitz, vorlage, live);
  const regeln = pruefeRegeln(besitz, live);
  const fehler = [...felder.fehler, ...regeln.fehler];
  const sauber = felder.abweichungen.length === 0 && regeln.verletzungen.length === 0;
  return {
    ok: sauber && fehler.length === 0,
    geprueft: felder.geprueft,
    geprueftRegeln: regeln.geprueft,
    abweichungen: felder.abweichungen,
    verletzungen: regeln.verletzungen,
    fehler,
  };
}

// Die Namen ALLER besessenen Felder, wie die Vorlage sie erklaert - unabhaengig
// davon, ob sie gerade abweichen. Gebraucht dort, wo ein Aufrufer eine Auswahl
// von Feldern entgegennimmt und einen Namen pruefen muss, den es gar nicht gibt.
// Steht hier und nicht beim Aufrufer, weil sonst ein zweiter Ort wuesste, wie
// die Besitz-Erklaerung aufgebaut ist - und mit ihr driften wuerde.
export function besesseneFeldNamen(vorlage) {
  const eintraege = vorlage?.[BESITZ_SCHLUESSEL]?.[FELDER_SCHLUESSEL];
  if (!Array.isArray(eintraege)) return [];
  return eintraege.map((eintrag) => eintrag?.feld).filter((feld) => typeof feld === "string");
}

// Was die Vorlage ausdruecklich NICHT besitzt - wird mitgemeldet, damit die
// Grenze des Vergleichs sichtbar bleibt und niemand ein stilles "gruen" fuer
// "alles geprueft" haelt.
export function nichtBesessen(vorlage) {
  const besitz = vorlage?.[BESITZ_SCHLUESSEL];
  const liste = besitz?.[NICHT_BESESSEN_SCHLUESSEL];
  return Array.isArray(liste) ? liste.filter((zeile) => typeof zeile === "string") : [];
}
