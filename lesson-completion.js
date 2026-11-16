(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourtNoteLessonCompletion = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function completeLesson(db, lessonId) {
    if (!db || typeof db.runTransaction !== "function") fail("transactions_unavailable");
    var lessonRef = db.doc("lessons/" + lessonId);
    return db.runTransaction(async function (transaction) {
      var snapshot = await transaction.get(lessonRef);
      if (!snapshot.exists) fail("lesson_not_found");
      var lesson = snapshot.data();
      // Read the committed state, not a possibly stale screen cache.
      if (lesson.status === "done") return { completed: false, reason: "already_done" };
      if (lesson.status !== "scheduled") fail("lesson_not_scheduled");
      var counts = Object.create(null), seen = Object.create(null);
      var participants = (lesson.participants || []).map(function (p) {
        if (!p.memberId || seen[p.memberId]) fail("invalid_lesson_participants");
        seen[p.memberId] = true;
        var next = p.attendance === "scheduled" ? Object.assign({}, p, { attendance: "done" }) : p;
        if (next.attendance === "done" && next.passId) counts[next.passId] = (counts[next.passId] || 0) + 1;
        return next;
      });
      // Firestore requires every read before the first write.
      var changes = [];
      for (var passId of Object.keys(counts)) {
        var passRef = db.doc("passes/" + passId);
        var passSnapshot = await transaction.get(passRef);
        if (!passSnapshot.exists) fail("pass_not_found");
        var pass = passSnapshot.data(), used = pass.usedCount == null ? 0 : pass.usedCount;
        if (pass.status !== "active" || !Number.isInteger(used) || used < 0 ||
            !Number.isInteger(pass.totalCount) || pass.totalCount <= 0 || used + counts[passId] > pass.totalCount) fail("pass_not_available");
        var update = { usedCount: used + counts[passId] };
        if (update.usedCount === pass.totalCount) {
          if ((pass.courtFeeAmount || 0) <= 0) { update.status = "settled"; update.settledDate = lesson.date; }
          else { update.status = "ready_settle"; update.readyDate = lesson.date; }
        }
        changes.push({ ref: passRef, update: update });
      }
      transaction.update(lessonRef, { status: "done", participants: participants });
      changes.forEach(function (change) { transaction.update(change.ref, change.update); });
      return { completed: true, passCount: changes.length };
    });
  }
  return { completeLesson: completeLesson };
});
