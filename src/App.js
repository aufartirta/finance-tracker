import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

const SUPABASE_URL = "https://rpbrpbajiemcpxafpryj.supabase.co";
const SUPABASE_KEY = "sb_publishable_L58KOmx4avbn3P2TANtjUw_OY8izJuf";

const api = async (path, opts = {}, token = null) => {
  const headers = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token || SUPABASE_KEY}`, ...opts.headers };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || "API error"); }
  return res.status === 204 ? null : res.json();
};

const authApi = async (path, body) => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Auth error");
  return data;
};

const fmtShort = n => {
  if (n >= 1e9) return `Rp ${(n/1e9).toFixed(1)}M`;
  if (n >= 1e6) return `Rp ${(n/1e6).toFixed(1)}jt`;
  if (n >= 1e3) return `Rp ${(n/1e3).toFixed(0)}rb`;
  return `Rp ${n}`;
};

const C = { income: "#34C759", spending: "#FF3B30", bg: "#F2F2F7", card: "#FFFFFF", text: "#1C1C1E", sub: "#8E8E93", border: "#E5E5EA" };
const iStyle = (extra = {}) => ({ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 16, background: "#F9F9F9", color: C.text, outline: "none", boxSizing: "border-box", ...extra });
const card = (extra = {}) => ({ background: C.card, borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", ...extra });

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const [form, setForm] = useState({ type: "spending", amount: "", category: "", note: "", date: localDate });
  const [recForm, setRecForm] = useState({ type: "spending", amount: "", category: "", note: "", frequency: "monthly", start_date: localDate });
  const [saving, setSaving] = useState(false);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  const fetchData = useCallback(async (token) => {
    try {
      const [tx, rec] = await Promise.all([
        api("transactions?select=*&order=date.desc", {}, token),
        api("recurring?select=*&order=created_at.desc", {}, token),
      ]);
      setTransactions(tx || []);
      setRecurring(rec || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    const s = localStorage.getItem("ft_session");
    if (s) try {
      const parsed = JSON.parse(s);
      setSession(parsed);
      fetchData(parsed.access_token);
    } catch {}
    setLoading(false);
  }, [fetchData]);

  useEffect(() => {
    if (session?.access_token) fetchData(session.access_token);
  }, [session, fetchData]);

  async function handleAuth() {
    setAuthLoading(true); setAuthError("");
    try {
      const data = await authApi(authMode === "login" ? "token?grant_type=password" : "signup", authForm);
      if (authMode === "signup") { setAuthError("Check your email to confirm!"); setAuthMode("login"); }
      else { localStorage.setItem("ft_session", JSON.stringify(data)); setSession(data); }
    } catch (err) { setAuthError(err.message); }
    setAuthLoading(false);
  }

  function logout() { localStorage.removeItem("ft_session"); setSession(null); setTransactions([]); setRecurring([]); }

  async function addTransaction() {
    if (!form.amount || !form.category) return;
    setSaving(true);
    try {
      await api("transactions", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...form, amount: parseFloat(form.amount), user_id: session.user?.id }) }, session.access_token);
      setForm({ type: "spending", amount: "", category: "", note: "", date: localDate });
      fetchData(session.access_token);
    } catch (err) { console.error(err); }
    setSaving(false);
  }

  async function addRecurring() {
    if (!recForm.amount || !recForm.category) return;
    setSaving(true);
    try {
      await api("recurring", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...recForm, amount: parseFloat(recForm.amount), user_id: session.user?.id }) }, session.access_token);
      setRecForm({ type: "spending", amount: "", category: "", note: "", frequency: "monthly", start_date: new Date().toISOString().split("T")[0] });
      fetchData(session.access_token);
    } catch (err) { console.error(err); }
    setSaving(false);
  }

  async function deleteTx(id) {
    await api(`transactions?id=eq.${id}`, { method: "DELETE" }, session.access_token);
    fetchData(session.access_token);
  }

  async function deleteRec(id) {
    await api(`recurring?id=eq.${id}`, { method: "DELETE" }, session.access_token);
    fetchData(session.access_token);
  }

  function exportExcel() {
    const rows = filtered.map(t => ({ Date: t.date, Type: t.type, Category: t.category, Amount: t.amount, Note: t.note || "" }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, `finance-${filterMonth}.xlsx`);
  }

  const filtered = transactions.filter(t => t.date?.startsWith(filterMonth));
  const totalIncome = filtered.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalSpending = filtered.filter(t => t.type === "spending").reduce((s, t) => s + t.amount, 0);
  const balance = totalIncome - totalSpending;
  const catBreakdown = filtered.reduce((acc, t) => { if (t.type === "spending") acc[t.category] = (acc[t.category] || 0) + t.amount; return acc; }, {});

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: C.sub }}>Loading...</div>;

  if (!session) return (
    <div style={{ background: C.bg, minHeight: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ ...card({ marginBottom: 0 }), width: "100%", maxWidth: 360, padding: 28 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>💰</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Personal Finance Tracker</h1>
          <p style={{ color: C.sub, margin: "4px 0 0", fontSize: 14 }}>{authMode === "login" ? "Sign in to your account" : "Create a new account"}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <input placeholder="Email" type="email" value={authForm.email} onChange={e => setAuthForm(p => ({ ...p, email: e.target.value }))} style={iStyle()} />
          <input placeholder="Password" type="password" value={authForm.password} onChange={e => setAuthForm(p => ({ ...p, password: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleAuth()} style={iStyle()} />
        </div>
        {authError && <p style={{ color: authMode === "signup" ? C.income : C.spending, fontSize: 13, marginBottom: 10, textAlign: "center" }}>{authError}</p>}
        <button onClick={handleAuth} disabled={authLoading} style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: C.text, color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
          {authLoading ? "..." : authMode === "login" ? "Sign In" : "Sign Up"}
        </button>
        <p style={{ textAlign: "center", marginTop: 14, fontSize: 14, color: C.sub }}>
          {authMode === "login" ? "No account? " : "Have an account? "}
          <span onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); }} style={{ color: C.text, fontWeight: 600, cursor: "pointer" }}>
            {authMode === "login" ? "Sign Up" : "Sign In"}
          </span>
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ background: C.bg, maxWidth: 480, margin: "0 auto", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ background: "rgba(255,255,255,0.92)", padding: "14px 16px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10, backdropFilter: "blur(10px)" }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>💰 Personal Finance Tracker</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: C.sub }}>{session.user?.email?.split("@")[0]}</div>
          </div>
          <button onClick={logout} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", cursor: "pointer", color: C.sub }}>Logout</button>
        </div>
      </div>

      <div style={{ padding: "14px 14px 0" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && <>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
            <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...iStyle({ padding: "8px 12px", fontSize: 14, flex: 1, width: "auto" }) }} />
            <button onClick={exportExcel} style={{ padding: "8px 12px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>↓ Excel</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
            {[{ label: "Balance", val: balance, color: balance >= 0 ? C.income : C.spending }, { label: "Income", val: totalIncome, color: C.income }, { label: "Spending", val: totalSpending, color: C.spending }].map(c => (
              <div key={c.label} style={{ ...card({ marginBottom: 0, padding: "10px 8px", textAlign: "center" }) }}>
                <div style={{ fontSize: 10, color: C.sub, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{c.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.color }}>{fmtShort(Math.abs(c.val))}</div>
              </div>
            ))}
          </div>

          {Object.keys(catBreakdown).length > 0 && (
            <div style={card()}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Spending breakdown</div>
              {Object.entries(catBreakdown).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 3 }}>
                    <span>{cat}</span><span style={{ fontWeight: 600 }}>{fmtShort(amt)}</span>
                  </div>
                  <div style={{ background: C.border, borderRadius: 4, height: 4 }}>
                    <div style={{ background: C.spending, borderRadius: 4, height: 4, width: `${Math.min(100, (amt / totalSpending) * 100)}%`, transition: "width 0.3s" }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Transactions</div>
          {filtered.length === 0 && <div style={{ textAlign: "center", color: C.sub, padding: "32px 0", fontSize: 14 }}>No transactions this month</div>}
          {filtered.map(t => (
            <div key={t.id} style={{ ...card({ marginBottom: 8, padding: "12px 14px" }), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: t.type === "income" ? "#E8F8ED" : "#FFF0EF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                  {t.type === "income" ? "↑" : "↓"}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{t.note || t.category}</div>
                  <div style={{ fontSize: 12, color: C.sub }}>{t.date}{t.category ? ` · ${t.category}` : ""}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, color: t.type === "income" ? C.income : C.spending, fontSize: 14 }}>
                  {t.type === "income" ? "+" : "-"}{fmtShort(t.amount)}
                </span>
                <button onClick={() => deleteTx(t.id)} style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            </div>
          ))}
        </>}

        {/* ADD */}
        {tab === "add" && (
          <div style={card()}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Add Transaction</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {["spending", "income"].map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))} style={{ padding: "10px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 15, background: form.type === t ? (t === "income" ? C.income : C.spending) : C.bg, color: form.type === t ? "#fff" : C.sub, transition: "all 0.15s" }}>
                  {t === "income" ? "↑ Income" : "↓ Spending"}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input placeholder="Amount (Rp)" type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} style={iStyle()} />
              <input placeholder="Item (e.g. Food, Salary)" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={iStyle()} />
              <input placeholder="Note (optional)" value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} style={iStyle()} />
              <div style={{ width: "100%", overflow: "hidden", borderRadius: 12, border: `1px solid ${C.border}`, background: "#F9F9F9" }}>
                <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={{ width: "100%", padding: "12px 14px", border: "none", fontSize: 16, background: "transparent", color: C.text, outline: "none", boxSizing: "border-box", display: "block" }} />
              </div>
            </div>
            <button onClick={addTransaction} disabled={saving} style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 12, border: "none", background: C.text, color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
              {saving ? "Saving..." : "Add Transaction"}
            </button>
          </div>
        )}

        {/* RECURRING */}
        {tab === "recurring" && <>
          <div style={card()}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Add Recurring</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {["spending", "income"].map(t => (
                <button key={t} onClick={() => setRecForm(p => ({ ...p, type: t }))} style={{ padding: "10px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 15, background: recForm.type === t ? (t === "income" ? C.income : C.spending) : C.bg, color: recForm.type === t ? "#fff" : C.sub }}>
                  {t === "income" ? "↑ Income" : "↓ Spending"}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input placeholder="Amount (Rp)" type="number" value={recForm.amount} onChange={e => setRecForm(p => ({ ...p, amount: e.target.value }))} style={iStyle()} />
              <input placeholder="Item" value={recForm.category} onChange={e => setRecForm(p => ({ ...p, category: e.target.value }))} style={iStyle()} />
              <input placeholder="Note (optional)" value={recForm.note} onChange={e => setRecForm(p => ({ ...p, note: e.target.value }))} style={iStyle()} />
              <select value={recForm.frequency} onChange={e => setRecForm(p => ({ ...p, frequency: e.target.value }))} style={iStyle()}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <div style={{ width: "100%", overflow: "hidden", borderRadius: 12, border: `1px solid ${C.border}`, background: "#F9F9F9" }}>
                <input type="date" value={recForm.start_date} onChange={e => setRecForm(p => ({ ...p, start_date: e.target.value }))} style={{ width: "100%", padding: "12px 14px", border: "none", fontSize: 16, background: "transparent", color: C.text, outline: "none", boxSizing: "border-box", display: "block" }} />
              </div>
            </div>
            <button onClick={addRecurring} disabled={saving} style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 12, border: "none", background: C.text, color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
              {saving ? "Saving..." : "Add Recurring"}
            </button>
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Active Recurring</div>
          {recurring.length === 0 && <div style={{ textAlign: "center", color: C.sub, padding: "24px 0", fontSize: 14 }}>No recurring set up yet</div>}
          {recurring.map(r => (
            <div key={r.id} style={{ ...card({ marginBottom: 8, padding: "12px 14px" }), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: r.type === "income" ? "#E8F8ED" : "#FFF0EF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                  {r.frequency === "monthly" ? "📅" : r.frequency === "weekly" ? "📆" : "🔁"}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{r.category}</div>
                  <div style={{ fontSize: 12, color: C.sub }}>{r.frequency} · since {r.start_date}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, color: r.type === "income" ? C.income : C.spending, fontSize: 14 }}>
                  {r.type === "income" ? "+" : "-"}{fmtShort(r.amount)}
                </span>
                <button onClick={() => deleteRec(r.id)} style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            </div>
          ))}
        </>}
      </div>

      {/* Bottom nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderTop: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "8px 0 12px", zIndex: 10 }}>
        {[{ id: "dashboard", icon: "📊", label: "Dashboard" }, { id: "add", icon: "＋", label: "Add" }, { id: "recurring", icon: "🔁", label: "Recurring" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 0" }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={{ fontSize: 11, color: tab === t.id ? C.text : C.sub, fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
