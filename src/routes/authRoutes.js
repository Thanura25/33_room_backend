const router = require('express').Router();
const controller = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

router.post('/register', controller.register);
router.get('/setup', controller.setup);
router.post('/login', controller.login);
router.get('/me', requireAuth, controller.me);

module.exports = router;
