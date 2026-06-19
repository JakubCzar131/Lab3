import { Queue } from "bullmq";
import { env } from "@/lib/env";
import type { QueueAdapter, QueueJobType, QueuePayload } from "@/lib/queue/types";

export class BullMqAdapter implements QueueAdapter {
  private readonly queue = new Queue<QueuePayload>("nocturne-jobs", {
    connection: {
      url: env.REDIS_URL,
    },
  });

  async dispatch(type: QueueJobType, payload: QueuePayload): Promise<void> {
    await this.queue.add(type, payload, {
      removeOnComplete: true,
      attempts: 2,
      backoff: { type: "fixed", delay: 1500 },
    });
  }
}
