const router = require('express').Router();
const controller = require('../controllers/notificationController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.use(requireAuth);
router.get('/', controller.list);
router.post('/send', requireAdmin, controller.send);
module.exports = router;
