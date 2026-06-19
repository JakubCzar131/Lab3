import type { JobHandler, JobName, JobPayload, QueueAdapter } from "./types";

/**
 * Adapter BullMQ/Redis (STUB pod pozniejsza implementacje).
 *
 * Aby go wlaczyc:
 *  1. Zainstaluj `bullmq` i `ioredis`.
 *  2. Utworz Queue + Worker per JobName, uzywajac REDIS_URL.
 *  3. Ustaw QUEUE_DRIVER="bullmq" w .env i uruchom proces workera.
 *
 * Workery powinny dzialac jako osobny proces (np. `node worker.js`),
 * aby przetwarzanie nie blokowalo serwera web.
 */
export class BullmqQueueAdapter implements QueueAdapter {
  readonly driver = "bullmq";

  register(_name: JobName, _handler: JobHandler): void {
    throw new Error(
      "BullmqQueueAdapter nie jest jeszcze zaimplementowany. Zainstaluj bullmq+ioredis i uzupelnij stub."
    );
  }

  async enqueue(_name: JobName, _payload: JobPayload): Promise<void> {
    throw new Error(
      "BullmqQueueAdapter nie jest jeszcze zaimplementowany. Zainstaluj bullmq+ioredis i uzupelnij stub."
    );
  }
}
