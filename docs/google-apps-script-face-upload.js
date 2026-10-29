const SUPER_ADMIN_UID = "8uEjAk72BLWKjvnQJEatBdeVAi02";
const FIREBASE_PROJECT_ID = "presence-a873f";

function getConfig_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Missing Script Property: ${key}`);
  return value;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyFirebaseUser_(idToken) {
  const response = UrlFetchApp.fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${getConfig_("FIREBASE_API_KEY")}`,
    { method: "post", contentType: "application/json", payload: JSON.stringify({ idToken }), muteHttpExceptions: true }
  );
  const user = JSON.parse(response.getContentText()).users?.[0];
  if (response.getResponseCode() !== 200 || !user?.localId) throw new Error("Invalid Firebase sign-in token.");
  return user;
}

function firestoreRequest_(method, path, idToken, body, queryString) {
  const options = { method, headers: { Authorization: `Bearer ${idToken}` }, muteHttpExceptions: true };
  if (body !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(body);
  }
  const response = UrlFetchApp.fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}${queryString || ""}`,
    options
  );
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`Firebase record request failed (${response.getResponseCode()}).`);
  }
  return response.getContentText() ? JSON.parse(response.getContentText()) : null;
}

function getFaceRegistration_(studentUid, idToken) {
  const response = UrlFetchApp.fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/faceRegistrations/${studentUid}`,
    { headers: { Authorization: `Bearer ${idToken}` }, muteHttpExceptions: true }
  );
  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`Unable to read face registration (${response.getResponseCode()}).`);
  }
  return JSON.parse(response.getContentText());
}

function canResetFace_(requester, idToken) {
  if (requester.localId === SUPER_ADMIN_UID) return true;
  // Never trust a role supplied by the browser. Read the authenticated caller's
  // stored role through Firestore, which also applies its deployed rules.
  const profile = firestoreRequest_("get", `students/${encodeURIComponent(requester.localId)}`, idToken);
  return profile?.fields?.active?.booleanValue === true
    && ["head_admin", "student_manager"].includes(profile?.fields?.role?.stringValue);
}

function createFaceRegistration_(studentUid, idToken, file) {
  // This secret lives only in Script Properties and the Worker secret store.
  // The browser never receives it, and direct student writes are denied.
  const response = UrlFetchApp.fetch('https://presence-admin-api.mikhailovna2007.workers.dev/v1/internal/face-registration', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${idToken}`, 'X-Presence-Face-Secret': getConfig_('FACE_BACKEND_SECRET') },
    payload: JSON.stringify({ fileId: file.getId(), fileName: file.getName() })
  });
  if (response.getResponseCode() !== 200) throw new Error('Server face confirmation failed. Ask an administrator to check the face service setup.');
  return JSON.parse(response.getContentText());
}

// Focused reset service. Upload behavior remains independent.
class FaceResetService {
  constructor({ requestDrive = (id) => UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,trashed,ownedByMe,description,parents,capabilities(canTrash,canListChildren)`,
    { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true }
  ), trash = id => DriveApp.getFileById(id).setTrashed(true),
    findFiles = uid => getStudentFaceFiles_(uid), folderId = () => getConfig_("FACE_FOLDER_ID") } = {}) {
    Object.assign(this, { requestDrive, trash, findFiles, folderId });
  }
  metadata(id) {
    const response = this.requestDrive(id);
    const status = response.getResponseCode();
    if (status === 404) return null; // Missing OR inaccessible; never silently authorize recovery.
    if (status !== 200) throw new Error(`Drive access failed (${status}). Check script authorization and Drive API access.`);
    return JSON.parse(response.getContentText());
  }
  recoverMissing(payload, requester, idToken) {
    if (payload.recoverMissing !== true) throw new Error("Photo missing or inaccessible. Super Admin or Head Admin must verify its removal and confirm recovery with a reason.");
    if (!canRecoverMissingFace_(requester, idToken)) throw new Error("Only Super Admin or Head Admin can recover a missing photo registration.");
    if (typeof payload.recoveryReason !== "string" || payload.recoveryReason.trim().length < 10 || payload.recoveryReason.length > 500) {
      throw new Error("Provide a recovery reason of 10–500 characters.");
    }
    const folder = this.metadata(this.folderId());
    if (!folder || folder.trashed || !folder.ownedByMe || !folder.capabilities?.canListChildren) {
      throw new Error("Recovery blocked: the script account must own and be able to list the active face-photo folder.");
    }
    if (this.findFiles(payload.studentUid).length) throw new Error("Recovery blocked: another matching photo exists in the face-photo folder.");
    return "missing_recovered";
  }
  removePhoto(registration, payload, requester, idToken) {
    const fileId = registration.fields?.driveFileId?.stringValue;
    if (!fileId) {
      const files = this.findFiles(payload.studentUid);
      if (!files.length) return this.recoverMissing(payload, requester, idToken);
      files.forEach(file => {
        const metadata = this.metadata(file.getId());
        if (!metadata || !metadata.ownedByMe || !metadata.capabilities?.canTrash) throw new Error("Drive photo permission check failed.");
        this.trash(file.getId());
      });
      return "trashed";
    }
    const file = this.metadata(fileId);
    if (!file) return this.recoverMissing(payload, requester, idToken);
    if (!file.ownedByMe || !String(file.description || "").split("\n").includes(`Student UID: ${payload.studentUid}`)
      || !file.parents?.includes(this.folderId())) throw new Error("The registered photo does not match this student or the configured folder.");
    if (file.trashed) return "already_trashed";
    if (!file.capabilities?.canTrash) throw new Error("The script account cannot move this photo to Trash.");
    this.trash(fileId);
    return "trashed";
  }
  resultFields(payload, requester, status, outcome, error) {
    return {
      studentUid: { stringValue: payload.studentUid }, requesterUid: { stringValue: requester.localId },
      status: { stringValue: status }, outcome: { stringValue: outcome || "" },
      error: { stringValue: String(error || "").slice(0, 1000) },
      recoveryReason: { stringValue: payload.recoverMissing === true ? String(payload.recoveryReason || "").trim().slice(0, 500) : "" }
    };
  }
  commitResult(payload, requester, idToken, registration, outcome) {
    const base = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const writes = [{ update: { name: `${base}/faceResetRequests/${payload.requestId}`,
      fields: this.resultFields(payload, requester, "completed", outcome) }, currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: "completedAt", setToServerValue: "REQUEST_TIME" }] }];
    if (registration) writes.push({ delete: `${base}/faceRegistrations/${payload.studentUid}`,
      currentDocument: { updateTime: registration.updateTime } });
    // Atomic audit + deletion; a newer registration cannot be deleted by a stale reset.
    const response = UrlFetchApp.fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
      method: "post", headers: { Authorization: `Bearer ${idToken}` }, contentType: "application/json",
      payload: JSON.stringify({ writes }), muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error(`Firebase reset confirmation failed (${response.getResponseCode()}). Check deployed Rules and refresh student status.`);
  }
  reset(payload, requester, idToken) {
    if (!canResetFace_(requester, idToken)) throw new Error("Your role cannot reset face registration.");
    if (typeof payload.studentUid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.studentUid)) throw new Error("Invalid student UID.");
    payload.requestId = payload.requestId || Utilities.getUuid();
    if (typeof payload.requestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(payload.requestId)) throw new Error("Invalid reset request ID.");
    try {
      const registration = getFaceRegistration_(payload.studentUid, idToken);
      const outcome = registration ? this.removePhoto(registration, payload, requester, idToken) : "already_reset";
      this.commitResult(payload, requester, idToken, registration, outcome);
      return { ok: true, outcome };
    } catch (error) {
      try {
        firestoreRequest_("patch", `faceResetRequests/${payload.requestId}`, idToken, {
          fields: { ...this.resultFields(payload, requester, "failed", "", error.message), completedAt: { timestampValue: new Date().toISOString() } }
        }, "?currentDocument.exists=false");
      } catch (statusError) { console.error("Unable to record reset error", statusError); }
      throw error;
    }
  }
}

function canRecoverMissingFace_(requester, idToken) {
  if (requester.localId === SUPER_ADMIN_UID) return true;
  const profile = firestoreRequest_("get", `students/${encodeURIComponent(requester.localId)}`, idToken);
  return profile?.fields?.active?.booleanValue === true && profile?.fields?.role?.stringValue === "head_admin";
}

function getStudentFaceFiles_(studentUid) {
  const folder = DriveApp.getFolderById(getConfig_("FACE_FOLDER_ID"));
  const files = folder.getFiles();
  const matchingFiles = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDescription().split("\n").includes(`Student UID: ${studentUid}`)) matchingFiles.push(file);
  }
  return matchingFiles;
}

function safeNamePart_(value, fallback) {
  return String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").slice(0, 80);
}

function doGet() {
  return json_({ ok: true, service: "Presence Face Upload" });
}

function doPost(e) {
  try {
    if (!e?.postData || typeof e.postData.contents !== 'string' || e.postData.contents.length > 1600000) throw new Error('Upload request is too large or missing.');
    const payload = JSON.parse(e.postData.contents || "{}");
    if (!payload.idToken) throw new Error("Missing sign-in token.");
    const requester = verifyFirebaseUser_(payload.idToken);

    if (payload.action === "reset") {
      return json_(new FaceResetService().reset(payload, requester, payload.idToken));
    }

    if (!payload.imageDataUrl) throw new Error("Missing registration photo.");
    const studentUid = requester.localId;
    if (getFaceRegistration_(studentUid, payload.idToken)) throw new Error("A face photo is already registered. Ask your administrator to reset it.");
    if (getStudentFaceFiles_(studentUid).length) throw new Error("An existing Drive photo was found. Ask your administrator to reset it.");

    if (typeof payload.imageDataUrl !== 'string' || payload.imageDataUrl.length > 1500000) throw new Error('Photo is too large.');
    const match = payload.imageDataUrl.match(/^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw new Error("Only JPEG or PNG photos are accepted.");
    const mimeType = match[1];
    const bytes = Utilities.base64Decode(match[2].replace(/\s/g, ""));
    if (bytes.length > 1024 * 1024) throw new Error("Photo is too large.");
    const header = bytes.slice(0, 8).map(value => (value + 256) % 256);
    const imageHeader = mimeType === 'image/png' ? [137,80,78,71,13,10,26,10] : [255,216,255];
    if (bytes.length < 32 || !imageHeader.every((value,index) => header[index] === value)) throw new Error('The photo data is not a valid JPEG or PNG image.');

    const studentName = safeNamePart_(payload.studentName, "Student");
    const studentId = safeNamePart_(payload.studentId, "No-ID");
    const section = safeNamePart_(payload.section, "No section");
    const extension = mimeType === "image/png" ? "png" : "jpg";
    const file = DriveApp.getFolderById(getConfig_("FACE_FOLDER_ID")).createFile(
      Utilities.newBlob(bytes, mimeType, `${studentName} - ${studentId} - Face Registration.${extension}`)
    );
    file.setDescription(`Presence face registration\nStudent: ${studentName}\nStudent ID: ${studentId}\nSection: ${section}\nStudent UID: ${studentUid}`);

    try {
      // Save the exact file ID to Firebase; if that fails, keep no orphaned Drive file.
      createFaceRegistration_(studentUid, payload.idToken, file);
    } catch (error) {
      // An acknowledgement can be lost after the Worker committed. Keep the
      // confirmed photo, and leave an uncertain upload for admin reconciliation.
      let saved;
      try { saved = getFaceRegistration_(studentUid, payload.idToken); }
      catch { throw new Error('Upload confirmation is uncertain. Ask an administrator to refresh face status before retrying.'); }
      if (saved?.fields?.driveFileId?.stringValue === file.getId()) return json_({ ok: true, fileId: file.getId(), fileName: file.getName() });
      file.setTrashed(true);
      throw error;
    }
    return json_({ ok: true, fileId: file.getId(), fileName: file.getName() });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: error.message || "Upload failed." });
  }
}
