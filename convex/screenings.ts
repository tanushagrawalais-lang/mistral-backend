import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import schema, { audioChannelValidator } from "./schema";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

const screeningDoc = schema.doc("screenings");

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId;
}

export const getMyScreenings = query({
  args: {},
  returns: v.array(screeningDoc),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    return await ctx.db
      .query("screenings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const getScreening = query({
  args: { screeningId: v.id("screenings") },
  returns: v.union(screeningDoc, v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const screening = await ctx.db.get("screenings", args.screeningId);
    if (screening === null || screening.userId !== userId) {
      return null;
    }
    return screening;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createScreening = mutation({
  args: {},
  returns: v.id("screenings"),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const patient = await ctx.db
      .query("patients")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (patient === null) {
      throw new Error("Patient profile is required before screening");
    }
    return await ctx.db.insert("screenings", {
      userId,
      patientId: patient._id,
      status: "recording",
    });
  },
});

export const attachAudio = mutation({
  args: {
    screeningId: v.id("screenings"),
    channel: audioChannelValidator,
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const screening = await ctx.db.get("screenings", args.screeningId);
    if (screening === null || screening.userId !== userId) {
      throw new Error("Screening not found");
    }
    const coughAudioId =
      args.channel === "cough" ? args.storageId : screening.coughAudioId;
    const speechAudioId =
      args.channel === "speech" ? args.storageId : screening.speechAudioId;
    const bothPresent =
      coughAudioId !== undefined && speechAudioId !== undefined;
    const canMarkUploaded =
      screening.status === "recording" || screening.status === "uploaded";
    await ctx.db.patch("screenings", screening._id, {
      ...(args.channel === "cough"
        ? { coughAudioId: args.storageId, coughStorageId: args.storageId }
        : { speechAudioId: args.storageId, speechStorageId: args.storageId }),
      status: bothPresent && canMarkUploaded ? "uploaded" : screening.status,
    });
    return null;
  },
});

export const triggerAnalysis = mutation({
  args: { screeningId: v.id("screenings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const screening = await ctx.db.get("screenings", args.screeningId);
    if (screening === null || screening.userId !== userId) {
      throw new Error("Screening not found");
    }
    const coughAudioId = screening.coughAudioId ?? screening.coughStorageId;
    const speechAudioId = screening.speechAudioId ?? screening.speechStorageId;
    if (coughAudioId === undefined || speechAudioId === undefined) {
      throw new Error("Both coughAudioId and speechAudioId are required");
    }
    await ctx.scheduler.runAfter(0, internal.aiPipeline.processScreening, {
      screeningId: args.screeningId,
    });
    return null;
  },
});
