// src/routes/group.js
const Router = require("koa-router");
const groupController = require("../controllers/group");

const router = new Router();

router.post("/create", groupController.createGroup);
router.post("/leave", groupController.leaveGroup);
router.post("/invite", groupController.getInviteCode);
router.post("/join", groupController.joinGroup);
router.post("/info", groupController.groupInfo);
router.post("/list", groupController.groupAllInfo);
router.post("/members", groupController.groupParticipantsUpdate);
router.post("/send", groupController.sendGroupMessage);

// 兼容旧路由
router.post("/", groupController.createGroup);
router.post("/leaveGroup", groupController.leaveGroup);
router.post("/getInviteCode", groupController.getInviteCode);
router.post("/joinGroup", groupController.joinGroup);
router.post("/groupInfo", groupController.groupInfo);
router.post("/groupAllInfo", groupController.groupAllInfo);

module.exports = router;