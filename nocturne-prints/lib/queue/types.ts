export type QueueJobType = "order.moderate" | "order.generate" | "design.moderate";

export type QueuePayload = {
  orderId: string;
};

export type QueueHandlerMap = {
  [K in QueueJobType]: (payload: QueuePayload) => Promise<void>;
};

export interface QueueAdapter {
  dispatch(type: QueueJobType, payload: QueuePayload): Promise<void>;
}
