import { SUPER_ADMIN_UID, auth, db, studentIdToEmail, studentProvisioningAuth } from "../../../config/firebase-config.js?v=20261005-operational-reset";
import { ROLE_VIEWS } from './permissions.js?v=20261011-optimized';
import { createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


export { SUPER_ADMIN_UID, auth, db, studentIdToEmail, studentProvisioningAuth, createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, updateProfile, Timestamp, addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch, ROLE_VIEWS };
