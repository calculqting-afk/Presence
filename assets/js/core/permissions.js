// Fixed policy. Changes here must be reviewed alongside firestore.rules.
const operations = ['viewStudents', 'addStudents', 'editStudents', 'changePasswords', 'deleteStudents', 'resetFace', 'viewAbsences', 'viewAttendance', 'correctAttendance', 'manageEvents', 'deleteEvents', 'manageGeofences', 'viewFines', 'manageFines', 'deleteFines', 'changeRoles', 'resetData', 'adminProfile', 'manageSurveys'];
const grants = {
  super_admin: operations,
  head_admin: ['viewStudents', 'addStudents', 'editStudents', 'changePasswords', 'resetFace', 'viewAbsences', 'viewAttendance', 'correctAttendance', 'manageEvents', 'manageGeofences', 'viewFines', 'manageFines', 'manageSurveys'],
  attendance_admin: ['viewAttendance', 'correctAttendance', 'manageEvents', 'manageGeofences', 'manageSurveys'],
  student_manager: ['viewStudents', 'addStudents', 'editStudents', 'resetFace', 'viewAbsences', 'viewAttendance', 'viewFines'],
  student: []
};
export const ROLE_PERMISSIONS = Object.freeze(Object.fromEntries(Object.entries(grants).map(([role, actions]) => [role, Object.freeze(Object.fromEntries(operations.map(action => [action, actions.includes(action)])))])));
export function hasPermission(role, action) { return ROLE_PERMISSIONS[role]?.[action] === true; }
export function requirePermission(role, action) {
  if (!hasPermission(role, action)) { const error = new Error('Your role cannot perform this action.'); error.code = 'permission-denied'; throw error; }
}
const viewActions = { 'add-student': 'addStudents', 'modify-students': 'viewStudents', create: 'manageEvents', 'modify-events': 'manageEvents', 'past-events': 'manageEvents', 'attendance-line': 'correctAttendance', 'assign-fine': 'manageFines', 'assigned-fines': 'viewFines', geofence: 'manageGeofences', surveys: 'manageSurveys', profile: 'adminProfile' };
export const ROLE_VIEWS = Object.freeze(Object.fromEntries(Object.keys(grants).map(role => [role, Object.freeze(role === 'student' ? ['dashboard', 'events', 'attendances', 'history', 'fines', 'face', 'surveys', 'profile'] : ['dashboard', ...Object.entries(viewActions).filter(([, action]) => hasPermission(role, action)).map(([view]) => view)])])));
