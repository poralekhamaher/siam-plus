const PROGRAM_TOTAL_CREDITS = 129; // Program total credits
const INTERNSHIP_CREDITS = 5; // usually pass/fail, not GPA-bearing
const TRANSFER_NONGPA_CREDITS = 18; // Transfer/CS credits count toward grad, not GPA
const MAX_GPA_CREDITS = PROGRAM_TOTAL_CREDITS - INTERNSHIP_CREDITS - TRANSFER_NONGPA_CREDITS; // 106

const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const gradePoints = {
  A: 4.0,
  "B+": 3.5,
  B: 3.0,
  "C+": 2.5,
  C: 2.0,
  "D+": 1.5,
  D: 1.0,
  F: 0,
};

const STUDENT_STATS = {
  gradedCredits: 78, // CA (credits affecting GPA)
  totalGradePoints: 291, // GP
  totalEarnedCredits: 96, // graded + transfer/CS (no internship yet)
  currentSemesterCredits: 19, // current semester load (update when real term data is available)
};

// Ensure page starts at top after load/animation.
document.addEventListener("DOMContentLoaded", () => {
  try {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  } catch (_) {
    window.scrollTo(0, 0);
  }
});

const MOCK_DEGREE_PLAN = {
  remaining: { major: 5, ge: 3, electives: 2 },
  totals: {
    major: { completed: 18, required: 23 },
    ge: { completed: 9, required: 12 },
    electives: { completed: 3, required: 5 },
  },
};

// Helpers to build a week model and time display so the UI can map JSON schedule data.
function toDateKey(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildWeekDays() {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7; // shift so Monday is start of week
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() - mondayOffset);

  return daysOrder.map((label, idx) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + idx);
    return { label, date, key: toDateKey(date) };
  });
}

function renderTimeRange(start, end) {
  const startText = start || "--:--";
  const endText = end || "--:--";
  return `
    <div class="class-time">
      <span class="time-start">${startText}</span>
      <span class="time-line"></span>
      <span class="time-end">${endText}</span>
    </div>
  `;
}

function isTeacherPage() {
  return typeof window !== "undefined" && window.location && window.location.pathname.startsWith("/teacher");
}

function initThemeToggle() {
  const toggleButtons = [
    document.getElementById("themeToggle"),
    document.getElementById("themeToggleIcon"),
  ].filter(Boolean);
  if (!toggleButtons.length) return;

  const saved = localStorage.getItem("siam-theme");
  const isDarkPreferred = saved ? saved === "dark" : true;
  document.documentElement.classList.toggle("dark", isDarkPreferred);

  const setIcon = () => {
    const isDark = document.documentElement.classList.contains("dark");
    toggleButtons.forEach((btn) => {
      if (!btn) return;
      if (btn.id === "themeToggleIcon") {
        btn.dataset.mode = isDark ? "dark" : "light";
        btn.setAttribute("aria-pressed", isDark ? "true" : "false");
      } else {
        btn.textContent = isDark ? "Light" : "Dark";
      }
    });
  };

  toggleButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      document.documentElement.classList.toggle("dark");
      const isDark = document.documentElement.classList.contains("dark");
      localStorage.setItem("siam-theme", isDark ? "dark" : "light");
      setIcon();
    })
  );

  setIcon();
}

async function loadSchedule() {
  if (isTeacherPage()) return;

  const params = new URLSearchParams(window.location.search);

  const getCookie = (name) => {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : "";
  };

  const sidFromQuery = (params.get("sid") || "").trim();
  const sidFromCookie = (getCookie("sid") || "").trim();
  const sid = sidFromQuery || sidFromCookie;
  if (sidFromQuery && sidFromQuery !== sidFromCookie) {
    document.cookie = `sid=${encodeURIComponent(sidFromQuery)}; Max-Age=86400; Path=/; SameSite=Lax`;
  }
  const hasSid = Boolean(sid);
  const scheduleUrl = hasSid ? `/schedule/${encodeURIComponent(sid)}.json` : null;

  let data = null;
  let notFound = false;
  try {
    if (!scheduleUrl) {
      throw new Error("No student id provided");
    }
    const res = await fetch(scheduleUrl);
    if (!res.ok) {
      if (res.status === 404) {
        notFound = true;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    data = await res.json();
  } catch (err) {
    console.warn(`Failed to load ${scheduleUrl} via fetch.`, err);
  }

  if (!data && window.EMBEDDED_SCHEDULE) {
    data = window.EMBEDDED_SCHEDULE;
  }

  if (!data && notFound) {
    window.location.href = "/";
    return;
  }

  if (!data) {
    showError(
      hasSid
        ? `Unable to load schedule data for ${sid}. Ensure schedule/${sid}.json is available.`
        : "Unable to load schedule data. Please sign in again."
    );
    return;
  }

  const timetable = data.timetable || [];
  const normalizedTimetable = timetable.map(normalizeCourse);

  renderTodayClasses(normalizedTimetable);
  renderWeeklyTimetable(normalizedTimetable);
  renderCourseList(normalizedTimetable, data.grades || []);
  const progressData = renderProgress(data.grades || []);
  const courseCount = countCurrentCourses(normalizedTimetable);
  renderGoalPlanner(progressData, courseCount, normalizedTimetable, data.grades || []);
  initAttendancePanel(normalizedTimetable);
  renderDegreeSummary();
  hideError();
}

function normalizeDayLabel(value) {
  if (!value) return "";
  const strFull = value.toString().trim().toLowerCase();
  const str = strFull.slice(0, 3);
  const map = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
  // Support numeric day codes (0=Sun, 1=Mon, ... 6=Sat)
  const numMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (!Number.isNaN(Number(strFull)) && numMap[Number(strFull)]) {
    return numMap[Number(strFull)];
  }
  return map[str] || "";
}

function normalizeCourse(c = {}) {
  const day = normalizeDayLabel(c.day || c.dayOfWeek || c.Day || c.day_label);

  const timeRange = c.time || c.Time || "";
  let start = c.start_time || c.startTime || "";
  let end = c.end_time || c.endTime || "";
  if ((!start || !end) && typeof timeRange === "string" && timeRange.includes("-")) {
    const [s, e] = timeRange.split("-").map((t) => t.trim());
    start = start || s || "";
    end = end || e || "";
  }

  const course_name = c.course_name || c.courseName || c.coursename || c.name || "";
  const course_code = c.course_code || c.courseCode || c.coursecode || c.code || "";
  const location = c.location || c.room || c.classroom || c.place || "";

  return { ...c, day, start_time: start, end_time: end, course_name, course_code, location };
}

function showError(message) {
  const card = document.getElementById("errorCard");
  const msgEl = document.getElementById("errorMessage");
  if (!card || !msgEl) return;
  msgEl.textContent = message;
  card.classList.remove("hidden");
}

function hideError() {
  const card = document.getElementById("errorCard");
  if (!card) return;
  card.classList.add("hidden");
}

function renderTodayClasses(timetable) {
  const container = document.getElementById("todayClasses");
  const dayLabel = document.getElementById("todayLabel");
  if (!container || !dayLabel) return;
  container.innerHTML = "";
  const now = new Date();
  const todayIdx = now.getDay(); // 0 (Sun) - 6 (Sat)
  const dayShort = daysOrder[(todayIdx + 6) % 7]; // map Sunday to index 6
  dayLabel.textContent = dayShort;

  const todayList = timetable.filter((c) => normalizeDayLabel(c.day || c.dayOfWeek) === dayShort);
  if (!todayList.length) {
    container.innerHTML = `<div class="empty">No classes today. Enjoy your free time!</div>`;
    return;
  }

  todayList.sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

  todayList.forEach((cls) => {
    const el = document.createElement("div");
    el.className = "class-chip";
    el.innerHTML = `
      <div class="class-meta">
        <p class="class-title">${cls.course_code || ""} - ${cls.course_name || ""}</p>
        <p class="muted">${cls.location || "Room TBA"}</p>
      </div>
      <div class="badge">${cls.start_time || "--:--"} - ${cls.end_time || "--:--"}</div>
    `;
    container.appendChild(el);
  });
}

function renderWeeklyTimetable(timetable) {
  const strip = document.getElementById("dayStrip");
  const list = document.getElementById("dayEvents");
  const todayLabel = document.getElementById("todayLabel");
  if (!strip || !list) return;

  const week = buildWeekDays();
  const todayKey = toDateKey(new Date());

  if (todayLabel) {
    const today = week.find((d) => d.key === todayKey);
    if (today) {
      todayLabel.textContent = `${today.label} - ${today.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
  }

  strip.innerHTML = "";
  list.innerHTML = "";

  let selectedKey = week.find((d) => d.key === todayKey)?.key || week[0].key;

  const renderList = (key) => {
    const dayObj = week.find((d) => d.key === key);
    const classes = timetable
      .filter((c) => normalizeDayLabel(c.day || c.dayOfWeek) === dayObj.label)
      .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

    list.innerHTML = "";
    if (!classes.length) {
      list.innerHTML = `<div class="class-card empty-card">No classes today!</div>`;
      return;
    }

    classes.forEach((cls) => {
      const card = document.createElement("div");
      card.className = "class-card";
      card.innerHTML = `
        <div class="class-body">
          <p class="class-title">${cls.course_name || ""}</p>
          <p class="class-meta">${cls.location || "Room TBA"}</p>
        </div>
        ${renderTimeRange(cls.start_time, cls.end_time)}
      `;
      list.appendChild(card);
    });
  };

  const selectDay = (key) => {
    selectedKey = key;
    strip.querySelectorAll(".day-pill").forEach((btn) => {
      const active = btn.dataset.key === selectedKey;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    renderList(selectedKey);
  };

  week.forEach(({ label, date, key }) => {
    const isToday = key === todayKey;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `day-pill${key === selectedKey ? " active" : ""}${isToday ? " today-pill" : ""}`;
    btn.dataset.key = key;
    btn.setAttribute("aria-pressed", key === selectedKey ? "true" : "false");
    btn.innerHTML = `
      ${isToday ? '<span class="pill-today">TODAY</span>' : ""}
      <span class="pill-day">${label}</span>
      <span class="pill-date">${date.getDate()}</span>
    `;
    btn.addEventListener("click", () => selectDay(key));
    strip.appendChild(btn);
  });

  selectDay(selectedKey);
}

function countCurrentCourses(timetable = []) {
  const unique = new Set();
  timetable.forEach((c) => {
    if (c.course_code) unique.add(c.course_code);
    else if (c.coursecode) unique.add(c.coursecode);
    else if (c.course_name) unique.add(c.course_name);
    else if (c.coursename) unique.add(c.coursename);
  });
  if (unique.size > 0) return unique.size;
  return timetable.length || 0;
}

function renderCourseList(timetable, grades) {
  const tbody = document.getElementById("courseList");
  const search = document.getElementById("courseSearch");
  const courseGroupToggle = document.getElementById("courseGroupToggle");
  const courseTable = document.querySelector(".course-table");
  const termHeader = document.querySelector(".course-table thead th:nth-child(3)");

  const mergeCourseData = () => {
    const map = new Map();
    const upsert = (course, isTimetable = false) => {
      const code = course.course_code || course.coursecode || "";
      const name = course.course_name || course.coursename || "";
      const key = code || name;
      if (!key) return;

      const existing = map.get(key) || {};
      map.set(key, {
        code: code || existing.code || "",
        name: name || existing.name || "",
        day: course.day || existing.day || "",
        start_time: course.start_time || existing.start_time || "",
        end_time: course.end_time || existing.end_time || "",
        location: course.location || existing.location || "",
        lecturer: course.lecturer || existing.lecturer || "",
        section: course.section || existing.section || (isTimetable ? "Current timetable" : ""),
        grade: typeof course.grade === "string" ? course.grade : existing.grade || "",
        credit: course.credit || existing.credit || "",
      });
    };

    timetable.forEach((c) => upsert(c, true));
    grades.forEach((c) => upsert(c, false));
    return Array.from(map.values()).sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  };

  const dataset = mergeCourseData();
  const isNarrow = () => window.innerWidth <= 760;
  const layoutKey = () => (window.innerWidth <= 410 ? "tiny" : window.innerWidth <= 760 ? "narrow" : "wide");
  let groupMode = "semester";

  const updateGroupButton = () => {
    if (!courseGroupToggle) return;
    courseGroupToggle.textContent = groupMode === "type" ? "Group by Semester" : "Group by Code";
  };

  const groupLabel = (cls, mode) => {
    if (mode === "semester") {
      return cls.section || "Other";
    }
    if (mode === "type") {
      const match = (cls.code || "").match(/^(\d{3})/);
      return match ? `Type ${match[1]}` : "Other";
    }
    return "";
  };

  const groupSortKey = (label, mode) => {
    if (mode === "type") return [label.toLowerCase()];
    const up = (label || "").toUpperCase();
    if (up.includes("CURRENT") || up.includes("SCHEDULE")) {
      return [-Infinity, 0, label];
    }
    const yearMatch = up.match(/(\d{4})/);
    const semMatch = up.match(/SEMESTER\s*(\d)/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
    const sem = semMatch ? parseInt(semMatch[1], 10) : 0;
    return [-year, -sem, label];
  };

  const draw = (filter = "") => {
    tbody.innerHTML = "";
    const query = filter.trim().toLowerCase();
    const showTerm = groupMode !== "semester";
    const colSpan = showTerm ? 4 : 3;

    if (courseTable) {
      courseTable.classList.toggle("hide-term", !showTerm);
    }
    if (termHeader) {
      termHeader.style.display = showTerm ? "" : "none";
    }

    const filtered = dataset.filter((cls) => {
      const code = (cls.code || "").toLowerCase();
      const name = (cls.name || "").toLowerCase();
      const term = (cls.section || "").toLowerCase();
      const yearMatch = term.match(/(\d{4})/);
      const yearText = yearMatch ? yearMatch[1] : "";
      return (
        !query ||
        code.includes(query) ||
        name.includes(query) ||
        term.includes(query) ||
        yearText.includes(query)
      );
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty">No courses found.</div></td></tr>`;
      return;
    }

    let lastContentRow = null;

    const addRow = (cls) => {
      const term = cls.section || "--";
      const creditText = cls.credit ? ` (${cls.credit} cr)` : "";
      const status = cls.grade
        ? `${cls.grade}${creditText}`
        : cls.day
        ? `Ongoing${creditText}`
        : `In progress${creditText}`;
      const rawCode = cls.code || "";
      const splitMatch = rawCode.match(/^([^-.]+)([-.])(.*)$/);
      const codeText =
        isNarrow() && splitMatch
          ? `${splitMatch[1]}${splitMatch[2]}<br>${splitMatch[3]}`
          : rawCode;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${codeText}</td>
        <td>${cls.name || ""}</td>
        ${showTerm ? `<td class="term-col">${term}</td>` : ""}
        <td>${status || "-"}</td>
      `;
      tbody.appendChild(tr);
      lastContentRow = tr;
    };

    const grouped = new Map();
    filtered.forEach((cls) => {
      const label = groupLabel(cls, groupMode) || "Other";
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(cls);
    });

    const formatCredit = (val) => {
      if (!Number.isFinite(val)) return "0";
      const fixed = val.toFixed(1);
      return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
    };

    const compareKeys = (aKey, bKey) => {
      const len = Math.max(aKey.length, bKey.length);
      for (let i = 0; i < len; i += 1) {
        const av = aKey[i];
        const bv = bKey[i];
        if (av === bv) continue;
        return av < bv ? -1 : 1;
      }
      return 0;
    };

    let isFirstGroup = true;
    let lastGroupCount = 0;
    Array.from(grouped.entries())
      .sort((a, b) => compareKeys(groupSortKey(a[0], groupMode), groupSortKey(b[0], groupMode)))
      .forEach(([label, rows]) => {
        if (!isFirstGroup) {
          if (lastContentRow && lastGroupCount > 1) {
            lastContentRow.classList.add("no-border");
          }
          const spacerRow = document.createElement("tr");
          spacerRow.className = "group-spacer";
          spacerRow.innerHTML = `<td colspan="${colSpan}">&nbsp;</td>`;
          tbody.appendChild(spacerRow);
        }
        isFirstGroup = false;

        const headerRow = document.createElement("tr");
        headerRow.className = "group-row";
        headerRow.innerHTML = `<td colspan="${colSpan}"><span class="group-chip">${label}</span></td>`;
        tbody.appendChild(headerRow);
        rows.forEach(addRow);
        const totals = rows.reduce(
          (acc, cls) => {
            const credit = parseFloat(cls.credit);
            const gradeKey = (cls.grade || "").toUpperCase().trim();
            if (!Number.isNaN(credit)) {
              acc.totalCredits += credit;
              if (gradePoints.hasOwnProperty(gradeKey)) {
                acc.gpaCredits += credit;
                acc.points += credit * gradePoints[gradeKey];
              }
            }
            return acc;
          },
          { totalCredits: 0, gpaCredits: 0, points: 0 }
        );

        const tableGpa = totals.gpaCredits > 0 ? totals.points / totals.gpaCredits : null;
        const creditsText = formatCredit(totals.totalCredits);
        const gpaDisplay =
          tableGpa !== null ? `${tableGpa.toFixed(2)} (${creditsText} cr)` : `-- (${creditsText} cr)`;
        const summaryRow = document.createElement("tr");
        summaryRow.className = "summary-row";
        if (showTerm) {
          summaryRow.innerHTML = `
            <td></td>
            <td class="summary-course"><span class="summary-pill">GPA: ${tableGpa !== null ? tableGpa.toFixed(2) : "--"}</span></td>
            <td></td>
            <td class="summary-grade"><span class="summary-pill">${creditsText} cr</span></td>
          `;
        } else {
          summaryRow.innerHTML = `
            <td></td>
            <td class="summary-course"><span class="summary-pill">GPA: ${tableGpa !== null ? tableGpa.toFixed(2) : "--"}</span></td>
            <td class="summary-grade"><span class="summary-pill">${creditsText} cr</span></td>
          `;
        }
        tbody.appendChild(summaryRow);

        lastContentRow = summaryRow;
        lastGroupCount = rows.length + 1;
      });
  };

  search.addEventListener("input", (e) => draw(e.target.value));
  if (courseGroupToggle) {
    courseGroupToggle.addEventListener("click", () => {
      groupMode = groupMode === "semester" ? "type" : "semester";
      updateGroupButton();
      draw(search.value);
      courseGroupToggle.blur();
    });
    updateGroupButton();
  }
  draw();

  let lastLayout = layoutKey();
  window.addEventListener("resize", () => {
    const nowKey = layoutKey();
    if (nowKey === lastLayout) return;
    lastLayout = nowKey;
    draw(search.value);
  });
}

function renderProgress(grades) {
  // If the JSON includes a credit summary or GPA, wire it here.
  const creditsCompletedEl = document.getElementById("creditsCompleted");
  const creditsRemainingEl = document.getElementById("creditsRemaining");
  const gpaEl = document.getElementById("gpaValue");
  const fill = document.getElementById("progressFill");

  const normalizeCode = (code = "") => code.toString().replace(/\s+/g, "").toUpperCase();
  const uniqueGrades = [];
  const seenCodes = new Set();
  for (const g of grades || []) {
    const code = normalizeCode(g.coursecode || g.course_code || g.code);
    if (code && seenCodes.has(code)) continue;
    if (code) seenCodes.add(code);
    uniqueGrades.push(g);
  }

  const completedFromData = uniqueGrades
    .map((g) => parseFloat(g.credit))
    .filter((n) => !Number.isNaN(n))
    .reduce((sum, n) => sum + n, 0);

  const gpaAcc = uniqueGrades.reduce(
    (acc, g) => {
      const credit = parseFloat(g.credit);
      const gradeKey = (g.grade || "").toUpperCase().trim();
      if (Number.isNaN(credit)) return acc;
      if (!gradePoints.hasOwnProperty(gradeKey)) return acc; // skip transfer / in-progress
      acc.gradedCredits += credit;
      acc.points += credit * gradePoints[gradeKey];
      return acc;
    },
    { gradedCredits: 0, points: 0 }
  );

  // Treat current semester credits as in-progress; subtract them from completed.
  const currentInProgress = STUDENT_STATS.currentSemesterCredits || 0;

  const stats = {
    gradedCredits: gpaAcc.gradedCredits > 0 ? gpaAcc.gradedCredits : STUDENT_STATS.gradedCredits,
    totalGradePoints: gpaAcc.points > 0 ? gpaAcc.points : STUDENT_STATS.totalGradePoints,
    totalEarnedCredits:
      completedFromData > 0
        ? Math.max(completedFromData - currentInProgress, 0)
        : Math.max(STUDENT_STATS.totalEarnedCredits - currentInProgress, 0),
  };

  const completed = stats.totalEarnedCredits;
  const remaining = Math.max(PROGRAM_TOTAL_CREDITS - completed, 0);
  const percent = Math.min((completed / PROGRAM_TOTAL_CREDITS) * 100, 100);
  const gpaValue =
    stats.gradedCredits > 0 ? stats.totalGradePoints / stats.gradedCredits : null;
  const remainingGpaCredits = Math.max(MAX_GPA_CREDITS - stats.gradedCredits, 0);

  creditsCompletedEl.textContent = `${completed} cr`;
  if (creditsRemainingEl) {
    creditsRemainingEl.textContent = `${remaining} cr`;
  }
  fill.style.width = `${percent}%`;

  gpaEl.textContent = gpaValue !== null ? gpaValue.toFixed(2) : "--";

  return {
    completed,
    remaining, // total remaining credits toward 129
    percent, // percent toward 129
    gpa: gpaValue,
    gradedCredits: stats.gradedCredits,
    totalGradePoints: stats.totalGradePoints,
    remainingGpaCredits,
  };
}

function initMapViewer() {
  const viewer = document.getElementById("campusViewer");
  if (!viewer) return;
  const resetBtn = document.getElementById("resetMapBtn");
  const supportMsg = document.getElementById("mapSupportMsg");

  const defaults = {
    orbit: viewer.getAttribute("camera-orbit"),
    target: viewer.getAttribute("camera-target"),
    fov: viewer.getAttribute("field-of-view"),
  };

  viewer.addEventListener("load", () => {
    viewer.classList.add("ready");
  });

  viewer.addEventListener("error", () => {
    if (supportMsg) supportMsg.classList.remove("hidden");
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (defaults.orbit) viewer.setAttribute("camera-orbit", defaults.orbit);
      if (defaults.target) viewer.setAttribute("camera-target", defaults.target);
      if (defaults.fov) viewer.setAttribute("field-of-view", defaults.fov);
      viewer.removeAttribute("interaction-prompt");
    });
  }
}

function initMobileMenu() {
  const toggle = document.getElementById("menuToggle");
  const overlay = document.getElementById("mobileMenuOverlay");
  const sheet = document.getElementById("mobileMenuSheet");
  const logoutBtn = document.getElementById("mobileLogoutBtn");

  if (!toggle || !overlay) return;

  const closeMenu = () => {
    toggle.checked = false;
  };

  overlay.addEventListener("click", closeMenu);
  if (sheet) {
    sheet.addEventListener("click", (e) => e.stopPropagation());
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      closeMenu();
      window.location.href = "/";
    });
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth > 600 && toggle.checked) {
      toggle.checked = false;
    }
  });
}

let __teacherAttendancePoller = null;

function startTeacherAttendancePolling(sessionId) {
  const renderStudentList = window.renderStudentList;
  const handleTeacherStatus = window.handleTeacherStatus;
  if (!sessionId || typeof renderStudentList !== "function") return;

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/teacher/attendance/${encodeURIComponent(sessionId)}/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (handleTeacherStatus && typeof handleTeacherStatus === "function") {
        handleTeacherStatus(data);
      } else if (data && Array.isArray(data.students)) {
        renderStudentList(data.students);
      }
    } catch (err) {
      console.warn("Failed to refresh attendance status", err);
    }
  };

  if (__teacherAttendancePoller) {
    clearInterval(__teacherAttendancePoller);
  }
  fetchStatus();
  __teacherAttendancePoller = setInterval(fetchStatus, 3000);
  window.addEventListener("beforeunload", () => {
    if (__teacherAttendancePoller) clearInterval(__teacherAttendancePoller);
  });
}

function stopTeacherAttendancePolling() {
  if (__teacherAttendancePoller) {
    clearInterval(__teacherAttendancePoller);
    __teacherAttendancePoller = null;
  }
}

function initTeacherAttendancePolling() {
  const sessionId = window.TEACHER_SESSION_ID || window.SESSION_ID;
  if (sessionId) {
    startTeacherAttendancePolling(sessionId);
  }
}
window.startTeacherAttendancePolling = startTeacherAttendancePolling;
window.stopTeacherAttendancePolling = stopTeacherAttendancePolling;

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  if (!isTeacherPage()) {
    loadSchedule();
    initMapViewer();
    initRunnerGame("runnerGameSmall", "gameStartBtnSmall", { height: 140 });
    initMobileMenu();
  }
  initTeacherAttendancePolling();
});

async function giveAttendance() {
  const statusEl = document.getElementById("attendance-status");
  const statusBlock = document.getElementById("attendanceStatus");
  const statusTextEl = document.getElementById("attendanceStatusText");
  const statusSubEl = document.getElementById("attendanceSubtext");
  const statusDot = document.getElementById("attendanceStatusDot");
  const tokenInput = document.getElementById("session-token-input");

  if (!tokenInput) return;

  const sessionToken = (tokenInput.value || "").trim();
  if (!sessionToken) {
    if (statusEl) statusEl.textContent = "Please enter the session code.";
    if (statusTextEl) statusTextEl.textContent = "Please enter the session code.";
    if (statusSubEl) statusSubEl.textContent = "";
    if (statusDot) statusDot.classList.remove("active");
    return;
  }

  if (statusEl) statusEl.textContent = "Sending attendance…";
  if (statusTextEl) statusTextEl.textContent = "Sending attendance…";
  if (statusSubEl) statusSubEl.textContent = "";
  if (statusDot) statusDot.classList.remove("active");

  try {
    const res = await fetch("/api/student/attendance/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_token: sessionToken,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      const msg = data.error || data.message || "Unable to record attendance.";
      if (statusEl) statusEl.textContent = "❌ " + msg;
      if (statusTextEl) statusTextEl.textContent = msg;
      if (statusSubEl) statusSubEl.textContent = "";
      if (statusDot) statusDot.classList.remove("active");
    } else {
      if (statusEl) statusEl.textContent = "✅ Attendance recorded successfully.";
      if (statusTextEl) statusTextEl.textContent = data.message || "Attendance recorded successfully.";
      const nowText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (statusSubEl) statusSubEl.textContent = `Today at ${nowText}`;
      if (statusDot) statusDot.classList.add("active");
    }
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = "❌ Network error. Try again.";
    if (statusTextEl) statusTextEl.textContent = "Network error. Try again.";
    if (statusSubEl) statusSubEl.textContent = "";
    if (statusDot) statusDot.classList.remove("active");
  }
}

function renderGoalPlanner(progressData, courseCountOverride = 0, timetable = [], grades = []) {
  const gpaEl = document.getElementById("plannerCurrentGpa");
  const creditsEl = document.getElementById("plannerCompletedCredits");
  const input = document.getElementById("targetGpaInput");
  const button = document.getElementById("calculatePlanBtn");
  const summaryEl = document.getElementById("plannerSummary");
  const mixEl = document.getElementById("plannerMix");
  const modeToggle = document.getElementById("plannerModeToggle");
  const modeLabel = document.getElementById("plannerModeLabel");
  const targetPanel = document.getElementById("targetModePanel");
  const expectedPanel = document.getElementById("expectedModePanel");
  const expectedListEl = document.getElementById("expectedCoursesList");
  const expectedCalcBtn = document.getElementById("expectedCalcBtn");
  const expectedSummary = document.getElementById("expectedSummary");
  const expectedSubtext = document.getElementById("expectedSubtext");
  const plannerResult = document.getElementById("plannerResult");

  if (
    !gpaEl ||
    !creditsEl ||
    !input ||
    !button ||
    !summaryEl ||
    !mixEl ||
    !modeToggle ||
    !modeLabel ||
    !targetPanel ||
    !expectedPanel ||
    !expectedListEl ||
    !expectedCalcBtn ||
    !expectedSummary ||
    !expectedSubtext
  ) {
    return;
  }

  const profile = {
    currentGpa: Number.isFinite(progressData?.gpa) ? progressData.gpa : STUDENT_STATS.totalGradePoints / STUDENT_STATS.gradedCredits,
    completedCredits: Number.isFinite(progressData?.completed) ? progressData.completed : STUDENT_STATS.totalEarnedCredits,
    gradedCredits: Number.isFinite(progressData?.gradedCredits) ? progressData.gradedCredits : STUDENT_STATS.gradedCredits,
    totalGradePoints: Number.isFinite(progressData?.totalGradePoints) ? progressData.totalGradePoints : STUDENT_STATS.totalGradePoints,
    currentSemesterCredits: STUDENT_STATS.currentSemesterCredits,
  };

  const GRADE_OPTIONS = ["A", "B+", "B", "C+", "C", "D+", "D", "F", "W"];
  let mode = "target";
  let expectedGrades = {};

  const gpaPoints = (grade) => {
    if (grade === "W") return null;
    return gradePoints.hasOwnProperty(grade) ? gradePoints[grade] : null;
  };

  const buildOngoingCourses = () => {
    const list = [];
    const creditKeys = ["credit", "credits", "creditHours"];
    let counter = 0;

    const upsert = (course) => {
      const code = course.course_code || course.courseCode || course.coursecode || course.code || "";
      const name = course.course_name || course.courseName || course.coursename || course.name || "";
      const base = code || name || "course";
      const key = `${base}-${counter++}`;

      const creditRaw = creditKeys
        .map((k) => course[k])
        .find((v) => v !== undefined && v !== null && v !== "");
      const creditNum = parseFloat(creditRaw);
      const hasCredit = Number.isFinite(creditNum) && creditNum > 0;

      list.push({
        key,
        code,
        name,
        credits: hasCredit ? creditNum : 3,
        creditEstimated: !hasCredit,
      });
    };

    timetable.forEach(upsert);

    grades.forEach((g) => {
      const gradeStr = (g.grade || "").toString().trim().toLowerCase();
      const isOngoing =
        !gradeStr ||
        gradeStr.includes("ongoing") ||
        gradeStr.includes("in progress") ||
        gradeStr === "ip" ||
        gradeStr === "n/a" ||
        gradeStr === "na" ||
        gradeStr === "n.a";
      if (!isOngoing) return;
      upsert(g);
    });

    return list;
  };

  const ongoingCourses = buildOngoingCourses();
  const hasEstimatedCredits = ongoingCourses.some((c) => c.creditEstimated);

  gpaEl.textContent = profile.currentGpa.toFixed(2);
  creditsEl.textContent = `${profile.completedCredits} cr`;
  input.placeholder = (profile.currentGpa + 0.05).toFixed(2);

  const deriveCourseCount = () => {
    const derivedCourseCount = Math.max(1, Math.ceil(profile.currentSemesterCredits / 3));
    return Math.max(1, courseCountOverride || derivedCourseCount);
  };

  const buildMix = (requiredGpa) => {
    const courseCount = deriveCourseCount();
    if (requiredGpa >= 3.95) {
      return [{ grade: "A", count: courseCount }];
    }
    if (requiredGpa >= 3.8) {
      const aCount = Math.max(1, Math.round(courseCount * 0.66));
      return [
        { grade: "A", count: aCount },
        { grade: "B+", count: Math.max(courseCount - aCount, 0) },
      ].filter((item) => item.count > 0);
    }
    if (requiredGpa >= 3.5) {
      const aCount = Math.ceil(courseCount * 0.6);
      return [
        { grade: "A", count: aCount },
        { grade: "B+", count: Math.max(courseCount - aCount, 0) },
      ].filter((item) => item.count > 0);
    }
    if (requiredGpa >= 3.0) {
      const bPlus = Math.ceil(courseCount * 0.6);
      return [
        { grade: "B+", count: bPlus },
        { grade: "B", count: Math.max(courseCount - bPlus, 0) },
      ].filter((item) => item.count > 0);
    }
    const bCount = Math.ceil(courseCount * 0.6);
    return [
      { grade: "B", count: bCount },
      { grade: "C+", count: Math.max(courseCount - bCount, 0) },
    ].filter((item) => item.count > 0);
  };

  const renderMix = (list) => {
    mixEl.innerHTML = "";
    list.forEach((item) => {
      const p = document.createElement("p");
      p.className = "result-line";
      p.textContent = `${item.count} course${item.count !== 1 ? "s" : ""} with ${item.grade}`;
      mixEl.appendChild(p);
    });
  };

  const handleCalc = () => {
    const target = parseFloat(input.value);
    mixEl.innerHTML = "";

    if (!Number.isFinite(target) || target <= 0) {
      summaryEl.textContent = "Enter a target GPA to see your plan.";
      plannerResult.classList.remove("hidden");
      return;
    }

    const totalGradedAfter = profile.gradedCredits + profile.currentSemesterCredits;
    const totalPointsNeeded = target * totalGradedAfter;
    const requiredSemPoints = totalPointsNeeded - profile.totalGradePoints;
    const requiredSemGpa = requiredSemPoints / profile.currentSemesterCredits;

    if (requiredSemGpa <= 0) {
      summaryEl.textContent = `You're already above ${target.toFixed(2)}. Any passing grades will keep you above that target.`;
      return;
    }

    if (requiredSemGpa > 4) {
      summaryEl.textContent = `To reach ${target.toFixed(2)}, you'd need more than a 4.0 average this semester, which isn't possible on a 4.0 scale. Aim for straight As to maximize your GPA.`;
      renderMix([{ grade: "A", count: deriveCourseCount() }]);
      return;
    }

    const targetText = target.toFixed(2);
    summaryEl.textContent = `To reach ${targetText}, you need an average of ${requiredSemGpa.toFixed(2)} this semester.`;

    const mix = buildMix(requiredSemGpa);
    renderMix(mix);
    plannerResult.classList.remove("hidden");

    if (!mix.length) {
      summaryEl.textContent = "Keep steady performance this term to stay on track.";
    }
  };

  const updateExpectedState = () => {
    const hasCourses = ongoingCourses.length > 0;
    const allSelected = hasCourses && ongoingCourses.every((c) => expectedGrades[c.key]);
    expectedCalcBtn.disabled = !allSelected;
    expectedCalcBtn.title = allSelected ? "" : "🚫 Select all grades first";

    if (!hasCourses) {
      expectedSummary.textContent = "";
      expectedSubtext.textContent = "";
      return;
    }

    if (!allSelected) {
      expectedSummary.textContent = "";
      expectedSubtext.textContent = "";
      return;
    }

    expectedSummary.textContent = "";
    expectedSubtext.textContent = "";
  };

  const renderExpectedCourses = () => {
    expectedListEl.innerHTML = "";

    if (!ongoingCourses.length) {
      expectedListEl.innerHTML = `<p class="note">No ongoing courses found right now.</p>`;
      expectedCalcBtn.disabled = true;
      return;
    }

    ongoingCourses.forEach((course) => {
      const row = document.createElement("div");
      row.className = "expected-course";
      const creditText = `${course.credits} cr${course.creditEstimated ? " (est.)" : ""}`;
      row.innerHTML = `
        <div class="expected-course-info">
          <p class="course-title">${course.name || course.code || "Course"}</p>
          <p class="course-meta">${course.code || ""}${course.code && course.name ? " - " : ""}${creditText}</p>
        </div>
        <div class="grade-picker" role="group" aria-label="Expected grade for ${course.name || course.code || "course"}"></div>
      `;

      const picker = row.querySelector(".grade-picker");
      GRADE_OPTIONS.forEach((grade) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "grade-chip";
        btn.dataset.grade = grade;
        btn.textContent = grade;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", () => {
          expectedGrades[course.key] = grade;
          picker.querySelectorAll(".grade-chip").forEach((chip) => {
            const isActive = chip.dataset.grade === grade;
            chip.classList.toggle("active", isActive);
            chip.setAttribute("aria-pressed", isActive ? "true" : "false");
          });
          updateExpectedState();
        });
        picker.appendChild(btn);
      });

      expectedListEl.appendChild(row);
    });

    updateExpectedState();
  };

  const calculatePredictedGpa = () => {
    const hasCourses = ongoingCourses.length > 0;
    const allSelected = hasCourses && ongoingCourses.every((c) => expectedGrades[c.key]);

    if (!hasCourses) {
      expectedSummary.textContent = "";
      expectedSubtext.textContent = "";
      return;
    }
    if (!allSelected) {
      expectedSummary.textContent = "";
      expectedSubtext.textContent = "";
      expectedCalcBtn.disabled = true;
      return;
    }

    let newPoints = 0;
    let newCredits = 0;
    ongoingCourses.forEach((course) => {
      const grade = expectedGrades[course.key];
      const value = gpaPoints(grade);
      if (value === null) return;
      newPoints += value * course.credits;
      newCredits += course.credits;
    });

    const basePoints = Number.isFinite(profile.totalGradePoints)
      ? profile.totalGradePoints
      : profile.currentGpa * profile.gradedCredits;
    const totalCredits = profile.gradedCredits + newCredits;
    const finalGpa = totalCredits > 0 ? (basePoints + newPoints) / totalCredits : profile.currentGpa;
    const gpaText = Number.isFinite(finalGpa) ? finalGpa.toFixed(2) : "";

    expectedSummary.textContent = gpaText ? `Predicted GPA: ${gpaText}` : "";
    expectedSubtext.textContent = "";
  };

  const setMode = (nextMode) => {
    mode = nextMode;
    modeLabel.textContent = mode === "target" ? "Target GPA Mode" : "Target GPA Mode";
    targetPanel.classList.toggle("hidden", mode !== "target");
    expectedPanel.classList.toggle("hidden", mode !== "expected");

    if (mode === "expected") {
      expectedGrades = {};
      renderExpectedCourses();
      updateExpectedState();
    } else {
      expectedGrades = {};
      expectedCalcBtn.disabled = true;
      expectedSummary.textContent = "Please select expected grades for all courses.";
      expectedSubtext.textContent = "Based on your expected grades this semester.";
      expectedListEl.querySelectorAll(".grade-chip.active").forEach((chip) => chip.classList.remove("active"));
    }
  };

  button.addEventListener("click", handleCalc);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCalc();
    }
  });

  expectedCalcBtn.addEventListener("click", calculatePredictedGpa);
  modeToggle.addEventListener("click", () => {
    setMode(mode === "target" ? "expected" : "target");
  });

  setMode("target");
}

function initAttendancePanel() {
  const statusText = document.getElementById("attendanceStatusText");
  const statusDot = document.getElementById("attendanceStatusDot");
  const subText = document.getElementById("attendanceSubtext");
  const toggleBtn = document.getElementById("attendanceToggleBtn");
  const btnLabel = document.getElementById("attendanceBtnLabel");
  const btnSpinner = document.getElementById("attendanceBtnSpinner");
  if (!statusText || !statusDot || !subText || !toggleBtn || !btnLabel || !btnSpinner) return;

  let hasCheckedIn = false;
  let isListening = false;
  let checkedInAt = null;

  const updateUI = () => {
    statusDot.classList.toggle("active", hasCheckedIn);
    if (!hasCheckedIn && !isListening) {
      statusText.textContent = "Attendance not taken";
      subText.textContent = "Tap the button below and hold your RFID card near the device.";
      toggleBtn.disabled = false;
      toggleBtn.classList.remove("danger");
      btnLabel.textContent = "Give Attendance";
      btnSpinner.classList.add("hidden");
    } else if (isListening) {
      statusText.textContent = "Waiting for RFID…";
      subText.textContent = "";
      toggleBtn.disabled = true;
      toggleBtn.classList.add("danger");
      btnLabel.textContent = "Listening…";
      btnSpinner.classList.remove("hidden");
    } else if (hasCheckedIn) {
      statusText.textContent = "Attendance recorded";
      const timeText = checkedInAt
        ? `Today at ${checkedInAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";
      subText.textContent = timeText;
      toggleBtn.disabled = true;
      toggleBtn.classList.remove("danger");
      btnLabel.textContent = "Attendance Taken";
      btnSpinner.classList.add("hidden");
    }
  };

  const handleGiveAttendance = () => {
    if (hasCheckedIn || isListening) return;
    isListening = true;
    updateUI();
    setTimeout(() => {
      isListening = false;
      hasCheckedIn = true;
      checkedInAt = new Date();
      updateUI();
    }, 2000);
  };

  toggleBtn.addEventListener("click", handleGiveAttendance);
  updateUI();
}

function normalizeTimetable(timetable = []) {
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return timetable
    .map((c) => {
      const rawDay = (c.day || c.dayOfWeek || "").toString().toLowerCase();
      const dayOfWeek = dayMap.hasOwnProperty(rawDay) ? dayMap[rawDay] : Number(rawDay);
      const startTime = c.start_time || c.startTime || "";
      const endTime = c.end_time || c.endTime || "";
      const courseName = c.course_name || c.courseName || c.coursename || "";
      const courseCode = c.course_code || c.courseCode || c.coursecode || "";
      if (Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return null;
      if (!startTime || !endTime) return null;
      return { dayOfWeek, startTime, endTime, courseName, courseCode };
    })
    .filter(Boolean);
}

function getActiveClassForNow(timetable, now = new Date()) {
  const normalized = normalizeTimetable(timetable);
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  for (const cls of normalized) {
    if (cls.dayOfWeek !== currentDay) continue;
    const [sh, sm] = cls.startTime.split(":").map(Number);
    const [eh, em] = cls.endTime.split(":").map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) continue;
    if (startMinutes <= currentMinutes && currentMinutes <= endMinutes) {
      return cls;
    }
  }
  return null;
}

function initAttendancePanel(timetable) {
  const statusText = document.getElementById("attendanceStatusText");
  const statusDot = document.getElementById("attendanceStatusDot");
  const subText = document.getElementById("attendanceSubtext");
  const toggleBtn = document.getElementById("attendanceToggleBtn");
  const btnLabel = document.getElementById("attendanceBtnLabel");
  const btnSpinner = document.getElementById("attendanceBtnSpinner");
  const classEl = document.getElementById("attendanceClass");
  const actions = document.querySelector(".attendance-actions");
  if (!statusText || !statusDot || !subText || !toggleBtn || !btnLabel || !btnSpinner || !actions) return;
  // If the session code flow is present, avoid the old simulated click-to-check-in logic.
  if (document.getElementById("session-token-input")) {
    statusText.textContent = "Attendance not taken";
    subText.textContent = "Wait for teacher to share a code.";
    statusDot.classList.remove("active");
    toggleBtn.disabled = false;
    btnLabel.textContent = "Give Attendance";
    btnSpinner.classList.add("hidden");
    return;
  }

  let activeClass = null;
  let hasCheckedIn = false;
  let isListening = false;
  let checkedInAt = null;
  let lastClassKey = null;
  let timerId = null;

  const formatClassText = (cls) => {
    if (!cls) return "Session check-in";
    return `${cls.courseName || "Current class"} (${cls.startTime}-${cls.endTime})`;
  };

  const updateUI = () => {
    const hasActive = !!activeClass;
    if (classEl) {
      classEl.textContent = hasActive ? formatClassText(activeClass) : "Manual test (no active class)";
    }

    // Always allow testing, even without an active class.
    actions.style.display = "flex";
    if (isListening) {
      statusText.textContent = "Waiting for RFID…";
      subText.textContent = "";
      statusDot.classList.remove("active");
      toggleBtn.disabled = true;
      toggleBtn.classList.add("danger");
      btnLabel.textContent = "Listening…";
      btnSpinner.classList.remove("hidden");
      return;
    }

    if (hasCheckedIn) {
      statusText.textContent = `Attendance recorded${activeClass ? ` for ${activeClass.courseName}` : ""}`;
      const timeText = checkedInAt
        ? `Today at ${checkedInAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";
      subText.textContent = timeText;
      statusDot.classList.add("active");
      toggleBtn.disabled = true;
      toggleBtn.classList.remove("danger");
      btnLabel.textContent = "Attendance Taken";
      btnSpinner.classList.add("hidden");
      return;
    }

    statusText.textContent = "Attendance not taken";
    subText.textContent = hasActive
      ? "Wait for teacher to share a code."
      : "Wait for teacher to share a code.";
    statusDot.classList.remove("active");
    toggleBtn.disabled = false;
    toggleBtn.classList.remove("danger");
    btnLabel.textContent = "Give Attendance";
    btnSpinner.classList.add("hidden");
  };

  const handleGiveAttendance = () => {
    if (hasCheckedIn || isListening) return;
    isListening = true;
    updateUI();
    setTimeout(() => {
      isListening = false;
      hasCheckedIn = true;
      checkedInAt = new Date();
      updateUI();
    }, 2000);
  };

  const refreshActiveClass = () => {
    const next = getActiveClassForNow(timetable);
    const nextKey = next ? `${next.courseCode || ""}|${next.startTime}|${next.endTime}` : null;
    const changed = nextKey !== lastClassKey;
    if (changed) {
      activeClass = next;
      hasCheckedIn = false;
      isListening = false;
      checkedInAt = null;
      lastClassKey = nextKey;
    } else {
      activeClass = next;
    }
    updateUI();
  };

  toggleBtn.addEventListener("click", handleGiveAttendance);
  refreshActiveClass();
  timerId = setInterval(refreshActiveClass, 30000);

  window.addEventListener("beforeunload", () => {
    if (timerId) clearInterval(timerId);
  });
}

function renderDegreeSummary(plan = MOCK_DEGREE_PLAN) {
  const majorRemainEl = document.getElementById("majorRemainingValue");
  const geRemainEl = document.getElementById("geRemainingValue");
  const elecRemainEl = document.getElementById("electivesRemainingValue");
  const totalRemainEl = document.getElementById("totalRemainingValue");
  const internshipEl = document.getElementById("internshipCreditValue");

  const majorText = document.getElementById("majorProgressText");
  const geText = document.getElementById("geProgressText");
  const elecText = document.getElementById("electivesProgressText");

  const majorBar = document.getElementById("majorProgressBar");
  const geBar = document.getElementById("geProgressBar");
  const elecBar = document.getElementById("electivesProgressBar");

  if (!majorRemainEl || !geRemainEl || !elecRemainEl || !totalRemainEl) return;

  const calc = (key) => {
    const totals = plan.totals?.[key] || {};
    const completed = Number(totals.completed) || 0;
    const required = Number(totals.required) || 0;
    const remaining = Number(plan.remaining?.[key]);
    const derivedRemaining = Math.max(required - completed, 0);
    const remainValue = Number.isFinite(remaining) ? remaining : derivedRemaining;
    const percent = required ? Math.min((completed / required) * 100, 100) : 0;
    return { completed, required, remaining: remainValue, percent };
  };

  const major = calc("major");
  const ge = calc("ge");
  const electives = calc("electives");
  const totalRemaining = major.remaining + ge.remaining + electives.remaining;

  majorRemainEl.textContent = major.remaining;
  geRemainEl.textContent = ge.remaining;
  elecRemainEl.textContent = electives.remaining;
  totalRemainEl.textContent = totalRemaining;
  if (internshipEl) internshipEl.textContent = INTERNSHIP_CREDITS;

  if (majorText) majorText.textContent = `${major.completed} / ${major.required}`;
  if (geText) geText.textContent = `${ge.completed} / ${ge.required}`;
  if (elecText) elecText.textContent = `${electives.completed} / ${electives.required}`;

  if (majorBar) majorBar.style.width = `${major.percent}%`;
  if (geBar) geBar.style.width = `${ge.percent}%`;
  if (elecBar) elecBar.style.width = `${electives.percent}%`;
}

// Simple mini runner game (Chrome dino style)
function initRunnerGame(canvasId, startBtnId, opts = {}) {
  const canvas = document.getElementById(canvasId);
  const startBtn = document.getElementById(startBtnId);
  if (!canvas || !startBtn) return;

  const ctx = canvas.getContext("2d");
  const setSize = () => {
    const rect = canvas.getBoundingClientRect();
    const targetHeight = opts.height || canvas.height;
    canvas.width = rect.width;
    canvas.height = targetHeight;
  };
  setSize();

  const ground = canvas.height - 24;
  const player = { x: 28, y: ground, w: 18, h: 24, vy: 0, jump: -8.5, onGround: true };
  let obstacles = [];
  let running = false;
  let lastTime = 0;
  let spawnTimer = 0;
  let elapsedMs = 0;
  const gravity = 0.5;

  const reset = () => {
    obstacles = [];
    player.y = ground;
    player.vy = 0;
    player.onGround = true;
    running = true;
    spawnTimer = 0;
    elapsedMs = 0;
    lastTime = performance.now();
    startBtn.style.display = "none";
    loop(lastTime);
  };

  const spawnObstacle = (scale = 1) => {
    const size = 14 + Math.random() * 10;
    const speedBoost = (scale - 1) * 1.8;
    obstacles.push({
      x: canvas.width + size,
      y: ground,
      w: size,
      h: size,
      speed: 4 + Math.random() * 2 + speedBoost,
    });
  };

  const jump = () => {
    if (!running) return;
    if (player.onGround) {
      player.vy = player.jump;
      player.onGround = false;
    }
  };

  const collide = (a, b) => {
    // Tighten the hitboxes slightly so they align with what you see on canvas.
    const ax1 = a.x + 2;
    const ax2 = a.x + a.w - 2;
    const ay1 = a.y - a.h + 2;
    const ay2 = a.y - 2;

    const bx1 = b.x + 2;
    const bx2 = b.x + b.w - 2;
    const by1 = b.y - b.h + 2;
    const by2 = b.y - 2;

    return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
  };

  const loop = (time) => {
    if (!running) return;
    const dt = Math.min(32, time - lastTime);
    lastTime = time;
    spawnTimer += dt;
    elapsedMs += dt;
    // Speed up more aggressively over time: ~2x speed by 30s, capped around 2.8x.
    const difficultyScale = Math.min(2.8, 1 + elapsedMs / 30000);
    const spawnInterval = Math.max(380, 1400 / difficultyScale);

    if (spawnTimer > spawnInterval) {
      spawnTimer = 0;
      spawnObstacle(difficultyScale);
    }

    // physics
    player.vy += gravity;
    player.y += player.vy;
    if (player.y > ground) {
      player.y = ground;
      player.vy = 0;
      player.onGround = true;
    }

    obstacles.forEach((o) => {
      o.x -= o.speed;
    });
    obstacles = obstacles.filter((o) => o.x + o.w > 0);

    // collision
    for (const o of obstacles) {
      if (collide(player, o)) {
        running = false;
        break;
      }
    }

    // draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const isDark = document.documentElement.classList.contains("dark");
    const rootStyles = getComputedStyle(document.documentElement);
    const cardColor = (rootStyles.getPropertyValue("--card") || "").trim();
    const borderColor = (rootStyles.getPropertyValue("--border") || "").trim();
    const bgFallback = isDark ? "#1e1e20" : "#e7e7e8";
    const groundFallback = isDark ? "rgba(169,169,178,0.25)" : "rgba(32,32,32,0.12)";
    const bgColor = cardColor || bgFallback;
    const groundColor = borderColor || groundFallback;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ground line
    ctx.strokeStyle = groundColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ground + 1);
    ctx.lineTo(canvas.width, ground + 1);
    ctx.stroke();

    // player
    ctx.fillStyle = "#9c1b2f";
    ctx.fillRect(player.x, player.y - player.h, player.w, player.h);

    // obstacles
    ctx.fillStyle = "#c9a063";
    obstacles.forEach((o) => {
      ctx.fillRect(o.x, o.y - o.h, o.w, o.h);
    });

    if (running) {
      requestAnimationFrame(loop);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.font = "16px Poppins, sans-serif";
      const msg = "Game over";
      const textWidth = ctx.measureText(msg).width;
      ctx.fillText(msg, (canvas.width - textWidth) / 2, canvas.height / 2);
    }
  };

  startBtn.addEventListener("click", reset);
  canvas.addEventListener("click", () => {
    if (!running) {
      reset();
    } else {
      jump();
    }
  });
  window.addEventListener("keydown", (e) => {
    const target = e.target;
    const isTypingTarget =
      target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (isTypingTarget) return;
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (!running) reset();
      else jump();
    }
  });

  window.addEventListener("resize", setSize);
}

// (Hero parallax removed with banner)




