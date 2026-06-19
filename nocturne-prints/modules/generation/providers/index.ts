import { MockImageGenerationProvider } from "@/modules/generation/providers/mock-image-generation";
import type { ImageGenerationProvider } from "@/modules/generation/types";

let provider: ImageGenerationProvider | null = null;

export function getImageGenerationProvider(): ImageGenerationProvider {
  if (!provider) {
    provider = new MockImageGenerationProvider();
  }
  return provider;
}
