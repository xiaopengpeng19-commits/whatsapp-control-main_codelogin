const Router = require('koa-router');
const groupController = require('../controllers/group');
const { validateGroup } = require('../middleware/validation');

const router = new Router();

// router.get('/', groupController.getAllGroups);

router.post('/', groupController.createGroup);
router.post('/leaveGroup', groupController.leaveGroup);
router.post('/getInviteCode', groupController.getInviteCode);
router.post('/joinGroup', groupController.joinGroup);
router.post('/groupInfo', groupController.groupInfo);
router.post('/groupAllInfo', groupController.groupAllInfo);
router.get('/:id', groupController.getGroup);

router.post('/:id/participants', groupController.addParticipants);

router.delete('/:id/participants', groupController.removeParticipants);

router.delete('/:id', groupController.deleteGroup);

module.exports = router; 