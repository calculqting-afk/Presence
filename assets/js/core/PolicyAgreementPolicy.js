export class PolicyAgreementPolicy {
  static version = '2026-11-01-v1';
  static message = 'Please accept the Terms and Conditions and acknowledge the Privacy Policy before continuing.';
  static path(uid) { return ['policyAcceptances', uid, 'versions', this.version]; }
  static accepted(receipt, uid) {
    return receipt?.uid === uid && receipt.version === this.version &&
      receipt.termsAccepted === true && receipt.privacyAcknowledged === true && Boolean(receipt.acceptedAt);
  }
  static receipt(uid, acceptedAt) {
    return { uid, version: this.version, termsAccepted: true, privacyAcknowledged: true, acceptedAt };
  }
}
