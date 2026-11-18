import { v } from "convex/values";
import schema, {
  level1StatusValidator,
  predictedConditionValidator,
} from "./schema";
import { internalMutation, internalQuery } from "./_generated/server";

const screeningDoc = schema.doc("screenings");
const patientDoc = schema.doc("patients");

export const getScreeningWithPatient = internalQuery({
  args: { screeningId: v.id("screenings") },
  returns: v.union(
    v.object({
      screening: screeningDoc,
      patient: patientDoc,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const screening = await ctx.db.get("screenings", args.screeningId);
    if (screening === null) {
      return null;
    }
    const patient = await ctx.db.get("patients", screening.patientId);
    if (patient === null) {
      return null;
    }
    return { screening, patient };
  },
});

export const markProcessing = internalMutation({
  args: { screeningId: v.id("screenings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("screenings", args.screeningId, { status: "processing" });
    return null;
  },
});

export const saveScreeningResults = internalMutation({
  args: {
    screeningId: v.id("screenings"),
    rawTranscript: v.string(),
    translatedEnText: v.string(),
    riskScore: v.number(),
    predictedConditions: v.array(predictedConditionValidator),
    level1Status: level1StatusValidator,
    aiClinicalBrief: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("screenings", args.screeningId, {
      rawTranscript: args.rawTranscript,
      translatedEnText: args.translatedEnText,
      riskScore: args.riskScore,
      predictedConditions: args.predictedConditions,
      level1Status: args.level1Status,
      aiClinicalBrief: args.aiClinicalBrief,
      status: "completed",
    });
    return null;
  },
});

export const markScreeningFailed = internalMutation({
  args: {
    screeningId: v.id("screenings"),
    errorReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("screenings", args.screeningId, {
      status: "failed",
      ...(args.errorReason !== undefined ? { errorReason: args.errorReason } : {}),
    });
    return null;
  },
});
