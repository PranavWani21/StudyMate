// Smart Study Planner - Vanilla JS + localStorage

const LS_KEYS = {
  tasks: "ssp_tasks",
  goals: "ssp_goals",
  settings: "ssp_settings",
}

let tasks = []
let goals = []
let settings = { defaultReminderMins: 30, notifications: "default" /* default|granted|denied */ }

const reminderTimers = new Map() // taskId -> timeoutId

// Utilities
const uid = () => Math.random().toString(36).slice(2, 10)
const now = () => new Date()
const toISO = (d) => new Date(d).toISOString()
const parseLocalDateTime = (v) => (v ? new Date(v) : null)
const fmtDate = (d) =>
  d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
const isOverdue = (t) => !t.completed && new Date(t.dueAt).getTime() < Date.now()
const minutesUntil = (date) => Math.round((new Date(date).getTime() - Date.now()) / 60000)
const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

function loadData() {
  try {
    tasks = JSON.parse(localStorage.getItem(LS_KEYS.tasks) || "[]")
  } catch {
    tasks = []
  }
  try {
    goals = JSON.parse(localStorage.getItem(LS_KEYS.goals) || "[]")
  } catch {
    goals = []
  }
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEYS.settings) || "{}")
    settings = { ...settings, ...s }
  } catch {
    /* keep defaults */
  }
}

function saveData() {
  localStorage.setItem(LS_KEYS.tasks, JSON.stringify(tasks))
  localStorage.setItem(LS_KEYS.goals, JSON.stringify(goals))
  localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings))
}

// Notifications
function getNotifyPermission() {
  if (!("Notification" in window)) return "unsupported"
  return Notification.permission
}
async function requestNotifications() {
  if (!("Notification" in window)) return "unsupported"
  const perm = await Notification.requestPermission()
  settings.notifications = perm
  saveData()
  updateNotifyStatus()
  return perm
}

function scheduleAllReminders() {
  // Clear existing timers
  for (const [, id] of reminderTimers) clearTimeout(id)
  reminderTimers.clear()

  // Only schedule if permission granted
  if (getNotifyPermission() !== "granted") return

  const upcoming = tasks.filter((t) => !t.completed)
  for (const t of upcoming) {
    const remindAt = new Date(new Date(t.dueAt).getTime() - (t.remindMins ?? settings.defaultReminderMins) * 60000)
    const wait = remindAt.getTime() - Date.now()
    if (wait <= 0) continue // past reminder
    const id = setTimeout(() => showReminder(t), wait)
    reminderTimers.set(t.id, id)
  }
}

function showReminder(t) {
  if (getNotifyPermission() === "granted") {
    new Notification("Study Reminder", {
      body: `${t.title} (${t.subject}) due ${fmtDate(new Date(t.dueAt))}`,
      tag: `task-${t.id}`,
    })
  } else {
    // Fallback
    alert(`Reminder: ${t.title} (${t.subject}) is due ${fmtDate(new Date(t.dueAt))}`)
  }
}

// Stats
function updateStats() {
  const total = tasks.length
  const completed = tasks.filter((t) => t.completed).length
  const upcoming = tasks.filter((t) => !t.completed && new Date(t.dueAt).getTime() >= Date.now()).length

  // Weekly hours from open tasks within the current week
  const { start } = getWeekRange(0)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  const weeklyMins = tasks
    .filter((t) => !t.completed)
    .filter((t) => {
      const d = new Date(t.dueAt)
      return d >= start && d < end
    })
    .reduce((sum, t) => sum + Number(t.durationMins || 0), 0)
  const weeklyHours = (weeklyMins / 60).toFixed(1)

  setText("#stat-total", total)
  setText("#stat-upcoming", upcoming)
  setText("#stat-completed", completed)
  setText("#stat-weekly-hours", weeklyHours)
}

// DOM Helpers
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))
function setText(sel, value) {
  const el = $(sel)
  if (el) el.textContent = String(value)
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null) node.setAttribute(k, v)
  }
  for (const c of children) {
    if (c == null) continue
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
  }
  return node
}

// Panels
function initPanels() {
  const panels = $$(".panel")
  const tabs = $$(".tab-btn")
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.panel
      tabs.forEach((b) => b.classList.toggle("is-active", b === btn))
      panels.forEach((p) => p.classList.toggle("is-hidden", p.id !== id))
      tabs.forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"))
      // Re-render timeline when switching to it
      if (id === "timeline-panel") renderTimeline()
    })
  })
}

// Tasks
function handleTaskForm() {
  const form = $("#task-form")
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const t = {
      id: uid(),
      title: (fd.get("title") || "").toString().trim(),
      subject: (fd.get("subject") || "").toString().trim(),
      dueAt: toISO(parseLocalDateTime(fd.get("dueAt"))),
      durationMins: Number(fd.get("durationMins") || 0),
      priority: (fd.get("priority") || "med").toString(),
      remindMins: Number(fd.get("remindMins") || settings.defaultReminderMins),
      completed: false,
      createdAt: toISO(now()),
    }
    if (!t.title || !t.subject || !t.dueAt || !t.durationMins) return
    tasks.push(t)
    saveData()
    scheduleAllReminders()
    form.reset()
    $("#task-reminder").value = String(settings.defaultReminderMins)
    renderTasks()
    updateStats()
  })
}

function renderTasks() {
  const list = $("#task-list")
  const empty = $("#task-empty")

  const q = $("#filter-q").value.trim().toLowerCase()
  const status = $("#filter-status").value
  const sortBy = $("#sort-by").value

  let data = tasks.slice()

  if (q) {
    data = data.filter((t) => t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q))
  }

  if (status === "open") data = data.filter((t) => !t.completed)
  if (status === "completed") data = data.filter((t) => t.completed)
  if (status === "overdue") data = data.filter((t) => isOverdue(t))

  data.sort((a, b) => {
    if (sortBy === "dueAsc") return new Date(a.dueAt) - new Date(b.dueAt)
    if (sortBy === "dueDesc") return new Date(b.dueAt) - new Date(a.dueAt)
    if (sortBy === "priority") {
      const order = { high: 0, med: 1, low: 2 }
      return order[a.priority] - order[b.priority]
    }
    if (sortBy === "createdDesc") return new Date(b.createdAt) - new Date(a.createdAt)
    return 0
  })

  list.innerHTML = ""
  if (data.length === 0) {
    empty.hidden = false
    return
  }
  empty.hidden = true

  for (const t of data) {
    const due = new Date(t.dueAt)
    const soonMins = minutesUntil(due)
    const soon = !t.completed && soonMins >= 0 && soonMins <= 60
    const item = el("li", { class: "list-item" })

    const left = el(
      "div",
      { class: "task-left" },
      el("input", {
        type: "checkbox",
        "aria-label": "Mark complete",
        checked: t.completed ? "" : null,
        onchange: (e) => {
          t.completed = e.target.checked
          saveData()
          renderTasks()
          updateStats()
          scheduleAllReminders()
        },
      }),
      el(
        "div",
        {},
        el("p", { class: "task-title" }, t.title),
        el("div", { class: "task-meta" }, `${t.subject} • ${fmtDate(due)} • ${t.durationMins} mins`),
        el(
          "div",
          { class: "badges" },
          el("span", { class: `badge ${t.priority}` }, t.priority.toUpperCase()),
          isOverdue(t) ? el("span", { class: "badge overdue" }, "Overdue") : null,
          soon ? el("span", { class: "badge badge-soon" }, "Due soon") : null,
        ),
      ),
    )

    const actions = el(
      "div",
      { class: "task-actions" },
      el(
        "button",
        {
          class: "btn",
          onclick: () => editTask(t.id),
          title: "Edit task",
        },
        "Edit",
      ),
      el(
        "button",
        {
          class: "btn btn-danger",
          onclick: () => {
            if (confirm("Delete this task?")) {
              tasks = tasks.filter((x) => x.id !== t.id)
              saveData()
              renderTasks()
              updateStats()
              scheduleAllReminders()
            }
          },
          title: "Delete task",
        },
        "Delete",
      ),
    )

    const row = el("div", { class: "task-row" }, left, actions)
    item.appendChild(row)
    list.appendChild(item)
  }
}

function editTask(id) {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  // Simple prompt-based editor to keep UI minimal
  const title = prompt("Title", t.title)
  if (title == null) return
  const subject = prompt("Subject", t.subject)
  if (subject == null) return
  const dueAtLocal = new Date(t.dueAt)
  const dueStr = `${dueAtLocal.getFullYear()}-${String(dueAtLocal.getMonth() + 1).padStart(2, "0")}-${String(dueAtLocal.getDate()).padStart(2, "0")}T${String(dueAtLocal.getHours()).padStart(2, "0")}:${String(dueAtLocal.getMinutes()).padStart(2, "0")}`
  const dueInput = prompt("Due (YYYY-MM-DDTHH:MM)", dueStr)
  if (dueInput == null) return
  const duration = prompt("Duration (mins)", String(t.durationMins))
  if (duration == null) return
  const priority = prompt("Priority (low|med|high)", t.priority)
  if (priority == null) return
  const remind = prompt("Reminder minutes before", String(t.remindMins ?? settings.defaultReminderMins))
  if (remind == null) return

  t.title = title.trim() || t.title
  t.subject = subject.trim() || t.subject
  const parsed = parseLocalDateTime(dueInput)
  if (!isNaN(parsed)) t.dueAt = toISO(parsed)
  t.durationMins = Number(duration) || t.durationMins
  t.priority = ["low", "med", "high"].includes(priority) ? priority : t.priority
  t.remindMins = clamp(Number(remind) || (t.remindMins ?? settings.defaultReminderMins), 0, 1440)

  saveData()
  renderTasks()
  updateStats()
  scheduleAllReminders()
}

// Goals
function handleGoalForm() {
  const form = $("#goal-form")
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const g = {
      id: uid(),
      title: (fd.get("title") || "").toString().trim(),
      targetHours: Number(fd.get("targetHours") || 0),
      progressHours: 0,
      createdAt: toISO(now()),
    }
    if (!g.title || !g.targetHours) return
    goals.push(g)
    saveData()
    form.reset()
    renderGoals()
  })
}

function renderGoals() {
  const list = $("#goal-list")
  const empty = $("#goal-empty")

  if (goals.length === 0) {
    list.innerHTML = ""
    empty.hidden = false
    return
  }
  empty.hidden = true

  list.innerHTML = ""
  for (const g of goals) {
    const pct = clamp(Math.round((g.progressHours / Math.max(g.targetHours, 1)) * 100), 0, 100)

    const item = el(
      "li",
      { class: "list-item" },
      el(
        "div",
        { class: "task-row" },
        el(
          "div",
          {},
          el("p", { class: "goal-title" }, g.title),
          el("div", { class: "task-meta" }, `${g.progressHours} / ${g.targetHours} hrs (${pct}%)`),
          el("div", { class: "progress" }, el("span", { style: `width:${pct}%` })),
        ),
        el(
          "div",
          { class: "task-actions" },
          el("button", { class: "btn", onclick: () => addHours(g.id) }, "+ Hours"),
          el("button", { class: "btn", onclick: () => editGoal(g.id) }, "Edit"),
          el(
            "button",
            {
              class: "btn btn-danger",
              onclick: () => {
                if (confirm("Delete this goal?")) {
                  goals = goals.filter((x) => x.id !== g.id)
                  saveData()
                  renderGoals()
                }
              },
            },
            "Delete",
          ),
        ),
      ),
    )
    list.appendChild(item)
  }
}

function addHours(id) {
  const g = goals.find((x) => x.id === id)
  if (!g) return
  const n = prompt("Add hours", "1")
  if (n == null) return
  const val = Number(n)
  if (!isNaN(val) && val > 0) {
    g.progressHours = clamp(g.progressHours + val, 0, 10000)
    saveData()
    renderGoals()
  }
}

function editGoal(id) {
  const g = goals.find((x) => x.id === id)
  if (!g) return
  const title = prompt("Goal", g.title)
  if (title == null) return
  const target = prompt("Target hours", String(g.targetHours))
  if (target == null) return
  const progress = prompt("Progress hours", String(g.progressHours))
  if (progress == null) return

  g.title = title.trim() || g.title
  g.targetHours = Math.max(1, Number(target) || g.targetHours)
  g.progressHours = clamp(Number(progress) || g.progressHours, 0, 10000)
  saveData()
  renderGoals()
}

// Timeline
let weekOffset = 0 // 0 = current week
function getWeekRange(offset = 0) {
  const today = new Date()
  const start = new Date(today)
  const day = start.getDay() // 0 Sun ... 6 Sat
  // make Monday start (ISO): compute diff to Monday
  const diffToMonday = (day + 6) % 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - diffToMonday + 7 * offset)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function renderTimeline() {
  const { start, end } = getWeekRange(weekOffset)
  const grid = $("#timeline-grid")
  const rangeLabel = $("#week-range")
  rangeLabel.textContent = `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`

  // Group tasks by day
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    d.setHours(0, 0, 0, 0)
    return d
  })

  const byDay = days.map((d) => ({
    date: new Date(d),
    tasks: tasks
      .filter((t) => {
        const dt = new Date(t.dueAt)
        return dt >= d && dt < new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      })
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)),
  }))

  grid.innerHTML = ""

  const header = el(
    "div",
    { class: "timeline-row", role: "row" },
    ...byDay.map(({ date }) =>
      el(
        "div",
        { class: "day-col", role: "columnheader" },
        el(
          "div",
          { class: "day-head" },
          date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        ),
        el("span", { class: "time-pill" }, "Due tasks"),
      ),
    ),
  )
  grid.appendChild(header)

  const content = el(
    "div",
    { class: "timeline-row", role: "row" },
    ...byDay.map(({ date, tasks: dTasks }) => {
      const col = el("div", { class: "day-col", role: "cell" })
      col.appendChild(el("div", { class: "sr-only" }, date.toDateString()))
      if (dTasks.length === 0) {
        col.appendChild(el("div", { class: "muted" }, "No tasks"))
      } else {
        for (const t of dTasks) {
          const due = new Date(t.dueAt)
          const soonMins = minutesUntil(due)
          const soon = !t.completed && soonMins >= 0 && soonMins <= 60
          const c = ["tl-task"]
          if (isOverdue(t)) c.push("overdue")
          else if (soon) c.push("tl-task-soon")
          col.appendChild(
            el(
              "div",
              { class: c.join(" ") },
              el(
                "div",
                { style: "display:flex;justify-content:space-between;gap:.5rem;" },
                el("strong", {}, t.title),
                el("span", { class: "time-pill" }, due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
              ),
              el("div", { class: "task-meta" }, `${t.subject} • ${t.durationMins} mins • ${t.priority.toUpperCase()}`),
            ),
          )
        }
      }
      return col
    }),
  )
  grid.appendChild(content)
}

// Settings
function initSettings() {
  const def = $("#default-reminder")
  def.value = String(settings.defaultReminderMins ?? 30)
  def.addEventListener("change", () => {
    settings.defaultReminderMins = Number(def.value)
    saveData()
  })

  $("#request-notify").addEventListener("click", async () => {
    await requestNotifications()
    scheduleAllReminders()
  })

  $("#export-data").addEventListener("click", () => {
    const payload = JSON.stringify({ tasks, goals, settings }, null, 2)
    const blob = new Blob([payload], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `smart-study-planner-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  })

  $("#import-data").addEventListener("click", () => $("#import-input").click())
  $("#import-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"))
        if (Array.isArray(data.tasks)) tasks = data.tasks
        if (Array.isArray(data.goals)) goals = data.goals
        if (data.settings && typeof data.settings === "object") settings = { ...settings, ...data.settings }
        saveData()
        renderTasks()
        renderGoals()
        updateStats()
        renderTimeline()
        scheduleAllReminders()
        alert("Data imported successfully.")
      } catch {
        alert("Invalid file format.")
      }
    }
    reader.readAsText(file)
  })

  updateNotifyStatus()
}
function updateNotifyStatus() {
  const status = $("#notify-status")
  const perm = getNotifyPermission()
  if (perm === "granted") status.textContent = "Notifications enabled"
  else if (perm === "denied") status.textContent = "Notifications blocked in browser"
  else if (perm === "unsupported") status.textContent = "Notifications not supported"
  else status.textContent = "Notifications not enabled"
}

// Filters
function initFilters() {
  $("#filter-q").addEventListener("input", renderTasks)
  $("#filter-status").addEventListener("change", renderTasks)
  $("#sort-by").addEventListener("change", renderTasks)
}

// Timeline controls
function initTimelineControls() {
  $("#prev-week").addEventListener("click", () => {
    weekOffset -= 1
    renderTimeline()
  })
  $("#next-week").addEventListener("click", () => {
    weekOffset += 1
    renderTimeline()
  })
}

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
  loadData()
  initPanels()
  handleTaskForm()
  handleGoalForm()
  initFilters()
  initTimelineControls()
  initSettings()
  // Default reminder select on task form
  $("#task-reminder").value = String(settings.defaultReminderMins)
  // First render
  renderTasks()
  renderGoals()
  updateStats()
  renderTimeline()
  // Schedule reminders
  scheduleAllReminders()
})
