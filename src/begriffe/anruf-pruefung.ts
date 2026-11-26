export { E164 } from "./rufnummern.ts";

export const TEXT_LIMITS = {
  objective: 500,
  briefing: 2000,
  constraints: 2000,
  title: 200,
  agentName: 80,
  "context.summary": 1000,
  "context.recipient_relationship": 200,
  "context.desired_outcome": 500,
  "mandate.decide_freely": 1000,
  "mandate.fallback_order": 500,
} as const;

export type TextName = keyof typeof TEXT_LIMITS;
