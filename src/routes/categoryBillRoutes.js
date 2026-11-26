const router = require('express').Router();
const controller = require('../controllers/categoryBillController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.use(requireAuth);
router.get('/categories', controller.getCategories);
router.get('/', controller.getMonthBills);
router.post('/', requireAdmin, controller.createBill);
router.post('/preview-distribution', requireAdmin, controller.previewDistribution);
router.post('/distribute', requireAdmin, controller.distributeBill);
router.delete('/:id', requireAdmin, controller.deleteBill);

module.exports = router;
