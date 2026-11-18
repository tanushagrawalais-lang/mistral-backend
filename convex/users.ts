import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const createUserGoogle = internalMutation({
  args: {
    method: v.object({
      name: v.literal("google"),
      profile: v.object({
        id: v.string(),
        email: v.optional(v.string()),
        emailVerified: v.boolean(),
        name: v.optional(v.string()),
        picture: v.optional(v.string()),
      }),
    }),
  },
  returns: v.id("users"),
  handler: async (ctx) => {
    return await ctx.db.insert("users", {});
  },
});
