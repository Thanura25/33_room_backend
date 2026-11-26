const router = require('express').Router();
const controller = require('../controllers/billController');
const { requireAdmin, requireAuth } = require('../middleware/authMiddleware');

router.use(requireAuth);
router.post('/', requireAdmin, controller.create);
router.put('/:month', requireAdmin, controller.save);
router.post('/:id/notifications', requireAdmin, require('../controllers/notificationController').send);
router.get('/:id', controller.details);
module.exports = router;
