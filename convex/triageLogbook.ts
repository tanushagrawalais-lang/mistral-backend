import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import schema, {
  frequencyChartDataValidator,
  level1StatusValidator,
  patientDocTypeValidator,
  predictedConditionValidator,
  preferredLangValidator,
  reviewStatusValidator,
  sexValidator,
  staffRoleValidator,
} from "./schema";

const staffProfileDoc = schema.doc("staffProfiles");
const patientDoc = schema.doc("patients");
const screeningDoc = schema.doc("screenings");
const patientDocumentDoc = schema.doc("patientDocuments");

const screeningWithAudioValidator = screeningDoc.extend({
  coughAudioUrl: v.union(v.string(), v.null()),
  speechAudioUrl: v.union(v.string(), v.null()),
});

const documentWithUrlValidator = patientDocumentDoc.extend({
  fileUrl: v.union(v.string(), v.null()),
});

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const authUserId = await getAuthUserId(ctx);
  if (authUserId) {
    return authUserId;
  }
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const rawId = identity.subject.split("|")[0];
    const normalizedId = ctx.db.normalizeId("users", rawId);
    if (normalizedId !== null) {
      return normalizedId;
    }
  }
  throw new Error("Not authenticated");
}

async function staffByUserAndRole(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  role: "nurse" | "primary_doctor" | "city_specialist",
) {
  return await ctx.db
    .query("staffProfiles")
    .withIndex("by_user_role", (q) => q.eq("userId", userId).eq("role", role))
    .unique();
}

async function requireStaffProfile(
  ctx: QueryCtx | MutationCtx,
  preferredRole?: "nurse" | "primary_doctor" | "city_specialist",
) {
  const userId = await requireUserId(ctx);
  if (preferredRole !== undefined) {
    const scoped = await staffByUserAndRole(ctx, userId, preferredRole);
    if (scoped !== null) {
      return scoped;
    }
  }
  const staffRows = await ctx.db
    .query("staffProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(1);
  const staff = staffRows[0];
  if (staff === undefined) {
    throw new Error("Staff profile is required");
  }
  return staff;
}

async function withAudioUrls<T extends {
  coughAudioId?: Id<"_storage">;
  speechAudioId?: Id<"_storage">;
  coughStorageId?: Id<"_storage">;
  speechStorageId?: Id<"_storage">;
}>(
  ctx: QueryCtx,
  screening: T,
): Promise<T & { coughAudioUrl: string | null; speechAudioUrl: string | null }> {
  const coughId = screening.coughAudioId ?? screening.coughStorageId;
  const speechId = screening.speechAudioId ?? screening.speechStorageId;
  const [coughAudioUrl, speechAudioUrl] = await Promise.all([
    coughId !== undefined ? ctx.storage.getUrl(coughId) : Promise.resolve(null),
    speechId !== undefined ? ctx.storage.getUrl(speechId) : Promise.resolve(null),
  ]);
  return { ...screening, coughAudioUrl, speechAudioUrl };
}

export const generateAudioUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const getMyStaffProfile = query({
  args: {
    role: v.optional(staffRoleValidator),
  },
  returns: v.union(staffProfileDoc, v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    if (args.role !== undefined) {
      return await staffByUserAndRole(ctx, userId, args.role);
    }
    const rows = await ctx.db
      .query("staffProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1);
    return rows[0] ?? null;
  },
});

export const upsertStaffProfile = mutation({
  args: {
    role: staffRoleValidator,
    fullName: v.string(),
    facilityName: v.string(),
    hprRegistrationId: v.optional(v.string()),
    district: v.string(),
    phoneNumber: v.optional(v.string()),
  },
  returns: v.id("staffProfiles"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await staffByUserAndRole(ctx, userId, args.role);
    const fields = {
      role: args.role,
      fullName: args.fullName,
      facilityName: args.facilityName,
      district: args.district,
      ...(args.hprRegistrationId !== undefined
        ? { hprRegistrationId: args.hprRegistrationId }
        : {}),
      ...(args.phoneNumber !== undefined ? { phoneNumber: args.phoneNumber } : {}),
    };
    if (existing !== null) {
      await ctx.db.patch("staffProfiles", existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("staffProfiles", {
      userId,
      ...fields,
    });
  },
});

export const searchOrListPatients = query({
  args: { search: v.optional(v.string()) },
  returns: v.array(patientDoc),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const needle = args.search?.trim() ?? "";
    if (needle.length === 0) {
      return await ctx.db.query("patients").order("desc").take(30);
    }
    const lowered = needle.toLowerCase();
    const byCode = await ctx.db
      .query("patients")
      .withIndex("by_patientCode", (q) => q.eq("patientCode", needle))
      .take(10);
    const byPhone = await ctx.db
      .query("patients")
      .withIndex("by_phone", (q) => q.eq("phone", needle))
      .take(10);
    const recent = await ctx.db.query("patients").order("desc").take(100);
    const matched = recent.filter((patient) => {
      const name = patient.fullName?.toLowerCase() ?? "";
      const phone = patient.phone?.toLowerCase() ?? "";
      const code = patient.patientCode?.toLowerCase() ?? "";
      return name.includes(lowered) || phone.includes(lowered) || code.includes(lowered);
    });
    const byId = new Map<string, (typeof recent)[number]>();
    for (const patient of [...byCode, ...byPhone, ...matched]) {
      byId.set(patient._id, patient);
    }
    return [...byId.values()].slice(0, 30);
  },
});

export const createLogbookPatient = mutation({
  args: {
    fullName: v.string(),
    phone: v.optional(v.string()),
    age: v.number(),
    sex: sexValidator,
    village: v.string(),
    preferredLang: preferredLangValidator,
    smokingHistory: v.boolean(),
    chronicConditions: v.optional(v.array(v.string())),
  },
  returns: v.id("patients"),
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.age) || args.age < 1 || args.age > 120) {
      throw new Error("Age must be a whole number from 1 to 120");
    }
    const userId = await requireUserId(ctx);
    const staff = await requireStaffProfile(ctx, "nurse");
    const patientCode = "SV-" + Math.floor(1000 + Math.random() * 9000);
    return await ctx.db.insert("patients", {
      userId,
      age: args.age,
      sex: args.sex,
      preferredLang: args.preferredLang,
      smokingHistory: args.smokingHistory,
      patientCode,
      fullName: args.fullName,
      village: args.village,
      registeredByStaffId: staff._id,
      ...(args.phone !== undefined ? { phone: args.phone } : {}),
      ...(args.chronicConditions !== undefined
        ? { chronicConditions: args.chronicConditions }
        : {}),
    });
  },
});

export const submitTriageScreening = mutation({
  args: {
    patientId: v.id("patients"),
    coughAudioId: v.id("_storage"),
    speechAudioId: v.id("_storage"),
    rawAudioBytes: v.optional(v.number()),
    compressedAudioBytes: v.optional(v.number()),
    compressionRatio: v.optional(v.number()),
    frequencyChartData: v.optional(frequencyChartDataValidator),
    symptomNotes: v.optional(v.string()),
    spo2Percent: v.optional(v.number()),
    respiratoryRate: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
    provisionalMedication: v.optional(v.string()),
    aiClinicalBrief: v.optional(v.string()),
    rawTranscript: v.optional(v.string()),
    translatedEnText: v.optional(v.string()),
    level1Status: v.optional(level1StatusValidator),
    predictedConditions: v.optional(v.array(predictedConditionValidator)),
  },
  returns: v.id("screenings"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const staff = await requireStaffProfile(ctx, "nurse");
    const patient = await ctx.db.get("patients", args.patientId);
    if (patient === null) {
      throw new Error("Patient not found");
    }
    const screeningId = await ctx.db.insert("screenings", {
      userId,
      patientId: args.patientId,
      status: "uploaded",
      reviewStatus: "pending_review",
      coughAudioId: args.coughAudioId,
      speechAudioId: args.speechAudioId,
      coughStorageId: args.coughAudioId,
      speechStorageId: args.speechAudioId,
      submittedByStaffId: staff._id,
      ...(args.rawAudioBytes !== undefined ? { rawAudioBytes: args.rawAudioBytes } : {}),
      ...(args.compressedAudioBytes !== undefined
        ? { compressedAudioBytes: args.compressedAudioBytes }
        : {}),
      ...(args.compressionRatio !== undefined
        ? { compressionRatio: args.compressionRatio }
        : {}),
      ...(args.frequencyChartData !== undefined
        ? { frequencyChartData: args.frequencyChartData }
        : {}),
      ...(args.symptomNotes !== undefined ? { symptomNotes: args.symptomNotes, rawTranscript: args.symptomNotes } : {}),
      ...(args.spo2Percent !== undefined ? { spo2Percent: args.spo2Percent } : {}),
      ...(args.respiratoryRate !== undefined ? { respiratoryRate: args.respiratoryRate } : {}),
      ...(args.temperatureC !== undefined ? { temperatureC: args.temperatureC } : {}),
      ...(args.provisionalMedication !== undefined
        ? { provisionalMedication: args.provisionalMedication }
        : {}),
      ...(args.aiClinicalBrief !== undefined ? { aiClinicalBrief: args.aiClinicalBrief } : {}),
      ...(args.translatedEnText !== undefined ? { translatedEnText: args.translatedEnText } : {}),
      ...(args.level1Status !== undefined ? { level1Status: args.level1Status } : {}),
      ...(args.predictedConditions !== undefined
        ? { predictedConditions: args.predictedConditions }
        : {}),
    });
    await ctx.scheduler.runAfter(0, internal.aiPipeline.processScreening, {
      screeningId,
    });
    return screeningId;
  },
});

export const getPatientLogbook = query({
  args: { patientId: v.id("patients") },
  returns: v.object({
    patient: patientDoc,
    screenings: v.array(screeningWithAudioValidator),
    documents: v.array(documentWithUrlValidator),
  }),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const patient = await ctx.db.get("patients", args.patientId);
    if (patient === null) {
      throw new Error("Patient not found");
    }
    const screeningRows = await ctx.db
      .query("screenings")
      .withIndex("by_user", (q) => q.eq("userId", patient.userId))
      .order("desc")
      .take(100);
    const screenings = await Promise.all(
      screeningRows
        .filter((row) => row.patientId === args.patientId)
        .map((row) => withAudioUrls(ctx, row)),
    );
    const documentRows = await ctx.db
      .query("patientDocuments")
      .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
      .order("desc")
      .take(50);
    const documents = await Promise.all(
      documentRows.map(async (doc) => ({
        ...doc,
        fileUrl: await ctx.storage.getUrl(doc.fileId),
      })),
    );
    return { patient, screenings, documents };
  },
});

export const attachPatientDocument = mutation({
  args: {
    patientId: v.id("patients"),
    screeningId: v.optional(v.id("screenings")),
    fileId: v.id("_storage"),
    fileName: v.string(),
    docType: patientDocTypeValidator,
    notes: v.optional(v.string()),
  },
  returns: v.id("patientDocuments"),
  handler: async (ctx, args) => {
    const staff = await requireStaffProfile(ctx, "nurse");
    const patient = await ctx.db.get("patients", args.patientId);
    if (patient === null) {
      throw new Error("Patient not found");
    }
    if (args.screeningId !== undefined) {
      const screening = await ctx.db.get("screenings", args.screeningId);
      if (screening === null || screening.patientId !== args.patientId) {
        throw new Error("Screening not found");
      }
    }
    return await ctx.db.insert("patientDocuments", {
      patientId: args.patientId,
      fileId: args.fileId,
      fileName: args.fileName,
      docType: args.docType,
      uploadedByStaffId: staff._id,
      uploadedAt: Date.now(),
      ...(args.screeningId !== undefined ? { screeningId: args.screeningId } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
  },
});

export const getSpecialistTriageQueue = query({
  args: {
    statusFilter: v.optional(reviewStatusValidator),
  },
  returns: v.array(
    v.object({
      screening: screeningWithAudioValidator,
      patient: patientDoc,
    }),
  ),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const rows =
      args.statusFilter !== undefined
        ? await ctx.db
            .query("screenings")
            .withIndex("by_reviewStatus", (q) =>
              q.eq("reviewStatus", args.statusFilter),
            )
            .order("desc")
            .take(100)
        : await ctx.db.query("screenings").order("desc").take(100);
    const joined = [];
    for (const row of rows) {
      const patient = await ctx.db.get("patients", row.patientId);
      if (patient === null) {
        continue;
      }
      joined.push({
        screening: await withAudioUrls(ctx, row),
        patient,
      });
    }
    joined.sort((a, b) => {
      const aFlag = a.screening.physicalReferralFlag === true ? 1 : 0;
      const bFlag = b.screening.physicalReferralFlag === true ? 1 : 0;
      if (aFlag !== bFlag) {
        return bFlag - aFlag;
      }
      return (b.screening.riskScore ?? -1) - (a.screening.riskScore ?? -1);
    });
    return joined;
  },
});

export const submitSpecialistReview = mutation({
  args: {
    screeningId: v.id("screenings"),
    specialistRemarks: v.string(),
    physicalReferralFlag: v.boolean(),
    referralInstructions: v.optional(v.string()),
    provisionalMedication: v.optional(v.string()),
    medicationApproved: v.optional(v.boolean()),
    approvedMedication: v.optional(v.string()),
    reviewedByName: v.optional(v.string()),
    reviewedByPhone: v.optional(v.string()),
    reviewedByFacility: v.optional(v.string()),
    reviewedByDistrict: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaffProfile(ctx, "city_specialist");
    const screening = await ctx.db.get("screenings", args.screeningId);
    if (screening === null) {
      throw new Error("Screening not found");
    }
    await ctx.db.patch("screenings", args.screeningId, {
      specialistRemarks: args.specialistRemarks,
      physicalReferralFlag: args.physicalReferralFlag,
      reviewedBySpecialistId: staff._id,
      reviewStatus: args.physicalReferralFlag ? "physical_referral" : "reviewed",
      ...(args.referralInstructions !== undefined
        ? { referralInstructions: args.referralInstructions }
        : {}),
      ...(args.provisionalMedication !== undefined
        ? { provisionalMedication: args.provisionalMedication }
        : {}),
      ...(args.medicationApproved !== undefined
        ? { medicationApproved: args.medicationApproved }
        : {}),
      ...(args.approvedMedication !== undefined
        ? { approvedMedication: args.approvedMedication }
        : {}),
      reviewedByName: args.reviewedByName ?? staff.fullName,
      reviewedByFacility: args.reviewedByFacility ?? staff.facilityName,
      reviewedByDistrict: args.reviewedByDistrict ?? staff.district,
      ...(args.reviewedByPhone !== undefined
        ? { reviewedByPhone: args.reviewedByPhone }
        : staff.phoneNumber !== undefined
          ? { reviewedByPhone: staff.phoneNumber }
          : {}),
    });
    return null;
  },
});
