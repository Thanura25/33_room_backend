const router = require('express').Router();
const controller = require('../controllers/reportController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.use(requireAuth);
router.get('/', requireAdmin, controller.getReport);

module.exports = router;
