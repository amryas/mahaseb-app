/** Standard billing / access-control error codes for writes and limits. */

export const BILLING_ERROR_CODES = {
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
};

export class BillingGuardError extends Error {
  /**
   * @param {keyof typeof BILLING_ERROR_CODES} code
   * @param {string} [message]
   */
  constructor(code, message = '') {
    super(message || code);
    this.code = code;
    this.name = 'BillingGuardError';
  }
}
