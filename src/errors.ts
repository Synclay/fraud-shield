export class SynclayFraudShieldError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { code?: string; status?: number; details?: unknown } = {}
  ) {
    super(message);
    this.name = "SynclayFraudShieldError";
    this.code = options.code ?? "fraud_shield_error";
    this.status = options.status ?? 500;
    this.details = options.details;
  }
}

export function isSynclayFraudShieldError(
  error: unknown
): error is SynclayFraudShieldError {
  return error instanceof SynclayFraudShieldError;
}
