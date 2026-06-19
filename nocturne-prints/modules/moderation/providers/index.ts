import { MockImageModerationProvider } from "@/modules/moderation/providers/mock-image-moderation";
import { MockPromptModerationProvider } from "@/modules/moderation/providers/mock-prompt-moderation";

export const promptModerationProvider = new MockPromptModerationProvider();
export const imageModerationProvider = new MockImageModerationProvider();
