// Shared error base (PLAN §7.1): every service error carries a machine `code`
// the HTTP layer maps to a status; message text never echoes env values or keys.
export class KiteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}
