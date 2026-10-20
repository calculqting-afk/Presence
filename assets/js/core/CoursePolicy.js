// Recognize the verified legacy spelling without guessing unknown courses.
export class CoursePolicy {
  static normalize(value) {
    const course = String(value ?? '').trim();
    const key = course.replace(/\s+/g, '').toLowerCase();
    if (key === 'bsinfotech') return 'BS Info Tech';
    if (['bsa', 'bsmb', 'bsfi'].includes(key)) return key.toUpperCase();
    return course;
  }
  static profile(profile) {
    return { ...profile, course: this.normalize(profile.course) };
  }
}
