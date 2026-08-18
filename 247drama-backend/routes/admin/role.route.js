const express = require("express");
const router = express.Router();

const roleCtrl = require("../../controllers/admin/role.controller");

const checkAccessWithSecretKey = require("../../checkAccess");
const adminMiddleware = require("../../middleware/admin.middleware");

router.use(checkAccessWithSecretKey());

// Create Role
router.post("/forgeRole", adminMiddleware, roleCtrl.forgeRole);

// Update Role
router.patch("/refineRole", adminMiddleware, roleCtrl.refineRole);

// Get All Roles
router.get("/catalogRoles", adminMiddleware, roleCtrl.catalogRoles);

// Delete Role
router.delete("/decommissionRole", adminMiddleware, roleCtrl.decommissionRole);

// Get All Roles ( When Create Staff )
router.get("/fetchAssignableRoles", adminMiddleware, roleCtrl.fetchAssignableRoles);

// Toggle Role Active Status
router.patch("/transitionRoleState", adminMiddleware, roleCtrl.transitionRoleState);

module.exports = router;
