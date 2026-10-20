const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { initReelUpload, confirmReelUpload, listReels, incrementView, deleteReel } = require('../controllers/reelController');

router.post(
  '/instructors/:instructorId/reels/upload-init',
  protect,
  tenantScope,
  authorize('admin', 'assistant'),
  initReelUpload
);
router.post('/instructors/:instructorId/reels/confirm-upload', protect, tenantScope, authorize('admin', 'assistant'), confirmReelUpload);

router.get('/instructors/:instructorId/reels', protect, tenantScope, authorize('student', 'admin', 'assistant'), listReels);
router.patch('/reels/:reelId/view', protect, tenantScope, authorize('student'), incrementView);
router.delete('/reels/:reelId', protect, tenantScope, authorize('admin', 'assistant'), deleteReel);

module.exports = router;
