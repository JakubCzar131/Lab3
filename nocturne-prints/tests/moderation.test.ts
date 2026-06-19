import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { classifyImageSafety } from "@/modules/moderation/image";
import { classifyPromptSafety } from "@/modules/moderation/prompt";

describe("prompt moderation", () => {
  it("rejects trademark prompts", async () => {
    const result = await classifyPromptSafety("dark hoodie with nike logo and marvel vibe");
    expect(result.status).toBe("rejected");
    expect(result.categories).toContain("trademark_brand");
  });

  it("allows safe custom prompts", async () => {
    const result = await classifyPromptSafety("ritual portal, smoke, gothic symbols, unique mood");
    expect(["allowed", "needs_manual_review"]).toContain(result.status);
  });
});

describe("image moderation", () => {
  it("rejects images without face consent when face-like filename", async () => {
    const png = await sharp({
      create: {
        width: 800,
        height: 900,
        channels: 3,
        background: "#222222",
      },
    })
      .png()
      .toBuffer();

    const result = await classifyImageSafety({
      buffer: png,
      filename: "nike_logo_face.png",
      mimeType: "image/png",
      faceConsent: false,
    });

    expect(["rejected", "needs_manual_review"]).toContain(result.status);
  });
});
