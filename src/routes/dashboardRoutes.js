const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { getDashboardSummary } = require('../controllers/dashboardController');
const { getDashboardAnalysis } = require('../controllers/dashboardAnalysisController');

const router = express.Router();
router.get('/:instructorId/dashboard/summary', protect, tenantScope, authorize('admin'), getDashboardSummary);
router.get('/:instructorId/dashboard/analysis', protect, tenantScope, authorize('admin'), getDashboardAnalysis);
module.exports = router;
