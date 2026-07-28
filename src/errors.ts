export interface HttpErrorOptions {
  status: number;
  statusText: string;
  url: string;
  response: Response;
  body?: unknown;
}

export class HttpError extends Error {
  public readonly name = "HttpError";
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly response: Response;
  public readonly body?: unknown;

  public constructor(message: string, options: HttpErrorOptions) {
    super(message);
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
    this.response = options.response;
    this.body = options.body;
  }
}
