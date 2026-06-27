const Router = require('koa-router');
const messageController = require('../controllers/message');
const { validateMessage } = require('../middleware/validation');

const router = new Router();

router.post('/',  messageController.sendMessage);
router.post('/link',  messageController.sendLinkMessage);

router.post('/bulk', validateMessage, messageController.sendBulkMessages);

router.post('/history', messageController.getMessageHistory);

module.exports = router; 