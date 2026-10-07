import type { PositionPort } from './contract';

const OPTIONS = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 } as const;

/** The device's position through the browser Geolocation API (no network; the fix is read locally). */
export const browserPosition: PositionPort = {
  current: () =>
    new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation)
        return reject(new Error('no geolocation'));
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            lon: p.coords.longitude,
            lat: p.coords.latitude,
            ...(p.coords.altitude === null ? {} : { alt: p.coords.altitude }),
            ...(Number.isFinite(p.coords.accuracy) ? { accuracy: p.coords.accuracy } : {}),
          }),
        (e) => reject(new Error(e.message)),
        OPTIONS,
      );
    }),
};
