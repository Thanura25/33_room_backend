const router = require('express').Router();
const controller = require('../controllers/memberController');
const { requireAuth, requireMemberOrAdmin } = require('../middleware/authMiddleware');

router.use(requireAuth);
router.use(requireMemberOrAdmin);

router.get('/dashboard', controller.getMyDashboard);
router.get('/receipts/:id', controller.getMyReceipt);

module.exports = router;
