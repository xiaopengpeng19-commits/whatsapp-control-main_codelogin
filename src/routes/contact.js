const Router = require('koa-router');
const contactController = require('../controllers/contact');
const { validateContact } = require('../middleware/validation');

const router = new Router();

router.post('/list', contactController.getAllContacts);





module.exports = router; 