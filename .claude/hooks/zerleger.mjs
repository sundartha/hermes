const UMLEITUNG = /^(?:&>>?|<<<|<<-|<<|<>|<&|>>|>&|>\||[<>])/;
const UND_ODER = /^(?:&>|&&|\|\||\|&|[&|])/;
const PROZESS_ERSETZUNG = /^[<>]\(/;
const MASKIERUNG = /^\\[\s\S]?/;
export const LESEND = new Set(["<", "<&", "<<<", "<<", "<<-"]);
const HEREDOC = new Set(["<<", "<<-"]);
export const DUPLIKAT = new Set([">&", "<&"]);
export const DESKRIPTOR = /^(?:\d+|-)$/;
export const SCHLUESSELWORT = new Set(["!", "{", "}", "then", "do", "else", "elif", "if", "while", "until", "time", "fi", "done"]);
const FD_WORT = /^(?:\d+|\{\w+\})$/;
const MUSTER = new Set(["*", "?", "[", "{"]);
const BEDINGT_VORHER = new Set(["&&", "||", "|"]);
const BEDINGT_NACHHER = new Set(["|", "&"]);
const ERSETZUNG_GESPERRT =
  "Ersetzung in Bash ist für Test- und Bau-Agent gesperrt; ohne Ersetzung schreiben: Temp-Datei als fester Pfad unter /tmp statt $TMPDIR, " +
  "$ in Mustern in einfache Anführungszeichen, Pfade und Dateien wörtlich statt aus Variable oder Schleife (mehrere Dateien in einem Aufruf), Exit-Code nur mit $?";
const EXIT_CODE = "$?";
const SCHRITTE = new Map([
  ["\\", (zerleger) => zerleger.maskierung()],
  ["'", (zerleger) => zerleger.einfach()],
  ['"', (zerleger) => zerleger.doppelt()],
  ["$", (zerleger) => zerleger.dollar()],
  ["`", (zerleger) => zerleger.backtick()],
  ["#", (zerleger) => zerleger.kommentar()],
  [" ", (zerleger) => zerleger.leer()],
  ["\t", (zerleger) => zerleger.leer()],
  ["\n", (zerleger) => zerleger.zeilenEnde()],
  [";", (zerleger) => zerleger.trenner(1, ";")],
  ["&", (zerleger) => zerleger.undOder()],
  ["|", (zerleger) => zerleger.undOder()],
  ["(", (zerleger) => zerleger.klammerAuf()],
  [")", (zerleger) => zerleger.klammerZu()],
  ["<", (zerleger) => zerleger.pfeil()],
  [">", (zerleger) => zerleger.pfeil()],
]);

function neuesWort() {
  return { text: "", dyn: false, dynAb: -1, glob: false, zitiert: false };
}

export class Zerleger {
  constructor(text) {
    Object.assign(this, { text, i: 0, befehle: [], woerter: [], umleitungen: [], wort: null, wartet: null });
    Object.assign(this, { heredocs: [], tiefe: 0, klammer: 0, vorher: "", fehler: null });
    this.lies(null);
    this.befehlEnde("\n");
  }

  get rest() {
    return this.text.slice(this.i);
  }

  aktuell() {
    this.wort ??= neuesWort();
    return this.wort;
  }

  anhaengen(zeichen) {
    this.aktuell().text += zeichen;
  }

  melde(fehler) {
    this.fehler ??= fehler;
  }

  dynamisch() {
    const offen = this.aktuell();
    if (offen.dynAb === -1) offen.dynAb = offen.text.length;
    offen.dyn = true;
  }

  wortEnde() {
    const fertig = this.wort;
    this.wort = null;
    if (fertig === null) return;
    if (this.wartet === null) {
      this.woerter.push(fertig);
      return;
    }
    this.wartet.ziel = fertig;
    if (HEREDOC.has(this.wartet.op)) this.heredocMerken(fertig);
    this.wartet = null;
  }

  heredocMerken(marke) {
    if (marke.dyn) this.melde("Heredoc-Endmarke mit $");
    this.heredocs.push({ ende: marke.text, zitiert: marke.zitiert, tabs: this.wartet.op === "<<-" });
  }

  befehlEnde(trenner) {
    this.wortEnde();
    if (this.wartet !== null) this.melde(`Umleitung ${this.wartet.op} ohne Ziel`);
    if (this.woerter.length > 0 || this.umleitungen.length > 0) {
      const imBlock = this.tiefe > 0 || this.klammer > 0;
      const bedingt = imBlock || BEDINGT_VORHER.has(this.vorher) || BEDINGT_NACHHER.has(trenner);
      this.befehle.push({ woerter: this.woerter, umleitungen: this.umleitungen, bedingt });
    }
    Object.assign(this, { woerter: [], umleitungen: [], vorher: trenner });
  }

  unterBefehl(ende) {
    const { woerter, umleitungen, wort, wartet, klammer, vorher, tiefe } = this;
    Object.assign(this, { woerter: [], umleitungen: [], wort: null, wartet: null, klammer: 0, vorher: "", tiefe: tiefe + 1 });
    this.lies(ende);
    this.befehlEnde(ende);
    Object.assign(this, { woerter, umleitungen, wort, wartet, klammer, vorher, tiefe });
  }

  dollar() {
    if (!this.text.startsWith(EXIT_CODE, this.i)) return this.melde(ERSETZUNG_GESPERRT);
    this.dynamisch();
    this.i += EXIT_CODE.length;
  }

  backtick() {
    this.melde(ERSETZUNG_GESPERRT);
  }

  maskierung() {
    const [treffer] = MASKIERUNG.exec(this.rest);
    this.i += treffer.length;
    if (treffer.length === 1 || treffer.endsWith("\n")) return;
    this.aktuell().zitiert = true;
    this.anhaengen(treffer.slice(1));
  }

  einfach() {
    const ende = this.text.indexOf("'", this.i + 1);
    if (ende === -1) return this.melde("Anführungszeichen ohne Ende");
    this.aktuell().zitiert = true;
    this.anhaengen(this.text.slice(this.i + 1, ende));
    this.i = ende + 1;
  }

  doppeltZeichen() {
    const zeichen = this.text[this.i];
    if (zeichen === "$") return this.dollar();
    if (zeichen === "`") return this.backtick();
    const [treffer] = MASKIERUNG.exec(this.rest) ?? [zeichen];
    const maskiert = treffer.length > 1 && '$`"\\\n'.includes(treffer.slice(1));
    const wert = maskiert ? treffer.slice(1) : zeichen;
    if (wert !== "\n") this.anhaengen(wert);
    this.i += maskiert ? treffer.length : zeichen.length;
  }

  doppelt() {
    this.aktuell().zitiert = true;
    this.i += 1;
    while (this.i < this.text.length && this.text[this.i] !== '"' && this.fehler === null) this.doppeltZeichen();
    if (this.text[this.i] !== '"') this.melde("Anführungszeichen ohne Ende");
    this.i += 1;
  }

  heredocKoerper({ ende, zitiert, tabs }) {
    const start = this.i;
    for (let anfang = start; anfang < this.text.length; ) {
      const schluss = this.text.indexOf("\n", anfang) === -1 ? this.text.length : this.text.indexOf("\n", anfang);
      const zeile = this.text.slice(anfang, schluss);
      if ((tabs ? zeile.replace(/^\t+/, "") : zeile) === ende) return this.koerper({ start, ende: anfang, weiter: schluss + 1, zitiert });
      anfang = schluss + 1;
    }
    this.koerper({ start, ende: this.text.length, weiter: this.text.length, zitiert });
  }

  koerper({ start, ende, weiter, zitiert }) {
    this.i = start;
    while (!zitiert && this.i < ende && this.fehler === null) {
      if ("$`".includes(this.text[this.i]) && !this.text.startsWith(EXIT_CODE, this.i)) this.melde(ERSETZUNG_GESPERRT);
      this.i += this.text[this.i] === "\\" ? MASKIERUNG.exec(this.rest)[0].length : 1;
    }
    this.i = weiter;
  }

  zeilenEnde() {
    this.trenner(1, "\n");
    for (const heredoc of this.heredocs.splice(0)) this.heredocKoerper(heredoc);
  }

  trenner(laenge, art) {
    this.befehlEnde(art);
    this.i += laenge;
  }

  undOder() {
    const [op] = UND_ODER.exec(this.rest);
    if (op === "&>") return this.pfeil();
    this.trenner(op.length, op === "|&" ? "|" : op);
  }

  klammerAuf() {
    if (this.text[this.i + 1] === "(" && this.woerter.length === 0 && this.wort === null) return this.melde("Arithmetik-Befehl (( ))");
    this.trenner(1, "(");
    this.klammer += 1;
  }

  klammerZu() {
    this.trenner(1, ")");
    this.klammer = Math.max(0, this.klammer - 1);
  }

  pfeil() {
    const ersetzung = PROZESS_ERSETZUNG.exec(this.rest);
    if (ersetzung !== null) {
      this.dynamisch();
      this.i += ersetzung[0].length;
      return this.unterBefehl(")");
    }
    if (this.wort !== null && FD_WORT.test(this.wort.text) && !this.wort.zitiert && !this.wort.dyn) this.wort = null;
    this.wortEnde();
    const [op] = UMLEITUNG.exec(this.rest);
    if (this.wartet !== null) this.melde(`Umleitung ${this.wartet.op} ohne Ziel`);
    this.wartet = { op, ziel: null };
    this.umleitungen.push(this.wartet);
    this.i += op.length;
  }

  kommentar() {
    if (this.wort !== null) return this.zeichen("#");
    const ende = this.text.indexOf("\n", this.i);
    this.i = ende === -1 ? this.text.length : ende;
  }

  leer() {
    this.wortEnde();
    this.i += 1;
  }

  zeichen(zeichen) {
    const amAnfang = this.wort === null || (this.wort.text === "" && !this.wort.dyn);
    if (MUSTER.has(zeichen) || (zeichen === "~" && amAnfang)) {
      if (amAnfang) this.aktuell().dynAb = 0;
      this.aktuell().glob = true;
    }
    this.anhaengen(zeichen);
    this.i += 1;
  }

  lies(ende) {
    while (this.i < this.text.length && this.fehler === null) {
      const zeichen = this.text[this.i];
      if (zeichen === ende && (ende !== ")" || this.klammer === 0)) {
        this.i += 1;
        return;
      }
      const schritt = SCHRITTE.get(zeichen);
      if (schritt) schritt(this);
      else this.zeichen(zeichen);
    }
    if (ende !== null) this.melde(`${ende} ohne Ende`);
  }
}
