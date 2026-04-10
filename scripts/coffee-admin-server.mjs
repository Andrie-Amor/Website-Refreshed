// Run locally with: npm run coffee-admin, then open http://127.0.0.1:4322
import { createServer } from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE_PATH = path.join(ROOT_DIR, "src", "data", "coffeeShops.json");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const LOGO_PUBLIC_DIR = path.join(PUBLIC_DIR, "images", "coffee-logos");
const LOGO_PUBLIC_PREFIX = "/images/coffee-logos/";
const HOST = "127.0.0.1";
const PORT = Number(process.env.COFFEE_ADMIN_PORT || 4322);
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const SERVER_STARTED_AT = new Date().toISOString();
const IS_WATCH_MODE = process.env.COFFEE_ADMIN_WATCH === "1";
const DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(
  response,
  statusCode,
  text,
  contentType = "text/plain; charset=utf-8",
) {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(text);
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function compactString(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function optionalString(value) {
  const normalized = compactString(value);
  return normalized ? normalized : undefined;
}

function optionalMultilineString(value) {
  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n")
    .trim();

  return normalized ? normalized : undefined;
}

function normalizeAccent(value) {
  const normalized = compactString(value);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    return normalized.toLowerCase();
  }

  return "#8b6f60";
}

function normalizeCoordinate(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return Number(numeric.toFixed(6));
}

function optionalBoolean(value) {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }

  return undefined;
}

function normalizeHours(rawHours) {
  if (typeof rawHours === "string") {
    const label = optionalString(rawHours);
    return label ? [{ days: [...DAY_ORDER], label }] : undefined;
  }

  if (!Array.isArray(rawHours)) {
    return undefined;
  }

  const entries = rawHours
    .map((entry) => {
      const days = Array.isArray(entry?.days)
        ? entry.days.filter((day) => DAY_ORDER.includes(day))
        : [];
      const label = optionalString(entry?.label);

      if (days.length === 0 || !label) {
        return null;
      }

      return { days, label };
    })
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

function normalizeDetails(rawDetails) {
  const details = {
    wifi: optionalBoolean(rawDetails?.wifi),
    sockets: optionalBoolean(rawDetails?.sockets),
    seating: optionalBoolean(rawDetails?.seating),
    hours: normalizeHours(rawDetails?.hours),
  };

  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value),
  );
}

function ensureShopPayload(rawShop) {
  const name = compactString(rawShop?.name);
  if (!name) {
    throw new Error("Name is required.");
  }

  const id = slugify(rawShop?.id || name);
  if (!id) {
    throw new Error("A valid id could not be generated.");
  }

  const longitude = normalizeCoordinate(
    rawShop?.coordinates?.[0] ?? rawShop?.longitude,
    "Longitude",
  );
  const latitude = normalizeCoordinate(
    rawShop?.coordinates?.[1] ?? rawShop?.latitude,
    "Latitude",
  );

  const details = normalizeDetails(rawShop?.details);

  return {
    id,
    name,
    coordinates: [longitude, latitude],
    description: optionalMultilineString(rawShop?.description),
    recommendedStudySpot: optionalBoolean(rawShop?.recommendedStudySpot),
    accent: normalizeAccent(rawShop?.accent),
    logoPath:
      typeof rawShop?.logoPath === "string" && rawShop.logoPath.startsWith("/")
        ? rawShop.logoPath
        : null,
    website: optionalString(rawShop?.website),
    neighborhood: optionalString(rawShop?.neighborhood),
    address: optionalString(rawShop?.address),
    addressUrl: optionalString(rawShop?.addressUrl),
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}

async function readDataFile() {
  const raw = await readFile(DATA_FILE_PATH, "utf8");
  return JSON.parse(raw);
}

async function writeDataFile(payload) {
  await writeFile(
    DATA_FILE_PATH,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function collectAllShops(data) {
  return Object.values(data).flatMap((city) => city.shops);
}

function isManagedLogoPath(logoPath) {
  return (
    typeof logoPath === "string" && logoPath.startsWith(LOGO_PUBLIC_PREFIX)
  );
}

async function maybeDeleteManagedLogo(logoPath, data) {
  if (!isManagedLogoPath(logoPath)) return;

  const stillUsed = collectAllShops(data).some(
    (shop) => shop.logoPath === logoPath,
  );
  if (stillUsed) return;

  const absolutePath = path.join(PUBLIC_DIR, logoPath.replace(/^\//, ""));
  try {
    await unlink(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function extensionFromUpload(upload) {
  const originalExtension = path.extname(upload.filename || "").toLowerCase();
  if (
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(
      originalExtension,
    )
  ) {
    return originalExtension;
  }

  if (upload.mimeType === "image/png") return ".png";
  if (upload.mimeType === "image/jpeg") return ".jpg";
  if (upload.mimeType === "image/webp") return ".webp";
  if (upload.mimeType === "image/gif") return ".gif";
  if (upload.mimeType === "image/svg+xml") return ".svg";
  return ".png";
}

async function persistLogo(shopId, upload) {
  if (!upload?.base64) {
    return null;
  }

  const fileBuffer = Buffer.from(upload.base64, "base64");
  if (fileBuffer.byteLength === 0) {
    return null;
  }

  await mkdir(LOGO_PUBLIC_DIR, { recursive: true });

  const extension = extensionFromUpload(upload);
  const fileName = `${shopId}${extension}`;
  const destinationPath = path.join(LOGO_PUBLIC_DIR, fileName);

  await writeFile(destinationPath, fileBuffer);

  return `${LOGO_PUBLIC_PREFIX}${fileName}`;
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text);
}

function withCors(response) {
  response.setHeader("access-control-allow-origin", `http://${HOST}:${PORT}`);
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

async function servePublicAsset(response, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const absolutePath = path.join(PUBLIC_DIR, decodedPath.replace(/^\//, ""));

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const fileContents = await readFile(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(fileContents);
  } catch (error) {
    sendText(response, error?.code === "ENOENT" ? 404 : 500, "Asset not found");
  }
}

async function handleSaveShop(request, response) {
  const body = await readJsonBody(request);
  const cityKey = compactString(body.cityKey);
  const previousShopId = compactString(body.previousShopId);
  const hasAccentOverride = Boolean(compactString(body.shop?.accent));
  const normalizedShop = ensureShopPayload(body.shop);
  const data = await readDataFile();
  const city = data[cityKey];

  if (!city) {
    throw new Error("City not found.");
  }

  const existingIndex = city.shops.findIndex((shop) =>
    previousShopId ? shop.id === previousShopId : shop.id === normalizedShop.id,
  );
  const existingShop = existingIndex >= 0 ? city.shops[existingIndex] : null;

  const conflictingIndex = city.shops.findIndex(
    (shop) => shop.id === normalizedShop.id && shop.id !== previousShopId,
  );
  if (conflictingIndex >= 0) {
    throw new Error(`A shop with id "${normalizedShop.id}" already exists.`);
  }

  let nextLogoPath = existingShop?.logoPath ?? normalizedShop.logoPath;
  if (body.logoUpload?.base64) {
    nextLogoPath = await persistLogo(normalizedShop.id, body.logoUpload);
  }
  if (!nextLogoPath) {
    throw new Error("Logo is required.");
  }

  const nextShop = {
    ...normalizedShop,
    accent: hasAccentOverride
      ? normalizedShop.accent
      : (existingShop?.accent ?? normalizedShop.accent),
    logoPath: nextLogoPath,
  };

  if (!nextShop.description) delete nextShop.description;
  if (!nextShop.recommendedStudySpot) delete nextShop.recommendedStudySpot;
  if (!nextShop.website) delete nextShop.website;
  if (!nextShop.neighborhood) delete nextShop.neighborhood;
  if (!nextShop.address) delete nextShop.address;
  if (!nextShop.addressUrl) delete nextShop.addressUrl;
  if (!nextShop.details || Object.keys(nextShop.details).length === 0) {
    delete nextShop.details;
  }

  if (existingIndex >= 0) {
    city.shops.splice(existingIndex, 1, nextShop);
  } else {
    city.shops.push(nextShop);
  }

  await writeDataFile(data);

  if (existingShop?.logoPath && existingShop.logoPath !== nextShop.logoPath) {
    await maybeDeleteManagedLogo(existingShop.logoPath, data);
  }

  sendJson(response, 200, {
    ok: true,
    cityKey,
    shop: nextShop,
    data,
  });
}

async function handleDeleteShop(request, response, url) {
  const cityKey = compactString(url.searchParams.get("cityKey"));
  const shopId = compactString(url.searchParams.get("shopId"));
  const data = await readDataFile();
  const city = data[cityKey];

  if (!city) {
    throw new Error("City not found.");
  }

  const existingIndex = city.shops.findIndex((shop) => shop.id === shopId);
  if (existingIndex < 0) {
    throw new Error("Shop not found.");
  }

  const [removedShop] = city.shops.splice(existingIndex, 1);
  await writeDataFile(data);

  if (removedShop.logoPath) {
    await maybeDeleteManagedLogo(removedShop.logoPath, data);
  }

  sendJson(response, 200, {
    ok: true,
    cityKey,
    deletedShopId: shopId,
    data,
  });
}

const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local Coffee Admin</title>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Lora&display=swap" rel="stylesheet" />
    <style>
      :root {
        color-scheme: light;
        --bg: #ffffff;
        --panel: #ffffff;
        --panel-strong: #f9f9f9;
        --line: #e5e5e5;
        --text: #111111;
        --muted: #666666;
        --accent: #333333;
        --accent-strong: #111111;
        --danger: #8a3b32;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: "Lora", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      }

      .shell {
        width: min(1080px, calc(100vw - 2rem));
        margin: 0 auto;
        padding: 1rem 0 2rem;
      }

      .hero {
        margin-bottom: 1rem;
        padding: 0.5rem 0;
      }

      .hero h1 {
        margin: 0;
        font-size: 2rem;
        line-height: 1.1;
        color: #333333;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(18rem, 21rem) minmax(0, 1fr);
        gap: 1rem;
        align-items: start;
      }

      .panel {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--panel);
      }

      .sidebar {
        position: sticky;
        top: 1rem;
        display: flex;
        flex-direction: column;
        height: calc(100vh - 4rem);
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        padding: 0.85rem 1rem;
        border-bottom: 1px solid var(--line);
      }

      .panel-header h2,
      .panel-header h3 {
        margin: 0;
        font-size: 1.05rem;
        color: #333333;
      }

      .toolbar {
        display: flex;
        gap: 0.55rem;
        flex-wrap: wrap;
      }

      button,
      select,
      input,
      textarea {
        font: inherit;
      }

      button {
        border: 1px solid var(--line);
        border-radius: 4px;
        background: #ffffff;
        color: var(--text);
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease;
      }

      button:hover {
        background-color: #f0f0f0;
        border-color: #d9d9d9;
      }

      .button-primary {
        background: #f9f9f9;
        color: #333333;
        border-color: var(--line);
      }

      .button-danger {
        color: var(--danger);
      }

      .button-ghost {
        background: transparent;
      }

      .toolbar button,
      .form-actions button {
        padding: 0.55rem 0.8rem;
      }

      .shop-list {
        display: grid;
        flex: 1 1 auto;
        gap: 0.55rem;
        min-height: 0;
        padding: 0.8rem;
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .shop-card {
        display: grid;
        grid-template-columns: 3rem minmax(0, 1fr);
        gap: 0.85rem;
        width: 100%;
        padding: 0.8rem;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--panel-strong);
        text-align: left;
      }

      .shop-card.is-active {
        border-color: #cfcfcf;
        background: #f5f5f5;
      }

      .shop-avatar {
        display: grid;
        place-items: center;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 5px;
        overflow: hidden;
        border: 1px solid var(--line);
        background: #ffffff;
        color: #333333;
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.08em;
      }

      .shop-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .shop-card strong {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 1rem;
      }

      .shop-card span {
        display: block;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.45;
      }

      .shop-card code {
        display: inline-block;
        margin-top: 0.35rem;
        padding: 0.15rem 0.4rem;
        border-radius: 3px;
        background: #f0f0f0;
        font-size: 0.76rem;
      }

      .form-shell {
        padding: 0.9rem 1rem 1rem;
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }

      .field-group {
        display: grid;
        gap: 0.45rem;
      }

      .field-group.col-span-2 {
        grid-column: span 2;
      }

      .hours-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem 0.75rem;
      }

      .hours-row {
        display: grid;
        gap: 0.22rem;
      }

      .hours-row span {
        color: var(--muted);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .toggle-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }

      .toggle-chip {
        padding: 0.7rem 0.95rem;
        border-radius: 999px;
        font-size: 0.92rem;
      }

      .toggle-chip.is-active {
        background: #111111;
        border-color: #111111;
        color: #ffffff;
      }

      label {
        font-size: 0.84rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted);
      }

      input,
      select,
      textarea {
        width: 100%;
        padding: 0.7rem 0.8rem;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: #ffffff;
        color: var(--text);
      }

      textarea {
        min-height: 6.5rem;
        resize: vertical;
      }

      .logo-preview {
        display: flex;
        align-items: center;
        gap: 0.9rem;
        padding: 0.8rem;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: #f9f9f9;
      }

      .logo-preview img,
      .logo-fallback {
        width: 3.6rem;
        height: 3.6rem;
        border-radius: 4px;
        object-fit: cover;
        background: #ffffff;
        border: 1px solid var(--line);
      }

      .logo-fallback {
        display: grid;
        place-items: center;
        color: var(--muted);
        font-size: 0.8rem;
      }

      .inline-check {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .inline-check input {
        width: auto;
        margin: 0;
      }

      .status {
        min-height: 1.4rem;
        margin-bottom: 0.85rem;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .status.is-error {
        color: var(--danger);
      }

      .status.is-success {
        color: var(--accent-strong);
      }

      .form-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--line);
      }

      .form-actions .left,
      .form-actions .right {
        display: flex;
        gap: 0.55rem;
        flex-wrap: wrap;
      }

      .tiny {
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.45;
      }

      @media (max-width: 980px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .sidebar {
          position: static;
          height: auto;
          min-height: 0;
        }
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 1rem, 100%);
          padding-top: 0.75rem;
        }

        .form-grid {
          grid-template-columns: 1fr;
        }

        .field-group.col-span-2 {
          grid-column: span 1;
        }

        .hours-grid {
          grid-template-columns: 1fr;
        }

        .form-actions {
          flex-direction: column;
          align-items: stretch;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <h1>Local Coffee Admin</h1>
      </section>

      <div class="layout">
        <aside class="panel sidebar">
          <div class="panel-header">
            <div><h2>Shops</h2></div>
            <div class="toolbar">
              <button id="refresh-data" type="button" class="button-ghost">Refresh</button>
              <button id="new-shop" type="button" class="button-primary">New shop</button>
            </div>
          </div>
          <div id="shop-list" class="shop-list"></div>
        </aside>

        <main class="panel">
          <div class="panel-header">
            <div><h3>Shop Details</h3></div>
          </div>
          <div class="form-shell">
            <div id="status" class="status"></div>
            <form id="shop-form">
              <div class="form-grid">
                <div class="field-group">
                  <label for="city-key">City</label>
                  <select id="city-key" name="cityKey"></select>
                </div>

                <div class="field-group">
                  <label for="name">Name</label>
                  <input id="name" name="name" type="text" required />
                </div>
                <div class="field-group">
                  <label for="id">Id</label>
                  <input id="id" name="id" type="text" required />
                </div>

                <div class="field-group">
                  <label for="website">Website</label>
                  <input id="website" name="website" type="url" placeholder="https://..." />
                </div>

                <div class="field-group">
                  <label for="longitude">Longitude</label>
                  <input id="longitude" name="longitude" type="number" step="0.000001" required />
                </div>
                <div class="field-group">
                  <label for="latitude">Latitude</label>
                  <input id="latitude" name="latitude" type="number" step="0.000001" required />
                </div>

                <div class="field-group">
                  <label for="neighborhood">Neighborhood</label>
                  <input id="neighborhood" name="neighborhood" type="text" />
                </div>
                <div class="field-group">
                  <label for="address">Address</label>
                  <input id="address" name="address" type="text" />
                </div>
                <div class="field-group col-span-2">
                  <label for="address-url">Address Link</label>
                  <input id="address-url" name="addressUrl" type="url" placeholder="https://maps.google.com/..." />
                </div>

                <div class="field-group col-span-2">
                  <label for="description">Description</label>
                  <textarea id="description" name="description"></textarea>
                </div>

                <div class="field-group col-span-2">
                  <label>Study Spot</label>
                  <div class="toggle-row" role="group" aria-label="Study spot">
                    <button type="button" class="toggle-chip" data-detail-toggle="recommendedStudySpot" aria-pressed="false">Recommend Study Spot</button>
                  </div>
                  <input id="recommendedStudySpot" name="recommendedStudySpot" type="hidden" />
                </div>

                <div class="field-group col-span-2">
                  <label>Hours</label>
                  <div class="hours-grid">
                    <label class="hours-row">
                      <span>Sun</span>
                      <input id="hours-sun" name="hoursSun" type="text" placeholder="Closed" />
                    </label>
                    <label class="hours-row">
                      <span>Mon</span>
                      <input id="hours-mon" name="hoursMon" type="text" placeholder="9 AM - 5 PM" />
                    </label>
                    <label class="hours-row">
                      <span>Tue</span>
                      <input id="hours-tue" name="hoursTue" type="text" placeholder="9 AM - 5 PM" />
                    </label>
                    <label class="hours-row">
                      <span>Wed</span>
                      <input id="hours-wed" name="hoursWed" type="text" placeholder="9 AM - 5 PM" />
                    </label>
                    <label class="hours-row">
                      <span>Thu</span>
                      <input id="hours-thu" name="hoursThu" type="text" placeholder="9 AM - 5 PM" />
                    </label>
                    <label class="hours-row">
                      <span>Fri</span>
                      <input id="hours-fri" name="hoursFri" type="text" placeholder="9 AM - 5 PM" />
                    </label>
                    <label class="hours-row">
                      <span>Sat</span>
                      <input id="hours-sat" name="hoursSat" type="text" placeholder="Closed" />
                    </label>
                  </div>
                </div>
                <div class="field-group col-span-2">
                  <div class="toggle-row" role="group" aria-label="Amenities">
                    <button type="button" class="toggle-chip" data-detail-toggle="wifi" aria-pressed="false">Wifi</button>
                    <button type="button" class="toggle-chip" data-detail-toggle="sockets" aria-pressed="false">Sockets</button>
                    <button type="button" class="toggle-chip" data-detail-toggle="seating" aria-pressed="false">Seating</button>
                  </div>
                  <input id="wifi" name="wifi" type="hidden" />
                  <input id="sockets" name="sockets" type="hidden" />
                  <input id="seating" name="seating" type="hidden" />
                </div>
                <div class="field-group">
                  <label for="logo-file">Logo Image</label>
                  <input id="logo-file" name="logoFile" type="file" accept="image/*" required />
                </div>

                <div class="field-group col-span-2">
                  <label>Logo Preview</label>
                  <div class="logo-preview">
                    <div id="logo-fallback" class="logo-fallback">No logo</div>
                    <img id="logo-preview" alt="" hidden />
                    <div>
                      <div id="logo-path" class="tiny">Upload a logo to save this shop.</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-actions">
                <div class="left">
                  <button type="submit" class="button-primary">Save shop</button>
                  <button id="reset-form" type="button" class="button-ghost">Reset form</button>
                </div>
                <div class="right">
                  <button id="delete-shop" type="button" class="button-danger">Delete selected shop</button>
                </div>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>

    <script>
      const DAY_ORDER = ${JSON.stringify(DAY_ORDER)};
      const state = {
        data: null,
        cityKey: "",
        selectedShopId: null,
      };

      const statusElement = document.getElementById("status");
      const shopListElement = document.getElementById("shop-list");
      const formElement = document.getElementById("shop-form");
      const citySelect = document.getElementById("city-key");
      const newShopButton = document.getElementById("new-shop");
      const refreshButton = document.getElementById("refresh-data");
      const resetButton = document.getElementById("reset-form");
      const deleteButton = document.getElementById("delete-shop");
      const logoFileInput = document.getElementById("logo-file");
      const logoPreview = document.getElementById("logo-preview");
      const logoFallback = document.getElementById("logo-fallback");
      const logoPathLabel = document.getElementById("logo-path");
      const nameInput = document.getElementById("name");
      const idInput = document.getElementById("id");
      const detailToggleButtons = Array.from(document.querySelectorAll("[data-detail-toggle]"));
      const ACTIVE_DETAIL_VALUE = "true";
      const hoursInputIds = Object.fromEntries(
        DAY_ORDER.map((day) => [day, "hours-" + day.toLowerCase()]),
      );
      let serverStartedAt = ${JSON.stringify(SERVER_STARTED_AT)};

      function slugify(value) {
        return String(value || "")
          .normalize("NFKD")
          .replace(/[\\u0300-\\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .replace(/-{2,}/g, "-");
      }

      function getCity() {
        return state.data?.[state.cityKey] || null;
      }

      function getSelectedShop() {
        const city = getCity();
        if (!city || !state.selectedShopId) return null;
        return city.shops.find((shop) => shop.id === state.selectedShopId) || null;
      }

      function setStatus(message, tone) {
        statusElement.textContent = message || "";
        statusElement.className = "status" + (tone ? " is-" + tone : "");
      }

      function fileToBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || "");
            const base64 = result.includes(",") ? result.split(",")[1] : result;
            resolve({
              filename: file.name,
              mimeType: file.type,
              base64,
            });
          };
          reader.onerror = () => reject(new Error("Could not read the selected file."));
          reader.readAsDataURL(file);
        });
      }

      function updateLogoPreview() {
        const selectedShop = getSelectedShop();
        const file = logoFileInput.files && logoFileInput.files[0];

        if (file) {
          const objectUrl = URL.createObjectURL(file);
          logoPreview.src = objectUrl;
          logoPreview.hidden = false;
          logoFallback.hidden = true;
          logoPathLabel.textContent = "New upload: " + file.name;
          return;
        }

        if (selectedShop && selectedShop.logoPath) {
          logoPreview.src = selectedShop.logoPath;
          logoPreview.hidden = false;
          logoFallback.hidden = true;
          logoPathLabel.textContent = "Saved logo: " + selectedShop.logoPath;
          return;
        }

        logoPreview.hidden = true;
        logoPreview.removeAttribute("src");
        logoFallback.hidden = false;
        logoPathLabel.textContent = "Upload a logo to save this shop.";
      }

      function fillHoursInputs(hours) {
        DAY_ORDER.forEach((day) => {
          const input = document.getElementById(hoursInputIds[day]);
          if (input) {
            input.value = "";
          }
        });

        if (!Array.isArray(hours)) {
          return;
        }

        hours.forEach((entry) => {
          if (!Array.isArray(entry?.days) || !entry?.label) {
            return;
          }

          entry.days.forEach((day) => {
            const input = document.getElementById(hoursInputIds[day]);
            if (input) {
              input.value = entry.label;
            }
          });
        });
      }

      function buildHoursSchedule() {
        const dailyLabels = DAY_ORDER.map((day) => {
          const input = document.getElementById(hoursInputIds[day]);
          return String(input?.value || "").trim().replace(/\\s+/g, " ");
        });

        const entries = [];
        let currentEntry = null;

        dailyLabels.forEach((label, index) => {
          const day = DAY_ORDER[index];

          if (!label) {
            currentEntry = null;
            return;
          }

          if (currentEntry && currentEntry.label === label) {
            currentEntry.days.push(day);
            return;
          }

          currentEntry = {
            days: [day],
            label,
          };
          entries.push(currentEntry);
        });

        return entries;
      }

      function blankShop(city) {
        return {
          id: "",
          name: "",
          coordinates: city?.center ? [city.center[0], city.center[1]] : [-122.433, 37.764],
          description: "",
          recommendedStudySpot: false,
          logoPath: "",
          website: "",
          neighborhood: "",
          address: "",
          addressUrl: "",
          details: {
            wifi: false,
            sockets: false,
            seating: false,
            hours: [],
          },
        };
      }

      function syncDetailToggleButtons() {
        detailToggleButtons.forEach((button) => {
          const key = button.dataset.detailToggle;
          const input = key ? document.getElementById(key) : null;
          const isActive = Boolean(input?.value);
          button.classList.toggle("is-active", isActive);
          button.setAttribute("aria-pressed", String(isActive));
        });
      }

      function fillCityOptions() {
        citySelect.innerHTML = "";
        const entries = Object.entries(state.data || {});
        entries.forEach(([cityKey, city]) => {
          const option = document.createElement("option");
          option.value = cityKey;
          option.textContent = city.label;
          citySelect.append(option);
        });

        if (!state.cityKey && entries[0]) {
          state.cityKey = entries[0][0];
        }

        citySelect.value = state.cityKey;
      }

      function fillForm(shop) {
        document.getElementById("name").value = shop.name || "";
        document.getElementById("id").value = shop.id || "";
        document.getElementById("longitude").value = shop.coordinates?.[0] ?? "";
        document.getElementById("latitude").value = shop.coordinates?.[1] ?? "";
        document.getElementById("website").value = shop.website || "";
        document.getElementById("neighborhood").value = shop.neighborhood || "";
        document.getElementById("address").value = shop.address || "";
        document.getElementById("address-url").value = shop.addressUrl || "";
        document.getElementById("description").value = shop.description || "";
        document.getElementById("recommendedStudySpot").value = shop.recommendedStudySpot ? ACTIVE_DETAIL_VALUE : "";
        fillHoursInputs(shop.details?.hours || []);
        document.getElementById("wifi").value = shop.details?.wifi ? ACTIVE_DETAIL_VALUE : "";
        document.getElementById("sockets").value = shop.details?.sockets ? ACTIVE_DETAIL_VALUE : "";
        document.getElementById("seating").value = shop.details?.seating ? ACTIVE_DETAIL_VALUE : "";
        syncDetailToggleButtons();
        logoFileInput.value = "";
        logoFileInput.required = !shop.logoPath;
        updateLogoPreview();
      }

      function renderShopList() {
        const city = getCity();
        shopListElement.innerHTML = "";

        if (!city) {
          return;
        }

        city.shops.forEach((shop) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "shop-card" + (shop.id === state.selectedShopId ? " is-active" : "");

          const avatar = document.createElement("div");
          avatar.className = "shop-avatar";
          if (shop.logoPath) {
            const image = document.createElement("img");
            image.src = shop.logoPath;
            image.alt = "";
            avatar.append(image);
          } else {
            avatar.textContent = "No logo";
          }

          const content = document.createElement("div");
          const name = document.createElement("strong");
          name.textContent = shop.name;
          const neighborhood = document.createElement("span");
          neighborhood.textContent = shop.neighborhood || shop.address || "No neighborhood yet";
          const meta = document.createElement("code");
          meta.textContent = shop.id;

          content.append(name, neighborhood, meta);
          button.append(avatar, content);
          button.addEventListener("click", () => {
            state.selectedShopId = shop.id;
            fillForm(shop);
            renderShopList();
            toggleDeleteButton();
            setStatus("Editing " + shop.name + ".", "");
          });

          shopListElement.append(button);
        });
      }

      function toggleDeleteButton() {
        deleteButton.disabled = !state.selectedShopId;
      }

      function resetToBlankShop() {
        state.selectedShopId = null;
        fillForm(blankShop(getCity()));
        renderShopList();
        toggleDeleteButton();
      }

      async function loadData() {
        setStatus("Loading coffee data...", "");
        const response = await fetch("/api/cities", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Could not load coffee data.");
        }

        state.data = payload.data;
        if (!state.cityKey || !state.data[state.cityKey]) {
          state.cityKey = Object.keys(state.data)[0] || "";
        }

        fillCityOptions();
        renderShopList();
        resetToBlankShop();
        setStatus("Coffee data loaded.", "success");
      }

      function buildPayload() {
        return {
          cityKey: citySelect.value,
          previousShopId: state.selectedShopId,
          shop: {
            id: document.getElementById("id").value,
            name: document.getElementById("name").value,
            coordinates: [
              Number(document.getElementById("longitude").value),
              Number(document.getElementById("latitude").value),
            ],
            website: document.getElementById("website").value,
            neighborhood: document.getElementById("neighborhood").value,
            address: document.getElementById("address").value,
            addressUrl: document.getElementById("address-url").value,
            description: document.getElementById("description").value,
            recommendedStudySpot: document.getElementById("recommendedStudySpot").value,
            details: {
              hours: buildHoursSchedule(),
              wifi: document.getElementById("wifi").value,
              sockets: document.getElementById("sockets").value,
              seating: document.getElementById("seating").value,
            },
          },
        };
      }

      async function checkForAdminUpdates() {
        try {
          const response = await fetch("/api/admin-meta", { cache: "no-store" });
          if (!response.ok) return;

          const payload = await response.json();
          if (!payload?.ok || !payload.serverStartedAt) return;

          if (payload.serverStartedAt !== serverStartedAt) {
            window.location.reload();
            return;
          }

          serverStartedAt = payload.serverStartedAt;
        } catch (error) {
          // Ignore transient failures while the watch process is restarting.
        }
      }

      formElement.addEventListener("submit", async (event) => {
        event.preventDefault();

        const payload = buildPayload();
        const selectedFile = logoFileInput.files && logoFileInput.files[0];

        try {
          setStatus("Saving shop...", "");

          if (selectedFile) {
            payload.logoUpload = await fileToBase64(selectedFile);
          }

          const response = await fetch("/api/shops", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || "Could not save shop.");
          }

          state.data = result.data;
          state.cityKey = result.cityKey;
          state.selectedShopId = result.shop.id;
          fillCityOptions();
          fillForm(result.shop);
          renderShopList();
          toggleDeleteButton();
          setStatus("Saved " + result.shop.name + " to src/data/coffeeShops.json.", "success");
        } catch (error) {
          setStatus(error.message || "Could not save shop.", "error");
        }
      });

      deleteButton.addEventListener("click", async () => {
        const selectedShop = getSelectedShop();
        if (!selectedShop) return;

        const confirmed = window.confirm("Delete " + selectedShop.name + "? This rewrites the repo data file.");
        if (!confirmed) return;

        try {
          setStatus("Deleting shop...", "");
          const response = await fetch(
            "/api/shops?cityKey=" + encodeURIComponent(state.cityKey) + "&shopId=" + encodeURIComponent(selectedShop.id),
            { method: "DELETE" },
          );
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || "Could not delete shop.");
          }

          state.data = result.data;
          resetToBlankShop();
          renderShopList();
          setStatus("Deleted " + selectedShop.name + ".", "success");
        } catch (error) {
          setStatus(error.message || "Could not delete shop.", "error");
        }
      });

      citySelect.addEventListener("change", () => {
        state.cityKey = citySelect.value;
        resetToBlankShop();
        renderShopList();
        setStatus("Switched city.", "");
      });

      newShopButton.addEventListener("click", () => {
        resetToBlankShop();
        setStatus("Creating a new coffee shop entry.", "");
      });

      refreshButton.addEventListener("click", () => {
        loadData().catch((error) => {
          setStatus(error.message || "Could not reload data.", "error");
        });
      });

      resetButton.addEventListener("click", () => {
        const selectedShop = getSelectedShop();
        fillForm(selectedShop || blankShop(getCity()));
        setStatus(selectedShop ? "Reset unsaved edits." : "Cleared the new shop form.", "");
      });

      logoFileInput.addEventListener("change", updateLogoPreview);

      detailToggleButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.detailToggle;
          const input = key ? document.getElementById(key) : null;
          if (!input) return;

          input.value = input.value ? "" : ACTIVE_DETAIL_VALUE;
          syncDetailToggleButtons();
        });
      });

      nameInput.addEventListener("input", () => {
        if (!idInput.dataset.locked || !idInput.value) {
          idInput.value = slugify(nameInput.value);
          idInput.dataset.locked = "";
        }
      });

      idInput.addEventListener("input", () => {
        idInput.dataset.locked = idInput.value ? "true" : "";
      });

      loadData().catch((error) => {
        setStatus(error.message || "Could not load the local admin tool.", "error");
      });

      window.setInterval(checkForAdminUpdates, 1000);
    </script>
  </body>
</html>`;

const server = createServer(async (request, response) => {
  withCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  try {
    if (request.method === "GET" && requestUrl.pathname === "/") {
      sendText(response, 200, ADMIN_PAGE_HTML, "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/cities") {
      const data = await readDataFile();
      sendJson(response, 200, { ok: true, data });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/admin-meta") {
      sendJson(response, 200, {
        ok: true,
        serverStartedAt: SERVER_STARTED_AT,
        watchMode: IS_WATCH_MODE,
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/shops") {
      await handleSaveShop(request, response);
      return;
    }

    if (request.method === "DELETE" && requestUrl.pathname === "/api/shops") {
      await handleDeleteShop(request, response, requestUrl);
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname.startsWith("/images/")
    ) {
      await servePublicAsset(response, requestUrl.pathname);
      return;
    }

    sendText(response, 404, "Not found");
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local coffee admin running at http://${HOST}:${PORT}`);
});
