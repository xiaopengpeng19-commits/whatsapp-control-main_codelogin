const Router = require('koa-router');
const chatController = require('../controllers/chat');


const router = new Router();

router.post('/list', chatController.getAllChats);





module.exports = router; 