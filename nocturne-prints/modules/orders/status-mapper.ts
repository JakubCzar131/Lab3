import { SafetyStatus } from "@prisma/client";
import type { ImageSafetyResult, PromptSafetyResult } from "@/modules/moderation/types";

export function toSafetyStatusEnum(status: "allowed" | "rejected" | "needs_manual_review"): SafetyStatus {
  if (status === "allowed") return SafetyStatus.ALLOWED;
  if (status === "rejected") return SafetyStatus.REJECTED;
  return SafetyStatus.NEEDS_MANUAL_REVIEW;
}

export function decideFailSafeModerationStatus(results: Array<PromptSafetyResult | ImageSafetyResult>) {
  if (results.some((result) => result.status === "rejected")) {
    return "rejected" as const;
  }
  if (results.some((result) => result.status === "needs_manual_review")) {
    return "needs_manual_review" as const;
  }
  return "allowed" as const;
}
