const admin = require("firebase-admin");


const validateAuthToken = async (req, res, next) => {
  const privateKey = settingJSON?.privateKey;
  if (!privateKey) {
    console.error("❌ Firebase private key not found in global setting.");
    return res.status(500).json({ status: false, message: "Firebase not configured." });
  }



  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  console.log("🔹 [AUTH] Authorization Header:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("⚠️ [AUTH] Authorization token missing or malformed.");
    return res.status(401).json({ status: false, message: "Authorization token required" });
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log("✅ [AUTH] Token successfully verified.", decodedToken);

    if (!decodedToken) {
      console.warn("⚠️ [AUTH] Invalid token. Authorization failed.");
      return res.status(401).json({ status: false, message: "Invalid token. Authorization failed." });
    }

    req.user = {
      uid: decodedToken.uid,
      provider: decodedToken.firebase?.sign_in_provider || "unknown",
    };

    next();
  } catch (error) {
    console.error(`❌ [AUTH] Token verification failed: ${error.message}`);

    return res.status(401).json({
      status: false,
      message: error.code === "auth/id-token-expired" ? "Token expired. Please reauthenticate." : "Invalid token. Authorization failed.",
    });
  }
};

module.exports = validateAuthToken;
