/** The JSON body of an HttpError response. */
export interface HttpErrorBody {
  code?: string;
  message: string;
  [key: string]: unknown;
}

/** An error that carries the HTTP status (and an optional machine-readable code) a controller should send. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    /** Extra response fields, e.g. the `departments` of a save-plans 409 CONFLICT. */
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /** Response body: `{ code, message }` when there is a code, else `{ message }`, followed by any `details` fields. */
  toJSON(): HttpErrorBody {
    const body: HttpErrorBody = this.code ? { code: this.code, message: this.message } : { message: this.message };
    for (const [key, value] of Object.entries(this.details || {})) {
      // details never replace the code or the message
      if (key !== 'code' && key !== 'message') body[key] = value;
    }
    return body;
  }
}
