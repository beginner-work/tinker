/* /practice — prompt list inside writing chrome. textContent only. */
(function () {
  "use strict";

  var listEl = document.getElementById("practice-list");
  var streakEl = document.getElementById("practice-streak");

  function paintStreak() {
    if (!streakEl || !window.tinkerPracticeStreak) return;
    var count = window.tinkerPracticeStreak.getStreak();
    streakEl.textContent = "Streak: " + count + (count === 1 ? " weekday" : " weekdays");
  }

  function paintList() {
    if (!listEl || !window.tinkerPracticeCatalog) return;
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    var reps = window.tinkerPracticeCatalog.listReps();
    for (var i = 0; i < reps.length; i++) {
      var rep = reps[i];
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.className = "practice-list__row";
      a.href = "/practice/rep?id=" + encodeURIComponent(rep.id);

      var left = document.createElement("div");
      var title = document.createElement("p");
      title.className = "practice-list__title";
      title.textContent = rep.title;
      var summary = document.createElement("p");
      summary.className = "practice-list__summary";
      summary.textContent = rep.summary;
      left.appendChild(title);
      left.appendChild(summary);

      if (Array.isArray(rep.tags) && rep.tags.length) {
        var tags = document.createElement("div");
        tags.className = "practice-list__tags";
        for (var t = 0; t < rep.tags.length; t++) {
          var tag = document.createElement("span");
          tag.className = "practice-list__tag";
          tag.textContent = rep.tags[t];
          tags.appendChild(tag);
        }
        left.appendChild(tags);
      }

      var meta = document.createElement("p");
      meta.className = "practice-list__meta";
      meta.textContent = rep.learnFromDocs ? "Learn from docs" : "From Tinker";

      a.appendChild(left);
      a.appendChild(meta);
      li.appendChild(a);
      listEl.appendChild(li);
    }
  }

  paintStreak();
  paintList();
})();
