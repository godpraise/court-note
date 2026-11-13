(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourtNoteCoachSession = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  var COLLECTIONS = ["venues", "members", "lessons", "passes", "journals", "skills", "progress"];
  function createScopedDb(db, user) {
    if (!user || typeof user.uid !== "string" || !user.uid || user.uid.indexOf("/") !== -1) throw new Error("coach_identity_required");
    var coach = db.collection("coaches").doc(user.uid);
    function collection(name) {
      if (COLLECTIONS.indexOf(name) === -1) throw new Error("unknown_coach_collection");
      return coach.collection(name);
    }
    return Object.freeze({collection: collection, doc: function (documentPath) {
      var parts = typeof documentPath === "string" ? documentPath.split("/") : [];
      if (parts.length !== 2 || !parts[1]) throw new Error("invalid_coach_document_path");
      return collection(parts[0]).doc(parts[1]);
    }});
  }
  // A callback belongs to one session generation, including after logout.
  function createSession(options) {
    var generation = 0, unsubscribers = [], activeUid = null;
    function stop() {
      generation += 1; activeUid = null;
      var previous = unsubscribers; unsubscribers = [];
      previous.forEach(function (unsubscribe) { unsubscribe(); });
      options.onReset(null, null);
    }
    function start(db, user) {
      stop();
      var scoped = createScopedDb(db, user); activeUid = user.uid;
      var current = generation;
      options.onReset(scoped, activeUid);
      function isCurrent() { return current === generation && activeUid === user.uid; }
      function fail(error) { if (isCurrent()) { stop(); options.onError(error); } }
      for (var i = 0; i < COLLECTIONS.length && isCurrent(); i += 1) {
        (function (name) {
          try {
            var unsubscribe = scoped.collection(name).onSnapshot(function (snapshot) {
              if (isCurrent()) options.onSnapshot(name, snapshot);
            }, fail);
            if (isCurrent()) unsubscribers.push(unsubscribe); else unsubscribe();
          } catch (error) { fail(error); }
        })(COLLECTIONS[i]);
      }
    }
    return { start: start, stop: stop };
  }
  return { collections: COLLECTIONS.slice(), createScopedDb: createScopedDb, createSession: createSession };
});
