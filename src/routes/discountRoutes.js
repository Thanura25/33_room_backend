const router = require('express').Router();
const controller = require('../controllers/discountController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.use(requireAuth);

router.get('/', controller.getDiscount);
router.post('/preview', requireAdmin, controller.previewDiscount);
router.post('/', requireAdmin, controller.saveDiscount);
router.delete('/', requireAdmin, controller.deleteDiscount);

module.exports = router;
