import { VoiceCatalogSchema, type VoiceCatalog, type VoiceCatalogEntry } from "@studynarrator/shared-types";

export const KOKORO_V1_MODEL_ID = "speaches-ai/Kokoro-82M-v1.0-ONNX";
export const KOKORO_VOICE_CATALOG_SOURCE = "https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md";
export const KOKORO_VOICE_CATALOG_ATTRIBUTION = "Kokoro-82M voice identifiers, Apache-2.0, hexgrad/Kokoro-82M.";

const groups = [
  { language: "American English", locale: "en-US", ids: ["af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"] },
  { language: "British English", locale: "en-GB", ids: ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"] },
  { language: "Japanese", locale: "ja-JP", ids: ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"] },
  { language: "Mandarin Chinese", locale: "zh-CN", ids: ["zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"] },
  { language: "Spanish", locale: "es-ES", ids: ["ef_dora", "em_alex", "em_santa"] },
  { language: "French", locale: "fr-FR", ids: ["ff_siwis"] },
  { language: "Hindi", locale: "hi-IN", ids: ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"] },
  { language: "Italian", locale: "it-IT", ids: ["if_sara", "im_nicola"] },
  { language: "Brazilian Portuguese", locale: "pt-BR", ids: ["pf_dora", "pm_alex", "pm_santa"] }
] as const;

function friendlyName(voiceId: string): string {
  const name = voiceId.slice(3).replaceAll("_", " ");
  return name.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

const entries: VoiceCatalogEntry[] = groups.flatMap((group) => group.ids.map((voiceId) => ({
  voiceId,
  label: `${friendlyName(voiceId)} — ${group.language} — ${voiceId}`,
  enabled: true,
  language: group.language,
  locale: group.locale,
  accent: group.language === "American English" ? "American" : group.language === "British English" ? "British" : null,
  category: null,
  style: null,
  sampleText: null
})));

export const KOKORO_V1_VOICE_CATALOG: VoiceCatalog = VoiceCatalogSchema.parse({
  schemaVersion: 1,
  modelId: KOKORO_V1_MODEL_ID,
  entries
});

export const BUNDLED_VOICE_CATALOGS: ReadonlyMap<string, VoiceCatalog> = new Map([
  [KOKORO_V1_MODEL_ID, KOKORO_V1_VOICE_CATALOG]
]);
