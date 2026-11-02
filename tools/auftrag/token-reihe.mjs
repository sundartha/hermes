import { env } from "node:process";

const REIHE = ["CLAUDE_CODE_OAUTH_TOKEN_1", "CLAUDE_CODE_OAUTH_TOKEN_2", "CLAUDE_CODE_OAUTH_TOKEN_3"];
const ALT = "CLAUDE_CODE_OAUTH_TOKEN";
const LAUF_NUMMER = "GITHUB_RUN_NUMBER";

function nimm(name) {
  const wert = String(env[name] ?? "").trim();
  delete env[name];
  return wert;
}

function startAusLaufnummer() {
  const nummer = Number.parseInt(env[LAUF_NUMMER] ?? "", 10);
  return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : 0;
}

export class TokenReihe {
  constructor(tokens, start = 0) {
    this.tokens = [...new Set(tokens.filter(Boolean))];
    this.stelle = this.tokens.length === 0 ? 0 : start % this.tokens.length;
  }

  get leer() {
    return this.tokens.length === 0;
  }

  async versuche(lauf, { istLimit, meldung = console.log }) {
    let letzter = null;
    for (let schritt = 0; schritt < this.tokens.length; schritt += 1) {
      const stelle = (this.stelle + schritt) % this.tokens.length;
      letzter = await lauf(this.tokens[stelle]);
      if (!istLimit(letzter)) {
        this.stelle = stelle;
        return letzter;
      }
      meldung(`Token ${stelle + 1} von ${this.tokens.length} im Nutzungslimit${schritt + 1 < this.tokens.length ? ", weiter mit dem nächsten" : ""}.`);
    }
    return letzter;
  }
}

export function alsReihe(wert) {
  if (wert instanceof TokenReihe) return wert;
  return new TokenReihe(typeof wert === "string" ? [wert] : []);
}

export function nimmTokenReihe() {
  const start = startAusLaufnummer();
  const reihe = REIHE.map(nimm);
  const alt = nimm(ALT);
  const vorhanden = reihe.filter(Boolean);
  return new TokenReihe(vorhanden.length > 0 ? vorhanden : [alt], start);
}
