const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !JWT_SECRET) {
  console.error("Missing ADMIN_USERNAME, ADMIN_PASSWORD or JWT_SECRET environment variable.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "apps.json");
const APK_DIR = path.join(__dirname, "uploads", "apks");
const ICON_DIR = path.join(__dirname, "uploads", "icons");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(APK_DIR, { recursive: true });
fs.mkdirSync(ICON_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

function readApps() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeApps(apps) {
  fs.writeFileSync(DB_FILE, JSON.stringify(apps, null, 2), "utf8");
}

function deleteFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

function authMiddleware(req, res, next) {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ success: false, message: "Not logged in" });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.username !== ADMIN_USERNAME) {
      return res.status(401).json({ success: false, message: "Invalid admin" });
    }

    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Session expired" });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "apk") return cb(null, APK_DIR);
    if (file.fieldname === "icon") return cb(null, ICON_DIR);
    cb(new Error("Invalid upload field"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + "-" + crypto.randomUUID() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "apk") {
      if (path.extname(file.originalname).toLowerCase() !== ".apk") {
        return cb(new Error("Only APK files are allowed."));
      }
      return cb(null, true);
    }

    if (file.fieldname === "icon") {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
        return cb(new Error("Icon must be PNG, JPG or WEBP."));
      }
      return cb(null, true);
    }

    cb(new Error("Invalid upload field"));
  }
});

/* ---------- Public API ---------- */

app.get("/api/apps", (req, res) => {
  const apps = readApps()
    .filter(a => a.published !== false)
    .map(a => ({
      id: a.id,
      name: a.name,
      version: a.version,
      category: a.category,
      description: a.description,
      icon: a.icon,
      downloads: a.downloads || 0,
      downloadUrl: `/api/apps/${encodeURIComponent(a.id)}/download`,
      createdAt: a.createdAt
    }));

  res.json(apps);
});

app.get("/api/apps/:id/download", (req, res) => {
  const apps = readApps();
  const index = apps.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).send("APK not found");

  const item = apps[index];
  if (!item.apkFile) return res.status(404).send("APK file missing");

  const apkPath = path.join(APK_DIR, path.basename(item.apkFile));
  if (!fs.existsSync(apkPath)) return res.status(404).send("APK file not found");

  item.downloads = (item.downloads || 0) + 1;
  apps[index] = item;
  writeApps(apps);

  res.download(apkPath, item.apkOriginalName || `${item.name || "app"}.apk`);
});

/* ---------- Admin auth ---------- */

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "Wrong username or password" });
  }

  const token = jwt.sign({ username: ADMIN_USERNAME }, JWT_SECRET, { expiresIn: "7d" });

  res.cookie("admin_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({ success: true, message: "Login successful" });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("admin_token");
  res.json({ success: true });
});

app.get("/api/admin/me", authMiddleware, (req, res) => {
  res.json({ success: true, username: req.admin.username });
});

/* ---------- Admin app management ---------- */

app.get("/api/admin/apps", authMiddleware, (req, res) => {
  res.json({ success: true, apps: readApps() });
});

app.post(
  "/api/admin/apps",
  authMiddleware,
  upload.fields([{ name: "apk", maxCount: 1 }, { name: "icon", maxCount: 1 }]),
  (req, res) => {
    try {
      const { name, version, category, description } = req.body;
      const apk = req.files?.apk?.[0];
      const icon = req.files?.icon?.[0];

      if (!name || !version || !category || !apk) {
        if (apk) deleteFile(apk.path);
        if (icon) deleteFile(icon.path);
        return res.status(400).json({
          success: false,
          message: "Name, version, category and APK are required."
        });
      }

      const apps = readApps();
      const newApp = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        version: String(version).trim(),
        category: String(category).trim(),
        description: String(description || "").trim(),
        icon: icon ? `/uploads/icons/${icon.filename}` : null,
        apkFile: apk.filename,
        apkOriginalName: apk.originalname,
        downloads: 0,
        published: true,
        createdAt: new Date().toISOString()
      };

      apps.unshift(newApp);
      writeApps(apps);
      res.json({ success: true, message: "APK added successfully", app: newApp });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

app.patch(
  "/api/admin/apps/:id",
  authMiddleware,
  upload.fields([{ name: "apk", maxCount: 1 }, { name: "icon", maxCount: 1 }]),
  (req, res) => {
    try {
      const apps = readApps();
      const index = apps.findIndex(a => a.id === req.params.id);
      if (index === -1) return res.status(404).json({ success: false, message: "APK not found" });

      const item = apps[index];

      for (const key of ["name", "version", "category", "description"]) {
        if (req.body[key] !== undefined) item[key] = String(req.body[key]).trim();
      }

      if (req.body.published !== undefined) {
        item.published = req.body.published === true || req.body.published === "true";
      }

      const newApk = req.files?.apk?.[0];
      const newIcon = req.files?.icon?.[0];

      if (newApk) {
        deleteFile(path.join(APK_DIR, path.basename(item.apkFile || "")));
        item.apkFile = newApk.filename;
        item.apkOriginalName = newApk.originalname;
      }

      if (newIcon) {
        if (item.icon) deleteFile(path.join(ICON_DIR, path.basename(item.icon)));
        item.icon = `/uploads/icons/${newIcon.filename}`;
      }

      apps[index] = item;
      writeApps(apps);
      res.json({ success: true, message: "APK updated", app: item });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

app.delete("/api/admin/apps/:id", authMiddleware, (req, res) => {
  try {
    const apps = readApps();
    const index = apps.findIndex(a => a.id === req.params.id);
    if (index === -1) return res.status(404).json({ success: false, message: "APK not found" });

    const item = apps[index];
    deleteFile(path.join(APK_DIR, path.basename(item.apkFile || "")));
    if (item.icon) deleteFile(path.join(ICON_DIR, path.basename(item.icon)));

    apps.splice(index, 1);
    writeApps(apps);
    res.json({ success: true, message: "APK deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* ---------- Static files ---------- */

app.use("/uploads/icons", express.static(ICON_DIR));
app.use("/admin", express.static(path.join(__dirname, "admin")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "Aaps Hub" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(400).json({ success: false, message: error.message || "Something went wrong" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aaps Hub running on port ${PORT}`);
});
