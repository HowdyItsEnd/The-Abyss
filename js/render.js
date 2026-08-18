function qs(param) {
  return new URLSearchParams(window.location.search).get(param);
}

function loadWorldData() {
  const data = window.__SITE_DATA__ || {};

  window.WORLD_CONFIG = {
    siteName: data.siteName || "",
    tagline: data.tagline || "",
    intro: data.intro || "",
    collections: data.collections || []
  };

  window.WORLD_DATA = {};
  window.WORLD_CONFIG.collections.forEach(c => {
    window.WORLD_DATA[c.key] = (data.entries && data.entries[c.key]) || [];
  });

  return data;
}

function getCollectionMeta(key) {
  return (window.WORLD_CONFIG.collections || []).find(c => c.key === key);
}

function getEntries(key) {
  const data = window.WORLD_DATA || {};
  return data[key] || [];
}

function getEntry(key, id) {
  return getEntries(key).find(e => e.id === id);
}

function slugify(str) {
  return String(str).toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function renderMarkdown(md) {
  if (!md) return "";
  if (window.marked) {
    return window.marked.parse(md, { gfm: true, breaks: false });
  }
  const escaped = md.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<pre class="md-fallback">${escaped}</pre>`;
}

function renderHeader(activeKey) {
  const collections = window.WORLD_CONFIG.collections || [];
  const links = collections.map(c => `
    <a href="collection.html?c=${c.key}" class="nav-link${c.key === activeKey ? " is-active" : ""}">${c.label}</a>
  `).join("");

  return `
    <header class="site-header">
      <a class="brand" href="index.html">
        <span class="brand-mark" aria-hidden="true">${window.ICONS.compass()}</span>
        <span class="brand-name">${window.WORLD_CONFIG.siteName}</span>
      </a>
      <nav class="site-nav" aria-label="Categories">
        ${links}
      </nav>
      <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </header>
  `;
}

function mountHeader(activeKey) {
  document.getElementById("site-header").innerHTML = renderHeader(activeKey);
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
}

function mountFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  el.innerHTML = `
    <footer class="site-footer">
      <p>${window.WORLD_CONFIG.siteName}</p>
    </footer>
  `;
  initFooterEasterEgg(el.querySelector(".site-footer"));
}

function initFooterEasterEgg(footer) {
  if (!footer) return;

  const SPARKLE_SVG = `<svg viewBox="0 0 24 24"><path d="M12 0l2.2 8.1L22 12l-7.8 3.9L12 24l-2.2-8.1L2 12l7.8-3.9L12 0z"/></svg>`;

  footer.addEventListener("click", (e) => {
    const rect = footer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ripple = document.createElement("span");
    ripple.className = "footer-ripple";
    const size = Math.max(rect.width, rect.height) * 0.9;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    footer.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());

    const count = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const sparkle = document.createElement("span");
      sparkle.className = "footer-sparkle";
      sparkle.innerHTML = SPARKLE_SVG;

      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const distance = 22 + Math.random() * 34;
      const sx = Math.cos(angle) * distance;
      const sy = Math.sin(angle) * distance - 8; // slight upward drift
      const scale = 0.6 + Math.random() * 0.9;
      const rot = Math.random() * 180 - 90;
      const delay = Math.random() * 80;

      sparkle.style.left = `${x}px`;
      sparkle.style.top = `${y}px`;
      sparkle.style.setProperty("--sx", `${sx}px`);
      sparkle.style.setProperty("--sy", `${sy}px`);
      sparkle.style.setProperty("--sscale", scale.toFixed(2));
      sparkle.style.setProperty("--srot", `${rot}deg`);
      sparkle.style.animationDelay = `${delay}ms`;

      footer.appendChild(sparkle);
      sparkle.addEventListener("animationend", () => sparkle.remove());
    }
  });
}

function renderCollectionsGrid() {
  const collections = window.WORLD_CONFIG.collections || [];
  return collections.map(c => {
    const count = getEntries(c.key).length;
    const countLabel = count === 0 ? "No entries yet" : `${count} ${count === 1 ? c.singular : c.singular + "s"}`;
    return `
      <a class="atlas-card" href="collection.html?c=${c.key}">
        <span class="atlas-card-icon" aria-hidden="true">${window.ICONS[c.icon] ? window.ICONS[c.icon]() : window.ICONS.compass()}</span>
        <span class="atlas-card-label">${c.label}</span>
        <span class="atlas-card-desc">${c.description}</span>
        <span class="atlas-card-count">${countLabel}</span>
      </a>
    `;
  }).join("");
}

function renderEntryCard(collectionKey, entry) {
  const tags = (entry.tags || []).slice(0, 4).map(t => `<span class="chip">${t}</span>`).join("");
  const summary = entry.summary ? `<p class="entry-card-summary">${entry.summary}</p>` : "";
  const cover = entry.coverImage
    ? `<div class="entry-card-cover" style="background-image:url('${entry.coverImage}')"></div>`
    : `<div class="entry-card-cover entry-card-cover--empty"><span>${window.ICONS.leaf()}</span></div>`;

  return `
    <a class="entry-card" href="entry.html?c=${collectionKey}&id=${entry.id}">
      ${cover}
      <div class="entry-card-body">
        <span class="specimen-tag">${entry.subtitle || getCollectionMeta(collectionKey).singular}</span>
        <h3 class="entry-card-title">${entry.title}</h3>
        ${summary}
        <div class="chip-row">${tags}</div>
      </div>
    </a>
  `;
}

function renderCollectionPage() {
  const key = qs("c");
  const meta = getCollectionMeta(key);
  const listEl = document.getElementById("collection-list");
  const titleEl = document.getElementById("collection-title");
  const descEl = document.getElementById("collection-desc");
  const eyebrowEl = document.getElementById("collection-eyebrow");

  if (!meta) {
    if (eyebrowEl) eyebrowEl.style.display = "none";
    titleEl.textContent = "Unknown category";
    descEl.textContent = `No category with key "${key}" exists. Check admin/index.html.`;
    listEl.innerHTML = "";
    return;
  }

  document.title = `${meta.label}: ${window.WORLD_CONFIG.siteName}`;
  if (eyebrowEl) eyebrowEl.textContent = meta.singular + "s";
  titleEl.textContent = meta.label;
  descEl.textContent = meta.description;

  const entries = getEntries(key);

  if (entries.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">${window.ICONS[meta.icon] ? window.ICONS[meta.icon]() : window.ICONS.compass()}</span>
        <h3>Nothing here yet</h3>
        <p>Open <code>admin/index.html</code> and add an entry to "${meta.label}" — it'll show up here right away.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = entries.map(e => renderEntryCard(key, e)).join("");
}

function renderTOC(sections) {
  if (!sections || sections.length < 2) return "";
  const items = sections.map(s => `<li><a href="#${slugify(s.heading)}">${s.heading}</a></li>`).join("");
  return `
    <nav class="entry-toc" aria-label="Sections">
      <span class="entry-toc-label">On this page</span>
      <ol>${items}</ol>
    </nav>
  `;
}

function renderSections(sections) {
  if (!sections || sections.length === 0) {
    return `<p class="muted">No content written for this entry yet.</p>`;
  }
  return sections.map(s => `
    <section class="entry-section" id="${slugify(s.heading)}">
      <h2>${s.heading}</h2>
      <div class="md">${renderMarkdown(s.markdown)}</div>
    </section>
  `).join("");
}

function renderEntryPage() {
  const key = qs("c");
  const id = qs("id");
  const meta = getCollectionMeta(key);
  const entry = getEntry(key, id);

  const crumbEl = document.getElementById("entry-crumb");
  const headEl = document.getElementById("entry-head");
  const bodyEl = document.getElementById("entry-body");
  const tocEl = document.getElementById("entry-toc-slot");

  if (!meta || !entry) {
    crumbEl.innerHTML = `<a href="index.html">Atlas</a>`;
    headEl.innerHTML = `<h1>Entry not found</h1>`;
    bodyEl.innerHTML = `<p class="muted">No entry with id "${id}" in collection "${key}". Check js/data/${key || ""}/.</p>`;
    return;
  }

  document.title = `${entry.title}: ${window.WORLD_CONFIG.siteName}`;

  crumbEl.innerHTML = `
    <a href="index.html">Atlas</a>
    <span class="crumb-sep">/</span>
    <a href="collection.html?c=${key}">${meta.label}</a>
  `;

  const tags = (entry.tags || []).map(t => `<span class="chip">${t}</span>`).join("");

  headEl.innerHTML = `
    <span class="specimen-tag">${entry.subtitle || meta.singular}</span>
    <h1>${entry.title}</h1>
    ${entry.summary ? `<p class="entry-lede">${entry.summary}</p>` : ""}
    <div class="chip-row">${tags}</div>
  `;

  tocEl.innerHTML = renderTOC(entry.sections);
  bodyEl.innerHTML = renderSections(entry.sections);
}
