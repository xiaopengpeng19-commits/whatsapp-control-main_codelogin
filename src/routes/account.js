const Router = require('koa-router');
const accountController = require('../controllers/account');
const { validateAccount } = require('../middleware/validation');

const router = new Router();

// 登录相关路由
router.post('/loginByPhone', accountController.loginWithPhone);  // 新的手机号码登录端点
router.post('/loginByPairCode',accountController.loginByPairCode);
router.post('/loginByQrCode', accountController.loginByQrcode);


router.post('/', accountController.getAllAccounts);
router.post('/checkonwhatsapp',accountController.checkonwhatsapp);

router.get('/:id', accountController.getAccount);

router.post('/:id/connect', accountController.connectAccount);

router.post('/:id/disconnect', accountController.disconnectAccount);

router.post('/delete', accountController.deleteAccount);

router.post('/online',accountController.online);
module.exports = router; 