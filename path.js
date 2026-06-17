/**
 * Abarkavan Fleet Accounting — Standalone API Worker
 *
 * Deploy this code in your separate "abarkavan" Worker
 * (Workers & Pages → abarkavan → Edit Code / Quick Edit → paste this file).
 *
 * The Pages site (abarkavan.pages.dev) is plain static files (index.html,
 * style.css, app.js) and calls THIS worker for all /api/* requests, so CORS
 * is enabled for every response.
 *
 * SETUP:
 * Workers & Pages → abarkavan (this Worker) → Settings → Bindings →
 *   Add binding → D1 database → Variable name: DB → Database: lc
 *
 * After deploying, note this Worker's URL (shown at the top of its page,
 * looks like https://abarkavan.<something>.workers.dev) and put that exact
 * URL into the API_BASE constant near the top of app.js.
 */

const USERS = {
  "1232": "Saeed",
  "1234": "Tayeb",
  "1230": "Fatemah",
  "1100": "Mo11aei",
};
const ADMIN_NAME = "Mo11aei";

const VESSELS = ["ABARKAVAN", "ABARKAVAN 1", "ABARKAVAN 4", "NONAME"];
const CATEGORIES = [
  "general_expense",
  "salary",
  "income_received",
  "income_pending",
];
const CURRENCIES = ["IRR", "AED"]; // IRR is used to mean "Toman" throughout the UI

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  try {
    return await handleApi(request, env, url);
  } catch (err) {
    return jsonResponse({ error: err.message || "Server error" }, 500);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

async function authenticate(request, db) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();

  // First check user_pins table (custom PINs override defaults)
  if (db) {
    try {
      const pinRow = await db.prepare("SELECT username FROM user_pins WHERE pin = ?").bind(token).first();
      if (pinRow) {
        return { token, name: pinRow.username, isAdmin: pinRow.username === ADMIN_NAME };
      }
    } catch (e) { /* DB not ready, fall through */ }
  }

  // Fall back to hardcoded PINs
  const name = USERS[token];
  if (!name) return null;
  return { token, name, isAdmin: name === ADMIN_NAME };
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vessel TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        recorded_by TEXT NOT NULL,
        charterer_id INTEGER REFERENCES charterers(id) ON DELETE SET NULL,
        deleted_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rate REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'auto',
        set_by TEXT,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pdf_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vessel TEXT NOT NULL,
        month TEXT NOT NULL,
        pdf_base64 TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(vessel, month)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS shareholder_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vessel TEXT NOT NULL,
        partner_name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('withdrawal','debt','settlement')),
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'IRR',
        description TEXT,
        settled INTEGER NOT NULL DEFAULT 0,
        settled_at TEXT DEFAULT NULL,
        settled_by TEXT DEFAULT NULL,
        recorded_by TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `),
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS user_pins (
        username TEXT PRIMARY KEY,
        pin TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS statement_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vessel TEXT NOT NULL,
        month TEXT NOT NULL,
        pdf_base64 TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(vessel, month)
      )
    `),
  ]);
  // Add deleted_at column if it doesn't exist yet (for existing databases)
  try {
    await env.DB.prepare("ALTER TABLE transactions ADD COLUMN deleted_at TEXT DEFAULT NULL").run();
  } catch (e) {
    // Column already exists — ignore
  }
}

function validateVessel(vessel) {
  return VESSELS.includes(vessel);
}
function validateCategory(category) {
  return CATEGORIES.includes(category);
}
function validateCurrency(currency) {
  return CURRENCIES.includes(currency);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // --- Health check (no auth, no DB needed) -----------------------------
  if (path === "/api/health" && method === "GET") {
    return jsonResponse({ ok: true, db_bound: !!env.DB });
  }

  // --- Login (no auth required) -----------------------
  if (path === "/api/login" && method === "POST") {
    const body = await safeJson(request);
    const password = String((body && body.password) || "").trim();

    if (env.DB) {
      try {
        await ensureSchema(env.DB);
        // Check custom PINs first
        const pinRow = await env.DB.prepare(
          "SELECT username FROM user_pins WHERE pin = ?"
        ).bind(password).first();
        if (pinRow) {
          const name = pinRow.username;
          return jsonResponse({ ok: true, name, token: password, isAdmin: name === ADMIN_NAME });
        }
        // Check if this is a default PIN but user has a custom PIN set (block old PIN)
        const defaultName = USERS[password];
        if (defaultName) {
          const hasCustomPin = await env.DB.prepare(
            "SELECT pin FROM user_pins WHERE username = ?"
          ).bind(defaultName).first();
          if (hasCustomPin) {
            // User has changed their PIN — old default PIN is no longer valid
            return jsonResponse({ error: "رمز عبور نامعتبر است" }, 401);
          }
          return jsonResponse({ ok: true, name: defaultName, token: password, isAdmin: defaultName === ADMIN_NAME });
        }
        return jsonResponse({ error: "رمز عبور نامعتبر است" }, 401);
      } catch (e) {
        // DB error — fall back to defaults only
      }
    }

    const nameByDefault = USERS[password];
    if (!nameByDefault) return jsonResponse({ error: "رمز عبور نامعتبر است" }, 401);
    return jsonResponse({ ok: true, name: nameByDefault, token: password, isAdmin: nameByDefault === ADMIN_NAME });
  }

  // --- Everything below needs the D1 database ---------------------------
  if (!env.DB) {
    return jsonResponse(
      { error: "اتصال دیتابیس D1 برقرار نیست — در تنظیمات این Worker یک Binding با نام DB به دیتابیس lc اضافه کنید" },
      500
    );
  }
  await ensureSchema(env.DB);

  // --- Everything below requires authentication ------------------------
  const user = await authenticate(request, env.DB);
  if (!user) return jsonResponse({ error: "ورود نامعتبر است" }, 401);

  // --- Transactions ------------------------------------------------------
  if (path === "/api/transactions" && method === "GET") {
    const vessel = url.searchParams.get("vessel");
    const category = url.searchParams.get("category");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);

    let query = `SELECT t.*, c.name AS charterer_name
      FROM transactions t LEFT JOIN charterers c ON t.charterer_id = c.id
      WHERE t.vessel = ? AND t.deleted_at IS NULL`;
    const params = [vessel];
    if (category) {
      if (!validateCategory(category)) return jsonResponse({ error: "دسته نامعتبر" }, 400);
      query += " AND t.category = ?";
      params.push(category);
    }
    query += " ORDER BY t.entry_date DESC, t.id DESC";
    const { results } = await env.DB.prepare(query).bind(...params).all();
    return jsonResponse({ ok: true, transactions: results });
  }

  if (path === "/api/transactions" && method === "POST") {
    const body = await safeJson(request);
    const { vessel, category, description, amount, currency, entry_date, charterer_id } = body || {};
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    if (!validateCategory(category)) return jsonResponse({ error: "دسته نامعتبر" }, 400);
    if (!validateCurrency(currency)) return jsonResponse({ error: "ارز نامعتبر" }, 400);
    const numAmount = Number(amount);
    if (!isFinite(numAmount) || numAmount <= 0) return jsonResponse({ error: "مقدار نامعتبر" }, 400);
    if (!entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) return jsonResponse({ error: "تاریخ نامعتبر" }, 400);
    const numCharterer = charterer_id ? Number(charterer_id) : null;
    const result = await env.DB.prepare(`
      INSERT INTO transactions (vessel, category, description, amount, currency, entry_date, recorded_by, charterer_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(vessel, category, description || "", numAmount, currency, entry_date, user.name, numCharterer).run();
    const row = await env.DB.prepare(
      `SELECT t.*, c.name AS charterer_name FROM transactions t
       LEFT JOIN charterers c ON t.charterer_id = c.id WHERE t.id = ?`
    ).bind(result.meta.last_row_id).first();
    return jsonResponse({ ok: true, transaction: row });
  }

  // Soft-delete: move to trash
  const trashMatch = path.match(/^\/api\/transactions\/(\d+)\/trash$/);
  if (trashMatch && method === "POST") {
    const id = Number(trashMatch[1]);
    const row = await env.DB.prepare("SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL").bind(id).first();
    if (!row) return jsonResponse({ error: "یافت نشد" }, 404);
    if (row.recorded_by !== user.name && !user.isAdmin) return jsonResponse({ error: "اجازه ندارید" }, 403);
    await env.DB.prepare("UPDATE transactions SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  }

  const txMatch = path.match(/^\/api\/transactions\/(\d+)$/);
  if (txMatch && method === "DELETE") {
    // Only admins can permanently delete
    if (!user.isAdmin) return jsonResponse({ error: "فقط مدیر می‌تواند حذف دائم کند" }, 403);
    const id = Number(txMatch[1]);
    await env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  }

  // --- Trash endpoints ---------------------------------------------------
  if (path === "/api/trash" && method === "GET") {
    const vessel = url.searchParams.get("vessel");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    const { results } = await env.DB.prepare(`
      SELECT t.*, c.name AS charterer_name FROM transactions t
      LEFT JOIN charterers c ON t.charterer_id = c.id
      WHERE t.vessel = ? AND t.deleted_at IS NOT NULL
      ORDER BY t.deleted_at DESC
    `).bind(vessel).all();
    return jsonResponse({ ok: true, transactions: results });
  }

  const restoreMatch = path.match(/^\/api\/trash\/(\d+)\/restore$/);
  if (restoreMatch && method === "POST") {
    const id = Number(restoreMatch[1]);
    const row = await env.DB.prepare("SELECT * FROM transactions WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first();
    if (!row) return jsonResponse({ error: "یافت نشد" }, 404);
    if (row.recorded_by !== user.name && !user.isAdmin) return jsonResponse({ error: "اجازه ندارید" }, 403);
    await env.DB.prepare("UPDATE transactions SET deleted_at = NULL WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  }

  const permDelMatch = path.match(/^\/api\/trash\/(\d+)$/);
  if (permDelMatch && method === "DELETE") {
    if (!user.isAdmin) return jsonResponse({ error: "فقط مدیر می‌تواند حذف دائم کند" }, 403);
    const id = Number(permDelMatch[1]);
    await env.DB.prepare("DELETE FROM transactions WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
    return jsonResponse({ ok: true });
  }

  if (path === "/api/trash/empty" && method === "DELETE") {
    if (!user.isAdmin) return jsonResponse({ error: "فقط مدیر می‌تواند سطل را خالی کند" }, 403);
    const vessel = url.searchParams.get("vessel");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    await env.DB.prepare("DELETE FROM transactions WHERE vessel = ? AND deleted_at IS NOT NULL").bind(vessel).run();
    return jsonResponse({ ok: true });
  }

  // --- Charterers ----------------------------------------------------------
  if (path === "/api/charterers" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM charterers ORDER BY name ASC"
    ).all();
    return jsonResponse({ ok: true, charterers: results });
  }

  if (path === "/api/charterers" && method === "POST") {
    const body = await safeJson(request);
    const name = String((body && body.name) || "").trim();
    if (!name) return jsonResponse({ error: "نام الزامی است" }, 400);
    try {
      const result = await env.DB.prepare(
        "INSERT INTO charterers (name, created_by) VALUES (?, ?)"
      ).bind(name, user.name).run();
      const row = await env.DB.prepare("SELECT * FROM charterers WHERE id = ?")
        .bind(result.meta.last_row_id).first();
      return jsonResponse({ ok: true, charterer: row });
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return jsonResponse({ error: "این نام قبلاً ثبت شده است" }, 409);
      throw e;
    }
  }

  const charMatch = path.match(/^\/api\/charterers\/(\d+)$/);
  if (charMatch && method === "DELETE") {
    if (!user.isAdmin) return jsonResponse({ error: "فقط مدیر می‌تواند حذف کند" }, 403);
    await env.DB.prepare("DELETE FROM charterers WHERE id = ?").bind(Number(charMatch[1])).run();
    return jsonResponse({ ok: true });
  }

  // --- Change PIN ----------------------------------------------------------
  if (path === "/api/change-pin" && method === "POST") {
    const body = await safeJson(request);
    const new_pin = String((body && body.new_pin) || "").trim();
    if (!/^\d{4,8}$/.test(new_pin)) return jsonResponse({ error: "رمز باید ۴ تا ۸ رقم باشد" }, 400);
    await env.DB.prepare(`
      INSERT INTO user_pins (username, pin) VALUES (?, ?)
      ON CONFLICT(username) DO UPDATE SET pin = excluded.pin
    `).bind(user.name, new_pin).run();
    return jsonResponse({ ok: true });
  }

  // --- Exchange rate (AED -> Toman) --------------------------------------
  if (path === "/api/rate" && method === "GET") {
    const rate = await getRate(env);
    return jsonResponse({ ok: true, ...rate });
  }

  if (path === "/api/rate" && method === "POST") {
    if (!user.isAdmin) return jsonResponse({ error: "فقط مدیر می‌تواند نرخ را ثبت کند" }, 403);
    const body = await safeJson(request);
    const rate = Number(body && body.rate);
    if (!isFinite(rate) || rate <= 0) return jsonResponse({ error: "نرخ نامعتبر" }, 400);
    await env.DB.prepare(`
      INSERT INTO exchange_rates (rate, source, set_by, fetched_at) VALUES (?, 'manual', ?, datetime('now'))
    `).bind(rate, user.name).run();
    return jsonResponse({ ok: true, rate, source: "manual" });
  }

  // --- Summary for charts --------------------------------------------------
  if (path === "/api/summary" && method === "GET") {
    const vessel = url.searchParams.get("vessel");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);

    const { results } = await env.DB.prepare(`
      SELECT substr(entry_date, 1, 7) AS month, category, currency, SUM(amount) AS total
      FROM transactions
      WHERE vessel = ?
      GROUP BY month, category, currency
      ORDER BY month ASC
    `).bind(vessel).all();

    const monthsSet = new Set();
    for (const r of results) monthsSet.add(r.month);
    const months = Array.from(monthsSet).sort();

    const init = () => Object.fromEntries(months.map((m) => [m, 0]));
    const incomeToman = init();
    const expenseToman = init();
    const incomeAed = init();
    const expenseAed = init();

    for (const r of results) {
      const isIncome = r.category === "income_received" || r.category === "income_pending";
      const isExpense = r.category === "general_expense" || r.category === "salary";
      if (r.currency === "IRR") {
        if (isIncome) incomeToman[r.month] += r.total;
        if (isExpense) expenseToman[r.month] += r.total;
      } else if (r.currency === "AED") {
        if (isIncome) incomeAed[r.month] += r.total;
        if (isExpense) expenseAed[r.month] += r.total;
      }
    }

    return jsonResponse({
      ok: true,
      months,
      income_toman: months.map((m) => incomeToman[m]),
      expense_toman: months.map((m) => expenseToman[m]),
      income_aed: months.map((m) => incomeAed[m]),
      expense_aed: months.map((m) => expenseAed[m]),
    });
  }

  // --- Monthly statement data (income received / pending / expenses split) -
  if (path === "/api/statements" && method === "GET") {
    const vessel = url.searchParams.get("vessel");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);

    const { results } = await env.DB.prepare(`
      SELECT substr(entry_date, 1, 7) AS month, category, currency, SUM(amount) AS total
      FROM transactions
      WHERE vessel = ?
      GROUP BY month, category, currency
      ORDER BY month ASC
    `).bind(vessel).all();

    const monthsSet = new Set();
    for (const r of results) monthsSet.add(r.month);
    const months = Array.from(monthsSet).sort();

    const init = () => Object.fromEntries(months.map((m) => [m, 0]));
    const incRecIrr = init();
    const incRecAed = init();
    const incPendIrr = init();
    const incPendAed = init();
    const expIrr = init();
    const expAed = init();

    for (const r of results) {
      if (r.category === "income_received") {
        if (r.currency === "IRR") incRecIrr[r.month] += r.total;
        else incRecAed[r.month] += r.total;
      } else if (r.category === "income_pending") {
        if (r.currency === "IRR") incPendIrr[r.month] += r.total;
        else incPendAed[r.month] += r.total;
      } else if (r.category === "general_expense" || r.category === "salary") {
        if (r.currency === "IRR") expIrr[r.month] += r.total;
        else expAed[r.month] += r.total;
      }
    }

    return jsonResponse({
      ok: true,
      months,
      income_received_irr: months.map((m) => incRecIrr[m]),
      income_received_aed: months.map((m) => incRecAed[m]),
      income_pending_irr: months.map((m) => incPendIrr[m]),
      income_pending_aed: months.map((m) => incPendAed[m]),
      expense_irr: months.map((m) => expIrr[m]),
      expense_aed: months.map((m) => expAed[m]),
    });
  }

  // --- PDF monthly reports --------------------------------------------------
  if (path === "/api/pdf-report" && method === "POST") {
    const body = await safeJson(request);
    const { vessel, month, pdf_base64 } = body || {};
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return jsonResponse({ error: "ماه نامعتبر" }, 400);
    if (!pdf_base64) return jsonResponse({ error: "فایل PDF خالی است" }, 400);

    await env.DB.prepare(`
      INSERT INTO pdf_reports (vessel, month, pdf_base64, created_by, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(vessel, month) DO UPDATE SET
        pdf_base64 = excluded.pdf_base64,
        created_by = excluded.created_by,
        created_at = datetime('now')
    `).bind(vessel, month, pdf_base64, user.name).run();

    const row = await env.DB.prepare(
      "SELECT id, vessel, month, created_by, created_at FROM pdf_reports WHERE vessel = ? AND month = ?"
    ).bind(vessel, month).first();

    return jsonResponse({ ok: true, report: row });
  }

  if (path === "/api/pdf-report/list" && method === "GET") {
    const vessel = url.searchParams.get("vessel");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    const { results } = await env.DB.prepare(
      "SELECT id, vessel, month, created_by, created_at FROM pdf_reports WHERE vessel = ? ORDER BY month DESC"
    ).bind(vessel).all();
    return jsonResponse({ ok: true, reports: results });
  }

  const pdfMatch = path.match(/^\/api\/pdf-report\/(\d+)$/);
  if (pdfMatch && method === "GET") {
    const id = Number(pdfMatch[1]);
    const row = await env.DB.prepare("SELECT * FROM pdf_reports WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ error: "یافت نشد" }, 404);
    return pdfFileResponse(row);
  }

  if (pdfMatch && method === "DELETE") {
    if (!user.isAdmin) return jsonResponse({ error: "اجازه حذف ندارید" }, 403);
    const id = Number(pdfMatch[1]);
    await env.DB.prepare("DELETE FROM pdf_reports WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  }

  // --- Monthly statement reports (partner profit-share PDFs) --------------
  if (path === "/api/statement-report" && method === "POST") {
    const body = await safeJson(request);
    const { vessel, month, pdf_base64 } = body || {};
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return jsonResponse({ error: "ماه نامعتبر" }, 400);
    if (!pdf_base64) return jsonResponse({ error: "فایل PDF خالی است" }, 400);

    await env.DB.prepare(`
      INSERT INTO statement_reports (vessel, month, pdf_base64, created_by, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(vessel, month) DO UPDATE SET
        pdf_base64 = excluded.pdf_base64,
        created_by = excluded.created_by,
        created_at = datetime('now')
    `).bind(vessel, month, pdf_base64, user.name).run();

    const row = await env.DB.prepare(
      "SELECT id, vessel, month, created_by, created_at FROM statement_reports WHERE vessel = ? AND month = ?"
    ).bind(vessel, month).first();

    return jsonResponse({ ok: true, report: row });
  }

  if (path === "/api/statement-report/list" && method === "GET") {
    const vessel = url.searchParams.get("vessel");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    const { results } = await env.DB.prepare(
      "SELECT id, vessel, month, created_by, created_at FROM statement_reports WHERE vessel = ? ORDER BY month DESC"
    ).bind(vessel).all();
    return jsonResponse({ ok: true, reports: results });
  }

  const stmtMatch = path.match(/^\/api\/statement-report\/(\d+)$/);
  if (stmtMatch && method === "GET") {
    const id = Number(stmtMatch[1]);
    const row = await env.DB.prepare("SELECT * FROM statement_reports WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ error: "یافت نشد" }, 404);
    return pdfFileResponse(row, "statement");
  }

  if (stmtMatch && method === "DELETE") {
    if (!user.isAdmin) return jsonResponse({ error: "اجازه حذف ندارید" }, 403);
    const id = Number(stmtMatch[1]);
    await env.DB.prepare("DELETE FROM statement_reports WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  }

  // --- Shareholder transactions ------------------------------------------
  if (path === "/api/shareholder-tx" && method === "GET") {
    const vessel = url.searchParams.get("vessel");
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    const { results } = await env.DB.prepare(`
      SELECT * FROM shareholder_transactions WHERE vessel = ? ORDER BY entry_date DESC, id DESC
    `).bind(vessel).all();
    return jsonResponse({ ok: true, transactions: results });
  }

  if (path === "/api/shareholder-tx" && method === "POST") {
    const body = await safeJson(request);
    const { vessel, partner_name, type, amount, currency, description, entry_date } = body || {};
    if (!validateVessel(vessel)) return jsonResponse({ error: "شناور نامعتبر" }, 400);
    if (!partner_name) return jsonResponse({ error: "نام شریک الزامی است" }, 400);
    if (!["withdrawal","debt","settlement"].includes(type)) return jsonResponse({ error: "نوع نامعتبر" }, 400);
    if (!validateCurrency(currency || "IRR")) return jsonResponse({ error: "ارز نامعتبر" }, 400);
    const numAmount = Number(amount);
    if (!isFinite(numAmount) || numAmount < 0) return jsonResponse({ error: "مقدار نامعتبر" }, 400);
    if (!entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) return jsonResponse({ error: "تاریخ نامعتبر" }, 400);

    const result = await env.DB.prepare(`
      INSERT INTO shareholder_transactions (vessel, partner_name, type, amount, currency, description, recorded_by, entry_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(vessel, partner_name, type, numAmount, currency || "IRR", description || "", user.name, entry_date).run();

    const row = await env.DB.prepare("SELECT * FROM shareholder_transactions WHERE id = ?")
      .bind(result.meta.last_row_id).first();
    return jsonResponse({ ok: true, transaction: row });
  }

  // Settle a shareholder transaction
  const shSettle = path.match(/^\/api\/shareholder-tx\/(\d+)\/settle$/);
  if (shSettle && method === "POST") {
    const id = Number(shSettle[1]);
    const row = await env.DB.prepare("SELECT * FROM shareholder_transactions WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ error: "یافت نشد" }, 404);
    if (row.settled) return jsonResponse({ error: "قبلاً تسویه شده است" }, 400);
    await env.DB.prepare(`
      UPDATE shareholder_transactions SET settled=1, settled_at=datetime('now'), settled_by=? WHERE id=?
    `).bind(user.name, id).run();
    return jsonResponse({ ok: true });
  }

  // Delete a shareholder transaction (admin only)
  const shDel = path.match(/^\/api\/shareholder-tx\/(\d+)$/);
  if (shDel && method === "DELETE") {
    if (!user.isAdmin) return jsonResponse({ error: "فقط مدیر می‌تواند حذف کند" }, 403);
    await env.DB.prepare("DELETE FROM shareholder_transactions WHERE id = ?").bind(Number(shDel[1])).run();
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "مسیر یافت نشد" }, 404);
}

// Build a downloadable PDF Response from a pdf_reports / statement_reports row.
function pdfFileResponse(row, prefix = "") {
  let base64 = row.pdf_base64;
  const commaIdx = base64.indexOf(",");
  if (base64.startsWith("data:") && commaIdx !== -1) base64 = base64.slice(commaIdx + 1);

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const safeVessel = row.vessel.replace(/[^A-Za-z0-9]+/g, "-");
  const namePrefix = prefix ? prefix + "-" : "";
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${namePrefix}${safeVessel}-${row.month}.pdf"`,
      ...CORS_HEADERS,
    },
  });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exchange rate: AED -> Toman, sourced from tgju.org with D1 caching + manual override
// ---------------------------------------------------------------------------

async function getRate(env) {
  const cached = await env.DB.prepare(
    "SELECT * FROM exchange_rates ORDER BY id DESC LIMIT 1"
  ).first();

  const now = Date.now();
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  if (cached) {
    const fetchedAt = new Date(cached.fetched_at.replace(" ", "T") + "Z").getTime();
    const isFresh = now - fetchedAt < SIX_HOURS;
    if (cached.source === "manual" || isFresh) {
      return {
        rate: cached.rate,
        source: cached.source,
        fetched_at: cached.fetched_at,
        stale: false,
      };
    }
  }

  // Try to fetch a fresh rate from tgju.org
  try {
    const resp = await fetch("https://www.tgju.org/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "fa,en;q=0.8",
      },
    });

    if (!resp.ok) throw new Error("tgju fetch failed: " + resp.status);
    const html = await resp.text();

    const rial = extractAedRial(html);
    if (!rial) throw new Error("rate not found in tgju page");

    const toman = rial / 10;

    await env.DB.prepare(
      "INSERT INTO exchange_rates (rate, source, fetched_at) VALUES (?, 'auto', datetime('now'))"
    ).bind(toman).run();

    return { rate: toman, source: "auto", fetched_at: new Date().toISOString(), stale: false };
  } catch (err) {
    if (cached) {
      return {
        rate: cached.rate,
        source: cached.source,
        fetched_at: cached.fetched_at,
        stale: true,
        error: err.message,
      };
    }
    return { rate: null, source: "none", fetched_at: null, stale: true, error: err.message };
  }
}

// Parse the AED (free-market) Rial price out of the tgju.org homepage market table.
function extractAedRial(html) {
  // Primary: the homepage market-summary row for AED
  let m = html.match(/data-market-row=["']price_aed["'][\s\S]{0,600}?<td[^>]*class=["'][^"']*nf[^"']*["'][^>]*>\s*([\d,]+)/i);
  if (m) return parseFloat(m[1].replace(/,/g, ""));

  // Fallback: any "نرخ فعلی" style value near "price_aed"
  m = html.match(/price_aed[\s\S]{0,800}?([\d]{2,3}(?:,\d{3})+)/);
  if (m) return parseFloat(m[1].replace(/,/g, ""));

  return null;
}
