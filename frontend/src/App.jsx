import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase";

const STORAGE_KEY = "ruangusaha-financial-v1";
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const TITLES = { dashboard: "Ringkasan", transactions: "Transaksi", reports: "Laporan keuangan", analysis: "Analisis KBR", assets: "Aset usaha", settings: "Pengaturan usaha" };
const CATEGORIES = {
  revenue: ["Penjualan", "Pendapatan jasa", "Pendapatan usaha lainnya", "Pendapatan non-operasional"],
  expense: ["COGS / HPP", "OPEX", "Marketing", "Beban non-operasional"],
  capital: ["Setoran modal pemilik"], loan: ["Penerimaan pinjaman"],
  draw: ["Prive / pengambilan pribadi"], principal: ["Pembayaran pokok pinjaman"],
};
const KIND_NAMES = { revenue: "Pendapatan", expense: "Pengeluaran", capital: "Setoran modal", loan: "Pinjaman masuk", draw: "Prive", principal: "Bayar pokok pinjaman", asset: "Pembelian aset" };

const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const monthOf = (date) => String(date || "").slice(0, 7);
const endOfMonth = (month) => {
  const [year, number] = month.split("-").map(Number);
  return `${year}-${String(number).padStart(2, "0")}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}`;
};
const monthLabel = (month) => {
  if (!month) return "Periode belum dipilih";
  const [year, number] = month.split("-").map(Number);
  return `${MONTHS[number - 1]} ${year}`;
};
const money = (value, compact = false) => {
  const amount = Number(value) || 0;
  if (compact && Math.abs(amount) >= 1_000_000) return `Rp${(amount / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
};
const percent = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%` : "—";
const dateLabel = (date) => {
  if (!date) return "—";
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
};
const cashDelta = (tx) => ["revenue", "capital", "loan"].includes(tx.kind) ? tx.amount : -tx.amount;
const amountFor = (rows, predicate) => rows.reduce((total, row) => total + (predicate(row) ? Number(row.amount) : 0), 0);
function sampleData() {
  const transactions = [];
  const add = (date, description, kind, category, amount, account = "cash") => transactions.push({ id: id(), date, description, kind, category, amount, account, note: "" });
  add("2026-08-03", "Penjualan Agustus", "revenue", "Penjualan", 90_000_000);
  add("2026-08-05", "Pembelian bahan baku", "expense", "COGS / HPP", 38_000_000);
  add("2026-08-10", "Biaya operasional", "expense", "OPEX", 30_000_000);
  add("2026-08-15", "Promosi dan iklan", "expense", "Marketing", 4_000_000);
  add("2026-08-25", "Pengambilan pemilik", "draw", CATEGORIES.draw[0], 3_000_000);
  add("2026-08-27", "Pembayaran pokok pinjaman", "principal", CATEGORIES.principal[0], 2_000_000);
  add("2026-09-03", "Penjualan September", "revenue", "Penjualan", 100_000_000);
  add("2026-09-05", "Pembelian bahan baku", "expense", "COGS / HPP", 46_500_000);
  add("2026-09-10", "Biaya operasional", "expense", "OPEX", 32_000_000);
  add("2026-09-15", "Promosi dan iklan", "expense", "Marketing", 6_500_000);
  add("2026-09-18", "Pengambilan pemilik", "draw", CATEGORIES.draw[0], 8_000_000);
  add("2026-09-25", "Pembayaran pokok pinjaman", "principal", CATEGORIES.principal[0], 2_000_000);
  const assetId = id();
  transactions.push({ id: id(), date: "2026-09-12", description: "Mesin kopi espresso", kind: "asset", category: "Aset tetap", amount: 12_000_000, account: "cash", note: "", assetId });
  return {
    version: 1, demo: true,
    profile: { businessName: "Kedai Kopi Senja", ownerName: "Andi Rahman", businessType: "Kedai kopi" },
    opening: { date: "2026-07-31", cash: 12_000_000, bank: 15_000_000, fixedAssets: 0, liabilities: 5_000_000, equity: 22_000_000, confirmed: true },
    transactions,
    assets: [{ id: assetId, name: "Mesin kopi espresso", cost: 12_000_000, residual: 0, lifeMonths: 12, startDate: "2026-09-12", account: "cash", opening: false }],
  };
}
function emptyData() {
  return { version: 1, demo: false, profile: { businessName: "Usaha Saya", ownerName: "Pemilik usaha", businessType: "Kuliner" }, opening: { date: today(), cash: 0, bank: 0, fixedAssets: 0, liabilities: 0, equity: 0, confirmed: false }, transactions: [], assets: [] };
}
function readLocalData() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const sample = sampleData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sample));
    return sample;
  }
  const parsed = JSON.parse(stored);
  if (parsed?.version !== 1 || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.assets)) throw new Error("Format data browser tidak dikenali.");
  return parsed;
}
function App() {
  const [page, setPage] = useState("dashboard");
  const [period, setPeriod] = useState("2026-09");
  const [data, setData] = useState(() => {
    try { return readLocalData(); } catch (error) { console.error(error); return emptyData(); }
  });
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [workspaceReady, setWorkspaceReady] = useState(!supabaseConfigured);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [reasoner, setReasoner] = useState({ status: "idle", result: null, error: "" });
  const [financialReport, setFinancialReport] = useState({ request: "", status: "idle", body: null, error: "" });
  const [reportRetry, setReportRetry] = useState(0);
  const [reportTab, setReportTab] = useState("profit");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!supabaseConfigured) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data: result, error }) => {
      if (error) setAuthError(error.message);
      if (active) { setSession(result.session); setAuthReady(true); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthError("");
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !session?.user) {
      if (!supabaseConfigured) setWorkspaceReady(true);
      else { setData(emptyData()); setWorkspaceReady(true); }
      return undefined;
    }
    let active = true;
    setWorkspaceReady(false);
    (async () => {
      const { data: row, error } = await supabase.from("user_workspaces").select("data").eq("user_id", session.user.id).maybeSingle();
      if (error) throw error;
      if (!active) return;
      if (row?.data) setData(row.data);
      else {
        const initial = emptyData();
        const { error: saveError } = await supabase.from("user_workspaces").upsert({ user_id: session.user.id, data: initial });
        if (saveError) throw saveError;
        setData(initial);
      }
      setWorkspaceReady(true);
    })().catch((error) => {
      console.error(error);
      if (active) { setNotice(`Gagal memuat workspace Supabase: ${error.message}`); setWorkspaceReady(true); }
    });
    return () => { active = false; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    if (!supabaseConfigured) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
      catch (error) { console.error(error); setNotice(`Data gagal disimpan di browser: ${error.message}`); }
      return undefined;
    }
    if (!session?.user) return undefined;
    const timer = window.setTimeout(async () => {
      const { error } = await supabase.from("user_workspaces").upsert({ user_id: session.user.id, data, updated_at: new Date().toISOString() });
      if (error) { console.error(error); setNotice(`Gagal menyimpan ke Supabase: ${error.message}`); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [data, session?.user?.id, workspaceReady]);

  const availableMonths = useMemo(() => {
    const found = new Set(data.transactions.map((tx) => monthOf(tx.date)));
    found.add(period || monthOf(today()));
    if (data.opening.date) found.add(monthOf(data.opening.date));
    return [...found].filter(Boolean).sort().reverse();
  }, [data.transactions, data.opening.date, period]);
  const reportRequest = useMemo(() => JSON.stringify({ month: period, workspace: data }), [data, period]);

  useEffect(() => {
    const controller = new AbortController();
    setFinancialReport({ request: reportRequest, status: "loading", body: null, error: "" });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/reports`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: reportRequest,
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) {
          const detail = Array.isArray(result.detail)
            ? result.detail.map((item) => item.msg).join("; ")
            : result.detail;
          throw new Error(detail || `API laporan merespons ${response.status}.`);
        }
        setFinancialReport({ request: reportRequest, status: "ok", body: result, error: "" });
      } catch (error) {
        if (error.name !== "AbortError") {
          setFinancialReport({ request: reportRequest, status: "error", body: null, error: error.message });
        }
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [reportRequest, reportRetry]);

  const reportBody = financialReport.request === reportRequest ? financialReport.body : null;
  const report = financialReport.status === "ok" ? reportBody?.report : null;
  const trend = financialReport.status === "ok" ? reportBody?.trend || [] : [];
  const analysis = useMemo(() => report ? makeAnalysis(data, report) : null, [data, report]);
  const reasonerPayload = analysis ? JSON.stringify(toReasonerPayload(analysis)) : "";

  useEffect(() => {
    if (!["dashboard", "analysis"].includes(page)) return undefined;
    let cancelled = false;
    if (!report || !analysis) {
      setReasoner({ status: "idle", result: null, error: "Menunggu laporan dari backend." });
      return undefined;
    }
    if (!analysis.comparable) {
      setReasoner({ status: "idle", result: null, error: "Data dua bulan berurutan belum cukup untuk menjalankan aturan tren." });
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setReasoner({ status: "loading", result: null, error: "" });
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/analyze`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: reasonerPayload,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Reasoner merespons ${response.status}.`);
        if (!cancelled) setReasoner({ status: "ok", result, error: "" });
      } catch (error) {
        if (!cancelled) setReasoner({ status: "error", result: null, error: error.message });
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [page, period, analysis?.comparable, reasonerPayload, report]);

  useEffect(() => {
    document.title = `${TITLES[page]} — RuangUsaha`;
  }, [page]);

  const notify = useCallback((message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }, []);

  async function handleAuth(event) {
    event.preventDefault(); setAuthError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setAuthError(result.error.message);
    else if (authMode === "signup" && !result.data.session) setAuthError("Periksa email untuk mengonfirmasi akun sebelum masuk.");
  }

  if (!authReady || !workspaceReady) return <div className="app-loading">Memuat RuangUsaha…</div>;
  if (supabaseConfigured && !session) return <AuthPage mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} error={authError} />;
  if (!report || !analysis) {
    if (financialReport.status === "error" && financialReport.request === reportRequest) {
      return <main className="prototype-auth"><h1>Laporan belum dapat dimuat</h1><p>{financialReport.error}</p><button className="button button-primary" onClick={() => setReportRetry((value) => value + 1)}>Coba lagi</button></main>;
    }
    return <div className="app-loading">Menghitung laporan di backend…</div>;
  }

  const nav = [
    ["dashboard", "◫", "Ringkasan"], ["transactions", "↕", "Transaksi"],
    ["reports", "▤", "Laporan keuangan"], ["analysis", "✳", "Analisis KBR"],
    ["assets", "▧", "Aset usaha"], ["settings", "⚙", "Pengaturan usaha"],
  ];
  const renderPage = () => {
    if (page === "dashboard") return <Dashboard data={data} report={report} trend={trend} analysis={analysis} period={period} setPeriod={setPeriod} months={availableMonths} setPage={setPage} setShowForm={setShowForm} reasoner={reasoner} />;
    if (page === "transactions") return <Transactions data={data} setData={setData} period={period} setPeriod={setPeriod} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} setEditing={setEditing} setShowForm={setShowForm} notify={notify} />;
    if (page === "reports") return <Reports data={data} report={report} period={period} setPeriod={setPeriod} months={availableMonths} tab={reportTab} setTab={setReportTab} />;
    if (page === "analysis") return <Analysis analysis={analysis} period={period} setPeriod={setPeriod} months={availableMonths} reasoner={reasoner} />;
    if (page === "assets") return <Assets data={data} report={report} setPage={setPage} />;
    return <Settings data={data} setData={setData} notify={notify} onSignOut={supabaseConfigured ? () => supabase.auth.signOut() : null} />;
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage("dashboard"); }}><span className="brand-mark">R</span><span className="brand-copy"><strong>ruangusaha</strong><small>FINANCIAL HEALTH</small></span></a>
      <div className="business-switcher"><span className="business-avatar">KS</span><span className="business-info"><strong>{data.profile.businessName}</strong><small>{supabaseConfigured ? session.user.email : "Usaha aktif"}</small></span><span className="switch-chevron">⌄</span></div>
      <p className="nav-label">MENU UTAMA</p><nav className="main-nav" aria-label="Navigasi utama">{nav.slice(0,5).map(([key,icon,label])=><button key={key} className={`nav-item ${page===key?"active":""}`} onClick={()=>setPage(key)}><span className="nav-icon">{icon}</span>{label}{key==="analysis"&&<span className="nav-pill">BARU</span>}</button>)}</nav>
      <p className="nav-label nav-label-bottom">PREFERENSI</p><nav className="main-nav"><button className={`nav-item ${page==="settings"?"active":""}`} onClick={()=>setPage("settings")}><span className="nav-icon">⚙</span>Pengaturan usaha</button></nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-spark">✦</span><strong>Keuangan lebih jelas.</strong><p>Pahami bukan hanya hasilnya, tapi juga alasan di baliknya.</p><button onClick={()=>setPage("analysis")}>Lihat cara kerja <span>→</span></button></div><div className="profile-row"><span className="profile-avatar">AR</span><span><strong>{data.profile.ownerName}</strong><small>{session?.user?.email || "Pemilik usaha"}</small></span>{supabaseConfigured&&<button className="profile-more" aria-label="Keluar" onClick={()=>supabase.auth.signOut()}>↪</button>}</div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><span>RuangUsaha</span><span className="crumb-sep">/</span><strong>{TITLES[page]}</strong></div><div className="topbar-actions"><span className="local-badge"><i></i>{supabaseConfigured?"Database Supabase":"Data tersimpan di perangkat ini"}</span><button className="icon-button" title="Bantuan" onClick={()=>setPage("analysis")}>?</button><span className="top-avatar">AR</span></div></header>
      {!supabaseConfigured&&data.demo&&<div className="demo-notice"><span>ⓘ</span><span><strong>Mode data contoh.</strong> Angka adalah simulasi dan tersimpan di browser ini.</span><button aria-label="Tutup" onClick={()=>setData({...data,demo:false})}>×</button></div>}
      {notice&&<div className="notice-error" role="status">{notice}</div>}
      <div className="page-content">{renderPage()}</div>
      <footer className="app-footer"><span>RuangUsaha {new Date().getFullYear()} · Asisten keuangan untuk UMKM</span><span>Alat bantu keputusan, bukan pengganti saran akuntan.</span></footer>
    </main>
    {showForm&&<TransactionModal initial={editing} onClose={()=>{setShowForm(false);setEditing(null);}} onSave={(tx)=>{setData((old)=>({...old,demo:false,transactions:old.transactions.some((item)=>item.id===tx.id)?old.transactions.map((item)=>item.id===tx.id?tx:item):[...old.transactions,tx]}));setPeriod(monthOf(tx.date));setShowForm(false);setEditing(null);notify("Transaksi berhasil disimpan.");}} />}
  </div>;
}

function makeAnalysis(data,report) {
  const prev=report.previous, comparable=Boolean(prev&&prev.revenue>0&&report.revenue>0), revenueGrowth=comparable?(report.revenue-prev.revenue)/prev.revenue:null;
  const cogsGrowth=comparable&&prev.cogs>0?(report.cogs-prev.cogs)/prev.cogs:null;
  const findings=[];
  if(comparable&&cogsGrowth!==null&&revenueGrowth!==null&&cogsGrowth>revenueGrowth) {
    findings.push({id:"cost",severity:"Perlu diperiksa",title:"Biaya bahan tumbuh lebih cepat dari pendapatan",summary:"Porsi biaya bahan terhadap penjualan naik. Ini indikasi awal, bukan bukti bahwa biaya pasti tidak wajar.",evidence:[["Pertumbuhan pendapatan",percent(revenueGrowth*100)],["Pertumbuhan COGS",percent(cogsGrowth*100)],["COGS Ratio",`${(report.cogsRatio*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`]],chain:["Pendapatan dibandingkan","COGS tumbuh lebih cepat","COGS Ratio naik","Periksa bahan baku & harga jual"],advice:"Bandingkan harga supplier dan pemakaian bahan, lalu tinjau harga jual. Periksa product mix sebelum menyimpulkan penyebab margin."});
    if(prev.grossMargin!==null&&report.grossMargin!==null&&report.grossMargin<prev.grossMargin)findings.push({id:"margin",severity:"Perlu diperiksa",title:"Margin kotor menurun",summary:"Gross margin periode ini lebih rendah dari bulan sebelumnya, bersamaan dengan kenaikan relatif COGS.",evidence:[["Gross margin bulan lalu",`${(prev.grossMargin*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`],["Gross margin periode ini",`${(report.grossMargin*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`]],chain:["COGS tumbuh lebih cepat","Biaya bahan menyerap lebih banyak penjualan","Gross margin turun","Periksa bahan & harga jual"],advice:"Periksa harga bahan baku, pemakaian atau waste, product mix, dan harga jual. Data persediaan belum digunakan."});
  }
  for(const [key,label,current,prior] of [["opex","Beban operasional",report.opex,prev?.opex],["marketing","Biaya pemasaran",report.marketing,prev?.marketing]]) {
    if(comparable&&prior>0&&current/prior-1>revenueGrowth)findings.push({id:key,severity:"Pantau",title:`${label} tumbuh lebih cepat dari pendapatan`,summary:"Rasio pengeluaran terhadap pendapatan berpotensi meningkat. Kenaikan belum otomatis berarti pemborosan.",evidence:[["Pertumbuhan pendapatan",percent(revenueGrowth*100)],[`Pertumbuhan ${label.toLowerCase()}`,percent((current/prior-1)*100)]],chain:["Bandingkan bulan sebelumnya",`${label} tumbuh lebih cepat`,"Rasio biaya berpotensi naik","Periksa rincian biaya"],advice:"Tinjau rincian biaya dan hubungkan pengeluaran dengan aktivitas atau hasil usaha terkait."});
  }
  if(comparable&&prev.netMargin!==null&&report.netMargin!==null&&report.netMargin<prev.netMargin)findings.push({id:"profit",severity:"Pantau",title:"Margin laba bersih menurun",summary:"Porsi laba bersih dari pendapatan turun dibanding bulan sebelumnya.",evidence:[["Net margin bulan lalu",`${(prev.netMargin*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`],["Net margin periode ini",`${(report.netMargin*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`]],chain:["Bandingkan net margin","Net margin turun","Telusuri pendapatan & beban","Pantau periode berikutnya"],advice:"Telusuri perubahan COGS, OPEX, marketing, dan penyusutan; pastikan kategori transaksi benar."});
  if(report.changeCash<0)findings.push({id:"cash",severity:"Perlu diperiksa",title:report.netProfit>0?"Laba positif, tetapi kas berkurang":"Saldo kas berkurang",summary:"Laba dan kas menjawab pertanyaan berbeda. Investasi, prive, dan pembayaran pokok pinjaman dapat mengurangi kas.",evidence:[["Laba bersih tercatat",money(report.netProfit,true)],["Perubahan kas",money(report.changeCash,true)],["Arus kas investasi",money(report.investingCashFlow,true)],["Arus kas pendanaan",money(report.financingCashFlow,true)]],chain:["Hitung kas masuk & keluar","Pisahkan operasi, investasi, pendanaan","Laba berbeda dari perubahan kas","Periksa transaksi penyebab"],advice:"Cek arus kas investasi, setoran/prive, dan pembayaran pokok. Laba ini berdasarkan transaksi yang dicatat, bukan laporan akrual lengkap."});
  const reasons=[];
  if(!comparable)reasons.push("Data pendapatan dua bulan berurutan belum cukup untuk membandingkan tren.");
  if(!report.revenue)reasons.push("Belum ada pendapatan tercatat; margin tidak dapat dihitung.");
  if(!data.opening.confirmed)reasons.push("Saldo awal belum dikonfirmasi; posisi kas dan neraca mungkin belum akurat.");
  if(!findings.length&&!reasons.length)reasons.push("Tidak ada aturan perhatian yang terpenuhi. Ini bukan jaminan semua aspek keuangan sehat.");
  return {report,findings,reasons,comparable,revenueGrowth,cogsGrowth};
}
function toReasonerPayload(analysis) {
  const {report,comparable,revenueGrowth,cogsGrowth}=analysis;
  const numbers={hasNetProfit:report.netProfit,hasChangeInCash:report.changeCash,hasOperatingCashFlow:report.operatingCashFlow};
  const movements=[];
  if(comparable&&report.previous) {
    const prev=report.previous;
    numbers.hasRevenueGrowth=revenueGrowth;
    if(cogsGrowth!==null)numbers.hasCOGSGrowth=cogsGrowth;
    numbers.hasOPEXGrowth=prev.opex?(report.opex-prev.opex)/prev.opex:0;
    numbers.hasMarketingGrowth=prev.marketing?(report.marketing-prev.marketing)/prev.marketing:0;
    if(report.grossMargin!==null&&prev.grossMargin!==null){numbers.hasGrossMargin=report.grossMargin;numbers.hasGrossMarginLowerBound=prev.grossMargin;}
    if(report.netMargin!==null&&prev.netMargin!==null){numbers.hasNetMargin=report.netMargin;numbers.hasNetMarginLowerBound=prev.netMargin;}
    const priorRows=report.previous.rows||[];
    numbers.hasOwnerDrawAmount=amountFor(report.rows,(tx)=>tx.kind==="draw");
    numbers.hasPreviousOwnerDrawAmount=amountFor(priorRows,(tx)=>tx.kind==="draw");
    const candidates=[["COGS",report.cogs,prev.cogs],["OPEX",report.opex,prev.opex],["Marketing",report.marketing,prev.marketing]].filter((item)=>item[2]>0);
    let top=-1;
    candidates.forEach((item,index)=>{if(top<0||item[1]-item[2]>candidates[top][1]-candidates[top][2])top=index;});
    candidates.forEach((item,index)=>movements.push({name:item[0],growth:(item[1]-item[2])/item[2],is_top:index===top&&item[1]>item[2]}));
  }
  return {numbers,movements};
}

function PageHeading({eyebrow,title,subtitle,actions}) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div><div className="heading-actions">{actions}</div></div>; }
function MonthPicker({value,onChange,months}) { return <select className="period-select" aria-label="Pilih periode" value={value} onChange={(event)=>onChange(event.target.value)}>{months.map((month)=><option key={month} value={month}>{monthLabel(month)}</option>)}</select>; }
function Stats({report,analysis}) {
  const prev=report.previous;
  const cards=[["Pendapatan",money(report.revenue,true),"↗",prev?.revenue?percent((report.revenue-prev.revenue)/prev.revenue*100):"Total pendapatan tercatat"],["Laba bersih*",money(report.netProfit,true),"◉","Pendapatan − biaya − penyusutan"],["Saldo kas & bank",money(report.cash+report.bank,true),"▣",`Perubahan kas ${money(report.changeCash,true)}`],["Gross margin",report.grossMargin===null?"—":`${(report.grossMargin*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`,"◌",`COGS ${money(report.cogs,true)}`]];
  return <section className="stats-grid">{cards.map(([label,value,icon,foot])=><article className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot"><span className={`delta ${label==="Saldo kas & bank"?(report.changeCash>=0?"positive":"negative"):"neutral"}`}>{label==="Saldo kas & bank"?(report.changeCash>=0?"Naik":"Turun"):""}</span>{foot}</div></article>)}</section>;
}
function ReasonerStatus({reasoner}) {
  if(reasoner.status==="loading")return <div className="reasoner-pill">Mengirim fakta ke knowledge base OWL/Pellet…</div>;
  if(reasoner.status==="ok") {
    const visible=reasoner.result.inferred.filter((name)=>["CostEscalation","MarginPressure","OPEXPressure","MarketingEfficiencyReview","ProfitPressure","ProfitCashGap","LiquidityPressure","OwnerDrawLiquidityPressure","LiquidityCritical"].includes(name));
    return <div className="reasoner-pill"><strong>{reasoner.result.engine} aktif</strong> · {reasoner.result.java} · {visible.length?visible.join(", "):"belum ada kelas temuan"} · {reasoner.result.elapsed_ms} ms</div>;
  }
  return <div className={`reasoner-pill ${reasoner.status==="error"?"error":""}`}>{reasoner.status==="error"?`Reasoner OWL error: ${reasoner.error}`:reasoner.error||"Reasoner menunggu data pembanding."}</div>;
}
function Dashboard({data,report,trend,analysis,period,setPeriod,months,setPage,setShowForm,reasoner}) {
  const max=Math.max(1,...trend.map((item)=>item.revenue));
  const latest=analysis.findings[0];
  return <><PageHeading eyebrow="RINGKASAN USAHA" title={`Halo, ${data.profile.ownerName} 👋`} subtitle={`Berikut gambaran keuangan ${data.profile.businessName} untuk ${monthLabel(period)}.`} actions={<><MonthPicker value={period} onChange={setPeriod} months={months}/><button className="button button-primary" onClick={()=>setShowForm(true)}>＋ Catat transaksi</button></>}/>
    <Stats report={report} analysis={analysis}/><div className="report-note report-data-note">* Laba dihitung dari transaksi yang dicatat dan estimasi penyusutan. Laporan akrual bisa memerlukan data persediaan, piutang, atau utang.</div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Tren keuangan</h2><p className="panel-caption">Pendapatan dibandingkan biaya utama yang dicatat</p></div><button className="panel-link" onClick={()=>setPage("reports")}>Lihat laporan →</button></div><div className="chart-legend"><span><i className="legend-dot"/>Pendapatan</span><span><i className="legend-dot orange"/>COGS</span><span><i className="legend-dot gray"/>Laba</span></div><div className="trend-chart">{trend.map(({month,revenue,cogs,netProfit})=><div className="trend-month" key={month}><div className="bars"><i className="bar" style={{height:`${Math.max(2,revenue/max*100)}%`}}/><i className="bar expense" style={{height:`${Math.max(2,cogs/max*100)}%`}}/><i className="bar profit" style={{height:`${Math.max(2,Math.max(0,netProfit)/max*100)}%`}}/></div><span className="month-label">{MONTHS[Number(month.slice(5,7))-1].slice(0,3)}</span></div>)}</div></section>
      <section className="health-card health-warning"><div className="health-label"><i/>STATUS PERIODE INI</div><h2 className="health-title">{analysis.findings.length?"Ada yang perlu ditinjau":"Data masih terbatas"}</h2><p className="health-copy">{analysis.findings.length?`${analysis.findings.length} indikasi ditemukan. Buka bukti dan alur penalaran sebelum mengambil tindakan.`:analysis.reasons.join(" ")}</p><button className="health-link" onClick={()=>setPage("analysis")}>Buka analisis KBR →</button><ReasonerStatus reasoner={reasoner}/></section></div>
    <div className="lower-grid"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Transaksi terbaru</h2><p className="panel-caption">{report.rows.length} transaksi pada periode ini</p></div><button className="panel-link" onClick={()=>setPage("transactions")}>Semua transaksi →</button></div>{[...report.rows].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4).map((tx)=><MiniTransaction key={tx.id} tx={tx}/>)}{!report.rows.length&&<div className="empty-state"><strong>Belum ada transaksi</strong>Mulai catat transaksi untuk melihat ringkasan.</div>}</section><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Dari sistem KBR</h2><p className="panel-caption">Bukti → aturan → hal yang perlu diperiksa</p></div></div><ReasonerStatus reasoner={reasoner}/>{latest?<div className="reasoning-teaser"><h3>{latest.title}</h3>{latest.chain.slice(0,3).map((step,index)=><div className="reasoning-line" key={step}><span className="step-dot">{index+1}</span>{step}</div>)}<button className="panel-link" onClick={()=>setPage("analysis")}>Telusuri reasoning →</button></div>:<div className="reasoning-teaser"><h3>Belum ada diagnosis</h3><p>Lengkapi data periode ini dan bulan pembanding.</p></div>}</section></div>
  </>;
}
function MiniTransaction({tx}) { const positive=cashDelta(tx)>0;return <div className="mini-row"><span className={`mini-symbol ${positive?"":"out"}`}>{positive?"↗":"↙"}</span><span className="mini-copy"><strong>{tx.description}</strong><small>{tx.category} · {dateLabel(tx.date)}</small></span><span className={`mini-amount ${positive?"in":"out"}`}>{positive?"+":"−"}{money(tx.amount,true)}</span></div>; }
function Transactions({data,setData,period,setPeriod,search,setSearch,filter,setFilter,setEditing,setShowForm,notify}) {
  const filtered=[...data.transactions].filter((tx)=>monthOf(tx.date)===period&&(filter==="all"||tx.kind===filter)&&`${tx.description} ${tx.category}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date));
  function remove(tx) { if(!window.confirm(`Hapus transaksi "${tx.description}"?`))return;setData((old)=>({...old,transactions:old.transactions.filter((item)=>item.id!==tx.id),assets:tx.assetId?old.assets.filter((asset)=>asset.id!==tx.assetId):old.assets}));notify("Transaksi dihapus."); }
  function exportCsv() { const records=[["Tanggal","Nama transaksi","Jenis","Kategori","Akun","Nominal"],...data.transactions.map((tx)=>[tx.date,tx.description,KIND_NAMES[tx.kind],tx.category,tx.account==="bank"?"Rekening bank":"Kas",tx.amount])];const content=`\uFEFF${records.map((row)=>row.map((value)=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\r\n")}`;const url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="transaksi-ruangusaha.csv";link.click();URL.revokeObjectURL(url); }
  return <><PageHeading eyebrow="CATATAN USAHA" title="Semua transaksi" subtitle="Pemasukan, pengeluaran, modal, dan pergerakan kas tercatat di sini." actions={<><button className="button button-secondary" onClick={exportCsv}>↓ Ekspor CSV</button><button className="button button-primary" onClick={()=>{setEditing(null);setShowForm(true);}}>＋ Tambah transaksi</button></>}/><section className="panel"><div className="filter-row"><label className="input-control search-field"><span>⌕</span><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Cari transaksi atau kategori"/></label><MonthPicker value={period} onChange={setPeriod} months={[...new Set([...data.transactions.map((tx)=>monthOf(tx.date)),period])].sort().reverse()}/><select className="input-control" value={filter} onChange={(event)=>setFilter(event.target.value)}><option value="all">Semua jenis</option><option value="revenue">Pendapatan</option><option value="expense">Pengeluaran</option><option value="capital">Setoran modal</option><option value="loan">Pinjaman masuk</option><option value="draw">Prive</option></select></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>TANGGAL</th><th>TRANSAKSI</th><th>KATEGORI</th><th>AKUN</th><th style={{textAlign:"right"}}>NOMINAL</th><th/></tr></thead><tbody>{filtered.length?filtered.map((tx)=><tr key={tx.id}><td>{dateLabel(tx.date)}</td><td><strong>{tx.description}</strong></td><td><span className="category-badge">{tx.category}</span></td><td>{tx.account==="bank"?"Rekening bank":"Kas"}</td><td className={`table-amount ${cashDelta(tx)>0?"in":""}`}>{cashDelta(tx)>0?"+":"−"}{money(tx.amount)}</td><td className="table-actions"><button onClick={()=>{setEditing(tx);setShowForm(true);}}>Ubah</button><button onClick={()=>remove(tx)}>Hapus</button></td></tr>):<tr><td colSpan="6"><div className="empty-state"><strong>Belum ada transaksi</strong>Ubah filter atau tambahkan transaksi.</div></td></tr>}</tbody></table></div><div className="report-note">Modal dan pinjaman bukan pendapatan; prive dan pokok pinjaman bukan beban laba rugi.</div></section></>;
}
function Reports({data,report,period,setPeriod,months,tab,setTab}) {
  const tabs=[["profit","Laba rugi"],["cash","Arus kas"],["balance","Neraca"]];
  return <><PageHeading eyebrow="LAPORAN KEUANGAN" title="Angka yang saling terhubung" subtitle="Laporan disusun dari transaksi, saldo awal, dan aset yang kamu catat." actions={<MonthPicker value={period} onChange={setPeriod} months={months}/>}/><div className="report-tabs">{tabs.map(([key,label])=><button key={key} className={`report-tab ${tab===key?"active":""}`} onClick={()=>setTab(key)}>{label}</button>)}</div><div className="report-layout section-gap"><div className="report-card">{tab==="profit"?<IncomeReport report={report}/>:tab==="cash"?<CashReport report={report}/>:<BalanceReport data={data} report={report}/>}</div><aside className="report-card-side"><SideMetric label="Kas + rekening akhir periode" value={money(report.cash+report.bank,true)} text="Uang tersedia bukan ukuran laba."/><SideMetric label="Laba bersih tercatat" value={money(report.netProfit,true)} text="Modal, prive, aset, dan pembayaran pokok dipisahkan dari laba."/><SideMetric label="Perubahan kas periode ini" value={money(report.changeCash,true)} text="Termasuk arus operasi, investasi, dan pendanaan."/></aside></div></>;
}
function SideMetric({label,value,text}) { return <div className="report-side-item"><small>{label}</small><strong>{value}</strong><p>{text}</p></div>; }
function IncomeReport({report:r}) { return <><span className="eyebrow">KINERJA USAHA</span><h2 style={{marginTop:5}}>Laporan laba rugi</h2><p className="panel-caption">{monthLabel(r.month)} · transaksi tercatat</p><table className="report-table"><tbody><ReportRow label="Pendapatan" value={r.revenue} subtotal/><ReportRow label="− COGS / HPP" value={r.cogs} indent/><ReportRow label="Laba kotor" value={r.grossProfit} total/><ReportRow label="− OPEX" value={r.opex} indent/><ReportRow label="− Marketing (bagian beban operasional)" value={r.marketing} indent/><ReportRow label="− Penyusutan aset" value={r.depreciation} indent/><ReportRow label="Laba operasional" value={r.operatingProfit} subtotal/><ReportRow label="+ Pendapatan non-operasional" value={r.nonOperatingIncome} indent/><ReportRow label="− Beban non-operasional" value={r.nonOperatingExpense} indent/><ReportRow label="Laba bersih tercatat" value={r.netProfit} total/><tr><td>Gross margin</td><td>{r.grossMargin===null?"Belum dapat dihitung":`${(r.grossMargin*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`}</td></tr><tr><td>COGS Ratio</td><td>{r.cogsRatio===null?"Belum dapat dihitung":`${(r.cogsRatio*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%`}</td></tr></tbody></table><div className="report-note warning">HPP akrual yang akurat dapat memerlukan data persediaan, pembelian kredit, serta barang yang benar-benar terjual.</div></>; }
function ReportRow({label,value,indent,subtotal,total}) { return <tr className={`${indent?"indent":""} ${subtotal?"subtotal":""} ${total?"total":""}`}><td>{label}</td><td>{money(value)}</td></tr>; }
function CashReport({report:r}) { return <><span className="eyebrow">PERGERAKAN UANG</span><h2 style={{marginTop:5}}>Laporan arus kas</h2><p className="panel-caption">{monthLabel(r.month)} · transaksi kas tercatat</p><table className="report-table"><tbody><ReportRow label="Kas awal periode*" value={r.cashOpening}/><ReportRow label="Arus kas operasi" value={r.operatingCashFlow}/><ReportRow label="Arus kas investasi" value={r.investingCashFlow}/><ReportRow label="Arus kas pendanaan" value={r.financingCashFlow}/><ReportRow label="Perubahan kas" value={r.changeCash} total/><ReportRow label="Kas akhir periode*" value={r.cashClosing} subtotal/></tbody></table><div className="report-note">* Saldo kas awal/akhir berasal dari saldo awal. Transfer antarakun belum didukung.</div></>; }
function BalanceReport({data,report:r}) { return <><span className="eyebrow">POSISI KEUANGAN</span><h2 style={{marginTop:5}}>Neraca sederhana</h2><p className="panel-caption">Per {dateLabel(endOfMonth(r.month))} · bergantung pada saldo awal</p><table className="report-table"><tbody><tr className="subtotal"><td>ASET</td><td/></tr><ReportRow label="Kas" value={r.cash} indent/><ReportRow label="Rekening bank" value={r.bank} indent/><ReportRow label="Aset tetap bersih" value={r.fixedAssets} indent/><ReportRow label="Total aset" value={r.assetsTotal} total/><tr className="subtotal"><td>LIABILITAS</td><td/></tr><ReportRow label="Utang / pinjaman tercatat" value={r.liabilities} indent/><tr className="subtotal"><td>EKUITAS</td><td/></tr><ReportRow label="Modal awal & setoran modal" value={data.opening.equity+amountFor(r.rows,(tx)=>tx.kind==="capital")} indent/><ReportRow label="Laba tercatat setelah prive" value={r.equity-data.opening.equity-amountFor(r.rows,(tx)=>tx.kind==="capital")} indent/><ReportRow label="Total liabilitas & ekuitas" value={r.liabilities+r.equity} total/></tbody></table><div className={`report-note ${!data.opening.confirmed?"warning":Math.abs(r.balanceDifference)>1?"error":""}`}>{data.opening.confirmed?`Selisih neraca: ${money(r.balanceDifference)}. ${Math.abs(r.balanceDifference)>1?"Periksa saldo awal, aset, utang, atau transaksi.":"Aset = liabilitas + ekuitas berdasarkan data yang dimasukkan."}`:"Saldo awal belum dikonfirmasi. Neraca belum dapat dianggap lengkap; isi kas, aset, utang, dan ekuitas awal."}</div></>; }
function Analysis({analysis,period,setPeriod,months,reasoner}) {
  const severity=analysis.findings.length?"warning":"";
  return <><PageHeading eyebrow="KNOWLEDGE-BASED REASONING" title="Bukan cuma lampu merah atau hijau" subtitle="Setiap indikasi menampilkan evidence, aturan, urutan inferensi, dan bagian yang dapat diperiksa." actions={<MonthPicker value={period} onChange={setPeriod} months={months}/>}/><div className={`analysis-summary ${severity}`}><span className="summary-check">{analysis.findings.length?"!":"✓"}</span><div><strong>{analysis.findings.length?`${analysis.findings.length} indikasi untuk ditinjau`:"Belum ada indikasi dari aturan yang tersedia"}</strong><p>{analysis.reasons.join(" ")||"Hasil mengikuti data dan aturan untuk periode ini; bukan penilaian menyeluruh atas kesehatan usaha."}</p></div></div><ReasonerStatus reasoner={reasoner}/><div className="diagnosis-list">{analysis.findings.map((finding)=><article className="diagnosis-card" key={finding.id}><div className="diagnosis-head"><div><span className="eyebrow">DIAGNOSIS · {monthLabel(period).toUpperCase()}</span><h3 style={{marginTop:6}}>{finding.title}</h3></div><span className="severity-badge">{finding.severity}</span></div><p>{finding.summary}</p><div className="evidence-grid">{finding.evidence.map(([label,value])=><div className="evidence-item" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="reasoning-chain">{finding.chain.map((step,index)=><span key={`${finding.id}-${step}`} style={{display:"contents"}}>{index>0&&<span className="reason-arrow">→</span>}<span className={`reason-node ${index<finding.chain.length-1?"active":""}`}>{step}</span></span>)}</div><div className="advisory-box"><strong>Yang bisa diperiksa:</strong> {finding.advice}</div></article>)}</div><div className="why-not"><strong>WHY-NOT · Mengapa kondisi lain tidak disimpulkan?</strong>{analysis.comparable?"Sistem tidak menyimpulkan masalah biaya bila perubahan relatifnya tidak memenuhi aturan pembanding.":analysis.reasons.join(" ")}<br/>Aturan tidak mengisi data yang tidak diketahui dengan asumsi.</div><div className="report-note section-gap">Analisis menggunakan bulan sebelumnya dan transaksi yang dicatat. Persediaan, piutang, dan utang usaha belum dimodelkan. Hasil adalah indikasi untuk ditinjau, bukan kesimpulan profesional.</div></>;
}
function Assets({data,report,setPage}) { return <><PageHeading eyebrow="PENGELOLAAN ASET" title="Aset usaha" subtitle="Pembelian aset dicatat sebagai investasi; penyusutan menjadi beban berkala." actions={<button className="button button-primary" onClick={()=>setPage("settings")}>＋ Catat aset lewat transaksi</button>}/><div className="asset-grid">{data.assets.map((asset)=><article className="asset-card" key={asset.id}><div className="asset-top"><span className="asset-symbol">▧</span><span className="asset-status">Aktif</span></div><h3>{asset.name}</h3><div className="asset-value">{money(asset.cost,true)}</div><p>Nilai perolehan · umur manfaat {asset.lifeMonths} bulan</p><div className="asset-meta"><span>Penyusutan per bulan</span><strong>{money((asset.cost-asset.residual)/asset.lifeMonths,true)}</strong></div><div className="asset-meta"><span>Mulai digunakan</span><span>{dateLabel(asset.startDate)}</span></div></article>)}{!data.assets.length&&<div className="panel"><div className="empty-state"><strong>Belum ada aset terdaftar</strong>Catat transaksi pembelian aset untuk mulai menghitung penyusutan.</div></div>}</div><div className="report-note section-gap">Penyusutan bulan ini {money(report.depreciation)} menggunakan metode garis lurus. Konfirmasikan umur manfaat dan nilai residu.</div></>; }
function Settings({data,setData,notify,onSignOut}) {
  function submitProfile(event){event.preventDefault();const form=new FormData(event.currentTarget);setData((old)=>({...old,profile:{businessName:String(form.get("businessName")).trim(),ownerName:String(form.get("ownerName")).trim(),businessType:String(form.get("businessType")).trim()}}));notify("Profil tersimpan.");}
  function submitOpening(event){event.preventDefault();const form=new FormData(event.currentTarget);const values=["cash","bank","fixedAssets","liabilities","equity"].map((key)=>Number(form.get(key)));if(values.some((value)=>!Number.isSafeInteger(value)||value<0)){notify("Saldo harus berupa bilangan bulat rupiah nol atau lebih.");return;}setData((old)=>({...old,opening:{date:String(form.get("date")),cash:Number(form.get("cash")),bank:Number(form.get("bank")),fixedAssets:Number(form.get("fixedAssets")),liabilities:Number(form.get("liabilities")),equity:Number(form.get("equity")),confirmed:form.get("confirmed")==="on"}}));notify("Saldo awal tersimpan.");}
  const implied=data.opening.cash+data.opening.bank+data.opening.fixedAssets-data.opening.liabilities;
  return <><PageHeading eyebrow="PROFIL & SALDO AWAL" title="Pengaturan usaha" subtitle="Saldo awal menjadi titik awal laporan. Modal tidak dihitung sebagai pendapatan." actions={onSignOut?<button className="button button-secondary" onClick={onSignOut}>Keluar</button>:<button className="button button-secondary" onClick={()=>{if(window.confirm("Reset semua data contoh?"))setData(sampleData());}}>Muat data contoh</button>}/><div className="settings-layout"><div className="panel"><h2 className="panel-title">Profil usaha</h2><form className="settings-form" onSubmit={submitProfile}><label className="field field-wide"><span>Nama usaha</span><input name="businessName" defaultValue={data.profile.businessName} required/></label><label className="field"><span>Nama pemilik</span><input name="ownerName" defaultValue={data.profile.ownerName} required/></label><label className="field"><span>Jenis usaha</span><input name="businessType" defaultValue={data.profile.businessType}/></label><button className="button button-primary settings-save">Simpan profil</button></form><h2 className="panel-title section-gap">Saldo awal</h2><form className="settings-form" onSubmit={submitOpening}><label className="field"><span>Tanggal saldo awal</span><input type="date" name="date" defaultValue={data.opening.date} required/></label>{["cash","bank","fixedAssets","liabilities","equity"].map((key)=><label className="field" key={key}><span>{{cash:"Kas awal (Rp)",bank:"Rekening bank awal (Rp)",fixedAssets:"Aset tetap awal (Rp)",liabilities:"Utang awal (Rp)",equity:"Ekuitas / modal awal (Rp)"}[key]}</span><input name={key} type="number" min="0" step="1" defaultValue={data.opening[key]} required/></label>)}<label className="field field-wide"><span><input name="confirmed" type="checkbox" defaultChecked={data.opening.confirmed}/> Saya sudah memeriksa saldo awal ini</span></label><div className="report-note field-wide">Ekuitas tersirat: <strong>{money(implied)}</strong> (hanya pembanding).</div><button className="button button-primary settings-save">Simpan saldo awal</button></form></div><aside className="report-card-side"><div className="report-card"><h2 className="panel-title">Kas ≠ laba ≠ modal</h2><p className="panel-caption" style={{lineHeight:1.8}}>Setoran modal menambah kas dan ekuitas, bukan pendapatan. Laba dihitung dari pendapatan dikurangi biaya serta penyusutan. Kas berubah juga karena investasi, pinjaman, dan prive.</p></div><div className="settings-note"><strong>Laporan tergantung data.</strong><br/>Neraca memerlukan saldo awal aset, utang, dan ekuitas. Laba akrual dapat memerlukan informasi persediaan, piutang, serta utang.</div></aside></div></>;
}
function TransactionModal({initial,onClose,onSave}) {
  const [kind,setKind]=useState(initial?.kind||"revenue");
  const [error,setError]=useState("");
  function submit(event){event.preventDefault();const form=new FormData(event.currentTarget);const amount=Number(form.get("amount"));if(!Number.isSafeInteger(amount)||amount<=0){setError("Nominal harus berupa bilangan bulat rupiah yang lebih besar dari nol.");return;}onSave({id:initial?.id||id(),date:String(form.get("date")),description:String(form.get("description")).trim(),kind,category:String(form.get("category")),amount,account:String(form.get("account")),note:String(form.get("note")||"").trim()});}
  const hint={revenue:"Pendapatan menambah kas dan pendapatan. Setoran modal bukan pendapatan.",expense:"Pengeluaran masuk ke laporan laba rugi sesuai kategori.",capital:"Modal menambah kas dan ekuitas, bukan pendapatan atau laba.",loan:"Pinjaman menambah kas dan utang, bukan pendapatan usaha.",draw:"Prive mengurangi kas dan ekuitas, bukan beban operasional.",principal:"Pokok pinjaman mengurangi kas dan utang, bukan beban laba rugi."};
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><section className="modal-box" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal-heading"><div><span className="eyebrow">CATAT KEUANGAN</span><h2 id="transaction-title">{initial?"Ubah transaksi":"Tambah transaksi"}</h2></div><button className="modal-close" onClick={onClose} aria-label="Tutup">×</button></div><form onSubmit={submit}><div className="form-grid"><label className="field field-wide"><span>Jenis transaksi</span><select value={kind} onChange={(event)=>setKind(event.target.value)}>{Object.entries(KIND_NAMES).filter(([key])=>key!=="asset").map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="field field-wide"><span>Nama transaksi</span><input name="description" defaultValue={initial?.description} required maxLength="90" placeholder="Contoh: Penjualan harian"/></label><label className="field"><span>Kategori</span><select name="category" defaultValue={initial?.category||CATEGORIES[kind][0]}>{CATEGORIES[kind].map((item)=><option key={item}>{item}</option>)}</select></label><label className="field"><span>Nominal (Rp)</span><input name="amount" type="number" min="1" step="1" defaultValue={initial?.amount} required/></label><label className="field"><span>Tanggal</span><input name="date" type="date" defaultValue={initial?.date||today()} required/></label><label className="field"><span>Akun</span><select name="account" defaultValue={initial?.account||"cash"}><option value="cash">Kas</option><option value="bank">Rekening bank</option></select></label><label className="field field-wide"><span>Catatan (opsional)</span><textarea name="note" rows="2" defaultValue={initial?.note}/></label></div><div className="form-hint">{hint[kind]}</div>{error&&<div className="notice-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Batal</button><button className="button button-primary">Simpan transaksi</button></div></form></section></div>;
}
function AuthPage({mode,setMode,onSubmit,error}) {
  return <main className="prototype-auth"><span className="brand-mark">R</span><h1>{mode==="signup"?"Buat akun RuangUsaha":"Masuk ke RuangUsaha"}</h1><p>Data keuangan kamu disimpan di workspace yang dilindungi Supabase.</p><form onSubmit={onSubmit}><label className="field"><span>Email</span><input type="email" name="email" autoComplete="email" required/></label><label className="field"><span>Kata sandi</span><input type="password" name="password" minLength="8" autoComplete={mode==="signup"?"new-password":"current-password"} required/></label>{error&&<div className="notice-error">{error}</div>}<button className="button button-primary" style={{width:"100%",marginTop:14}}>{mode==="signup"?"Daftar":"Masuk"}</button></form><p style={{marginTop:15}}>{mode==="signup"?"Sudah punya akun?":"Belum punya akun?"} <button className="panel-link" onClick={()=>setMode(mode==="signup"?"login":"signup")}>{mode==="signup"?"Masuk":"Daftar"}</button></p></main>;
}

export default App;
