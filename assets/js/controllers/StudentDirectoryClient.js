import { PasswordResetApi } from './PasswordResetApi.js';

export const D1_DIRECTORY_ENABLED = true;

export class StudentDirectoryClient {
  constructor(api) { this.api = api; }
  call(...args) { this.api ||= new PasswordResetApi(); return this.api.call(...args); }
  async list(user, refresh = false) {
    const result = await this.call('/v1/admin/directory', user, { refresh }, { forceRefresh: false });
    result.students = result.students.map(student => ({ ...student,
      ...(typeof student.createdAt === 'string' ? { createdAt: { toMillis: () => Date.parse(student.createdAt) } } : {}) }));
    return result;
  }
  sync(user, studentUid) { return this.call('/v1/directory/sync', user, { studentUid }, { forceRefresh: false }); }
}
