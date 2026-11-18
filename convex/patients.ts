import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import schema, {
  preferredLangValidator,
  sexValidator,
} from "./schema";
import { mutation, query } from "./_generated/server";

const patientDoc = schema.doc("patients");

async function requireUserId(ctx: {
  auth: Parameters<typeof getAuthUserId>[0]["auth"];
  runQuery: Parameters<typeof getAuthUserId>[0]["runQuery"];
}) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId;
}

export const getMyPatient = query({
  args: {},
  returns: v.union(patientDoc, v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    return await ctx.db
      .query("patients")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const upsertPatient = mutation({
  args: {
    age: v.number(),
    sex: sexValidator,
    preferredLang: preferredLangValidator,
    smokingHistory: v.boolean(),
  },
  returns: v.id("patients"),
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.age) || args.age < 1 || args.age > 120) {
      throw new Error("Age must be a whole number from 1 to 120");
    }
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("patients")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch("patients", existing._id, {
        age: args.age,
        sex: args.sex,
        preferredLang: args.preferredLang,
        smokingHistory: args.smokingHistory,
      });
      return existing._id;
    }
    return await ctx.db.insert("patients", {
      userId,
      age: args.age,
      sex: args.sex,
      preferredLang: args.preferredLang,
      smokingHistory: args.smokingHistory,
    });
  },
});
