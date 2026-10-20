const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Course = require('../models/Course');
const Assignment = require('../models/Assignment');
const VideoProgress = require('../models/VideoProgress');

const CAIRO_TIME_ZONE = 'Africa/Cairo';
const ACTIVE_STUDENT_WINDOW_DAYS = 30;

function invalid(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }

function cairoParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function cairoDateTimeToUtc(year, month, day) {
  const localAsUtc = Date.UTC(year, month - 1, day);
  let candidate = localAsUtc;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate = localAsUtc - (representedAsUtc - candidate);
  }
  return new Date(candidate);
}

function monthName(year, month) {
  return new Intl.DateTimeFormat('ar-EG', { month: 'long', timeZone: CAIRO_TIME_ZONE }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function parseInteger(value, label, minimum, maximum) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) invalid(label + ' غير صالح');
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) invalid(label + ' غير صالح');
  return number;
}

function parseIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(label + ' غير صالح');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) invalid(label + ' غير صالح');
  return { year, month, day, value };
}

function addCalendarDays(value, amount) {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function addCalendarMonths(year, month, amount) {
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function dateKey(value) {
  return value.year + '-' + String(value.month).padStart(2, '0') + '-' + String(value.day).padStart(2, '0');
}

function createRange(query = {}) {
  const now = new Date();
  const today = cairoParts(now);
  const isDefault = !Object.keys(query).length;
  if (!isDefault && !['day', 'month', 'year'].includes(query.mode)) invalid('نوع الفترة غير صالح');

  if (isDefault || (query.mode === 'month' && query.fromMonth === undefined && query.toMonth === undefined && (query.year === undefined || query.year === String(today.year)))) {
    const start = cairoDateTimeToUtc(today.year, today.month, 1);
    const next = addCalendarMonths(today.year, today.month, 1);
    const end = cairoDateTimeToUtc(next.year, next.month, 1);
    const previous = addCalendarMonths(today.year, today.month, -1);
    const previousStart = cairoDateTimeToUtc(previous.year, previous.month, 1);
    const days = new Date(Date.UTC(next.year, next.month - 1, 0)).getUTCDate();
    const buckets = Array.from({ length: Math.ceil(days / 7) }, (_, index) => ({
      key: 'week-' + (index + 1),
      label: 'الأسبوع ' + new Intl.NumberFormat('ar-EG').format(index + 1)
    }));
    return { mode: 'week', isDefault: true, start, end, previousStart, previousEnd: start, buckets, periodLabel: 'أسابيع ' + monthName(today.year, today.month) + ' ' + today.year, snapshotAt: now, year: today.year, month: today.month };
  }

  if (query.mode === 'month') {
    if (query.fromDate !== undefined || query.toDate !== undefined) invalid('معاملات التصفية غير صالحة لهذا النوع');
    const year = query.year === undefined ? today.year : parseInteger(query.year, 'السنة', 2000, today.year);
    if (query.fromMonth === undefined) invalid('شهر البداية مطلوب');
    const fromMonth = parseInteger(query.fromMonth, 'شهر البداية', 1, 12);
    const toMonth = query.toMonth === undefined || query.toMonth === '' ? fromMonth : parseInteger(query.toMonth, 'شهر النهاية', 1, 12);
    if (toMonth < fromMonth) invalid('شهر النهاية يجب أن يكون بعد شهر البداية أو مساوياً له');
    if (year === today.year && toMonth > today.month) invalid('لا يمكن اختيار شهر مستقبلي');
    const count = toMonth - fromMonth + 1;
    const start = cairoDateTimeToUtc(year, fromMonth, 1);
    const after = addCalendarMonths(year, toMonth, 1);
    const end = cairoDateTimeToUtc(after.year, after.month, 1);
    const previous = addCalendarMonths(year, fromMonth, -count);
    const previousStart = cairoDateTimeToUtc(previous.year, previous.month, 1);
    const buckets = Array.from({ length: count }, (_, index) => {
      const item = addCalendarMonths(year, fromMonth, index);
      return { key: item.year + '-' + String(item.month).padStart(2, '0'), label: monthName(item.year, item.month) + ' ' + item.year };
    });
    const label = count === 1 ? buckets[0].label : 'من ' + buckets[0].label + ' إلى ' + buckets[buckets.length - 1].label;
    return { mode: 'month', isDefault: false, start, end, previousStart, previousEnd: start, buckets, periodLabel: label, snapshotAt: end < now ? new Date(end.getTime() - 1) : now, year, fromMonth, toMonth };
  }

  if (query.mode === 'year') {
    if (query.fromMonth !== undefined || query.toMonth !== undefined || query.fromDate !== undefined || query.toDate !== undefined) invalid('معاملات التصفية غير صالحة لهذا النوع');
    const year = query.year === undefined ? today.year : parseInteger(query.year, 'السنة', 2000, today.year);
    const start = cairoDateTimeToUtc(year, 1, 1);
    const end = cairoDateTimeToUtc(year + 1, 1, 1);
    const previousStart = cairoDateTimeToUtc(year - 1, 1, 1);
    const buckets = Array.from({ length: 12 }, (_, index) => ({ key: year + '-' + String(index + 1).padStart(2, '0'), label: monthName(year, index + 1) }));
    return { mode: 'year', isDefault: false, start, end, previousStart, previousEnd: start, buckets, periodLabel: 'سنة ' + year, snapshotAt: end < now ? new Date(end.getTime() - 1) : now, year };
  }

  if (query.mode === 'day') {
    if (query.year !== undefined || query.fromMonth !== undefined || query.toMonth !== undefined) invalid('معاملات التصفية غير صالحة لهذا النوع');
    const from = parseIsoDate(query.fromDate, 'تاريخ البداية');
    const to = parseIsoDate(query.toDate, 'تاريخ النهاية');
    if (dateKey(to) < dateKey(from)) invalid('تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له');
    if (dateKey(to) > dateKey(today)) invalid('لا يمكن اختيار تاريخ مستقبلي');
    const dayCount = (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86400000 + 1;
    if (dayCount > 62) invalid('الحد الأقصى للفترة اليومية هو 62 يوماً');
    const endDay = addCalendarDays(to, 1);
    const previousFrom = addCalendarDays(from, -dayCount);
    const start = cairoDateTimeToUtc(from.year, from.month, from.day);
    const end = cairoDateTimeToUtc(endDay.year, endDay.month, endDay.day);
    const previousStart = cairoDateTimeToUtc(previousFrom.year, previousFrom.month, previousFrom.day);
    const buckets = Array.from({ length: dayCount }, (_, index) => {
      const item = addCalendarDays(from, index);
      return { key: dateKey(item), label: new Intl.NumberFormat('ar-EG').format(item.day) + '/' + new Intl.NumberFormat('ar-EG').format(item.month) };
    });
    const periodLabel = dayCount === 1 ? from.value : 'من ' + from.value + ' إلى ' + to.value;
    return { mode: 'day', isDefault: false, start, end, previousStart, previousEnd: start, buckets, periodLabel, snapshotAt: end < now ? new Date(end.getTime() - 1) : now, fromDate: from.value, toDate: to.value };
  }

  invalid('نوع الفترة غير صالح');
}

function bucketExpression(mode) {
  if (mode === 'week') return { $ceil: { $divide: [{ $dayOfMonth: { date: '$createdAt', timezone: CAIRO_TIME_ZONE } }, 7] } };
  if (mode === 'day') return { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: CAIRO_TIME_ZONE } };
  return { $dateToString: { date: '$createdAt', format: '%Y-%m', timezone: CAIRO_TIME_ZONE } };
}

function keyFromGroup(mode, value) { return mode === 'week' ? 'week-' + value : value; }

async function aggregatePurchases(tenantFilter, range) {
  return Transaction.aggregate([
    { $match: { ...tenantFilter, status: 'success', type: 'purchase', createdAt: { $gte: range.start, $lt: range.end } } },
    { $group: { _id: { bucket: bucketExpression(range.mode), source: '$source' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
}

async function previousPurchaseTotal(tenantFilter, range) {
  const [result] = await Transaction.aggregate([
    { $match: { ...tenantFilter, status: 'success', type: 'purchase', createdAt: { $gte: range.previousStart, $lt: range.previousEnd } } },
    { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  return { amount: result?.amount || 0, count: result?.count || 0 };
}

async function studentBucketCounts(tenantFilter, range) {
  return User.aggregate([
    { $match: { ...tenantFilter, role: 'student', createdAt: { $gte: range.start, $lt: range.end } } },
    { $group: { _id: bucketExpression(range.mode), count: { $sum: 1 } } }
  ]);
}

async function studentMonthBuckets(tenantFilter, start, end) {
  return User.aggregate([
    { $match: { ...tenantFilter, role: 'student', createdAt: { $gte: start, $lt: end } } },
    { $group: { _id: {
      month: { $dateToString: { date: '$createdAt', format: '%Y-%m', timezone: CAIRO_TIME_ZONE } },
      week: { $ceil: { $divide: [{ $dayOfMonth: { date: '$createdAt', timezone: CAIRO_TIME_ZONE } }, 7] } }
    }, count: { $sum: 1 } } }
  ]);
}

async function studentTotalsAsOf(tenantFilter, snapshotAt) {
  const activeSince = new Date(snapshotAt.getTime() - ACTIVE_STUDENT_WINDOW_DAYS * 86400000);
  const [result] = await User.aggregate([
    { $match: { ...tenantFilter, role: 'student', createdAt: { $lte: snapshotAt } } },
    { $lookup: {
      from: VideoProgress.collection.name,
      let: { userId: '$_id' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$tenantId', new mongoose.Types.ObjectId(String(tenantFilter.tenantId))] },
          { $eq: ['$studentId', '$$userId'] },
          { $gte: ['$lastWatchedAt', activeSince] },
          { $lte: ['$lastWatchedAt', snapshotAt] }
        ] } } },
        { $limit: 1 },
        { $project: { _id: 1 } }
      ],
      as: 'recentLearningActivity'
    } },
    { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $gt: [{ $size: '$recentLearningActivity' }, 0] }, 1, 0] } } } }
  ]);
  return { total: result?.total || 0, active: result?.active || 0, inactive: (result?.total || 0) - (result?.active || 0) };
}

async function groupedPurchaseSources(tenantFilter, range) {
  const [purchaseSources, topups] = await Promise.all([
    Transaction.aggregate([
      { $match: { ...tenantFilter, status: 'success', type: 'purchase', createdAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: '$source', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1, _id: 1 } }
    ]),
    Transaction.aggregate([
      { $match: { ...tenantFilter, status: 'success', type: 'topup', source: 'scratchcard', createdAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ])
  ]);
  return { purchaseSources: purchaseSources.map((item) => ({ source: item._id || 'other', amount: item.amount, count: item.count })), scratchcardTopups: topups[0] || { amount: 0, count: 0 } };
}

async function getDashboardAnalysis({ tenantFilter, query }) {
  const range = createRange(query);
  const now = new Date();
  const currentParts = cairoParts(now);
  const currentMonthStart = cairoDateTimeToUtc(currentParts.year, currentParts.month, 1);
  const nextMonth = addCalendarMonths(currentParts.year, currentParts.month, 1);
  const currentMonthEnd = cairoDateTimeToUtc(nextMonth.year, nextMonth.month, 1);
  const previousMonth = addCalendarMonths(currentParts.year, currentParts.month, -1);
  const previousMonthStart = cairoDateTimeToUtc(previousMonth.year, previousMonth.month, 1);
  const snapshotAt = range.snapshotAt;

  const [purchaseGroups, previousPurchase, studentGroups, currentStudentMonth, previousStudentMonth, studentTotals, publishedCourses, pendingAssignments, sourceData] = await Promise.all([
    aggregatePurchases(tenantFilter, range),
    previousPurchaseTotal(tenantFilter, range),
    studentBucketCounts(tenantFilter, range),
    User.countDocuments({ ...tenantFilter, role: 'student', createdAt: { $gte: currentMonthStart, $lt: currentMonthEnd } }),
    User.countDocuments({ ...tenantFilter, role: 'student', createdAt: { $gte: previousMonthStart, $lt: currentMonthStart } }),
    studentTotalsAsOf(tenantFilter, snapshotAt),
    Course.countDocuments({ ...tenantFilter, isPublished: true }),
    Assignment.countDocuments({ ...tenantFilter, status: 'pending', submittedAt: { $gte: range.start, $lt: range.end } }),
    groupedPurchaseSources(tenantFilter, range)
  ]);

  const buckets = range.buckets.map((bucket) => ({ ...bucket, amount: 0, transactions: 0 }));
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const group of purchaseGroups) {
    const bucket = bucketByKey.get(keyFromGroup(range.mode, group._id.bucket));
    if (bucket) { bucket.amount += group.amount || 0; bucket.transactions += group.count || 0; }
  }
  const totalProfit = buckets.reduce((total, bucket) => total + bucket.amount, 0);
  const totalTransactions = buckets.reduce((total, bucket) => total + bucket.transactions, 0);
  const studentByKey = new Map(studentGroups.map((item) => [keyFromGroup(range.mode, item._id), item.count]));
  const studentSeries = range.buckets.map((bucket) => ({ ...bucket, count: studentByKey.get(bucket.key) || 0 }));
  const newStudentsInPeriod = studentSeries.reduce((total, bucket) => total + bucket.count, 0);
  const newStudentsPreviousPeriod = range.isDefault
    ? previousStudentMonth
    : await User.countDocuments({ ...tenantFilter, role: 'student', createdAt: { $gte: range.previousStart, $lt: range.start } });

  let defaultStudentSeries = null;
  if (range.isDefault) {
    const groupedMonths = await studentMonthBuckets(tenantFilter, previousMonthStart, currentMonthEnd);
    const grouped = new Map(groupedMonths.map((item) => [item._id.month + '|week-' + item._id.week, item.count]));
    const currentMonthKey = currentParts.year + '-' + String(currentParts.month).padStart(2, '0');
    const previousMonthKey = previousMonth.year + '-' + String(previousMonth.month).padStart(2, '0');
    defaultStudentSeries = range.buckets.map((bucket) => ({
      ...bucket,
      current: grouped.get(currentMonthKey + '|' + bucket.key) || 0,
      previous: grouped.get(previousMonthKey + '|' + bucket.key) || 0
    }));
  }

  const previousTotal = previousPurchase.amount;
  const percentChange = previousTotal > 0 ? ((totalProfit - previousTotal) / previousTotal) * 100 : null;
  const studentPercentChange = newStudentsPreviousPeriod > 0 ? ((newStudentsInPeriod - newStudentsPreviousPeriod) / newStudentsPreviousPeriod) * 100 : null;
  const sourceTotal = sourceData.purchaseSources.reduce((total, source) => total + source.amount, 0);

  return {
    period: { mode: range.mode, isDefault: range.isDefault, label: range.periodLabel, start: range.start, end: range.end, snapshotAt },
    profits: {
      total: totalProfit, average: buckets.length ? totalProfit / buckets.length : 0,
      bestPeriod: buckets.reduce((best, bucket) => bucket.amount > best.amount ? bucket : best, { label: '—', amount: -Infinity }),
      dataPoints: buckets.length, transactions: totalTransactions, previousTotal, previousTransactions: previousPurchase.count,
      percentChange: Number.isFinite(percentChange) ? percentChange : null,
      series: buckets.map(({ key, label, amount, transactions }) => ({ key, label, amount, transactions })),
      revenueBySource: sourceData.purchaseSources, revenueSourceTotal: sourceTotal, scratchcardTopups: sourceData.scratchcardTopups
    },
    students: {
      total: studentTotals.total, active: studentTotals.active, inactive: studentTotals.inactive, activeWindowDays: ACTIVE_STUDENT_WINDOW_DAYS,
      newInPeriod: newStudentsInPeriod, newPreviousPeriod: newStudentsPreviousPeriod,
      newPercentChange: Number.isFinite(studentPercentChange) ? studentPercentChange : null,
      currentMonth: currentStudentMonth, previousMonth: previousStudentMonth,
      existingStudents: Math.max(0, studentTotals.total - currentStudentMonth - previousStudentMonth),
      series: studentSeries.map(({ key, label, count }) => ({ key, label, count })),
      defaultWeeklySeries: defaultStudentSeries
    },
    platform: { publishedCourses, pendingAssignments }
  };
}

module.exports = { createRange, getDashboardAnalysis, ACTIVE_STUDENT_WINDOW_DAYS };

