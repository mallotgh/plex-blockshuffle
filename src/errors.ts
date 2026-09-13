export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notAuthenticated = () =>
  new ApiError(401, 'not_authenticated', 'Nicht mit Plex verbunden. Bitte zuerst anmelden.');
