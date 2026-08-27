export class ExovonError extends Error {
  public status: number;
  public code: string;

  constructor(message: string, status: number = 500, code: string = 'EXOVON_ERROR') {
    super(message);
    this.name = 'ExovonError';
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, ExovonError.prototype);
  }
}

export class ExovonAuthError extends ExovonError {
  constructor(message: string = 'Unauthorized: Invalid or revoked API Key') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'ExovonAuthError';
    Object.setPrototypeOf(this, ExovonAuthError.prototype);
  }
}

export class ExovonRateLimitError extends ExovonError {
  constructor(message: string = 'Too Many Requests') {
    super(message, 429, 'RATE_LIMITED');
    this.name = 'ExovonRateLimitError';
    Object.setPrototypeOf(this, ExovonRateLimitError.prototype);
  }
}
