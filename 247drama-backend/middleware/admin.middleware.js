//JWT Token
const jwt = require("jsonwebtoken");

//import model
const Admin = require("../models/admin.model");
const SubAdmin = require("../models/subAdmin.model");

module.exports = async (req, res, next) => {
  let admin;
  let subAdmin;
  try {
    const Authorization = req.get("Authorization");

    if (!Authorization) {
      console.error("401 FAILED: Missing Authorization header");
      return res.status(401).json({ status: false, message: "Oops ! You are not authorized." });
    }

    const decodeToken = await jwt.verify(Authorization, process?.env?.JWT_SECRET);

    if (!decodeToken || !decodeToken._id) {
      console.error("401 FAILED: Invalid token structure (no _id)");
      return res.status(401).json({ status: false, message: "Invalid token. Authorization failed." });
    }

    if (decodeToken.type === "admin") {
      admin = await Admin.findById(decodeToken._id);
      if (!admin) {
        console.error("401 FAILED: Admin not found in DB");
        return res.status(401).json({ status: false, message: "Admin not found. Authorization failed." });
      }
      req.admin = admin;
    } else if (decodeToken.type === "subAdmin") {
      subAdmin = await SubAdmin.findById(decodeToken._id);
      if (!subAdmin) {
        console.error("401 FAILED: SubAdmin not found in DB");
        return res.status(401).json({ status: false, message: "Sub Admin not found. Authorization failed." });
      }
      req.subAdmin = subAdmin;
    } else {
      console.error("401 FAILED: Unknown token type", decodeToken.type);
    }
    next();
  } catch (error) {
    console.error("JWT Verify Error:", error.message);
    console.error("Token being verified:", req.get("Authorization"));
    console.error("Secret being used:", process?.env?.JWT_SECRET);
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ status: false, message: "Invalid or expired token. Authorization failed." });
    }

    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
