"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type AcousticHit = { label: string; score: number };
type PredictedCondition = { label: string; confidence: number };

export const processScreening = internalAction({
  args: { screeningId: v.id("screenings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.screeningInternal.markProcessing, {
        screeningId: args.screeningId,
      });
      const joined: {
        screening: {
          coughAudioId?: Id<"_storage">;
          speechAudioId?: Id<"_storage">;
          coughStorageId?: Id<"_storage">;
          speechStorageId?: Id<"_storage">;
        };
        patient: {
          preferredLang: "hi" | "en" | "ta" | "te" | "bn" | "mr" | "kn";
          age: number;
          smokingHistory: boolean;
        };
      } | null = await ctx.runQuery(
        internal.screeningInternal.getScreeningWithPatient,
        { screeningId: args.screeningId },
      );
      if (joined === null) {
        throw new Error("Screening or patient not found");
      }
      const coughAudioId =
        joined.screening.coughAudioId ?? joined.screening.coughStorageId;
      const speechAudioId =
        joined.screening.speechAudioId ?? joined.screening.speechStorageId;
      if (coughAudioId === undefined || speechAudioId === undefined) {
        throw new Error("Both cough and speech audio are required");
      }
      const coughUrl = await ctx.storage.getUrl(coughAudioId);
      const speechUrl = await ctx.storage.getUrl(speechAudioId);
      if (coughUrl === null || speechUrl === null) {
        throw new Error("Could not create signed audio URLs");
      }
      const [coughAudio, speechAudio] = await Promise.all([
        fetchBinary(coughUrl),
        fetchBinary(speechUrl),
      ]);

      const { rawTranscript, translatedEnText } = await transcribeSpeech(
        speechAudio.data,
        speechAudio.contentType,
        joined.patient.preferredLang,
      );
      const acoustic = await inferCoughAcoustics(
        coughAudio.data,
        coughAudio.contentType,
      );
      const { riskScore, predictedConditions } = scoreTriage({
        acoustic,
        translatedEnText,
        age: joined.patient.age,
        smokingHistory: joined.patient.smokingHistory,
      });
      const level1Status =
        riskScore >= 70 ? "urgent" : riskScore >= 35 ? "monitor" : "normal";
      const aiClinicalBrief = await generateAiClinicalBrief({
        level1Status,
        riskScore,
        acoustic,
        translatedEnText,
        predictedConditions,
        age: joined.patient.age,
        smokingHistory: joined.patient.smokingHistory,
      });

      await ctx.runMutation(internal.screeningInternal.saveScreeningResults, {
        screeningId: args.screeningId,
        rawTranscript,
        translatedEnText,
        riskScore,
        predictedConditions,
        level1Status,
        aiClinicalBrief,
      });
    } catch (err) {
      console.error("processScreening error:", err);
      await ctx.runMutation(internal.screeningInternal.markScreeningFailed, {
        screeningId: args.screeningId,
        errorReason: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  },
});

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  let response = await fetch(url, init);
  for (let remaining = retries; remaining > 0; remaining -= 1) {
    if (response.status !== 503 && response.status !== 429) {
      return response;
    }
    const delayMs = await retryDelayMs(response);
    await sleep(delayMs);
    response = await fetch(url, init);
  }
  return response;
}

async function retryDelayMs(response: Response): Promise<number> {
  try {
    const payload: unknown = await response.clone().json();
    if (isRecord(payload) && typeof payload.estimated_time === "number") {
      const estimatedMs =
        payload.estimated_time <= 60
          ? payload.estimated_time * 1000
          : payload.estimated_time;
      return Math.min(estimatedMs, 6000);
    }
  } catch {
    // Use the default delay when the body is not JSON.
  }
  return 2500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchBinary(
  url: string,
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Audio download failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "audio/webm";
  return { data: await response.arrayBuffer(), contentType };
}

async function transcribeSpeech(
  speechAudio: ArrayBuffer,
  contentType: string,
  preferredLang: "hi" | "en" | "ta" | "te" | "bn" | "mr" | "kn",
): Promise<{ rawTranscript: string; translatedEnText: string }> {
  if (hasXaiKey()) {
    const rawTranscript = await grokTranscribe(
      speechAudio,
      contentType,
      preferredLang,
    );
    if (preferredLang !== "en" && !hasBhashiniCredentials()) {
      const translatedEnText = await grokTranslateToEnglish(rawTranscript);
      return { rawTranscript, translatedEnText };
    }
    return { rawTranscript, translatedEnText: rawTranscript };
  }
  if (preferredLang === "en" || !hasBhashiniCredentials()) {
    const text = await whisperTranscribe(speechAudio, contentType);
    return { rawTranscript: text, translatedEnText: text };
  }
  return bhashiniAsrAndTranslate(speechAudio, preferredLang);
}

function hasXaiKey(): boolean {
  const key = process.env.XAI_API_KEY;
  return key !== undefined && key.length > 0;
}

function hasBhashiniCredentials(): boolean {
  const userId = process.env.BHASHINI_USER_ID;
  const ulcaApiKey = process.env.BHASHINI_ULCA_API_KEY;
  return (
    userId !== undefined &&
    userId.length > 0 &&
    ulcaApiKey !== undefined &&
    ulcaApiKey.length > 0
  );
}

function audioFilename(contentType: string): string {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "audio/webm";
  if (mime.includes("mpeg") || mime.endsWith("/mp3")) {
    return "speech.mp3";
  }
  if (mime.includes("wav")) {
    return "speech.wav";
  }
  if (mime.includes("mp4") || mime.includes("m4a")) {
    return "speech.m4a";
  }
  if (mime.includes("ogg")) {
    return "speech.ogg";
  }
  return "speech.webm";
}

async function grokTranscribe(
  speechBuffer: ArrayBuffer,
  speechMimeType: string,
  preferredLang: "hi" | "en" | "ta" | "te" | "bn" | "mr" | "kn",
): Promise<string> {
  const form = new FormData();
  form.append("model", "grok-voice-transcribe-2.0");
  form.append("vad_threshold", "0.1");
  form.append("language", preferredLang);
  form.append(
    "file",
    new Blob([speechBuffer], { type: speechMimeType }),
    audioFilename(speechMimeType),
  );
  const response = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`xAI STT failed (${response.status})`);
  }
  const payload: unknown = await response.json();
  const text =
    isRecord(payload) && typeof payload.text === "string" ? payload.text.trim() : "";
  return text.length > 0 ? text : "[No speech detected]";
}

async function grokTranslateToEnglish(rawTranscript: string): Promise<string> {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast-non-reasoning",
      messages: [
        {
          role: "system",
          content:
            "Translate the following patient medical symptom transcript accurately into English. Output ONLY the English translation.",
        },
        { role: "user", content: rawTranscript },
      ],
      temperature: 0,
    }),
  });
  if (!response.ok) {
    throw new Error(`xAI translation failed (${response.status})`);
  }
  const payload: unknown = await response.json();
  const translated = extractChatContent(payload);
  return translated.length > 0 ? translated : rawTranscript;
}

async function generateAiClinicalBrief(input: {
  level1Status: "normal" | "monitor" | "urgent";
  riskScore: number;
  acoustic: AcousticHit[];
  translatedEnText: string;
  predictedConditions: PredictedCondition[];
  age: number;
  smokingHistory: boolean;
}): Promise<string> {
  const fallback = templateClinicalBrief(input);
  if (!hasXaiKey()) {
    return fallback;
  }
  try {
    const markers = input.acoustic
      .slice(0, 5)
      .map((hit) => `${hit.label} ${hit.score.toFixed(2)}`)
      .join(", ");
    const conditions = input.predictedConditions
      .slice(0, 3)
      .map((item) => item.label)
      .join(", ");
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-non-reasoning",
        messages: [
          {
            role: "system",
            content:
              "Write a concise 2-sentence clinical triage note. Sentence 1: acoustic markers and translated symptoms. Sentence 2: recommended next test. Output ONLY the two sentences.",
          },
          {
            role: "user",
            content: `Level-1 ${input.level1Status} (risk ${input.riskScore}/100). Age ${input.age}, smokingHistory=${input.smokingHistory}. Acoustic markers: ${markers || "none"}. Symptoms: ${input.translatedEnText}. Predicted: ${conditions || "none"}.`,
          },
        ],
        temperature: 0,
      }),
    });
    if (!response.ok) {
      return fallback;
    }
    const brief = extractChatContent(await response.json());
    return brief.length > 0 ? brief : fallback;
  } catch {
    return fallback;
  }
}

function templateClinicalBrief(input: {
  level1Status: "normal" | "monitor" | "urgent";
  riskScore: number;
  acoustic: AcousticHit[];
  translatedEnText: string;
  age: number;
  smokingHistory: boolean;
}): string {
  const topMarkers = input.acoustic
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((hit) => hit.label)
    .join(", ");
  const nextTest =
    input.level1Status === "urgent"
      ? "Obtain a chest X-ray and sputum AFB/NAAT now."
      : input.level1Status === "monitor"
        ? "Arrange follow-up pulse oximetry and spirometry within 72 hours."
        : "Continue routine observation and repeat screening if symptoms worsen.";
  const symptoms =
    input.translatedEnText.trim().length > 0
      ? input.translatedEnText.trim()
      : "no speech symptoms captured";
  return `Level-1 ${input.level1Status} (risk ${input.riskScore}/100) with acoustic markers ${topMarkers || "limited"} in a ${input.age}-year-old ${input.smokingHistory ? "with" : "without"} smoking history; symptoms: ${symptoms}. ${nextTest}`;
}

function extractChatContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return "";
  }
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return "";
  }
  return typeof choice.message.content === "string" ? choice.message.content.trim() : "";
}

async function huggingfaceAudioPost(
  url: string,
  audio: ArrayBuffer,
  contentType: string,
): Promise<unknown> {
  requiredEnv("HF_API_TOKEN");
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
      "Content-Type": contentType,
    },
    body: audio,
  });
  if (!response.ok) {
    throw new Error(`Hugging Face inference failed (${response.status})`);
  }
  return await response.json();
}

async function whisperTranscribe(
  speechAudio: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const payload = await huggingfaceAudioPost(
    "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo",
    speechAudio,
    contentType,
  );
  const text = extractWhisperText(payload);
  if (text.length === 0) {
    throw new Error("Whisper returned an empty transcript");
  }
  return text;
}

async function bhashiniAsrAndTranslate(
  speechAudio: ArrayBuffer,
  sourceLanguage: "hi" | "ta" | "te" | "bn" | "mr" | "kn",
): Promise<{ rawTranscript: string; translatedEnText: string }> {
  const configResponse = await fetch(
    "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline",
    {
      method: "POST",
      headers: {
        userID: process.env.BHASHINI_USER_ID!,
        ulcaApiKey: process.env.BHASHINI_ULCA_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: "asr",
            config: { language: { sourceLanguage } },
          },
          {
            taskType: "translation",
            config: {
              language: { sourceLanguage, targetLanguage: "en" },
            },
          },
        ],
        pipelineRequestConfig: { pipelineId: "64392f96daac500b55c543cd" },
      }),
    },
  );
  if (!configResponse.ok) {
    throw new Error(`Bhashini pipeline config failed (${configResponse.status})`);
  }
  const pipelineConfig: unknown = await configResponse.json();
  const { callbackUrl, inferenceApiKey, asrServiceId, translationServiceId } =
    extractUlcaPipeline(pipelineConfig, sourceLanguage);

  const computeResponse = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      [inferenceApiKey.name]: inferenceApiKey.value,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pipelineTasks: [
        {
          taskType: "asr",
          config: {
            language: { sourceLanguage },
            serviceId: asrServiceId,
            audioFormat: "webm",
            samplingRate: 16000,
          },
        },
        {
          taskType: "translation",
          config: {
            language: { sourceLanguage, targetLanguage: "en" },
            serviceId: translationServiceId,
          },
        },
      ],
      inputData: {
        audio: [{ audioContent: Buffer.from(speechAudio).toString("base64") }],
      },
    }),
  });
  if (!computeResponse.ok) {
    throw new Error(`Bhashini inference failed (${computeResponse.status})`);
  }
  const payload: unknown = await computeResponse.json();
  const rawTranscript = extractBhashiniText(payload, "asr");
  const translatedEnText =
    extractBhashiniText(payload, "translation") || rawTranscript;
  if (rawTranscript.length === 0) {
    throw new Error("Bhashini returned an empty transcript");
  }
  return { rawTranscript, translatedEnText };
}

const ACOUSTIC_FALLBACK: AcousticHit[] = [
  { label: "wheeze", score: 0.15 },
  { label: "crackle", score: 0.1 },
  { label: "cough", score: 0.25 },
];

async function inferCoughAcoustics(
  coughAudio: ArrayBuffer,
  contentType: string,
): Promise<AcousticHit[]> {
  const token = process.env.HF_API_TOKEN;
  if (token === undefined || token.length === 0) {
    console.warn("HF_API_TOKEN missing; using acoustic fallback");
    return ACOUSTIC_FALLBACK;
  }
  try {
    const modelUrl =
      process.env.HF_COUGH_MODEL_URL ??
      "https://router.huggingface.co/hf-inference/models/MIT/ast-finetuned-audioset-10-10-0.4593";
    const response = await fetchWithRetry(modelUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
        "Content-Type": contentType,
      },
      body: coughAudio,
    });
    if (
      response.status === 402 ||
      response.status === 429 ||
      response.status === 503
    ) {
      console.warn(
        `Hugging Face acoustic inference unavailable (${response.status}); using fallback`,
      );
      return ACOUSTIC_FALLBACK;
    }
    if (!response.ok) {
      console.warn(
        `Hugging Face acoustic inference unavailable (${response.status}); using fallback`,
      );
      return ACOUSTIC_FALLBACK;
    }
    return normalizeAcousticHits(await response.json());
  } catch (err) {
    console.warn("Hugging Face acoustic inference failed; using fallback", err);
    return ACOUSTIC_FALLBACK;
  }
}

function extractUlcaPipeline(
  payload: unknown,
  sourceLanguage: string,
): {
  callbackUrl: string;
  inferenceApiKey: { name: string; value: string };
  asrServiceId: string;
  translationServiceId: string;
} {
  const endpoint = isRecord(payload)
    ? (isRecord(payload.pipelineInferenceAPIEndPoint)
        ? payload.pipelineInferenceAPIEndPoint
        : isRecord(payload.pipelineInferenceEndPoint)
          ? payload.pipelineInferenceEndPoint
          : null)
    : null;
  const callbackFromEndpoint =
    endpoint !== null && typeof endpoint.callbackUrl === "string"
      ? endpoint.callbackUrl
      : null;
  const keyFromEndpoint =
    endpoint !== null && isRecord(endpoint.inferenceApiKey)
      ? endpoint.inferenceApiKey
      : isRecord(payload) && isRecord(payload.inferenceApiKey)
        ? payload.inferenceApiKey
        : null;

  const configs = isRecord(payload) ? payload.pipelineResponseConfig : undefined;
  const configRows = Array.isArray(configs) ? configs : [];
  const asrServiceId = extractServiceId(configRows, "asr", sourceLanguage);
  const translationServiceId = extractServiceId(
    configRows,
    "translation",
    sourceLanguage,
  );
  const name =
    keyFromEndpoint !== null && typeof keyFromEndpoint.name === "string"
      ? keyFromEndpoint.name
      : null;
  const value =
    keyFromEndpoint !== null && typeof keyFromEndpoint.value === "string"
      ? keyFromEndpoint.value
      : null;
  if (asrServiceId === null || translationServiceId === null || name === null || value === null) {
    throw new Error("Bhashini pipeline config was missing inference credentials");
  }
  return {
    callbackUrl:
      callbackFromEndpoint ??
      "https://dhruva-api.bhashini.gov.in/services/inference/pipeline",
    inferenceApiKey: { name, value },
    asrServiceId,
    translationServiceId,
  };
}

function extractServiceId(
  configRows: unknown[],
  taskType: "asr" | "translation",
  sourceLanguage: string,
): string | null {
  for (const row of configRows) {
    if (!isRecord(row) || row.taskType !== taskType || !Array.isArray(row.config)) {
      continue;
    }
    let fallback: string | null = null;
    for (const item of row.config) {
      if (!isRecord(item) || typeof item.serviceId !== "string") {
        continue;
      }
      fallback = fallback ?? item.serviceId;
      const language = isRecord(item.language) ? item.language : null;
      const source =
        language !== null && typeof language.sourceLanguage === "string"
          ? language.sourceLanguage
          : null;
      const target =
        language !== null && typeof language.targetLanguage === "string"
          ? language.targetLanguage
          : null;
      if (source === sourceLanguage && (taskType === "asr" || target === "en")) {
        return item.serviceId;
      }
    }
    if (fallback !== null) {
      return fallback;
    }
  }
  return null;
}

function scoreTriage(input: {
  acoustic: AcousticHit[];
  translatedEnText: string;
  age: number;
  smokingHistory: boolean;
}): { riskScore: number; predictedConditions: PredictedCondition[] } {
  const text = input.translatedEnText.toLowerCase();
  const coughScore = labelScore(input.acoustic, ["cough", "throat clearing"]);
  const breathingScore = labelScore(input.acoustic, [
    "breathing",
    "wheeze",
    "gasp",
    "snoring",
    "pant",
  ]);
  const keywordHits = [
    { label: "Acute cough", terms: ["cough", "sputum", "phlegm"], weight: 12 },
    { label: "Dyspnea", terms: ["breath", "shortness", "wheeze", "gasp"], weight: 16 },
    { label: "Chest infection", terms: ["fever", "chest", "infection", "pneumonia"], weight: 18 },
    { label: "Possible TB", terms: ["blood", "tb", "tuberculosis", "night sweats"], weight: 22 },
    { label: "Chronic airway disease", terms: ["asthma", "copd", "chronic"], weight: 14 },
  ];

  let risk = 8 + coughScore * 38 + breathingScore * 22;
  if (input.smokingHistory) {
    risk += 12;
  }
  if (input.age >= 60) {
    risk += 10;
  } else if (input.age >= 40) {
    risk += 5;
  }

  const predictedConditions: PredictedCondition[] = [];
  for (const hit of keywordHits) {
    if (hit.terms.some((term) => text.includes(term))) {
      risk += hit.weight;
      predictedConditions.push({
        label: hit.label,
        confidence: clamp01(0.35 + hit.weight / 40 + coughScore * 0.2),
      });
    }
  }
  if (coughScore >= 0.25) {
    predictedConditions.push({
      label: "Pathological cough signature",
      confidence: clamp01(coughScore),
    });
  }
  if (breathingScore >= 0.2) {
    predictedConditions.push({
      label: "Abnormal respiratory acoustics",
      confidence: clamp01(breathingScore),
    });
  }
  if (predictedConditions.length === 0) {
    predictedConditions.push({
      label: "Low-likelihood respiratory finding",
      confidence: clamp01(0.15 + coughScore),
    });
  }

  predictedConditions.sort((a, b) => b.confidence - a.confidence);
  return {
    riskScore: Math.round(clamp(risk, 0, 100)),
    predictedConditions: predictedConditions.slice(0, 5),
  };
}

function labelScore(hits: AcousticHit[], needles: string[]): number {
  let best = 0;
  for (const hit of hits) {
    const label = hit.label.toLowerCase();
    if (needles.some((needle) => label.includes(needle))) {
      best = Math.max(best, hit.score);
    }
  }
  return clamp01(best);
}

function normalizeAcousticHits(payload: unknown): AcousticHit[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.labels)
      ? payload.labels
      : [];
  const hits: AcousticHit[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const label = typeof row.label === "string" ? row.label : null;
    const score =
      typeof row.score === "number"
        ? row.score
        : typeof row.confidence === "number"
          ? row.confidence
          : null;
    if (label !== null && score !== null) {
      hits.push({ label, score });
    }
  }
  return hits;
}

function extractWhisperText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.trim();
  }
  if (isRecord(payload) && typeof payload.text === "string") {
    return payload.text.trim();
  }
  return "";
}

function extractBhashiniText(payload: unknown, taskType: "asr" | "translation"): string {
  if (!isRecord(payload)) {
    return "";
  }
  const pipeline = payload.pipelineResponse;
  if (!Array.isArray(pipeline)) {
    return "";
  }
  for (const task of pipeline) {
    if (!isRecord(task) || task.taskType !== taskType) {
      continue;
    }
    const output = task.output;
    if (!Array.isArray(output) || output.length === 0 || !isRecord(output[0])) {
      continue;
    }
    const source = output[0].source;
    const target = output[0].target;
    if (taskType === "translation" && typeof target === "string") {
      return target.trim();
    }
    if (typeof source === "string") {
      return source.trim();
    }
  }
  return "";
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
