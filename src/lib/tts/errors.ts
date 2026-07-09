export class TTSProviderError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean,
  ) {
    super(message);
    this.name = "TTSProviderError";
  }
}
