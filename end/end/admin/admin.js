function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function slugify(str) {
  return String(str || "").toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function uniqueSlug(base, taken) {
  let slug = slugify(base) || "item";
  let i = 2;
  while (taken.includes(slug)) {
    slug = `${slugify(base) || "item"}-${i++}`;
  }
  return slug;
}

function guessSingular(label) {
  const l = String(label || "").trim();
  if (/ies$/i.test(l)) return l.replace(/ies$/i, "y");
  if (/s$/i.test(l) && !/ss$/i.test(l)) return l.replace(/s$/i, "");
  return l;
}

let toastTimer = null;
function toast(msg, isError) {
  const el = document.getElementById("admin-toast");
  el.textContent = msg;
  el.classList.toggle("is-error", !!isError);
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
}

function setStatus(text, mode) {
  const el = document.getElementById("admin-status");
  el.textContent = text;
  el.className = "admin-status" + (mode ? ` is-${mode}` : "");
}

const IDB_NAME = "site-editor";
const IDB_STORE = "handles";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let ROOT_HANDLE = null;
let DATA_FILE_HANDLE = null;

const SUPPORTS_FS_ACCESS = "showDirectoryPicker" in window;

async function hasPermission(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

const DATA_JS_PREFIX = "window.__SITE_DATA__ = ";

function parseDataJs(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("data.js doesn't look like the expected format");
  return JSON.parse(text.slice(start, end + 1));
}

function serializeDataJs(data) {
  return DATA_JS_PREFIX + JSON.stringify(data, null, 2) + ";\n";
}

async function loadFromRoot(rootHandle) {
  const jsDir = await rootHandle.getDirectoryHandle("js");
  const dataDir = await jsDir.getDirectoryHandle("data");
  const fileHandle = await dataDir.getFileHandle("data.js");
  const file = await fileHandle.getFile();
  const text = await file.text();
  const data = parseDataJs(text);

  ROOT_HANDLE = rootHandle;
  DATA_FILE_HANDLE = fileHandle;
  DATA = data;
  await idbSet("rootHandle", rootHandle);
}

async function pickProjectFolder() {
  try {
    const handle = await window.showDirectoryPicker();
    await loadFromRoot(handle);
    setStatus("Connected to " + handle.name, "connected");
    VIEW = { screen: "settings" };
    render();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error(err);
    toast("Couldn't open that folder, make sure it's the website folder (the one with index.html in it).", true);
  }
}

async function tryReconnect() {
  const handle = await idbGet("rootHandle");
  if (!handle) return false;
  try {
    if (!(await hasPermission(handle))) return false;
    await loadFromRoot(handle);
    setStatus("Connected to " + handle.name, "connected");
    return true;
  } catch (err) {
    console.warn("Reconnect failed", err);
    return false;
  }
}

async function saveData() {
  if (!DATA_FILE_HANDLE) return;
  try {
    setStatus("Saving…");
    const writable = await DATA_FILE_HANDLE.createWritable();
    await writable.write(serializeDataJs(DATA));
    await writable.close();
    setStatus("Connected to " + ROOT_HANDLE.name, "connected");
    toast("Saved");
  } catch (err) {
    console.error(err);
    setStatus("Save failed", "error");
    toast("Couldn't save, try again, or check the folder is still available.", true);
  }
}

async function saveImageFile(file) {
  const assetsDir = await ROOT_HANDLE.getDirectoryHandle("assets", { create: true });
  const imagesDir = await assetsDir.getDirectoryHandle("images", { create: true });

  let name = file.name.replace(/[^\w.\-]/g, "-");
  let exists = true;
  try {
    await imagesDir.getFileHandle(name);
  } catch (e) {
    exists = false;
  }
  if (exists) {
    const dot = name.lastIndexOf(".");
    const base = dot > -1 ? name.slice(0, dot) : name;
    const ext = dot > -1 ? name.slice(dot) : "";
    name = `${base}-${Date.now()}${ext}`;
  }
  const fileHandle = await imagesDir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return `assets/images/${name}`;
}

let DATA = null;
let VIEW = { screen: "connect" }; // see renderMain() for screen shapes
let DRAFT = null; // working copy for whichever form is open

function collections() { return DATA.collections || (DATA.collections = []); }
function entriesFor(key) { return (DATA.entries ||= {})[key] || (DATA.entries[key] = []); }
function collectionByKey(key) { return collections().find((c) => c.key === key); }

function render() {
  document.getElementById("admin-brand-icon").innerHTML = window.ICONS.compass();
  const root = document.getElementById("admin-root");

  if (VIEW.screen === "connect") {
    root.innerHTML = renderConnectScreen();
    wireConnectScreen();
    return;
  }

  root.innerHTML = `
    <div class="admin-layout">
      ${renderNav()}
      <div class="admin-panel" id="admin-panel">${renderPanel()}</div>
    </div>
  `;
  wirePanel();
}

function renderConnectScreen() {
  if (!SUPPORTS_FS_ACCESS) {
    return `
      <div class="admin-connect">
        <h1>This browser can't save files directly</h1>
        <p>The site editor needs to write to files on your computer, which only works in
        <strong>Chrome</strong> or <strong>Edge</strong> right now. Open this page
        (<code>admin/index.html</code>) in one of those browsers to continue.</p>
      </div>
    `;
  }
  return `
    <div class="admin-connect">
      <span class="admin-brand-icon" style="width:34px;height:34px;margin:0 auto 18px;display:block;color:var(--violet-bright)">${window.ICONS.compass()}</span>
      <h1>Let's connect to your website</h1>
      <p>Click the button below, then choose the website's main folder, the one
      that has <code>index.html</code> inside it. Your browser will ask you to
      confirm access; that's normal.</p>
      <button class="admin-btn admin-btn-primary" id="btn-connect">Open project folder</button>
      <p class="admin-note">Everything you do here saves straight to your files.
      When you're ready to publish, run your usual push script like normal.</p>
    </div>
  `;
}

function wireConnectScreen() {
  const btn = document.getElementById("btn-connect");
  if (btn) btn.addEventListener("click", pickProjectFolder);
}

function renderNav() {
  const items = [
    { id: "settings", label: "Site settings" },
    { id: "collections", label: "Collections" },
  ];
  const collectionItems = collections().map((c) => ({
    id: `entries:${c.key}`,
    label: c.label,
    count: entriesFor(c.key).length,
  }));

  const isActive = (id) => {
    if (VIEW.screen === "collection-form") return id === "collections";
    if (VIEW.screen === "entries" || VIEW.screen === "entry-form") return id === `entries:${VIEW.collectionKey}`;
    return VIEW.screen === id;
  };

  const navBtn = (id, label, count) => `
    <button class="admin-nav-item${isActive(id) ? " is-active" : ""}" data-nav="${escapeHtml(id)}">
      ${escapeHtml(label)}${count !== undefined ? `<span class="admin-nav-count">${count}</span>` : ""}
    </button>
  `;

  return `
    <nav class="admin-nav">
      ${items.map((i) => navBtn(i.id, i.label)).join("")}
      <div style="height:10px"></div>
      ${collectionItems.length
        ? collectionItems.map((i) => navBtn(i.id, i.label, i.count)).join("")
        : `<span style="padding:9px 12px;font-size:0.82rem;color:var(--ink-faint)">No collections yet</span>`}
    </nav>
  `;
}

function renderPanel() {
  switch (VIEW.screen) {
    case "settings": return renderSettingsPanel();
    case "collections": return renderCollectionsPanel();
    case "collection-form": return renderCollectionForm();
    case "entries": return renderEntriesPanel(VIEW.collectionKey);
    case "entry-form": return renderEntryForm();
    default: return "";
  }
}

function wirePanel() {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.nav;
      if (id === "settings") VIEW = { screen: "settings" };
      else if (id === "collections") VIEW = { screen: "collections" };
      else if (id.startsWith("entries:")) VIEW = { screen: "entries", collectionKey: id.slice(8) };
      render();
    });
  });

  switch (VIEW.screen) {
    case "settings": return wireSettingsPanel();
    case "collections": return wireCollectionsPanel();
    case "collection-form": return wireCollectionForm();
    case "entries": return wireEntriesPanel();
    case "entry-form": return wireEntryForm();
  }
}

function renderSettingsPanel() {
  return `
    <div class="admin-panel-head">
      <div>
        <h1>Site settings</h1>
        <p>Shown at the top of the home page.</p>
      </div>
    </div>
    <div class="admin-field">
      <label for="f-site-name">Site name</label>
      <input type="text" id="f-site-name">
    </div>
    <div class="admin-field">
      <label for="f-site-tagline">Tagline</label>
      <input type="text" id="f-site-tagline">
    </div>
    <div class="admin-field">
      <label for="f-site-intro">Intro paragraph
        <span class="admin-hint">Optional. Leave blank to hide it.</span>
      </label>
      <textarea id="f-site-intro" rows="3"></textarea>
    </div>
  `;
}

function wireSettingsPanel() {
  const nameEl = document.getElementById("f-site-name");
  const taglineEl = document.getElementById("f-site-tagline");
  const introEl = document.getElementById("f-site-intro");
  nameEl.value = DATA.siteName || "";
  taglineEl.value = DATA.tagline || "";
  introEl.value = DATA.intro || "";

  let debounce;
  const saveSoon = () => {
    clearTimeout(debounce);
    debounce = setTimeout(saveData, 500);
  };
  nameEl.addEventListener("input", () => { DATA.siteName = nameEl.value; saveSoon(); });
  taglineEl.addEventListener("input", () => { DATA.tagline = taglineEl.value; saveSoon(); });
  introEl.addEventListener("input", () => { DATA.intro = introEl.value; saveSoon(); });
}

function renderCollectionsPanel() {
  const list = collections();
  return `
    <div class="admin-panel-head">
      <div>
        <h1>Collections</h1>
        <p>The categories on your home page, e.g. Characters, Places, Languages.</p>
      </div>
      <button class="admin-btn admin-btn-primary" data-action="new-collection">+ New collection</button>
    </div>
    <div class="admin-list">
      ${list.length ? list.map((c) => `
        <div class="admin-row">
          <span class="admin-row-icon">${window.ICONS[c.icon] ? window.ICONS[c.icon]() : window.ICONS.compass()}</span>
          <div class="admin-row-main">
            <div class="admin-row-title">${escapeHtml(c.label)}</div>
            <div class="admin-row-sub">${entriesFor(c.key).length} ${entriesFor(c.key).length === 1 ? c.singular : c.singular + "s"} · key: ${escapeHtml(c.key)}</div>
          </div>
          <div class="admin-row-actions">
            <button class="admin-btn admin-btn-small" data-action="view-entries" data-key="${escapeHtml(c.key)}">View entries</button>
            <button class="admin-btn admin-btn-small" data-action="edit-collection" data-key="${escapeHtml(c.key)}">Edit</button>
            <button class="admin-btn admin-btn-small admin-btn-danger" data-action="delete-collection" data-key="${escapeHtml(c.key)}">Delete</button>
          </div>
        </div>
      `).join("") : `<div class="admin-empty">No collections yet. Click "New collection" to add your first category.</div>`}
    </div>
  `;
}

function wireCollectionsPanel() {
  const panel = document.getElementById("admin-panel");
  panel.querySelector('[data-action="new-collection"]')?.addEventListener("click", () => {
    DRAFT = { key: "", label: "", singular: "", description: "", icon: "compass" };
    VIEW = { screen: "collection-form", mode: "new" };
    render();
  });
  panel.querySelectorAll('[data-action="view-entries"]').forEach((el) => {
    el.addEventListener("click", () => { VIEW = { screen: "entries", collectionKey: el.dataset.key }; render(); });
  });
  panel.querySelectorAll('[data-action="edit-collection"]').forEach((el) => {
    el.addEventListener("click", () => {
      const c = collectionByKey(el.dataset.key);
      DRAFT = { ...c };
      VIEW = { screen: "collection-form", mode: "edit", originalKey: c.key };
      render();
    });
  });
  panel.querySelectorAll('[data-action="delete-collection"]').forEach((el) => {
    el.addEventListener("click", async () => {
      const key = el.dataset.key;
      const c = collectionByKey(key);
      const count = entriesFor(key).length;
      const msg = count > 0
        ? `Delete "${c.label}" and all ${count} ${count === 1 ? "entry" : "entries"} in it? This can't be undone here.`
        : `Delete "${c.label}"?`;
      if (!confirm(msg)) return;
      DATA.collections = collections().filter((x) => x.key !== key);
      delete DATA.entries[key];
      await saveData();
      render();
    });
  });
}

function renderCollectionForm() {
  const iconKeys = Object.keys(window.ICONS);
  return `
    <div class="admin-panel-head">
      <div><h1>${VIEW.mode === "new" ? "New collection" : "Edit collection"}</h1></div>
    </div>
    <div class="admin-field-row">
      <div class="admin-field">
        <label for="f-c-label">Label
          <span class="admin-hint">Plural, e.g. "Characters"</span>
        </label>
        <input type="text" id="f-c-label">
      </div>
      <div class="admin-field">
        <label for="f-c-singular">Singular name
          <span class="admin-hint">e.g. "Character"</span>
        </label>
        <input type="text" id="f-c-singular">
      </div>
    </div>
    <div class="admin-field">
      <label>Web address bit <span class="admin-key-preview" id="f-c-key-preview"></span></label>
    </div>
    <div class="admin-field">
      <label for="f-c-desc">Description
        <span class="admin-hint">One line, shown on the home page card.</span>
      </label>
      <input type="text" id="f-c-desc">
    </div>
    <div class="admin-field">
      <label>Icon</label>
      <div class="admin-icon-picker" id="f-c-icons">
        ${iconKeys.map((k) => `
          <button type="button" class="admin-icon-option${DRAFT.icon === k ? " is-selected" : ""}" data-icon="${k}" title="${k}">${window.ICONS[k]()}</button>
        `).join("")}
      </div>
    </div>
    <div class="admin-form-actions">
      <button class="admin-btn admin-btn-primary" data-action="save-collection">Save collection</button>
      <button class="admin-btn admin-btn-ghost" data-action="cancel">Cancel</button>
    </div>
  `;
}

function wireCollectionForm() {
  const labelEl = document.getElementById("f-c-label");
  const singularEl = document.getElementById("f-c-singular");
  const descEl = document.getElementById("f-c-desc");
  const keyPreview = document.getElementById("f-c-key-preview");

  labelEl.value = DRAFT.label || "";
  singularEl.value = DRAFT.singular || "";
  descEl.value = DRAFT.description || "";

  const updateKeyPreview = () => {
    const existing = collections().map((c) => c.key).filter((k) => k !== VIEW.originalKey);
    const key = VIEW.mode === "edit" ? DRAFT.key : uniqueSlug(labelEl.value, existing);
    DRAFT.key = key;
    keyPreview.textContent = key ? `collection.html?c=${key}` : "";
  };
  updateKeyPreview();

  labelEl.addEventListener("input", () => {
    DRAFT.label = labelEl.value;
    if (!singularEl.dataset.touched) {
      singularEl.value = guessSingular(labelEl.value);
      DRAFT.singular = singularEl.value;
    }
    if (VIEW.mode === "new") updateKeyPreview();
  });
  singularEl.addEventListener("input", () => { singularEl.dataset.touched = "1"; DRAFT.singular = singularEl.value; });
  descEl.addEventListener("input", () => { DRAFT.description = descEl.value; });

  document.getElementById("f-c-icons").querySelectorAll("[data-icon]").forEach((btn) => {
    btn.addEventListener("click", () => {
      DRAFT.icon = btn.dataset.icon;
      document.querySelectorAll("#f-c-icons .admin-icon-option").forEach((b) => b.classList.toggle("is-selected", b.dataset.icon === DRAFT.icon));
    });
  });

  const panel = document.getElementById("admin-panel");
  panel.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    VIEW = { screen: "collections" }; render();
  });
  panel.querySelector('[data-action="save-collection"]').addEventListener("click", async () => {
    if (!labelEl.value.trim()) { toast("Give it a label first.", true); return; }
    if (!DRAFT.key) { toast("Something went wrong with the web address bit, try retyping the label.", true); return; }

    if (VIEW.mode === "new") {
      collections().push({ key: DRAFT.key, label: DRAFT.label, singular: DRAFT.singular || DRAFT.label, description: DRAFT.description || "", icon: DRAFT.icon });
      entriesFor(DRAFT.key); // ensures an empty array exists
    } else {
      const c = collectionByKey(VIEW.originalKey);
      c.label = DRAFT.label;
      c.singular = DRAFT.singular || DRAFT.label;
      c.description = DRAFT.description || "";
      c.icon = DRAFT.icon;
      if (DRAFT.key !== VIEW.originalKey) {
        c.key = DRAFT.key;
        DATA.entries[DRAFT.key] = DATA.entries[VIEW.originalKey] || [];
        delete DATA.entries[VIEW.originalKey];
      }
    }
    await saveData();
    VIEW = { screen: "collections" };
    render();
  });
}

function renderEntriesPanel(key) {
  const meta = collectionByKey(key);
  if (!meta) { VIEW = { screen: "collections" }; return renderCollectionsPanel(); }
  const list = entriesFor(key);

  return `
    <div class="admin-panel-head">
      <div>
        <h1>${escapeHtml(meta.label)}</h1>
        <p>${list.length} ${list.length === 1 ? meta.singular : meta.singular + "s"}</p>
      </div>
      <button class="admin-btn admin-btn-primary" data-action="new-entry">+ New ${escapeHtml(meta.singular.toLowerCase())}</button>
    </div>
    <div class="admin-list">
      ${list.length ? list.map((e) => `
        <div class="admin-row">
          <div class="admin-row-cover" style="${e.coverImage ? `background-image:url('../${escapeHtml(e.coverImage)}')` : ""}"></div>
          <div class="admin-row-main">
            <div class="admin-row-title">${escapeHtml(e.title)}</div>
            <div class="admin-row-sub">${escapeHtml(e.summary || "No summary yet")}</div>
          </div>
          <div class="admin-row-actions">
            <button class="admin-btn admin-btn-small" data-action="edit-entry" data-id="${escapeHtml(e.id)}">Edit</button>
            <button class="admin-btn admin-btn-small admin-btn-danger" data-action="delete-entry" data-id="${escapeHtml(e.id)}">Delete</button>
          </div>
        </div>
      `).join("") : `<div class="admin-empty">No entries yet. Click "New ${escapeHtml(meta.singular.toLowerCase())}" to add one.</div>`}
    </div>
  `;
}

function wireEntriesPanel() {
  const key = VIEW.collectionKey;
  const panel = document.getElementById("admin-panel");
  panel.querySelector('[data-action="new-entry"]')?.addEventListener("click", () => {
    DRAFT = { id: "", title: "", subtitle: "", summary: "", tags: [], coverImage: "", sections: [{ heading: "Overview", markdown: "" }] };
    VIEW = { screen: "entry-form", collectionKey: key, mode: "new" };
    render();
  });
  panel.querySelectorAll('[data-action="edit-entry"]').forEach((el) => {
    el.addEventListener("click", () => {
      const e = entriesFor(key).find((x) => x.id === el.dataset.id);
      DRAFT = JSON.parse(JSON.stringify(e));
      DRAFT.tags = DRAFT.tags || [];
      DRAFT.sections = DRAFT.sections && DRAFT.sections.length ? DRAFT.sections : [{ heading: "Overview", markdown: "" }];
      VIEW = { screen: "entry-form", collectionKey: key, mode: "edit", originalId: e.id };
      render();
    });
  });
  panel.querySelectorAll('[data-action="delete-entry"]').forEach((el) => {
    el.addEventListener("click", async () => {
      const e = entriesFor(key).find((x) => x.id === el.dataset.id);
      if (!confirm(`Delete "${e.title}"? This can't be undone here.`)) return;
      DATA.entries[key] = entriesFor(key).filter((x) => x.id !== el.dataset.id);
      await saveData();
      render();
    });
  });
}

function renderEntryForm() {
  const meta = collectionByKey(VIEW.collectionKey);
  return `
    <div class="admin-panel-head">
      <div><h1>${VIEW.mode === "new" ? `New ${escapeHtml(meta.singular)}` : `Edit ${escapeHtml(meta.singular)}`}</h1></div>
    </div>

    <div class="admin-field">
      <label for="f-e-title">Title</label>
      <input type="text" id="f-e-title">
    </div>
    <div class="admin-field">
      <label>Page address <span class="admin-key-preview" id="f-e-id-preview"></span></label>
    </div>
    <div class="admin-field-row">
      <div class="admin-field">
        <label for="f-e-subtitle">Subtitle
          <span class="admin-hint">Optional, defaults to "${escapeHtml(meta.singular)}"</span>
        </label>
        <input type="text" id="f-e-subtitle">
      </div>
    </div>
    <div class="admin-field">
      <label for="f-e-summary">Summary
        <span class="admin-hint">One or two sentences, shown on the card and at the top of the page.</span>
      </label>
      <textarea id="f-e-summary" rows="2"></textarea>
    </div>

    <div class="admin-field">
      <label>Cover image <span class="admin-hint">Optional</span></label>
      <div class="admin-image-field">
        <div class="admin-image-preview" id="f-e-cover-preview" style="${DRAFT.coverImage ? `background-image:url('../${escapeHtml(DRAFT.coverImage)}')` : ""}"></div>
        <div class="admin-image-controls">
          <input type="file" id="f-e-cover-file" accept="image/*">
          <span class="admin-image-path" id="f-e-cover-path">${DRAFT.coverImage ? escapeHtml(DRAFT.coverImage) : "No image set"}</span>
          ${DRAFT.coverImage ? `<button type="button" class="admin-btn admin-btn-small admin-btn-ghost" data-action="remove-cover" style="align-self:flex-start">Remove image</button>` : ""}
        </div>
      </div>
    </div>

    <div class="admin-field">
      <label for="f-e-tags">Tags
        <span class="admin-hint">Type one and press Enter</span>
      </label>
      <input type="text" id="f-e-tags" placeholder="Add a tag and press Enter">
      <div class="admin-tag-list" id="f-e-tag-list"></div>
    </div>

    <div class="admin-field">
      <label>Page content</label>
      <div id="f-e-sections"></div>
      <button type="button" class="admin-btn admin-add-section-btn" data-action="add-section">+ Add section</button>
    </div>

    <div class="admin-form-actions">
      <button class="admin-btn admin-btn-primary" data-action="save-entry">Save ${escapeHtml(meta.singular.toLowerCase())}</button>
      <button class="admin-btn admin-btn-ghost" data-action="cancel">Cancel</button>
      <div class="admin-spacer"></div>
      ${VIEW.mode === "edit" ? `<button class="admin-btn admin-btn-danger" data-action="delete-entry-inline">Delete</button>` : ""}
    </div>
  `;
}

function renderTagList() {
  const el = document.getElementById("f-e-tag-list");
  el.innerHTML = (DRAFT.tags || []).map((t, i) => `
    <span class="admin-tag-chip">${escapeHtml(t)}<button type="button" data-remove-tag="${i}" aria-label="Remove tag">×</button></span>
  `).join("");
  el.querySelectorAll("[data-remove-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      DRAFT.tags.splice(Number(btn.dataset.removeTag), 1);
      renderTagList();
    });
  });
}

function renderSectionsEditor() {
  const el = document.getElementById("f-e-sections");
  el.innerHTML = DRAFT.sections.map((s, i) => `
    <div class="admin-section-block" data-section="${i}">
      <div class="admin-section-block-head">
        <div class="admin-field">
          <label>Heading</label>
          <input type="text" class="section-heading-input" data-i="${i}" value="${escapeHtml(s.heading)}">
        </div>
        <div class="admin-row-actions" style="align-self:flex-end;margin-bottom:2px">
          <button type="button" class="admin-btn admin-btn-small admin-btn-ghost" data-move-up="${i}" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
          <button type="button" class="admin-btn admin-btn-small admin-btn-ghost" data-move-down="${i}" ${i === DRAFT.sections.length - 1 ? "disabled" : ""} title="Move down">↓</button>
          <button type="button" class="admin-btn admin-btn-small admin-btn-danger" data-remove-section="${i}" ${DRAFT.sections.length === 1 ? "disabled" : ""} title="Remove section">Remove</button>
        </div>
      </div>
      <div class="admin-md-tabs">
        <button type="button" class="admin-md-tab is-active" data-tab="write" data-i="${i}">Write</button>
        <button type="button" class="admin-md-tab" data-tab="preview" data-i="${i}">Preview</button>
      </div>
      <textarea class="section-md-input" data-i="${i}" rows="7" data-view="write">${escapeHtml(s.markdown)}</textarea>
      <div class="admin-md-preview" data-i="${i}" data-view="preview" style="display:none"></div>
    </div>
  `).join("");

  el.querySelectorAll(".section-heading-input").forEach((input) => {
    input.addEventListener("input", () => { DRAFT.sections[Number(input.dataset.i)].heading = input.value; });
  });
  el.querySelectorAll(".section-md-input").forEach((ta) => {
    ta.addEventListener("input", () => { DRAFT.sections[Number(ta.dataset.i)].markdown = ta.value; });
  });
  el.querySelectorAll("[data-move-up]").forEach((btn) => {
    btn.addEventListener("click", () => { swapSections(Number(btn.dataset.moveUp), -1); });
  });
  el.querySelectorAll("[data-move-down]").forEach((btn) => {
    btn.addEventListener("click", () => { swapSections(Number(btn.dataset.moveDown), 1); });
  });
  el.querySelectorAll("[data-remove-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      DRAFT.sections.splice(Number(btn.dataset.removeSection), 1);
      renderSectionsEditor();
    });
  });
  el.querySelectorAll(".admin-md-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const i = tab.dataset.i;
      const block = el.querySelector(`.admin-section-block[data-section="${i}"]`);
      block.querySelectorAll(".admin-md-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      const write = block.querySelector('[data-view="write"]');
      const preview = block.querySelector('[data-view="preview"]');
      if (tab.dataset.tab === "preview") {
        preview.innerHTML = window.marked ? window.marked.parse(DRAFT.sections[i].markdown || "", { gfm: true }) : escapeHtml(DRAFT.sections[i].markdown || "");
        write.style.display = "none"; preview.style.display = "block";
      } else {
        write.style.display = "block"; preview.style.display = "none";
      }
    });
  });
}

function swapSections(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= DRAFT.sections.length) return;
  [DRAFT.sections[i], DRAFT.sections[j]] = [DRAFT.sections[j], DRAFT.sections[i]];
  renderSectionsEditor();
}

function wireEntryForm() {
  const key = VIEW.collectionKey;
  const titleEl = document.getElementById("f-e-title");
  const subtitleEl = document.getElementById("f-e-subtitle");
  const summaryEl = document.getElementById("f-e-summary");
  const idPreview = document.getElementById("f-e-id-preview");
  const tagsInput = document.getElementById("f-e-tags");

  titleEl.value = DRAFT.title || "";
  subtitleEl.value = DRAFT.subtitle || "";
  summaryEl.value = DRAFT.summary || "";

  const updateIdPreview = () => {
    const existing = entriesFor(key).map((e) => e.id).filter((id) => id !== VIEW.originalId);
    if (VIEW.mode === "new") DRAFT.id = uniqueSlug(titleEl.value, existing);
    idPreview.textContent = DRAFT.id ? `entry.html?c=${key}&id=${DRAFT.id}` : "";
  };
  updateIdPreview();

  titleEl.addEventListener("input", () => { DRAFT.title = titleEl.value; updateIdPreview(); });
  subtitleEl.addEventListener("input", () => { DRAFT.subtitle = subtitleEl.value; });
  summaryEl.addEventListener("input", () => { DRAFT.summary = summaryEl.value; });

  tagsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = tagsInput.value.trim();
      if (v) { DRAFT.tags = DRAFT.tags || []; DRAFT.tags.push(v); tagsInput.value = ""; renderTagList(); }
    }
  });
  renderTagList();
  renderSectionsEditor();

  const fileInput = document.getElementById("f-e-cover-file");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const path = await saveImageFile(file);
      DRAFT.coverImage = path;
      document.getElementById("f-e-cover-preview").style.backgroundImage = `url('../${path}')`;
      document.getElementById("f-e-cover-path").textContent = path;
      toast("Image added");
      render(); // refresh so the "Remove image" button appears
    } catch (err) {
      console.error(err);
      toast("Couldn't save that image.", true);
    }
  });

  const panel = document.getElementById("admin-panel");
  panel.querySelector('[data-action="remove-cover"]')?.addEventListener("click", () => {
    DRAFT.coverImage = "";
    render();
  });
  panel.querySelector('[data-action="add-section"]').addEventListener("click", () => {
    DRAFT.sections.push({ heading: "New section", markdown: "" });
    renderSectionsEditor();
  });
  panel.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    VIEW = { screen: "entries", collectionKey: key }; render();
  });
  panel.querySelector('[data-action="delete-entry-inline"]')?.addEventListener("click", async () => {
    if (!confirm(`Delete "${DRAFT.title}"? This can't be undone here.`)) return;
    DATA.entries[key] = entriesFor(key).filter((x) => x.id !== VIEW.originalId);
    await saveData();
    VIEW = { screen: "entries", collectionKey: key };
    render();
  });
  panel.querySelector('[data-action="save-entry"]').addEventListener("click", async () => {
    if (!titleEl.value.trim()) { toast("Give it a title first.", true); return; }
    const clean = {
      id: DRAFT.id,
      title: DRAFT.title.trim(),
      subtitle: (DRAFT.subtitle || "").trim(),
      summary: (DRAFT.summary || "").trim(),
      tags: DRAFT.tags || [],
      sections: DRAFT.sections.filter((s) => s.heading.trim() || s.markdown.trim()),
    };
    if (DRAFT.coverImage) clean.coverImage = DRAFT.coverImage;

    const list = entriesFor(key);
    if (VIEW.mode === "new") {
      list.push(clean);
    } else {
      const idx = list.findIndex((e) => e.id === VIEW.originalId);
      list[idx] = clean;
    }
    await saveData();
    VIEW = { screen: "entries", collectionKey: key };
    render();
  });
}

(async function init() {
  if (!SUPPORTS_FS_ACCESS) { render(); return; }
  const reconnected = await tryReconnect();
  if (reconnected) {
    VIEW = { screen: "settings" };
    render();
  } else {
    render();
  }
})();
