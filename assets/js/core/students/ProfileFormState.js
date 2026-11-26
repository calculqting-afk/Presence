const studentFields = ['profileFirstName', 'profileMiddleName', 'profileLastName', 'profileBirthday', 'profileGender', 'profileCourse', 'profileSection', 'profileEmail', 'profilePhone', 'profileHometownBarangay', 'profileHometownCity', 'profileHometownProvince'];
const adminFields = ['adminDisplayName', 'adminProfileBirthday', 'adminProfilePhone'];

// Capture the rendered, editable values; display defaults and legacy aliases
// must not turn an unchanged form into a database update.
export function profileFormState(document, kind, photo) {
  const fields = kind === 'student' ? studentFields : adminFields;
  return { ...Object.fromEntries(fields.map(id => [id, String(document.querySelector('#' + id)?.value ?? '').trim()])), photo: photo || '' };
}
export function sameProfileForm(before, after) {
  return Boolean(before) && Object.keys(after).every(key => before[key] === after[key]);
}
