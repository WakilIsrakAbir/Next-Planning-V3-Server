/** An error that carries the HTTP status (and an optional machine-readable code) a controller should send. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /** Response body: `{ code, message }` when there is a code, else `{ message }`. */
  toJSON(): { code?: string; message: string } {
    return this.code ? { code: this.code, message: this.message } : { message: this.message };
  }
}
