import assert from "node:assert/strict";
import http from "node:http";
import anfrageMitFrist from "./anfrage-mit-frist.mjs";
import { test } from "node:test";
import { errorHandler } from "../../src/middleware.ts";
import { fehlerausgabeVon } from "./fehlerausgabe.js";
import { startServer, seedState, seedCall, waitForLog } from "../helpers.js";

const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;

function antwort({ headersSent, writableEnded }) {
  return {
    headersSent,
    writableEnded,
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const ZUSTAENDE = [
  {
    name: "vollstaendig gesendet",
    headersSent: true,
    writableEnded: true,
    weitergereicht: false,
    status: null,
  },
  {
    name: "teilweise gesendet",
    headersSent: true,
    writableEnded: false,
    weitergereicht: true,
    status: null,
  },
  {
    name: "nichts gesendet",
    headersSent: false,
    writableEnded: false,
    weitergereicht: false,
    status: HTTP_SERVER_ERROR,
  },
];

for (const zustand of ZUSTAENDE) {
  test(`errorHandler: ${zustand.name}`, () => {
    const res = antwort(zustand);
    const fehler = new Error("nacharbeit kaputt");
    let weitergereicht = null;
    const zeilen = fehlerausgabeVon(() =>
      errorHandler(fehler, {}, res, (e) => {
        weitergereicht = e;
      }),
    );
    assert.equal(weitergereicht, zustand.weitergereicht ? fehler : null);
    assert.equal(res.statusCode, zustand.status);
    assert.deepEqual(res.body, zustand.status ? { error: "internal error" } : null);
    assert.ok(zeilen.some((z) => z.includes("[error]") && z.includes("nacharbeit kaputt")));
  });
}

const urlOptionen = (url) => {
  const ziel = new URL(url);
  return { hostname: ziel.hostname, port: ziel.port, path: ziel.pathname + ziel.search };
};

function anfrage(agent, url) {
  return new Promise((resolve, reject) => {
    const req = anfrageMitFrist({ ...urlOptionen(url), method: "POST", agent }, (res) => {
      const socket = res.socket;
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, socket }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("/voice/status bei Altdaten-Provider: Verbindung bleibt nach dem 200 bestehen", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [seedCall({ id: "st_alt", provider: "altanbieter", status: "active" })],
    }),
  });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const url = `${srv.localUrl}/voice/status?callId=st_alt`;
    const erste = await anfrage(agent, url);
    assert.equal(erste.status, HTTP_OK);
    await waitForLog(srv, /\[error\] Error: Provider 'altanbieter'/);
    assert.equal(erste.socket.destroyed, false);
    const zweite = await anfrage(agent, url);
    assert.equal(zweite.status, HTTP_OK);
    assert.equal(zweite.socket, erste.socket);
  } finally {
    agent.destroy();
    await srv.stop();
  }
});
