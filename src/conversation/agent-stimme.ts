export interface VorlagenTts {
  model_id?: string;
  stability?: number;
  similarity_boost?: number;
  speed?: number;
}

export type StimmEinstellungen = Readonly<{
  stability: number;
  similarity_boost: number;
  speed?: number;
}>;
export type AgentStimme = Readonly<{ model?: string; voiceSettings?: StimmEinstellungen }>;

export function stimmeAusVorlage(tts: VorlagenTts | undefined): AgentStimme {
  if (!tts) return {};
  const { model_id: model, stability, similarity_boost: similarityBoost, speed } = tts;
  return {
    ...(model === undefined ? {} : { model }),
    ...(stability !== undefined && similarityBoost !== undefined
      ? {
          voiceSettings: {
            stability,
            similarity_boost: similarityBoost,
            ...(speed === undefined ? {} : { speed }),
          },
        }
      : {}),
  };
}
