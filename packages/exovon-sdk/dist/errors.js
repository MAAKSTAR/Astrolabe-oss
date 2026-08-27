"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExovonRateLimitError = exports.ExovonAuthError = exports.ExovonError = void 0;
class ExovonError extends Error {
    status;
    code;
    constructor(message, status = 500, code = 'EXOVON_ERROR') {
        super(message);
        this.name = 'ExovonError';
        this.status = status;
        this.code = code;
        Object.setPrototypeOf(this, ExovonError.prototype);
    }
}
exports.ExovonError = ExovonError;
class ExovonAuthError extends ExovonError {
    constructor(message = 'Unauthorized: Invalid or revoked API Key') {
        super(message, 401, 'UNAUTHORIZED');
        this.name = 'ExovonAuthError';
        Object.setPrototypeOf(this, ExovonAuthError.prototype);
    }
}
exports.ExovonAuthError = ExovonAuthError;
class ExovonRateLimitError extends ExovonError {
    constructor(message = 'Too Many Requests') {
        super(message, 429, 'RATE_LIMITED');
        this.name = 'ExovonRateLimitError';
        Object.setPrototypeOf(this, ExovonRateLimitError.prototype);
    }
}
exports.ExovonRateLimitError = ExovonRateLimitError;
