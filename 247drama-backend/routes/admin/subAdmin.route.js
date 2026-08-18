const express = require("express");
const router = express.Router();

const subAdminCtrl = require("../../controllers/admin/subAdmin.controller"); 
const adminMiddleware = require("../../middleware/admin.middleware");

const checkAccessWithSecretKey = require("../../checkAccess");

router.use(checkAccessWithSecretKey());

// Create sub admin
router.post("/inductSubAdmin", adminMiddleware, subAdminCtrl.inductSubAdmin);

// Update Sub Admin
router.patch("/refineSubAdmin", adminMiddleware, subAdminCtrl.refineSubAdmin);

// Toggle Sub Admin Active Status
router.patch("/transitionSubAdminState", adminMiddleware, subAdminCtrl.transitionSubAdminState);

// Delete Sub Admin
router.delete("/decommissionSubAdmin", adminMiddleware, subAdminCtrl.decommissionSubAdmin);

// Get All Sub Admin
router.get("/catalogSubAdmins", adminMiddleware, subAdminCtrl.catalogSubAdmins);

// Login Sub Admin
router.post("/authenticateSubAdmin", subAdminCtrl.authenticateSubAdmin);

module.exports = router;
