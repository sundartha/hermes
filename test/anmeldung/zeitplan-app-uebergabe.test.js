import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { importNachKonfiguration } from "../gemeinsam/umgebung-import.js";

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeitplan-app-uebergabe-"));

const [{ config }, { buildApp }] = await importNachKonfiguration(
  { DATA_DIR: TEMP_DATA_DIR },
  {
    auth: { sessionSecret: "zeitplan-app-uebergabe-secret" },
    tenancy: { multiTenant: true, selfServiceEnabled: true },
    server: { webDistDir: path.join(TEMP_DATA_DIR, "web-dist"), publicUrl: "https://zeitplan.test" },
  },
  () => import("../../src/config.js"),
  () => import("../../src/app.js"),
);

after(() => fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true }));

const noop = () => {};
const asyncNoop = async () => {};

function abhaengigkeiten(provisioning) {
  return {
    config,
    store: { load: () => ({ numbers: [], calls: [], tenants: {} }) },
    audit: noop,
    callFinish: { finishCall: asyncNoop },
    lifecycle: { armMaxDurationTimer: noop, armReserveReleaseTimer: noop, reattachActiveCallByControlId: asyncNoop },
    provisioning,
    outboundGates: [],
    requestTenant: noop,
    requireTenant: noop,
    conversationWatchdog: {},
    ttsStore: {},
    directiveSynth: {},
    voiceRender: { render: noop, turnDirectives: noop, sayInCallVoice: noop, followupTurnDirectives: noop },
    costTruing: {},
    messaging: {},
    consultDelivery: {},
    createPortalRunner: async () => ({
      withClient: async (fn) => fn({ query: async () => ({ rows: [] }) }),
      _pool: null,
    }),
  };
}

async function baue(provisioning) {
  const { log, error } = console;
  console.log = noop;
  console.error = noop;
  config.store.storeBackend = "pg";
  try {
    await buildApp(abhaengigkeiten(provisioning));
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("Zeitplan-App-1: ein Zeitplan in provisioning bekommt die Web-Login-Sweeps und die Session-Aufbewahrung", async () => {
  const plaene = [];
  await baue({
    triggerTenantProvisioning: asyncNoop,
    plane: async (name) => {
      plaene.push(name);
    },
  });
  assert.deepEqual(plaene.sort(), ["cancellation-mail", "contract-end", "did-release", "session-aufbewahrung"]);
});
