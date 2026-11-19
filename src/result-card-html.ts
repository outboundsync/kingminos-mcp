/**
 * The result card view: one self-contained HTML document (inline CSS and JS,
 * no external scripts, styles, fonts or fetches, no storage, no analytics).
 * The only remote content it may show is a company icon hosted on
 * logos.kingminos.com, declared in the resource CSP.
 *
 * It reads the tool result from either host bridge:
 * - MCP Apps (Claude, ChatGPT and other hosts): JSON-RPC over postMessage —
 *   `ui/initialize`, `ui/notifications/initialized`, then
 *   `ui/notifications/tool-result` (a CallToolResult; the card reads its
 *   structuredContent); theme from `hostContext.theme`.
 * - ChatGPT's older `window.openai` globals (`toolOutput`, `theme`,
 *   `openai:set_globals`) as a fallback.
 *
 * Keep the inline script free of backticks and dollar-brace sequences: this
 * file is a TypeScript template literal.
 */
export const RESULT_CARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KingMinos result</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #111418;
  --muted: #5f6b7a;
  --line: #e3e7ec;
  --chip: #f1f3f6;
  --hit: #157347;
  --hit-bg: #e7f5ee;
  --warn: #8a5a00;
  --warn-bg: #fdf3e1;
  --link: #1f5fbf;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1d1f23;
    --fg: #eef0f3;
    --muted: #9aa4b2;
    --line: #33373e;
    --chip: #2a2d33;
    --hit: #6fd39c;
    --hit-bg: #1d3328;
    --warn: #f0c26b;
    --warn-bg: #3a2f1a;
    --link: #8ab4ff;
  }
}
:root[data-theme="dark"] {
  --bg: #1d1f23;
  --fg: #eef0f3;
  --muted: #9aa4b2;
  --line: #33373e;
  --chip: #2a2d33;
  --hit: #6fd39c;
  --hit-bg: #1d3328;
  --warn: #f0c26b;
  --warn-bg: #3a2f1a;
  --link: #8ab4ff;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
body {
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.card { padding: 14px 16px; }
.head { display: flex; align-items: center; gap: 12px; }
.icon { width: 40px; height: 40px; border-radius: 8px; flex: none; background: var(--chip); }
.titles { min-width: 0; flex: 1; }
.kind { color: var(--muted); font-size: 12px; }
.title { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--chip); color: var(--muted); }
.badge.hit { background: var(--hit-bg); color: var(--hit); }
.badge.warn { background: var(--warn-bg); color: var(--warn); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 12px 0 0; }
dt { color: var(--muted); }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
dd.long { grid-column: 1 / -1; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.quiet { color: var(--muted); margin-top: 10px; }
.empty { color: var(--muted); }
</style>
</head>
<body>
<div class="card" id="card"><div class="empty">Waiting for the result…</div></div>
<script>
(function () {
  "use strict";
  var KINDS = {
    "company.resolve": "Company",
    "company.domain": "Company domain",
    "company.hierarchy": "Company hierarchy",
    "company.b2b_social": "Company LinkedIn",
    "company.x_account": "Company X account",
    "company.icon": "Company icon",
    "company.description": "Company description",
    "person.verify_employment": "Employment check",
    "person.language": "Language",
    "person.phone": "Phone",
    "person.title": "Job title",
    "person.b2b_social": "LinkedIn profile",
    "person.name": "Name",
    "person.email": "Work email",
    "email.verify": "Email check"
  };
  var LABELS = {
    "company_name": "Company",
    "company_domain": "Domain",
    "account_primary_domain": "Primary domain",
    "website": "Website",
    "linkedin_url": "LinkedIn",
    "immediate_parent_name": "Parent",
    "immediate_parent_domain": "Parent domain",
    "ultimate_parent_name": "Ultimate parent",
    "ultimate_parent_domain": "Ultimate parent domain",
    "x_handle": "Handle",
    "x_url": "X",
    "description": "Description",
    "person.job_title": "Title",
    "employment": "Employment",
    "recommended_language_name": "Use",
    "english": "English",
    "local_language_name": "Local language",
    "best_phone.e164": "Phone",
    "best_phone.type": "Line type",
    "title": "Title",
    "seniority": "Seniority",
    "function": "Function",
    "company.name": "Company",
    "first_name": "First name",
    "last_name": "Last name",
    "email": "Email",
    "email_status": "Status",
    "status": "Status",
    "person.linkedin_url": "LinkedIn"
  };
  var ORDER = Object.keys(LABELS);
  var CHECKS = { "email.verify": 1, "person.verify_employment": 1 };
  var HIDDEN = { "person.first_name": 1, "person.last_name": 1, "full_name": 1, "icon_url": 1 };
  var DECISIONS = {
    hit: ["Found", "hit"],
    ambiguous: ["Ambiguous", "warn"],
    reject: ["Rejected", "warn"]
  };
  var MAX_ROWS = 6;
  var root = document.documentElement;
  var card = document.getElementById("card");
  var openai = window.openai;
  var rendered = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function flat(obj, prefix, out) {
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var value = obj[key];
      var path = prefix ? prefix + "." + key : key;
      if (value && typeof value === "object" && !Array.isArray(value)) flat(value, path, out);
      else if (value !== null && value !== undefined && value !== "") out.push([path, value]);
    }
    return out;
  }
  function humanize(value) {
    return String(value).replace(/_/g, " ");
  }
  function isUrl(value) {
    return typeof value === "string" && /^https:\\/\\//i.test(value);
  }
  function openLink(url) {
    if (bridge.ready) {
      bridge.request("ui/open-link", { url: url });
      return true;
    }
    if (openai && typeof openai.openExternal === "function") {
      openai.openExternal({ href: url });
      return true;
    }
    return false;
  }
  function link(url) {
    var a = el("a", null, url.replace(/^https:\\/\\/(www\\.)?/i, "").replace(/\\/$/, ""));
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", function (event) {
      if (openLink(url)) event.preventDefault();
    });
    return a;
  }
  function personName(result) {
    if (result.full_name) return result.full_name;
    var person = result.person || {};
    var parts = [person.first_name || result.first_name, person.last_name || result.last_name];
    var name = parts.filter(Boolean).join(" ");
    return name || null;
  }
  function headline(capability, result) {
    if (capability && capability.indexOf("person.") === 0) {
      return personName(result) || result.email || null;
    }
    if (capability === "email.verify") return result.email || null;
    return result.company_name || result.account_primary_domain || result.company_domain || null;
  }

  function render(data) {
    if (!data || typeof data !== "object" || !data.answer) return;
    rendered = data;
    var answer = data.answer || {};
    var result = data.result || {};
    var capability = data.capability || "";
    var decision = DECISIONS[answer.es_decision];
    if (decision && answer.es_decision === "hit" && CHECKS[capability]) decision = ["Checked", "hit"];
    card.textContent = "";

    var head = el("div", "head");
    if (decision && typeof result.icon_url === "string" && /^https:\\/\\/logos\\.kingminos\\.com\\//.test(result.icon_url)) {
      var img = el("img", "icon");
      img.alt = "";
      img.src = result.icon_url;
      head.appendChild(img);
    }
    var titles = el("div", "titles");
    titles.appendChild(el("div", "kind", KINDS[capability] || "Lookup"));
    var title = decision ? headline(capability, result) : null;
    titles.appendChild(el("div", "title", title || (decision ? decision[0] : "No confident answer")));
    var badges = el("div", "badges");
    if (decision) {
      badges.appendChild(el("span", "badge " + decision[1], decision[0]));
      if (answer.confidence) badges.appendChild(el("span", "badge", humanize(answer.confidence) + " confidence"));
    }
    if (badges.childNodes.length) titles.appendChild(badges);
    head.appendChild(titles);
    card.appendChild(head);

    if (!decision) {
      card.appendChild(el("div", "quiet", "Nothing was returned with enough confidence to use."));
      notifySize();
      return;
    }

    var rows = flat(result, "", []).filter(function (row) {
      return !HIDDEN[row[0]] && LABELS[row[0]] && row[1] !== title;
    }).sort(function (a, b) {
      return ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]);
    }).slice(0, MAX_ROWS);
    if (rows.length) {
      var dl = el("dl");
      rows.forEach(function (row) {
        var long = row[0] === "description";
        if (!long) dl.appendChild(el("dt", null, LABELS[row[0]]));
        var dd = el("dd", long ? "long" : null);
        if (isUrl(row[1])) dd.appendChild(link(row[1]));
        else dd.textContent = typeof row[1] === "string" && /^[a-z]+(_[a-z]+)*$/.test(row[1]) && row[0] !== "x_handle" ? humanize(row[1]) : String(row[1]);
        dl.appendChild(dd);
      });
      card.appendChild(dl);
    }
    notifySize();
  }

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  }

  // MCP Apps bridge: JSON-RPC 2.0 over postMessage with the host window.
  var bridge = {
    ready: false,
    nextId: 1,
    pending: {},
    request: function (method, params) {
      var id = bridge.nextId++;
      window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params || {} }, "*");
      return new Promise(function (resolve) { bridge.pending[id] = resolve; });
    },
    notify: function (method, params) {
      window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params || {} }, "*");
    }
  };
  function notifySize() {
    if (!bridge.ready) return;
    var box = document.body.getBoundingClientRect();
    bridge.notify("ui/notifications/size-changed", { width: Math.ceil(box.width), height: Math.ceil(box.height) });
  }
  function fromToolResult(params) {
    if (!params) return;
    if (params.structuredContent) render(params.structuredContent);
  }
  function applyHostContext(ctx) {
    if (ctx && ctx.theme) applyTheme(ctx.theme);
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.id !== undefined && bridge.pending[msg.id]) {
      var resolve = bridge.pending[msg.id];
      delete bridge.pending[msg.id];
      resolve(msg.result || null);
      return;
    }
    if (msg.method === "ui/resource-teardown" && msg.id !== undefined) {
      window.parent.postMessage({ jsonrpc: "2.0", id: msg.id, result: {} }, "*");
      return;
    }
    if (msg.method === "ui/notifications/tool-result") fromToolResult(msg.params);
    else if (msg.method === "ui/notifications/host-context-changed") applyHostContext(msg.params);
  });

  // ChatGPT bridge: window.openai globals.
  function fromOpenAi() {
    openai = window.openai;
    if (!openai) return false;
    applyTheme(openai.theme);
    if (openai.toolOutput) render(openai.toolOutput);
    return true;
  }
  window.addEventListener("openai:set_globals", function (event) {
    var globals = event && event.detail && event.detail.globals;
    if (globals && globals.theme) applyTheme(globals.theme);
    if (globals && globals.toolOutput) render(globals.toolOutput);
    else fromOpenAi();
  });

  // MCP Apps is the standard both hosts speak; window.openai is ChatGPT's
  // older API and only fills in until the bridge delivers.
  fromOpenAi();
  if (window.parent && window.parent !== window) {
    bridge.request("ui/initialize", {
      protocolVersion: "2026-01-26",
      appInfo: { name: "KingMinos result card", version: "1" },
      appCapabilities: {}
    }).then(function (res) {
      bridge.ready = true;
      applyHostContext(res && res.hostContext);
      bridge.notify("ui/notifications/initialized", {});
      if (rendered) notifySize();
    });
  }
})();
</script>
</body>
</html>
`;
