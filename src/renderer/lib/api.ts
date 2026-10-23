import type { ApiMethod, ApiParams, ApiResults, AppError, Result } from '../../shared/types';

export class ApiError extends Error {
  readonly code: AppError['code'];
  readonly kind: AppError['kind'];
  readonly hint?: string;
  readonly detail?: string;
  readonly stderr?: string;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.kind = error.kind;
    this.hint = error.hint;
    this.detail = error.detail;
    this.stderr = error.stderr;
  }
}

export function getBridge() {
  if (!window.gitpp) {
    throw new Error('The Git++ preload bridge is unavailable. Start the app through Electron or the test harness.');
  }
  return window.gitpp;
}

export async function call<M extends ApiMethod>(method: M, payload: ApiParams[M]): Promise<ApiResults[M]> {
  const result: Result<ApiResults[M]> = await getBridge().invoke(method, payload);
  if (!result.ok) throw new ApiError(result.error);
  return result.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorDetail(error: unknown): string | undefined {
  if (error instanceof ApiError) {
    const parts = [error.hint, error.detail, error.stderr].filter(Boolean);
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }
  return undefined;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
