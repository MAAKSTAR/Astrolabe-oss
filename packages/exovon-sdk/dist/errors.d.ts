export declare class ExovonError extends Error {
    status: number;
    code: string;
    constructor(message: string, status?: number, code?: string);
}
export declare class ExovonAuthError extends ExovonError {
    constructor(message?: string);
}
export declare class ExovonRateLimitError extends ExovonError {
    constructor(message?: string);
}
