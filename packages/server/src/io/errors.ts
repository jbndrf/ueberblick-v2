/** A file that cannot be read at all for its format (import problem `file_unreadable`, row 0). */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}
