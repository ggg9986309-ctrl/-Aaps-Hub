const appsGrid = document.getElementById("appsGrid");
const emptyState = document.getElementById("emptyState");
const appCount = document.getElementById("appCount");
const searchInput = document.getElementById("searchInput");
const categoryButtons = document.querySelectorAll(".category");
const menuBtn = document.getElementById("menuBtn");
const mobileMenu = document.getElementById("mobileMenu");

const modal = document.getElementById("downloadModal");
const modalOverlay = document.getElementById("modalOverlay");
const modalClose = document.getElementById("modalClose");
const modalTitle = document.getElementById("modalTitle");
const modalDescription = document.getElementById("modalDescription");
const modalVersion = document.getElementById("modalVersion");
const modalDownloads = document.getElementById("modalDownloads");
const modalCategory = document.getElementById("modalCategory");
const modalDownload = document.getElementById("modalDownload");
const modalIcon = document.getElementById("modalIcon");

let apps = [];
let selectedCategory = "All";

document.getElementById("year").textContent = new Date().getFullYear();

menuBtn?.addEventListener("click", () => {
  mobileMenu.classList.toggle("open");
  const icon = menuBtn.querySelector("i");
  icon.className = mobileMenu.classList.contains("open")
    ? "fa-solid fa-xmark"
    : "fa-solid fa-bars";
});

document.querySelectorAll(".mobile-menu a").forEach(a => {
  a.addEventListener("click", () => mobileMenu.classList.remove("open"));
});

async function loadApps() {
  try {
    const response = await fetch("/api/apps", { cache: "no-store" });
    if (!response.ok) throw new Error("Server error");
    const data = await response.json();
    apps = Array.isArray(data) ? data : [];
    renderApps();
  } catch (error) {
    console.error(error);
    apps = [];
    showEmpty("Store Connection", "Apps could not be loaded right now.");
  }
}

function renderApps() {
  const query = (searchInput?.value || "").trim().toLowerCase();

  const filtered = apps.filter(app => {
    const name = String(app.name || "").toLowerCase();
    const desc = String(app.description || "").toLowerCase();
    const category = String(app.category || "").toLowerCase();

    return (selectedCategory === "All" || category === selectedCategory.toLowerCase())
      && (name.includes(query) || desc.includes(query) || category.includes(query));
  });

  if (appCount) appCount.textContent = `${filtered.length} App${filtered.length === 1 ? "" : "s"}`;
  if (appsGrid) appsGrid.innerHTML = "";

  if (!filtered.length) {
    showEmpty(
      query || selectedCategory !== "All" ? "No Apps Found" : "No Apps Yet",
      query || selectedCategory !== "All"
        ? "No app matches your search or category."
        : "No apps have been published yet."
    );
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  filtered.forEach((app, index) => {
    const card = document.createElement("article");
    card.className = "app-card";
    card.style.animationDelay = `${index * 0.04}s`;

    const icon = app.icon
      ? `<img src="${escapeAttr(app.icon)}" alt="" loading="lazy">`
      : `<i class="fa-solid fa-mobile-screen-button"></i>`;

    card.innerHTML = `
      <div class="app-top">
        <div class="app-icon">${icon}</div>
        <span class="app-category">${escapeHTML(app.category || "Apps")}</span>
      </div>
      <h3>${escapeHTML(app.name || "Unknown App")}</h3>
      <p>${escapeHTML(app.description || "No description available.")}</p>
      <div class="app-meta">
        <span>v${escapeHTML(app.version || "1.0")}</span>
        <span><i class="fa-solid fa-download"></i> ${formatDownloads(app.downloads)}</span>
      </div>
      <button class="app-download" type="button"><i class="fa-solid fa-download"></i> Download APK</button>
    `;

    card.querySelector(".app-download").addEventListener("click", () => openDownloadModal(app));
    appsGrid.appendChild(card);
  });
}

function openDownloadModal(app) {
  modalTitle.textContent = app.name || "Unknown App";
  modalDescription.textContent = app.description || "No description available.";
  modalVersion.textContent = app.version || "1.0";
  modalDownloads.textContent = formatDownloads(app.downloads);
  modalCategory.textContent = app.category || "App";

  modalIcon.innerHTML = app.icon
    ? `<img src="${escapeAttr(app.icon)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
    : `<i class="fa-solid fa-mobile-screen-button"></i>`;

  modalDownload.href = app.downloadUrl || "#";
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

modalClose?.addEventListener("click", closeModal);
modalOverlay?.addEventListener("click", closeModal);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchInput?.focus();
  }
});

searchInput?.addEventListener("input", renderApps);

categoryButtons.forEach(button => {
  button.addEventListener("click", () => {
    categoryButtons.forEach(b => b.classList.remove("active"));
    button.classList.add("active");
    selectedCategory = button.dataset.category || "All";
    renderApps();
  });
});

function showEmpty(title, message) {
  if (!emptyState) return;
  emptyState.style.display = "block";
  emptyState.querySelector("h3").textContent = title;
  emptyState.querySelector("p").textContent = message;
}

function formatDownloads(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "K";
  return String(n);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value);
}

loadApps();
setInterval(loadApps, 60000);
