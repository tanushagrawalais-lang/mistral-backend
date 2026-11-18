import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const sexValidator = v.union(
  v.literal("M"),
  v.literal("F"),
  v.literal("O"),
);

export const preferredLangValidator = v.union(
  v.literal("hi"),
  v.literal("en"),
  v.literal("ta"),
  v.literal("te"),
  v.literal("bn"),
  v.literal("mr"),
  v.literal("kn"),
);

export const screeningStatusValidator = v.union(
  v.literal("recording"),
  v.literal("uploaded"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
);

export const audioChannelValidator = v.union(
  v.literal("cough"),
  v.literal("speech"),
);

export const predictedConditionValidator = v.object({
  label: v.string(),
  confidence: v.number(),
});

export const transcriptValidator = v.object({
  channel: audioChannelValidator,
  text: v.string(),
});

export const staffRoleValidator = v.union(
  v.literal("nurse"),
  v.literal("primary_doctor"),
  v.literal("city_specialist"),
);

export const level1StatusValidator = v.union(
  v.literal("normal"),
  v.literal("monitor"),
  v.literal("urgent"),
);

export const reviewStatusValidator = v.union(
  v.literal("pending_review"),
  v.literal("reviewed"),
  v.literal("physical_referral"),
);

export const frequencyChartDataValidator = v.object({
  fftBins: v.array(v.number()),
  fundamentalFreqHz: v.number(),
  spectralCentroidHz: v.number(),
  zeroCrossingRate: v.number(),
  peakRmsEnergy: v.number(),
});

export const patientDocTypeValidator = v.union(
  v.literal("xray"),
  v.literal("lab_report"),
  v.literal("primary_rx"),
  v.literal("other"),
);

export default defineSchema({
  users: defineTable({}),
  staffProfiles: defineTable({
    userId: v.id("users"),
    role: staffRoleValidator,
    fullName: v.string(),
    facilityName: v.string(),
    hprRegistrationId: v.optional(v.string()),
    district: v.string(),
    phoneNumber: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_user_role", ["userId", "role"])
    .index("by_district", ["district"]),
  patients: defineTable({
    userId: v.id("users"),
    age: v.number(),
    sex: sexValidator,
    preferredLang: preferredLangValidator,
    smokingHistory: v.boolean(),
    patientCode: v.optional(v.string()),
    fullName: v.optional(v.string()),
    phone: v.optional(v.string()),
    village: v.optional(v.string()),
    chronicConditions: v.optional(v.array(v.string())),
    registeredByStaffId: v.optional(v.id("staffProfiles")),
  })
    .index("by_user", ["userId"])
    .index("by_patientCode", ["patientCode"])
    .index("by_phone", ["phone"]),
  screenings: defineTable({
    userId: v.id("users"),
    patientId: v.id("patients"),
    status: screeningStatusValidator,
    coughAudioId: v.optional(v.id("_storage")),
    speechAudioId: v.optional(v.id("_storage")),
    coughStorageId: v.optional(v.id("_storage")),
    speechStorageId: v.optional(v.id("_storage")),
    rawTranscript: v.optional(v.string()),
    translatedEnText: v.optional(v.string()),
    riskScore: v.optional(v.number()),
    predictedConditions: v.optional(v.array(predictedConditionValidator)),
    transcripts: v.optional(v.array(transcriptValidator)),
    errorReason: v.optional(v.string()),
    submittedByStaffId: v.optional(v.id("staffProfiles")),
    rawAudioBytes: v.optional(v.number()),
    compressedAudioBytes: v.optional(v.number()),
    compressionRatio: v.optional(v.number()),
    frequencyChartData: v.optional(frequencyChartDataValidator),
    level1Status: v.optional(level1StatusValidator),
    aiClinicalBrief: v.optional(v.string()),
    symptomNotes: v.optional(v.string()),
    spo2Percent: v.optional(v.number()),
    respiratoryRate: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
    provisionalMedication: v.optional(v.string()),
    medicationApproved: v.optional(v.boolean()),
    approvedMedication: v.optional(v.string()),
    specialistRemarks: v.optional(v.string()),
    reviewedBySpecialistId: v.optional(v.id("staffProfiles")),
    reviewedByName: v.optional(v.string()),
    reviewedByPhone: v.optional(v.string()),
    reviewedByFacility: v.optional(v.string()),
    reviewedByDistrict: v.optional(v.string()),
    physicalReferralFlag: v.optional(v.boolean()),
    referralInstructions: v.optional(v.string()),
    reviewStatus: v.optional(reviewStatusValidator),
  })
    .index("by_user", ["userId"])
    .index("by_reviewStatus", ["reviewStatus"]),
  patientDocuments: defineTable({
    patientId: v.id("patients"),
    screeningId: v.optional(v.id("screenings")),
    fileId: v.id("_storage"),
    fileName: v.string(),
    docType: patientDocTypeValidator,
    notes: v.optional(v.string()),
    uploadedByStaffId: v.id("staffProfiles"),
    uploadedAt: v.number(),
  }).index("by_patientId", ["patientId"]),
});
