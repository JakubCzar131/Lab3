import type { JobHandler, JobName, JobPayload, QueueAdapter } from "./types";

/**
 * Prosty adapter kolejki w pamieci procesu (MVP).
 * Zadania wykonywane sa asynchronicznie (setImmediate), poza cyklem zadania HTTP,
 * z podstawowym retry. NIE jest trwaly miedzy restartami — do produkcji uzyj BullMQ.
 */
export class MemoryQueueAdapter implements QueueAdapter {
  readonly driver = "memory";
  private handlers = new Map<JobName, JobHandler>();

  register(name: JobName, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async enqueue(name: JobName, payload: JobPayload): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      console.warn(`[queue] Brak handlera dla zadania "${name}" — pomijam.`);
      return;
    }
    // Uruchamiamy poza biezacym tickiem, by nie blokowac odpowiedzi HTTP.
    setImmediate(() => {
      void this.run(name, handler, payload, 0);
    });
  }

  private async run(name: JobName, handler: JobHandler, payload: JobPayload, attempt: number) {
    const maxAttempts = 3;
    try {
      await handler(payload);
    } catch (err) {
      console.error(`[queue] Zadanie "${name}" nie powiodlo sie (proba ${attempt + 1})`, err);
      if (attempt + 1 < maxAttempts) {
        const delay = 2 ** attempt * 500;
        setTimeout(() => void this.run(name, handler, payload, attempt + 1), delay);
      } else {
        console.error(`[queue] Zadanie "${name}" porzucone po ${maxAttempts} probach.`, payload);
      }
    }
  }
}
