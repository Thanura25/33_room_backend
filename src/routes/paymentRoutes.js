const router = require('express').Router();
const controller = require('../controllers/paymentController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.post('/', requireAuth, requireAdmin, controller.create);
module.exports = router;
