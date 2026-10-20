const mongoose = require('mongoose');
const { getDashboardAnalysis } = require('../services/dashboardAnalysisService');

const ALLOWED_QUERY_KEYS = new Set(['mode', 'year', 'fromMonth', 'toMonth', 'fromDate', 'toDate']);

exports.getDashboardAnalysis = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    if (!mongoose.isValidObjectId(instructorId)) return res.status(400).json({ message: 'معرف المدرس غير صالح' });
    if (String(req.user._id) !== String(instructorId)) return res.status(403).json({ message: 'غير مصرح لك بعرض تحليلات مؤسسة أخرى' });
    if (Object.keys(req.query).some((key) => !ALLOWED_QUERY_KEYS.has(key))) return res.status(400).json({ message: 'معاملات التصفية غير صالحة' });
    if (Object.values(req.query).some((value) => typeof value !== 'string')) return res.status(400).json({ message: 'معاملات التصفية غير صالحة' });

    const data = await getDashboardAnalysis({ tenantFilter: req.tenantFilter, query: req.query });
    return res.json({ data });
  } catch (err) {
    return next(err);
  }
};

