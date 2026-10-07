/**
 * The QR decoder behind a port. `html5-qrcode` (as in v3) is imported only when the QR tab opens, so the token tab and
 * the login link never download it. Tests pass a fake `LoadScanner`.
 */
export interface QrScanner {
  /** Starts the rear camera; `onDecoded` gets the text of each code seen. Rejects when the camera is refused. */
  startCamera(onDecoded: (text: string) => void): Promise<void>;
  /** Stops the camera; safe when it is not running. */
  stop(): Promise<void>;
  /** Decodes a QR code from a photo; rejects when there is none. */
  scanFile(file: File): Promise<string>;
}

/** `elementId` is the element the library draws its video into. */
export type LoadScanner = (elementId: string) => Promise<QrScanner>;

export const loadScanner: LoadScanner = async (elementId) => {
  const { Html5Qrcode } = await import('html5-qrcode');
  const reader = new Html5Qrcode(elementId);
  let running = false;
  return {
    async startCamera(onDecoded) {
      await reader.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onDecoded,
        () => {},
      );
      running = true;
    },
    async stop() {
      if (!running) return;
      running = false;
      try {
        await reader.stop();
      } catch {
        // already stopped
      }
    },
    scanFile: (file) => reader.scanFile(file, true),
  };
};
