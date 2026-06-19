/**
 * Abstrakcja kolejki zadan. MVP uzywa adaptera in-memory,
 * ale interfejs jest gotowy pod BullMQ/Redis (patrz bullmq-adapter.ts).
 */
export type JobName = "moderate_order" | "generate_design" | "moderate_generated";

export interface JobPayload {
  orderId: string;
  [key: string]: unknown;
}

export type JobHandler = (payload: JobPayload) => Promise<void>;

export interface QueueAdapter {
  readonly driver: string;
  /** Rejestruje handler dla danego typu zadania. */
  register(name: JobName, handler: JobHandler): void;
  /** Dodaje zadanie do kolejki. */
  enqueue(name: JobName, payload: JobPayload): Promise<void>;
}
