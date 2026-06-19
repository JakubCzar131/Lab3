import { env } from "@/lib/env";
import { BullmqQueueAdapter } from "./bullmq-adapter";
import { MemoryQueueAdapter } from "./memory-adapter";
import type { QueueAdapter } from "./types";

const globalForQueue = globalThis as unknown as {
  nocturneQueue: QueueAdapter | undefined;
  nocturneQueueRegistered: boolean | undefined;
};

function createQueue(): QueueAdapter {
  return env.QUEUE_DRIVER === "bullmq" ? new BullmqQueueAdapter() : new MemoryQueueAdapter();
}

/**
 * Singleton kolejki. Handlery rejestrowane sa leniwie przez registerWorkers()
 * (patrz lib/workers.ts), aby uniknac cyklicznych importow.
 */
export function getQueue(): QueueAdapter {
  if (!globalForQueue.nocturneQueue) {
    globalForQueue.nocturneQueue = createQueue();
  }
  return globalForQueue.nocturneQueue;
}

export function markWorkersRegistered(): boolean {
  if (globalForQueue.nocturneQueueRegistered) return false;
  globalForQueue.nocturneQueueRegistered = true;
  return true;
}

export type { JobName, JobPayload, QueueAdapter } from "./types";
