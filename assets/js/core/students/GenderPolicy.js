// Optional for legacy accounts and older app versions; never infer from names.
export class GenderPolicy {
  static valid(value) { return value === undefined || ['', 'Male', 'Female'].includes(value); }
  static normalize(value) { const text = String(value || '').trim().toLowerCase(); return text === 'male' ? 'Male' : text === 'female' ? 'Female' : ''; }
  static label(value) { return this.normalize(value) || 'Not specified'; }
}
