const router = require('express').Router();
const controller = require('../controllers/financialController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.use(requireAuth);
router.get('/balances', requireAdmin, controller.getBalances);
router.post('/payments', requireAdmin, controller.recordPayment);
router.get('/payments', requireAdmin, controller.getPayments);
router.get('/receipts/:id', controller.getReceipt);

module.exports = router;
