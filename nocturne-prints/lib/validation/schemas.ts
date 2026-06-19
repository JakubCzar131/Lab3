import { z } from "zod";
import { STYLE_OPTIONS, TRANSFORMATION_LEVELS } from "@/modules/catalog/options";

export const shippingInfoSchema = z.object({
  fullName: z.string().min(2).max(120),
  line1: z.string().min(3).max(160),
  line2: z.string().max(160).optional().or(z.literal("")),
  city: z.string().min(2).max(120),
  postalCode: z.string().min(3).max(20),
  country: z.string().length(2),
  phone: z.string().max(30).optional().or(z.literal("")),
});

export const consentSchema = z.object({
  rightsToImage: z.literal(true),
  mysteryNoPreview: z.literal(true),
  creativeVariance: z.literal(true),
  noReturnChangeOfMind: z.literal(true),
  faceConsent: z.boolean().optional().default(false),
});

export const createOrderSchema = z.object({
  email: z.string().email(),
  productId: z.string().min(1),
  variantId: z.string().min(1),
  size: z.string().min(1).max(10),
  color: z.string().min(1).max(40),
  customerPrompt: z.string().min(5).max(700),
  selectedStyle: z.enum(STYLE_OPTIONS),
  transformationLevel: z.enum(TRANSFORMATION_LEVELS),
  consents: consentSchema,
  shippingInfo: shippingInfoSchema,
});

export const moderatePromptSchema = z.object({
  prompt: z.string().min(1).max(1000),
});

export const adminUpdateOrderStatusSchema = z.object({
  nextStatus: z.enum([
    "PAID",
    "MODERATION_PENDING",
    "NEEDS_MANUAL_REVIEW",
    "REJECTED",
    "GENERATION_PENDING",
    "GENERATED",
    "PRODUCTION_READY",
    "PRINTED",
    "SHIPPED",
    "CANCELLED",
  ]),
  reason: z.string().max(300).optional(),
});
