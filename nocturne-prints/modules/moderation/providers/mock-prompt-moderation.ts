import type { ExternalPromptModerationProvider, PromptSafetyResult } from "@/modules/moderation/types";

export class MockPromptModerationProvider implements ExternalPromptModerationProvider {
  async classifyPrompt(prompt: string): Promise<PromptSafetyResult | null> {
    void prompt;
    return null;
  }
}
