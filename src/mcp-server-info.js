import { config } from "./config.js";
import { HERMES_ICON_DATA_URI, HERMES_ICON_SIZE } from "./brand-icon-data.js";
import { uiServerExtension } from "./ui/contract.js";
import { NOT_PLACED } from "./telephony/failure-reason.js";

export const BRAND_ASSETS_PREFIX = "/brand/";
const HERMES_ICON_FILENAME = "hermes-icon.png";

export const HERMES_SERVER_INFO = {
  name: "hermes",
  version: "0.2.0",
  websiteUrl: "https://www.sundartha.com",
  icons: [
    {
      src: HERMES_ICON_DATA_URI,
      mimeType: "image/png",
      sizes: [HERMES_ICON_SIZE],
    },
    {
      src: `${config.server.publicUrl}${BRAND_ASSETS_PREFIX}${HERMES_ICON_FILENAME}`,
      mimeType: "image/png",
      sizes: ["1024x1024"],
    },
  ],
};

export const CALL_PURPOSE_EXCLUSIONS = Object.freeze([
  Object.freeze({ full: "telemarketing", short: "telemarketing" }),
  Object.freeze({ full: "unsolicited advertising or sales calls", short: "unsolicited advertising" }),
  Object.freeze({ full: "political campaigning", short: "political campaign calls" }),
  Object.freeze({ full: "mass or automated dialling of many numbers", short: null }),
]);

const LIST_SEPARATOR = ", ";
const LAST_OR_FULL = ", or ";
const LAST_OR_SHORT = " or ";
export function listWithOr(items, lastSeparator) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(LIST_SEPARATOR) + lastSeparator + items.at(-1);
}

export const CALL_PURPOSE_RULE =
  "Place calls only when the user asks for them, for themselves or someone they act for, " +
  "such as booking, rescheduling, enquiring or complaining - not for " +
  listWithOr(
    CALL_PURPOSE_EXCLUSIONS.map((entry) => entry.full),
    LAST_OR_FULL,
  ) +
  ".";

export const CALL_PURPOSE_SHORT_RULE = `Not for ${listWithOr(
  CALL_PURPOSE_EXCLUSIONS.filter((entry) => entry.short !== null).map((entry) => entry.short),
  LAST_OR_SHORT,
)}.`;

const CORE_SEQUENCE =
  "Call prepare_call before every phone call; only the Hermes card places it, after " +
  "the user confirms - never call place_call yourself, never ask the user for or " +
  "invent a confirmation_code.";
const CORE_CONSULT_LOOP =
  'While a call runs, call await_call_event until event="done"; answer a consult at ' +
  'once: answer_consult status="working".';
const CORE_PURPOSE = `Only place calls the user asks for, never ${listWithOr(
  CALL_PURPOSE_EXCLUSIONS.map((entry) => entry.full),
  LAST_OR_FULL,
)}.`;
const CORE_MONEY = `Never retry a "${NOT_PLACED}" call.`;

function instructionsCore(consultLoop) {
  const sentences = consultLoop
    ? [CORE_SEQUENCE, CORE_CONSULT_LOOP, CORE_PURPOSE, CORE_MONEY]
    : [CORE_SEQUENCE, CORE_PURPOSE, CORE_MONEY];
  return sentences.join(" ");
}

const BASE_DETAILS =
  `If a call reports a failure_reason starting with "${NOT_PLACED}", the call could not ` +
  "be placed because of a problem on our side. Do NOT retry the call: call get_call_result " +
  "for that call_id - it works for a failed call, not only a completed one - and tell the " +
  "user what failed, using its result_summary text as it is. " +
  "Never invent facts about the principal or the call: if you do not know something, say so. " +
  "Before every place_call, call prepare_call first with the exact same arguments and let " +
  "the user confirm in the Hermes card; if they confirm, the card places the call itself " +
  "and reports the call_id back in a chat message - do not call place_call for that call " +
  "yourself, and never guess or invent a confirmation code. The confirmation covers every " +
  "argument, briefing and context included: after changing any of them, call " +
  "prepare_call again and let the user confirm again. If this host does not show " +
  "the Hermes card, or card confirmation is switched off for this server, no call can be " +
  "placed from here - tell the user so honestly. " +
  CALL_PURPOSE_RULE;

const CONSULT_BLOCK =
  "While a call placed with place_call is running, keep calling await_call_event with " +
  "that call_id, again and again, until it returns event=\"done\". " +
  "When it returns event=\"consult\", " +
  "the instant a consult arrives, call answer_consult once with status=\"working\" and no " +
  "answers - if that acknowledgement does not arrive within seconds, the server assumes " +
  "nobody can answer and lets the agent move on. Then answer the questions briefly and " +
  "factually with " +
  "answer_consult - answer from your own tools and context first; only ask the user when " +
  "they are actually present right now, and never invent an answer. " +
  "Staying in that loop pays off: the final \"done\" answer carries the summary of the " +
  "call and whether the objective was achieved. " +
  "The agent is on the phone while it waits, so answer within seconds - if you cannot " +
  "find the answer that fast, say with answer_consult that you do not know instead of " +
  "waiting, so the agent can tell the other party that the principal will get back on it.";

export const MCP_BASE_INSTRUCTIONS = `${instructionsCore(false)} ${BASE_DETAILS}`;
export const MCP_CONSULT_INSTRUCTIONS = `${instructionsCore(true)} ${BASE_DETAILS} ${CONSULT_BLOCK}`;

export function mcpServerOptions({ uiEnabled, consultLoop }) {
  const options = {};
  if (uiEnabled) options.capabilities = { extensions: uiServerExtension() };
  options.instructions = consultLoop ? MCP_CONSULT_INSTRUCTIONS : MCP_BASE_INSTRUCTIONS;
  return options;
}
