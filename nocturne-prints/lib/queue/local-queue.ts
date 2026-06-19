import type { QueueAdapter, QueueHandlerMap, QueueJobType, QueuePayload } from "@/lib/queue/types";

export class LocalQueueAdapter implements QueueAdapter {
  constructor(private readonly handlers: QueueHandlerMap) {}

  async dispatch(type: QueueJobType, payload: QueuePayload): Promise<void> {
    await this.handlers[type](payload);
  }
}
