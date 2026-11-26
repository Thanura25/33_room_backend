const router = require('express').Router();
const controller = require('../controllers/residentController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.use(requireAuth);
router.get('/', controller.list);
router.post('/', requireAdmin, controller.create);
router.put('/:id', requireAdmin, controller.update);
router.post('/:id/account', requireAdmin, controller.setAccount);

module.exports = router;
