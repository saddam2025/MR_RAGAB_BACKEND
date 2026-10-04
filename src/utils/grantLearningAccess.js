const CourseEnrollment = require('../models/CourseEnrollment');
const LectureAccess = require('../models/LectureAccess');

function expiry(days) { const value = new Date(); value.setDate(value.getDate() + Number(days || 10)); return value; }

async function grantCourseEnrollment({ course, studentId, tenantId, source, session = null }) {
  const now = new Date();
  const identity = { tenantId, studentId, courseId: course._id };
  const renewal = {
    $set: { purchasedAt: now, expiresAt: expiry(course.accessPeriodDays), source }
  };

  // Renew the existing unique row only after its prior access expired. This
  // keeps history compact while making the new access window and purchase
  // source authoritative for the latest purchase.
  const renewed = await CourseEnrollment.findOneAndUpdate(
    { ...identity, expiresAt: { $lte: now } },
    renewal,
    { new: true, session }
  );
  if (renewed) return renewed;

  return CourseEnrollment.findOneAndUpdate(
    identity,
    { $setOnInsert: { ...identity, purchasedAt: now, expiresAt: expiry(course.accessPeriodDays), source } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
}

// LectureAccess is the pre-existing per-item access mechanism. Its legacy
// `courseId` key stores the protected item's id, which lectureController
// already compares against lecture._id; keeping that representation avoids a
// parallel access collection during this migration.
async function grantLectureAccess({ lecture, studentId, tenantId, session = null }) {
  return LectureAccess.findOneAndUpdate(
    { tenantId, studentId, courseId: lecture._id },
    { $setOnInsert: { tenantId, studentId, courseId: lecture._id, purchasedAt: new Date(), expiresAt: expiry(lecture.accessPeriodDays), maxViews: lecture.maxViews, viewsUsed: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
}

module.exports = { grantCourseEnrollment, grantLectureAccess };
