export class GatewayTransactionAbort<T> extends Error {
  readonly name = "GatewayTransactionAbort";
  constructor(readonly result: T) { super("gateway_transaction_aborted"); }
}
