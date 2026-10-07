import type { MessageKey } from '../../../lib/participant/messages';

/** The device sections of the setup page, in the order shown: a heading and its numbered steps. */
export const STEP_KEYS: ReadonlyArray<{
  readonly heading: MessageKey;
  readonly steps: readonly MessageKey[];
}> = [
  {
    heading: 'setup_cert_android_heading',
    steps: ['setup_cert_android_1', 'setup_cert_android_2', 'setup_cert_android_3', 'setup_cert_android_4'],
  },
  {
    heading: 'setup_cert_ios_heading',
    steps: ['setup_cert_ios_1', 'setup_cert_ios_2', 'setup_cert_ios_3'],
  },
  {
    heading: 'setup_cert_windows_heading',
    steps: ['setup_cert_windows_1', 'setup_cert_windows_2', 'setup_cert_windows_3', 'setup_cert_windows_4'],
  },
  {
    heading: 'setup_cert_macos_heading',
    steps: ['setup_cert_macos_1', 'setup_cert_macos_2', 'setup_cert_macos_3', 'setup_cert_macos_4'],
  },
];
