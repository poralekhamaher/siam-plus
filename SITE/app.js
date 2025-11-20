const REQUIRED_CREDITS = 130; // Adjust if a real required total is available

const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function initThemeToggle() {
  const toggleBtn = document.getElementById("themeToggle");
  const saved = localStorage.getItem("siam-theme");
  if (saved === "dark") document.documentElement.classList.add("dark");

  const setIcon = () => {
    const isDark = document.documentElement.classList.contains("dark");
    toggleBtn.textContent = isDark ? "☀️" : "🌙";
  };

  toggleBtn.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    const isDark = document.documentElement.classList.contains("dark");
    localStorage.setItem("siam-theme", isDark ? "dark" : "light");
    setIcon();
  });

  setIcon();
}

async function loadSchedule() {
  try {
    const res = await fetch("schedule.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderTodayClasses(data.timetable || []);
    renderWeeklyTimetable(data.timetable || []);
    renderCourseList(data.timetable || [], data.grades || []);
    renderProgress(data.grades || []);
    hideError();
  } catch (err) {
    console.error("Failed to load schedule:", err);
    showError("Unable to load schedule.json. Please ensure it is in the same folder as this page.");
  }
}

function showError(message) {
  const card = document.getElementById("errorCard");
  const msgEl = document.getElementById("errorMessage");
  msgEl.textContent = message;
  card.classList.remove("hidden");
}

function hideError() {
  document.getElementById("errorCard").classList.add("hidden");
}

function renderTodayClasses(timetable) {
  const container = document.getElementById("todayClasses");
  const dayLabel = document.getElementById("todayLabel");
  container.innerHTML = "";
  const now = new Date();
  const todayIdx = now.getDay(); // 0 (Sun) - 6 (Sat)
  const dayShort = daysOrder[(todayIdx + 6) % 7]; // map Sunday to index 6
  dayLabel.textContent = dayShort;

  const todayList = timetable.filter((c) => c.day === dayShort);
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
  const grid = document.getElementById("weeklyTimetable");
  grid.innerHTML = "";
  const grouped = daysOrder.map((d) => ({
    day: d,
    classes: timetable.filter((c) => c.day === d).sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "")),
  }));

  grouped.forEach(({ day, classes }) => {
    const card = document.createElement("div");
    card.className = "day-card";
    const body = classes
      .map(
        (cls) => `
        <div class="class-chip">
          <div class="class-meta">
            <p class="class-title">${cls.course_code || ""} - ${cls.course_name || ""}</p>
            <p class="muted">${cls.location || "Room TBA"}</p>
          </div>
          <div class="badge">${cls.start_time || "--:--"} - ${cls.end_time || "--:--"}</div>
        </div>`
      )
      .join("");
    card.innerHTML = `
      <div class="day-title">
        <h3>${day}</h3>
        <span class="pill pill-soft">${classes.length || "0"} class${classes.length === 1 ? "" : "es"}</span>
      </div>
      ${classes.length ? body : `<div class="empty">No classes</div>`}
    `;
    grid.appendChild(card);
  });

  renderMobileAccordion(grouped);
}

function renderMobileAccordion(grouped) {
  let accordion = document.querySelector(".accordion");
  if (!accordion) {
    accordion = document.createElement("div");
    accordion.className = "accordion";
    accordion.id = "mobileAccordion";
    document.querySelector("main").insertBefore(accordion, document.querySelector(".card:nth-of-type(3)"));
  }
  accordion.innerHTML = "";

  grouped.forEach(({ day, classes }) => {
    const item = document.createElement("div");
    const buttonId = `btn-${day}`;
    const panelId = `panel-${day}`;
    item.innerHTML = `
      <button aria-expanded="false" aria-controls="${panelId}" id="${buttonId}">
        ${day} (${classes.length})
      </button>
      <div class="accordion-panel hidden" id="${panelId}" role="region" aria-labelledby="${buttonId}">
        ${
          classes.length
            ? classes
                .map(
                  (cls) => `
              <div class="class-chip" tabindex="0">
                <div class="class-meta">
                  <p class="class-title">${cls.course_code || ""} - ${cls.course_name || ""}</p>
                  <p class="muted">${cls.location || "Room TBA"}</p>
                </div>
                <div class="badge">${cls.start_time || "--:--"} - ${cls.end_time || "--:--"}</div>
              </div>
            `
                )
                .join("")
            : `<div class="empty">No classes</div>`
        }
      </div>
    `;
    accordion.appendChild(item);
  });

  accordion.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = document.getElementById(btn.getAttribute("aria-controls"));
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      panel.classList.toggle("hidden");
    });
  });
}

function renderCourseList(timetable, grades) {
  const tbody = document.getElementById("courseList");
  const search = document.getElementById("courseSearch");

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

  const draw = (filter = "") => {
    tbody.innerHTML = "";
    const query = filter.trim().toLowerCase();
    const filtered = dataset.filter((cls) => {
      const code = (cls.code || "").toLowerCase();
      const name = (cls.name || "").toLowerCase();
      const term = (cls.section || "").toLowerCase();
      return !query || code.includes(query) || name.includes(query) || term.includes(query);
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty">No courses found.</div></td></tr>`;
      return;
    }

    filtered.forEach((cls) => {
      const time = cls.start_time && cls.end_time ? `${cls.start_time} - ${cls.end_time}` : "--:--";
      const day = cls.day || "--";
      const term = cls.section || "--";
      const status = cls.grade
        ? `${cls.grade}${cls.credit ? ` (${cls.credit} cr)` : ""}`
        : cls.day
        ? "Scheduled"
        : "In progress";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${cls.code || ""}</td>
        <td>${cls.name || ""}</td>
        <td>${term}</td>
        <td>${day}</td>
        <td>${time}</td>
        <td>${cls.location || "Room TBA"}</td>
        <td>${cls.lecturer || "TBA"}</td>
        <td>${status || "-"}</td>
      `;
      tbody.appendChild(tr);
    });
  };

  search.addEventListener("input", (e) => draw(e.target.value));
  draw();
}

function renderProgress(grades) {
  // If the JSON includes a credit summary or GPA, wire it here.
  const creditsCompletedEl = document.getElementById("creditsCompleted");
  const creditsRemainingEl = document.getElementById("creditsRemaining");
  const gpaEl = document.getElementById("gpaValue");
  const fill = document.getElementById("progressFill");

  const completed = grades
    .map((g) => parseFloat(g.credit))
    .filter((n) => !Number.isNaN(n))
    .reduce((sum, n) => sum + n, 0);

  const remaining = Math.max(REQUIRED_CREDITS - completed, 0);
  const percent = Math.min((completed / REQUIRED_CREDITS) * 100, 100);

  creditsCompletedEl.textContent = `${completed} cr`;
  creditsRemainingEl.textContent = `${remaining} cr`;
  fill.style.width = `${percent}%`;

  // GPA placeholder: adjust when GPA data exists.
  gpaEl.textContent = grades.length ? "N/A" : "--";
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  loadSchedule();
});
