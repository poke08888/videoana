const admin = require("firebase-admin");
const initializeSettings = require("../util/initializeSettings");

const initFirebase = async () => {
  try {
    await initializeSettings;
    admin.initializeApp({
      credential: admin.credential.cert(settingJSON.privateKey),
    });
    console.log("Firebase Admin SDK initialized successfully");
    return admin;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
    throw error;
  }
};

module.exports = initFirebase();
