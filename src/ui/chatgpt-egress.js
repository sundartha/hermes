import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BlockList, isIP } from "node:net";

const RANGES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "chatgpt-egress-ranges.json",
);

const FAMILY_IPV6 = 6;
const IPV4_MAX_PREFIX = 32;
const IPV6_MAX_PREFIX = 128;

function cidrOf(entry) {
  const value = entry?.ipv4Prefix ?? entry?.ipv6Prefix;
  return typeof value === "string" ? value : null;
}

function parseCidr(cidr) {
  const slashIndex = cidr.indexOf("/");
  if (slashIndex < 0) return null;
  const address = cidr.slice(0, slashIndex);
  const family = isIP(address);
  if (!family) return null;
  const prefix = Number(cidr.slice(slashIndex + 1));
  const maxPrefix = family === FAMILY_IPV6 ? IPV6_MAX_PREFIX : IPV4_MAX_PREFIX;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;
  return { address, prefix, family };
}

function addPrefixEntry(list, entry) {
  const cidr = cidrOf(entry);
  if (!cidr) return;
  const parsed = parseCidr(cidr);
  if (!parsed) return;
  try {
    list.addSubnet(parsed.address, parsed.prefix, parsed.family === FAMILY_IPV6 ? "ipv6" : "ipv4");
  } catch {
  }
}

function buildBlockList() {
  const list = new BlockList();
  try {
    const raw = readFileSync(RANGES_PATH, "utf8");
    const data = JSON.parse(raw);
    const prefixes = Array.isArray(data?.prefixes) ? data.prefixes : [];
    for (const entry of prefixes) addPrefixEntry(list, entry);
  } catch {
  }
  return list;
}

const chatgptEgressList = buildBlockList();

export function isChatGptEgressIp(ip) {
  if (typeof ip !== "string" || !ip) return false;
  const family = isIP(ip);
  if (!family) return false;
  try {
    return chatgptEgressList.check(ip, family === FAMILY_IPV6 ? "ipv6" : "ipv4");
  } catch {
    return false;
  }
}
