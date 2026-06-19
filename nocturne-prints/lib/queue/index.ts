import { env } from "@/lib/env";
import { BullMqAdapter } from "@/lib/queue/bullmq-queue";
import { LocalQueueAdapter } from "@/lib/queue/local-queue";
import type { QueueAdapter, QueueHandlerMap } from "@/lib/queue/types";

let queueAdapter: QueueAdapter | null = null;

export function getQueueAdapter(handlers: QueueHandlerMap): QueueAdapter {
  if (queueAdapter) return queueAdapter;

  queueAdapter = env.QUEUE_DRIVER === "bullmq" ? new BullMqAdapter() : new LocalQueueAdapter(handlers);
  return queueAdapter;
}
