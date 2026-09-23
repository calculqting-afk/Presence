const ADMIN_EMAIL = "mikhailovna2007@gmail.com";
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

function createFaceRegistration_(studentUid, idToken, file) {
  return firestoreRequest_("patch", `faceRegistrations/${studentUid}`, idToken, {
    fields: {
      registered: { booleanValue: true },
      storageProvider: { stringValue: "Google Drive" },
      driveFileId: { stringValue: file.getId() },
      driveFileName: { stringValue: file.getName() },
      registeredAt: { timestampValue: new Date().toISOString() }
    }
  }, "?currentDocument.exists=false");
}

function deleteFaceRegistration_(studentUid, idToken) {
  firestoreRequest_("delete", `faceRegistrations/${studentUid}`, idToken);
}

function getStudentFaceFiles_(studentUid) {
  const folder = DriveApp.getFolderById(getConfig_("FACE_FOLDER_ID"));
  const files = folder.getFiles();
  const matchingFiles = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDescription().includes(`Student UID: ${studentUid}`)) matchingFiles.push(file);
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
    const payload = JSON.parse(e.postData.contents || "{}");
    if (!payload.idToken) throw new Error("Missing sign-in token.");
    const requester = verifyFirebaseUser_(payload.idToken);

    if (payload.action === "reset") {
      if (requester.email?.toLowerCase() !== ADMIN_EMAIL) throw new Error("Only the Presence administrator can reset face registration.");
      if (!payload.studentUid) throw new Error("Missing student UID.");
      const registration = getFaceRegistration_(payload.studentUid, payload.idToken);
      if (!registration) throw new Error("This student has no active face registration.");

      // New records use the exact Drive file ID. The search is for older records only.
      const driveFileId = registration.fields?.driveFileId?.stringValue;
      if (driveFileId) {
        DriveApp.getFileById(driveFileId).setTrashed(true);
      } else {
        const legacyFiles = getStudentFaceFiles_(payload.studentUid);
        if (!legacyFiles.length) throw new Error("The registered Drive photo could not be found.");
        legacyFiles.forEach((file) => file.setTrashed(true));
      }

      // Firebase changes only after Drive successfully moves the photo to Trash.
      deleteFaceRegistration_(payload.studentUid, payload.idToken);
      return json_({ ok: true });
    }

    if (!payload.imageDataUrl) throw new Error("Missing registration photo.");
    const studentUid = requester.localId;
    if (getFaceRegistration_(studentUid, payload.idToken)) throw new Error("A face photo is already registered. Ask your administrator to reset it.");
    if (getStudentFaceFiles_(studentUid).length) throw new Error("An existing Drive photo was found. Ask your administrator to reset it.");

    const match = payload.imageDataUrl.match(/^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw new Error("Only JPEG or PNG photos are accepted.");
    const mimeType = match[1];
    const bytes = Utilities.base64Decode(match[2].replace(/\s/g, ""));
    if (bytes.length > 1024 * 1024) throw new Error("Photo is too large.");

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
      file.setTrashed(true);
      throw error;
    }
    return json_({ ok: true, fileId: file.getId(), fileName: file.getName() });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: error.message || "Upload failed." });
  }
}
