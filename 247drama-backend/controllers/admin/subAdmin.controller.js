const Role = require("../../models/role.model");
const SubAdmin = require("../../models/subAdmin.model");
const { sendEmail } = require("../../util/emailService");
const { subAdminCreatedTemplate, subAdminUpdatedTemplate } = require("../../util/emailTemplates");
const jwt = require("jsonwebtoken");

const mongoose = require("mongoose");

//Cryptr
const Cryptr = require("cryptr");
const cryptr = new Cryptr("myTotallySecretKey");

const emailRegex = /^(?=.{6,254}$)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&^#()[\]{}\-_=+|:;"'<>,./~`])[A-Za-z\d@$!%*?&^#()[\]{}\-_=+|:;"'<>,./~`]{8,}$/;

// Create sub admin
exports.inductSubAdmin = async (req, res) => {
  try {
    const { name, email, password, roleId } = req.body;

    if (!name.trim() || !email || !password || !roleId) {
      return res.status(200).json({ status: false, message: "All fields (name, email, password, roleId) are required." });
    }

    if (!emailRegex.test(email)) {
      return res.status(200).json({
        status: false,
        message: "Invalid email format.",
      });
    }

    if (!passwordRegex.test(password)) {
      return res.status(200).json({
        status: false,
        message: "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(200).json({ status: false, message: "Invalid roleId." });
    }

    const [roleExists, emailExists] = await Promise.all([Role.findById(roleId), SubAdmin.findOne({ email })]);

    if (!roleExists) {
      return res.status(200).json({ status: false, message: "Invalid role selected." });
    }

    if (emailExists) {
      return res.status(200).json({ status: false, message: "Email already in use." });
    }

    const subAdmin = new SubAdmin({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: cryptr.encrypt(password),
      role: roleId,
    });
    await subAdmin.save();

    res.status(200).json({
      status: true,
      message: "Sub admin created successfully.",
      subAdmin: {
        name: subAdmin.name,
        email: subAdmin.email,
        role: subAdmin.role,
        _id: subAdmin._id,
      },
    });

    await sendEmail({
      to: subAdmin.email,
      subject: "Your Sub Admin Account Has Been Created",
      html: subAdminCreatedTemplate(subAdmin.name, subAdmin.email, password),
    });
  } catch (err) {
    console.error("Create Sub admin Error:", err);
    return res.status(500).json({ status: false, message: "Server error." });
  }
};

// Update Sub Admin
exports.refineSubAdmin = async (req, res) => {
  try {
    const { subAdminId, name, email, password, roleId, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(subAdminId)) {
      return res.status(200).json({ status: false, message: "Invalid Sub Admin ID." });
    }

    const subAdmin = await SubAdmin.findById(subAdminId);

    if (!subAdmin) {
      return res.status(200).json({ status: false, message: "Sub Admin not found." });
    }

    let updatedEmail = subAdmin.email;
    let updatedPassword = null;

    if (email && email !== subAdmin.email) {
      if (!emailRegex.test(email)) {
        return res.status(200).json({
          status: false,
          message: "Invalid email format.",
        });
      }

      const emailExists = await SubAdmin.findOne({ email, _id: { $ne: subAdminId } });
      if (emailExists) {
        return res.status(200).json({ status: false, message: "Email already in use." });
      }

      subAdmin.email = email.toLowerCase().trim();
      updatedEmail = subAdmin.email;
    }

    if (password) {
      if (!passwordRegex.test(password)) {
        return res.status(200).json({
          status: false,
          message: "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.",
        });
      }

      updatedPassword = password;
      subAdmin.password = cryptr.encrypt(password);
    }

    if (name) subAdmin.name = name.trim();
    if (typeof isActive === "boolean") subAdmin.isActive = isActive;
    if (roleId && mongoose.Types.ObjectId.isValid(roleId)) subAdmin.role = roleId;

    const updated = await subAdmin.save();

    res.status(200).json({
      status: true,
      message: "Sub Admin updated successfully.",
      subAdmin: {
        name: updated.name,
        email: updated.email,
        role: updated.role,
        _id: updated._id,
      },
    });

    await sendEmail({
      to: updated.email,
      subject: "Your Sub Admin Account Was Updated",
      html: subAdminUpdatedTemplate(updated.name, email ? updatedEmail : subAdmin.email, password ? updatedPassword : cryptr.decrypt(subAdmin.password)),
    });
  } catch (error) {
    console.error("Update Sub Admin Error:", error);
    return res.status(500).json({ status: false, message: "Internal server error." });
  }
};

// Toggle Sub Admin Active Status
exports.transitionSubAdminState = async (req, res) => {
  try {
    const { subAdminId } = req.query;

    if (!subAdminId) {
      return res.status(200).json({ status: false, message: "subAdmin ID is required." });
    }

    if (!mongoose.Types.ObjectId.isValid(subAdminId)) {
      return res.status(200).json({ status: false, message: "Invalid Sub Admin ID." });
    }

    const subAdmin = await SubAdmin.findById(subAdminId);
    if (!subAdmin) {
      return res.status(200).json({ status: false, message: "Sub Admin not found." });
    }

    subAdmin.isActive = !subAdmin.isActive;
    await subAdmin.save();

    return res.status(200).json({
      status: true,
      message: `Sub Admin has been ${subAdmin.isActive ? "activated" : "deactivated"} successfully.`,
      data: {
        _id: subAdmin._id,
        isActive: subAdmin.isActive,
        name: subAdmin.name,
        email: subAdmin.email,
        role: subAdmin.role,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: false,
      message: "An error occurred while updating Sub Admin active status.",
    });
  }
};

// Delete Sub Admin
exports.decommissionSubAdmin = async (req, res) => {
  try {
    const { subAdminId } = req.query;

    if (!subAdminId) {
      return res.status(200).json({ status: false, message: "subAdminId is required." });
    }

    if (!mongoose.Types.ObjectId.isValid(subAdminId)) {
      return res.status(200).json({ status: false, message: "Invalid Sub Admin ID." });
    }

    const subAdmin = await SubAdmin.findById(subAdminId);
    if (!subAdmin) {
      return res.status(200).json({ status: false, message: "Sub Admin not found." });
    }

    res.status(200).json({ status: true, message: "Sub Admin deleted successfully." });

    await SubAdmin.findByIdAndDelete(subAdminId);
  } catch (error) {
    console.error("Delete Sub Admin Error:", error);
    return res.status(500).json({ status: false, message: "Internal server error." });
  }
};

// Get All Sub Admin
exports.catalogSubAdmins = async (req, res) => {
  try {
    let start = Number(req.query.start);
    let limit = Number(req.query.limit);

    if (!Number.isInteger(start) || start < 1) {
      start = 1;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      limit = 20;
    }

    limit = Math.min(limit, 50);
    start = Math.min(start, 100000);

    const skip = (start - 1) * limit;

    const { search } = req.query;
    const filter = {};
    if (search && search.trim() !== "") {
      filter.$or = [{ name: { $regex: search.trim(), $options: "i" } }, { email: { $regex: search.trim(), $options: "i" } }];
    }

    const [subAdminList, total] = await Promise.all([
      SubAdmin.find(filter).select("-password").populate({ path: "role", select: "name permissions isActive" }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SubAdmin.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: true,
      message: "Sub Admin list retrieved successfully.",
      total,
      data: subAdminList,
    });
  } catch (err) {
    console.error("Get Sub Admin List Error:", err);
    return res.status(500).json({ status: false, message: "Internal server error." });
  }
};

// Login Sub Admin
exports.authenticateSubAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const subAdmin = await SubAdmin.findOne({ email }).populate("role");

    if (!subAdmin) {
      return res.status(200).json({ status: false, message: "Sub Admin not found" });
    }

    if (!subAdmin.password) {
      return res.status(200).json({ status: false, message: "Password not found!" });
    }

    if (cryptr.decrypt(subAdmin.password) !== password) {
      return res.status(200).json({ status: false, message: "Oops! Password doesn't match!" });
    }

    const ip = req.ip.replace(/^::ffff:/, "");

    subAdmin.lastLoginIp = ip;
    subAdmin.lastLoginAt = new Date();

    const payload = {
      _id: subAdmin._id,
      name: subAdmin.name,
      email: subAdmin.email,
      role: subAdmin.role.name,
      permissions: subAdmin.role.permissions,
      type: "subAdmin",
    };

    const token = jwt.sign(payload, process?.env?.JWT_SECRET, { expiresIn: "1h" });

    await subAdmin.save();

    return res.status(200).json({
      status: true,
      message: "Login successful",
      subAdmin: {
        _id: subAdmin._id,
        name: subAdmin.name,
        email: subAdmin.email,
        role: subAdmin.role.name,
        permissions: subAdmin.role.permissions,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
