/* Push notifications (Firebase Cloud Messaging). Public web settings only. */
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyAcEqB04XfQbyXw2kgibQSYgnp8sUQ8zr0",
  authDomain: "docinsight-health.firebaseapp.com",
  projectId: "docinsight-health",
  storageBucket: "docinsight-health.firebasestorage.app",
  messagingSenderId: "624234745329",
  appId: "1:624234745329:web:2edaebd36a228ab1edc850",
});
firebase.messaging();
