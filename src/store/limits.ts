// Caps for the in-memory local stores. They're shared by every user and only cleared by a
// restart, so without caps any logged-in account could grow them until the process runs out
// of memory. Checked inside the stores, so every write path is covered.
export const MAX_ENTRIES_PER_STORE = 1000;
export const MAX_TEXT_LENGTH = 300;

export class StoreLimitError extends Error {
  constructor(message: string, public status: 400 | 507) {
    super(message);
  }
}

export function checkRoom(count: number, what: string): void {
  if (count >= MAX_ENTRIES_PER_STORE) {
    throw new StoreLimitError(`No room for more local ${what} until the server restarts`, 507);
  }
}

export function checkTextLength(fields: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
      throw new StoreLimitError(`${name} is longer than ${MAX_TEXT_LENGTH} characters`, 400);
    }
  }
}
