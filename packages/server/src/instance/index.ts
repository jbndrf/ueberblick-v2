export {
  createInstanceStore,
  LEGAL_SLUG,
  type InstanceSettings,
  type InstanceStore,
  type LegalPage,
  type LegalPageInput,
  type RenameResult,
} from './store';
export { CONSENT_COOKIE, CONSENT_MAX_AGE_S, consentCookie, consentRefusal, readConsent } from './consent';
export { CONSENT_DECISIONS, INSTANCE_ERRORS, type ConsentDecision, type InstanceErrorCode } from './registry';
