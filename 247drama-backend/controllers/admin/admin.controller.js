const Admin = require("../../models/admin.model");
const Login = require("../../models/login.model");
const SubAdmin = require("../../models/subAdmin.model");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");

// Helper for hashing password
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Helper for verifying password
function verifyPassword(password, storedPassword) {
  if (!storedPassword || !storedPassword.includes(":")) {
    return false; // legacy or invalid password
  }
  const [salt, hash] = storedPassword.split(":");
  const derivedHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return hash === derivedHash;
}

exports.store = async (req, res) => {
  try {
    if (!req.body || !req.body.email || !req.body.password) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }
    const adminExists = await Admin.findOne({ email: req.body.email.trim() });
    const subAdminExists = await SubAdmin.findOne({ email: req.body.email.trim() });
    
    if (adminExists || subAdminExists) {
      return res.status(200).json({ status: false, message: "Email already taken!" });
    }

    const admin = new Admin({
      email: req.body.email.trim(),
      password: hashPassword(req.body.password)
    });

    await admin.save();
    
    // Set login true
    await Login.updateOne({}, { $set: { login: true } }, { upsert: true });

    return res.status(200).json({ status: true, message: "Admin created successfully", admin });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

exports.login = async (req, res) => {
  try {
    if (!req.body || !req.body.email || !req.body.password) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }
    
    let user = await Admin.findOne({ email: req.body.email.trim() });
    let type = "admin";

    if (!user) {
      user = await SubAdmin.findOne({ email: req.body.email.trim() }).populate("role");
      type = "subAdmin";
    }

    if (!user) {
      return res.status(200).json({ status: false, message: "Admin does not exist" });
    }

    if (!verifyPassword(req.body.password, user.password)) {
      return res.status(200).json({ status: false, message: "Email and password does not match!" });
    }

    const payload = {
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      type: type,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "24h" });

    if (type === "admin") {
      return res.status(200).json({
        status: true,
        message: "Admin Login Successful",
        token,
        admin: user,
      });
    } else {
      return res.status(200).json({
        status: true,
        message: "Sub Admin Login Successful",
        token,
        subAdmin: user,
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

exports.getProfile = async (req, res) => {
  try {
    if (req.admin) {
      return res.status(200).json({ status: true, message: "Success", admin: req.admin });
    }
    if (req.subAdmin) {
      return res.status(200).json({ status: true, message: "Success", subAdmin: req.subAdmin });
    }
    return res.status(200).json({ status: false, message: "Profile not found" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    let user;
    if (req.admin) {
      user = await Admin.findById(req.admin._id);
    } else if (req.subAdmin) {
      user = await SubAdmin.findById(req.subAdmin._id);
    }

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found" });
    }

    if (req.body.name) user.name = req.body.name;
    if (req.body.email) user.email = req.body.email;
    if (req.body.image) user.image = req.body.image;

    await user.save();
    return res.status(200).json({ status: true, message: "Profile updated successfully", admin: user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    let user;
    if (req.admin) user = await Admin.findById(req.admin._id);
    else if (req.subAdmin) user = await SubAdmin.findById(req.subAdmin._id);

    if (!user) return res.status(200).json({ status: false, message: "User not found" });

    if (!verifyPassword(req.body.oldPassword, user.password)) {
      return res.status(200).json({ status: false, message: "Old password does not match!" });
    }

    user.password = hashPassword(req.body.newPassword);
    await user.save();

    return res.status(200).json({ status: true, message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    let user = await Admin.findOne({ email: req.body.email });
    if (!user) {
      user = await SubAdmin.findOne({ email: req.body.email });
    }
    
    if (!user) {
      return res.status(200).json({ status: false, message: "Admin does not exist" });
    }

    const randomPassword = Math.random().toString(36).slice(-8);
    user.password = hashPassword(randomPassword);
    await user.save();
    
    console.log(`Password reset for ${req.body.email}: ${randomPassword}`);

    return res.status(200).json({ status: true, message: "Password reset successfully. Check console/email for new password." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

exports.setPassword = async (req, res) => {
  try {
    let user = await Admin.findById(req.body.adminId);
    if (!user) user = await SubAdmin.findById(req.body.adminId);
    
    if (!user) return res.status(200).json({ status: false, message: "User not found" });

    user.password = hashPassword(req.body.password);
    await user.save();

    return res.status(200).json({ status: true, message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
