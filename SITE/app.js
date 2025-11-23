const REQUIRED_CREDITS = 130; // Adjust if a real required total is available

const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function initThemeToggle() {
  const toggleButtons = [
    document.getElementById("themeToggle"),
    document.getElementById("themeToggleIcon"),
  ].filter(Boolean);
  if (!toggleButtons.length) return;

  const saved = localStorage.getItem("siam-theme");
  if (saved === "dark" || !saved) {
    document.documentElement.classList.add("dark");
  }

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
  let data = null;
  try {
    const res = await fetch("schedule.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.warn("Failed to load schedule.json via fetch.", err);
  }

  if (!data && window.EMBEDDED_SCHEDULE) {
    data = window.EMBEDDED_SCHEDULE;
  }

  if (!data) {
    showError("Unable to load schedule data. Ensure schedule.json is available.");
    return;
  }

  renderTodayClasses(data.timetable || []);
  renderWeeklyTimetable(data.timetable || []);
  renderCourseList(data.timetable || [], data.grades || []);
  renderProgress(data.grades || []);
  hideError();
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
  if (!container || !dayLabel) return;
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
      .filter((c) => c.day === dayObj.label)
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
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty">No courses found.</div></td></tr>`;
      return;
    }

    filtered.forEach((cls) => {
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
  if (creditsRemainingEl) {
    creditsRemainingEl.textContent = `${remaining} cr`;
  }
  fill.style.width = `${percent}%`;

  // GPA placeholder: adjust when GPA data exists.
  gpaEl.textContent = grades.length ? "N/A" : "--";
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  loadSchedule();
  initRunnerGame("runnerGameSmall", "gameStartBtnSmall", { height: 140 });
  initHeroParallax();
});

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
    ctx.fillStyle = "#1e1e20";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ground line
    ctx.strokeStyle = "rgba(169,169,178,0.25)";
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
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (!running) reset();
      else jump();
    }
  });

  window.addEventListener("resize", setSize);
}

function initHeroParallax() {
  const bannerImg = document.querySelector(".hero-banner-img");
  if (!bannerImg) return;

  const onScroll = () => {
    const offset = window.scrollY * 0.15;
    bannerImg.style.transform = `translateY(${offset}px)`;
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

