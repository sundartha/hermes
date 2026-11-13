import { mock } from "node:test";
import pg from "pg";

export const TAKT_MS = 60000;
export const FRIST_MS = 5000;
const RUNDEN = 50;

export const naechsteRunde = () => new Promise((fertig) => setImmediate(fertig));

export async function rundenWarten() {
  for (let runde = 0; runde < RUNDEN; runde += 1) await naechsteRunde();
}

export function zeitgeberAn(apis) {
  mock.timers.reset();
  mock.timers.enable({ apis });
}

export function zeitgeberAus() {
  mock.timers.reset();
}

export async function minuteVergeht() {
  mock.timers.tick(FRIST_MS);
  await rundenWarten();
  mock.timers.tick(TAKT_MS - FRIST_MS);
  await rundenWarten();
}

export function clientVerhalten(abfrage) {
  const Basis = pg.Client;
  const angelegt = [];
  pg.Client = class VerhaltenClient extends Basis {
    constructor(optionen) {
      super(optionen);
      const echteAbfrage = this.query;
      const echtesEnde = this.end.bind(this);
      this.beendet = false;
      this.query = (...argumente) => abfrage(this, echteAbfrage, ...argumente);
      this.end = () => {
        this.beendet = true;
        return echtesEnde();
      };
      angelegt.push(this);
    }
  };
  return {
    angelegt,
    offen: () => angelegt.filter((client) => !client.beendet).length,
    zuruecksetzen: () => {
      pg.Client = Basis;
    },
  };
}

export const haengt = () => new Promise(() => {});
