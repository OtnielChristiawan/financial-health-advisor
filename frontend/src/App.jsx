import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase";

const STORAGE_KEY = "ruangusaha-financial-v1";
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const TITLES = { dashboard: "Ringkasan", transactions: "Transaksi", reports: "Laporan keuangan", analysis: "Analisis KBR", assets: "Aset usaha", settings: "Pengaturan usaha" };
const CATEGORIES = {
    revenue: ["Penjualan", "Pendapatan jasa", "Pendapatan usaha lainnya", "Pendapatan non-operasional"],
    expense: [
        "COGS / HPP",
        "Beban Pegawai (HR/Payroll)",
        "Beban Utilitas & Tempat",
        "Beban Operasional & Umum",
        "Beban Pemasaran (Marketing/Selling)",
        "Beban Pemeliharaan",
        "Beban non-operasional",
    ],
    capital: ["Setoran modal pemilik"], loan: ["Penerimaan pinjaman"],
    draw: ["Prive / pengambilan pribadi"], principal: ["Pembayaran pokok pinjaman"],
    transfer: ["Perpindahan saldo"],
    asset: ["Aset tetap"],
};
const KIND_NAMES = { revenue: "Pendapatan", expense: "Pengeluaran", capital: "Setoran modal", loan: "Pinjaman masuk", draw: "Prive", principal: "Bayar pokok pinjaman", transfer: "Perpindahan saldo", asset: "Pembelian aset" };
const TRANSACTION_VIEWS = [
    ["income-expense", "Pendapatan & penjualan"],
    ["capital", "Setoran modal"],
    ["loan", "Pinjaman masuk"],
    ["draw", "Prive"],
    ["transfer", "Pemindahan saldo"],
    ["principal", "Pembayaran pokok pinjaman"],
    ["asset", "Pembelian aset"],
];

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
const cashDelta = (tx) => tx.kind === "transfer" ? 0 : ["revenue", "capital", "loan"].includes(tx.kind) ? tx.amount : -tx.amount;
const accountLabel = (account) => account === "bank" ? "Rekening" : "Cash";
const amountFor = (rows, predicate) => rows.reduce((total, row) => total + (predicate(row) ? Number(row.amount) : 0), 0);
function sampleData() {
    const transactions = [];
    const add = (date, description, kind, category, amount, account = "cash") => transactions.push({ id: id(), date, description, kind, category, amount, account, note: "" });
    add("2026-08-03", "Penjualan Agustus", "revenue", "Penjualan", 90_000_000);
    add("2026-08-05", "Pembelian bahan baku (biji kopi & susu)", "expense", "COGS / HPP", 38_000_000);
    add("2026-08-08", "Gaji barista & kitchen", "expense", "Beban Pegawai (HR/Payroll)", 18_000_000);
    add("2026-08-10", "Sewa ruko & tagihan listrik/air", "expense", "Beban Utilitas & Tempat", 7_000_000);
    add("2026-08-12", "Cup, sedotan, plastik & ATK", "expense", "Beban Operasional & Umum", 3_500_000);
    add("2026-08-14", "Servis grinder & filter air", "expense", "Beban Pemeliharaan", 1_500_000);
    add("2026-08-15", "Iklan IG & potongan MDR QRIS", "expense", "Beban Pemasaran (Marketing/Selling)", 4_000_000);
    add("2026-08-25", "Pengambilan pemilik", "draw", CATEGORIES.draw[0], 3_000_000);
    add("2026-08-27", "Pembayaran pokok pinjaman", "principal", CATEGORIES.principal[0], 2_000_000);
    add("2026-09-03", "Penjualan September", "revenue", "Penjualan", 100_000_000);
    add("2026-09-05", "Pembelian bahan baku (biji kopi & susu)", "expense", "COGS / HPP", 46_500_000);
    add("2026-09-08", "Gaji barista & kitchen", "expense", "Beban Pegawai (HR/Payroll)", 19_000_000);
    add("2026-09-10", "Sewa ruko & tagihan listrik/air", "expense", "Beban Utilitas & Tempat", 7_200_000);
    add("2026-09-12", "Cup, sedotan, plastik & ATK", "expense", "Beban Operasional & Umum", 3_800_000);
    add("2026-09-14", "Servis rutin AC & mesin kopi", "expense", "Beban Pemeliharaan", 2_000_000);
    add("2026-09-15", "Iklan IG, TikTok Ads & MDR", "expense", "Beban Pemasaran (Marketing/Selling)", 6_500_000);
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
function emptyData(ownerName = "Pemilik usaha") {
    return { version: 1, demo: false, profile: { businessName: "Usaha Saya", ownerName, businessType: "Kuliner" }, opening: { date: today(), cash: 0, bank: 0, fixedAssets: 0, liabilities: 0, equity: 0, confirmed: false }, transactions: [], assets: [] };
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
const LOCAL_USERS_KEY = "ruangusaha-users-v1";
const LOCAL_SESSION_KEY = "ruangusaha-active-session";

function getLocalUsers() {
    try {
        const raw = localStorage.getItem(LOCAL_USERS_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { console.error(e); }
    const defaultUsers = {
        "admin_trial": {
            username: "admin_trial",
            password: "12345",
            fullName: "Admin Trial UMKM",
            workspaceKey: `${STORAGE_KEY}-admin_trial`
        }
    };
    // Siapkan data contoh untuk admin_trial jika belum ada
    if (!localStorage.getItem(`${STORAGE_KEY}-admin_trial`)) {
        try {
            // Jika ada data lama di STORAGE_KEY, gunakan itu, jika tidak gunakan sampleData()
            const existing = localStorage.getItem(STORAGE_KEY);
            localStorage.setItem(`${STORAGE_KEY}-admin_trial`, existing || JSON.stringify(sampleData()));
        } catch (e) { }
    }
    try { localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(defaultUsers)); } catch (e) { }
    return defaultUsers;
}

function getActiveLocalSession() {
    try {
        const raw = localStorage.getItem(LOCAL_SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function App() {
    const [page, setPage] = useState("dashboard");
    const [period, setPeriod] = useState("2026-09");
    const [localSession, setLocalSession] = useState(() => getActiveLocalSession());
    const [session, setSession] = useState(null);
    const [demoSession, setDemoSession] = useState(false);
    const [authReady, setAuthReady] = useState(!supabaseConfigured);
    const [workspaceReady, setWorkspaceReady] = useState(false);
    const [workspaceError, setWorkspaceError] = useState("");
    const [workspaceRetry, setWorkspaceRetry] = useState(0);
    const [authMode, setAuthMode] = useState("login");
    const [authError, setAuthError] = useState("");
    const [authMessage, setAuthMessage] = useState("");
    const [authSubmitting, setAuthSubmitting] = useState(false);
    const [notice, setNotice] = useState("");
    const [reasoner, setReasoner] = useState({ status: "idle", result: null, error: "" });
    const [financialReport, setFinancialReport] = useState({ request: "", status: "idle", body: null, error: "" });
    const [reportRetry, setReportRetry] = useState(0);
    const [reportTab, setReportTab] = useState("profit");
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [newTransactionKind, setNewTransactionKind] = useState("revenue");
    const [showUserMenu, setShowUserMenu] = useState(false);

    const [data, setData] = useState(() => {
        const active = getActiveLocalSession();
        if (active?.workspaceKey) {
            try {
                const stored = localStorage.getItem(active.workspaceKey);
                if (stored) return JSON.parse(stored);
            } catch (e) { }
        }
        return sampleData();
    });

    useEffect(() => {
        if (!supabaseConfigured) {
            setAuthReady(true);
            return undefined;
        }
        let active = true;
        supabase.auth.getSession().then(({ data: result, error }) => {
            if (error) setAuthError(error.message);
            if (active) {
                setSession(result.session);
                setAuthReady(true);
            }
        });
        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
            setAuthError("");
            setAuthMessage("");
            if (nextSession) setDemoSession(false);
        });
        return () => { active = false; listener.subscription.unsubscribe(); };
    }, []);

    // Muat workspace berdasarkan sesi (Supabase atau Local Multi-User)
    useEffect(() => {
        if (!supabaseConfigured) {
            if (localSession?.workspaceKey) {
                try {
                    const stored = localStorage.getItem(localSession.workspaceKey);
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        setData(parsed);
                        if (parsed.transactions?.length) setPeriod(monthOf(parsed.transactions[parsed.transactions.length - 1].date));
                    } else {
                        const initial = localSession.username === "admin_trial" ? sampleData() : emptyData(localSession.fullName || localSession.username);
                        setData(initial);
                        localStorage.setItem(localSession.workspaceKey, JSON.stringify(initial));
                    }
                    setWorkspaceError("");
                } catch (error) {
                    console.error(error);
                    setWorkspaceError(`Gagal memuat data lokal: ${error.message}`);
                }
            } else {
                setData(emptyData());
            }
            setWorkspaceReady(true);
            return undefined;
        }

        if (demoSession) {
            try {
                const local = readLocalData();
                setData(local);
                if (local.transactions?.length) setPeriod(monthOf(local.transactions[local.transactions.length - 1].date));
                setWorkspaceError("");
            } catch (error) {
                console.error(error);
                setWorkspaceError(`Gagal memuat data akun demo: ${error.message}`);
            }
            setWorkspaceReady(true);
            return undefined;
        }
        if (!session?.user) {
            setData(emptyData());
            setWorkspaceError("");
            setWorkspaceReady(true);
            return undefined;
        }
        let active = true;
        setWorkspaceReady(false);
        setWorkspaceError("");
        setData(emptyData(session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Pemilik usaha"));
        (async () => {
            const { data: row, error } = await supabase.from("user_workspaces").select("data").eq("user_id", session.user.id).maybeSingle();
            if (error) throw error;
            if (!active) return;
            if (row?.data) {
                setData(row.data);
                if (row.data.transactions?.length) {
                    // Pilih bulan transaksi paling baru secara otomatis
                    const latestTx = [...row.data.transactions].sort((a, b) => b.date.localeCompare(a.date))[0];
                    if (latestTx?.date) setPeriod(monthOf(latestTx.date));
                }
            } else {
                const initial = emptyData(session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Pemilik usaha");
                const { error: saveError } = await supabase.from("user_workspaces").upsert({ user_id: session.user.id, data: initial });
                if (saveError) throw saveError;
                setData(initial);
            }
            setWorkspaceReady(true);
        })().catch((error) => {
            console.error(error);
            if (active) { setWorkspaceError(`Gagal memuat workspace Supabase: ${error.message}`); setWorkspaceReady(true); }
        });
        return () => { active = false; };
    }, [session?.user?.id, demoSession, localSession?.username, workspaceRetry]);

    // Simpan data setiap ada perubahan
    useEffect(() => {
        if (!workspaceReady || workspaceError) return undefined;
        if (!supabaseConfigured) {
            if (localSession?.workspaceKey) {
                try {
                    localStorage.setItem(localSession.workspaceKey, JSON.stringify(data));
                } catch (error) {
                    console.error(error);
                    setNotice(`Data gagal disimpan di browser: ${error.message}`);
                }
            }
            return undefined;
        }
        if (demoSession) {
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
    }, [data, session?.user?.id, workspaceReady, workspaceError, demoSession, localSession?.workspaceKey]);

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
                    headers: {
                        "Content-Type": "application/json",
                        "ngrok-skip-browser-warning": "true",
                    },
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

    const currentEmailOrUser = session?.user?.email || localSession?.username || (demoSession ? "Tamu (Mode Demo)" : "Pengguna");
    const currentOwner = data.profile.ownerName || localSession?.fullName || "Pemilik usaha";

    // Ambil inisial nama secara dinamis (contoh: "Kusuma" -> "KS", "Budi Santoso" -> "BS")
    const userInitials = useMemo(() => {
        const name = (currentOwner || "").trim();
        if (!name) return "US";
        const parts = name.split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }, [currentOwner]);

    // Evaluasi status kesehatan keuangan untuk tombol dinamis
    const healthStatus = useMemo(() => {
        if (!analysis) return { key: "limited", label: "Menghitung…", level: "limited" };
        const findings = analysis.findings || [];
        if (!analysis.comparable && !findings.length) {
            return { key: "limited", label: "Data Terbatas", level: "limited", desc: "Perlu data transaksi bulan pembanding" };
        }
        const hasCritical = findings.some(f => f.severity === "Kritis" || f.id === "critical");
        const hasPerluPeriksa = findings.some(f => f.severity === "Perlu diperiksa" || f.id === "cost" || f.id === "margin" || f.id === "cash");
        const hasPantau = findings.some(f => f.severity === "Pantau");

        if (hasCritical) {
            return { key: "critical", label: "Bahaya / Kritis", level: "critical", desc: "Ada masalah likuiditas/keuangan serius" };
        }
        if (hasPerluPeriksa) {
            return { key: "danger", label: "Perlu Diperiksa", level: "danger", desc: `${findings.length} indikasi perlu ditinjau` };
        }
        if (hasPantau) {
            return { key: "warning", label: "Pantau Tren", level: "warning", desc: "Beberapa beban tumbuh lebih cepat" };
        }
        return { key: "healthy", label: "Kondisi Sehat", level: "healthy", desc: "Tidak ada indikasi risiko ditemukan" };
    }, [analysis]);

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
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "ngrok-skip-browser-warning": "true",
                    },
                    body: reasonerPayload,
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
        document.title = supabaseConfigured && !session && !demoSession
            ? `${authMode === "signup" ? "Buat akun" : "Masuk"} — RuangUsaha`
            : `${TITLES[page]} — RuangUsaha`;
    }, [page, session, demoSession, authMode]);

    const notify = useCallback((message) => {
        setNotice(message);
        window.setTimeout(() => setNotice(""), 3500);
    }, []);
    const openTransaction = (kind = "revenue") => {
        setEditing(null);
        setNewTransactionKind(kind);
        setShowForm(true);
    };

    const handleSignOut = () => {
        if (supabaseConfigured && session) {
            supabase.auth.signOut();
        } else {
            localStorage.removeItem(LOCAL_SESSION_KEY);
            setLocalSession(null);
            setDemoSession(false);
        }
    };

    async function handleAuth(event) {
        event.preventDefault();
        setAuthError("");
        setAuthMessage("");
        setAuthSubmitting(true);
        const form = new FormData(event.currentTarget);
        const usernameOrEmail = String(form.get("email")).trim();
        const password = String(form.get("password"));
        const fullName = String(form.get("fullName") || "").trim();

        if (supabaseConfigured) {
            if (authMode === "signup" && !fullName) {
                setAuthError("Nama pemilik wajib diisi.");
                setAuthSubmitting(false);
                return;
            }
            try {
                const result = authMode === "signup"
                    ? await supabase.auth.signUp({ email: usernameOrEmail, password, options: { data: { full_name: fullName } } })
                    : await supabase.auth.signInWithPassword({ email: usernameOrEmail, password });
                if (result.error) setAuthError(result.error.message);
                else if (authMode === "signup" && !result.data.session) {
                    setAuthMode("login");
                    setAuthMessage("Akun berhasil dibuat. Periksa email untuk konfirmasi, lalu masuk.");
                } else if (authMode === "signup") {
                    setAuthMessage("Akun berhasil dibuat. Workspace baru sudah disiapkan untukmu.");
                }
            } catch (error) {
                setAuthError(`Autentikasi gagal: ${error.message}`);
            } finally {
                setAuthSubmitting(false);
            }
            return;
        }

        // --- Mode Lokal Multi-User (Offline / Tanpa Supabase) ---
        setTimeout(() => {
            try {
                const users = getLocalUsers();
                if (authMode === "login") {
                    const user = users[usernameOrEmail.toLowerCase()];
                    if (!user || user.password !== password) {
                        setAuthError("Username/email atau kata sandi salah. Coba username: admin_trial, pass: 12345");
                        setAuthSubmitting(false);
                        return;
                    }
                    const currentSession = {
                        username: user.username,
                        fullName: user.fullName,
                        workspaceKey: user.workspaceKey
                    };
                    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(currentSession));
                    setLocalSession(currentSession);
                    setDemoSession(false);
                } else {
                    // Signup mode
                    if (!fullName) {
                        setAuthError("Nama pemilik wajib diisi.");
                        setAuthSubmitting(false);
                        return;
                    }
                    const cleanKey = usernameOrEmail.toLowerCase();
                    if (users[cleanKey]) {
                        setAuthError("Username atau email ini sudah terdaftar.");
                        setAuthSubmitting(false);
                        return;
                    }
                    const newWorkspaceKey = `${STORAGE_KEY}-${cleanKey}`;
                    users[cleanKey] = {
                        username: usernameOrEmail,
                        password,
                        fullName,
                        workspaceKey: newWorkspaceKey
                    };
                    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
                    // Buat workspace bersih untuk akun baru
                    const newWorkspace = emptyData(fullName);
                    localStorage.setItem(newWorkspaceKey, JSON.stringify(newWorkspace));

                    setAuthMode("login");
                    setAuthMessage(`Akun ${usernameOrEmail} berhasil dibuat! Silakan masuk.`);
                }
            } catch (err) {
                setAuthError(`Terjadi kesalahan sistem: ${err.message}`);
            } finally {
                setAuthSubmitting(false);
            }
        }, 200);
    }

    if (!authReady || !workspaceReady) return <div className="app-loading">Memuat RuangUsaha…</div>;

    // Tampilkan AuthPage jika belum ada session (baik di Supabase atau Local) dan bukan mode demo
    const isAuthenticated = supabaseConfigured ? Boolean(session || demoSession) : Boolean(localSession || demoSession);
    if (!isAuthenticated) {
        return <AuthPage
            mode={authMode}
            setMode={(mode) => { setAuthMode(mode); setAuthError(""); setAuthMessage(""); }}
            onSubmit={handleAuth}
            error={authError}
            message={authMessage}
            submitting={authSubmitting}
            onDemo={() => { setDemoSession(true); setPage("dashboard"); }}
        />;
    }

    if (workspaceError) return <main className="prototype-auth"><span className="brand-mark">R</span><h1>Workspace belum dapat dimuat</h1><p>{workspaceError}</p><button className="button button-primary" onClick={() => setWorkspaceRetry((value) => value + 1)}>Coba lagi</button><button className="button button-secondary" style={{ marginLeft: 8 }} onClick={handleSignOut}>Keluar</button></main>;
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
        if (page === "dashboard") return <Dashboard data={data} report={report} trend={trend} analysis={analysis} period={period} setPeriod={setPeriod} months={availableMonths} setPage={setPage} openTransaction={openTransaction} reasoner={reasoner} />;
        if (page === "transactions") return <Transactions data={data} setData={setData} period={period} setPeriod={setPeriod} setEditing={setEditing} setShowForm={setShowForm} setNewTransactionKind={setNewTransactionKind} openTransaction={openTransaction} notify={notify} />;
        if (page === "reports") return <Reports data={data} report={report} period={period} setPeriod={setPeriod} months={availableMonths} tab={reportTab} setTab={setReportTab} />;
        if (page === "analysis") return <Analysis analysis={analysis} period={period} setPeriod={setPeriod} months={availableMonths} reasoner={reasoner} />;
        if (page === "assets") return <Assets data={data} report={report} openTransaction={openTransaction} />;
        return <Settings data={data} setData={setData} notify={notify} onSignOut={handleSignOut} />;
    };

    return <div className="app-shell" onClick={() => { if (showUserMenu) setShowUserMenu(false); }}>
        <aside className="sidebar">
            <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage("dashboard"); }}><span className="brand-mark">R</span><span className="brand-copy"><strong>ruangusaha</strong><small>FINANCIAL HEALTH</small></span></a>
            <div className="business-switcher"><span className="business-avatar">{userInitials}</span><span className="business-info"><strong>{data.profile.businessName}</strong><small>{currentEmailOrUser}</small></span><span className="switch-chevron">⌄</span></div>
            <p className="nav-label">MENU UTAMA</p><nav className="main-nav" aria-label="Navigasi utama">{nav.slice(0, 5).map(([key, icon, label]) => <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => setPage(key)}><span className="nav-icon">{icon}</span>{label}{key === "analysis" && <span className="nav-pill">BARU</span>}</button>)}</nav>
            <p className="nav-label nav-label-bottom">PREFERENSI</p><nav className="main-nav"><button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}><span className="nav-icon">⚙</span>Pengaturan usaha</button></nav>
            <div className="sidebar-bottom"><div className="help-card"><span className="help-spark">✦</span><strong>Keuangan lebih jelas.</strong><p>Pahami bukan hanya hasilnya, tapi juga alasan di baliknya.</p><button onClick={() => setPage("analysis")}>Lihat cara kerja <span>→</span></button></div><div className="profile-row"><span className="profile-avatar">{userInitials}</span><span><strong>{currentOwner}</strong><small>{currentEmailOrUser}</small></span><button className="profile-more" title="Keluar / Logout" aria-label="Keluar" onClick={handleSignOut}>↪</button></div></div>
        </aside>
        <main className="main-area"><header className="topbar">
            <div className="breadcrumb"><span>RuangUsaha</span><span className="crumb-sep">/</span><strong>{TITLES[page]}</strong></div>
            <div className="topbar-actions">
                {/* Titik Hijau Indikator Database Online */}
                <span
                    title={supabaseConfigured && !demoSession ? "Tersambung ke Database Supabase" : "Data tersimpan di perangkat ini"}
                    style={{ display: "inline-flex", alignItems: "center", cursor: "help" }}
                >
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#4bb56e", boxShadow: "0 0 0 3px rgba(75, 181, 110, 0.2)" }}></span>
                </span>

                {/* Status Indikator Dinamis Kesehatan Keuangan + Icon Tanya */}
                <button
                    className={`health-status-badge ${healthStatus.level}`}
                    title={`Status Keuangan: ${healthStatus.label} (${healthStatus.desc || "Buka Analisis KBR"}). Klik untuk membuka penalaran sistem.`}
                    onClick={() => setPage("analysis")}
                >
                    <span className="status-dot"></span>
                    <span>{healthStatus.label}</span>
                    <span className="icon-q">?</span>
                </button>

                {/* Avatar Profil dengan Dropdown Menu (Pengaturan & Logout) */}
                <div className="user-menu-wrapper" onClick={(e) => e.stopPropagation()}>
                    <button
                        className="top-avatar"
                        title={`Akun: ${currentOwner} (${currentEmailOrUser})`}
                        onClick={() => setShowUserMenu((prev) => !prev)}
                        aria-haspopup="true"
                        aria-expanded={showUserMenu}
                    >
                        {userInitials}
                    </button>

                    {showUserMenu && (
                        <div className="user-dropdown" role="menu">
                            <div className="user-dropdown-header">
                                <strong>{currentOwner}</strong>
                                <small>{currentEmailOrUser}</small>
                            </div>
                            <button
                                className="user-dropdown-item"
                                role="menuitem"
                                onClick={() => { setPage("settings"); setShowUserMenu(false); }}
                            >
                                <span>⚙</span> Pengaturan usaha
                            </button>
                            <button
                                className="user-dropdown-item"
                                role="menuitem"
                                onClick={() => { setPage("analysis"); setShowUserMenu(false); }}
                            >
                                <span>✳</span> Analisis KBR
                            </button>
                            <div style={{ height: 1, background: "#f0f3ee", margin: "4px 0" }}></div>
                            <button
                                className="user-dropdown-item danger"
                                role="menuitem"
                                onClick={() => { setShowUserMenu(false); handleSignOut(); }}
                            >
                                <span>↪</span> Keluar (Logout)
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
            {data.demo && (demoSession || !supabaseConfigured) && <div className="demo-notice"><span>ⓘ</span><span><strong>Mode data contoh ({currentEmailOrUser}).</strong> Angka simulasi ini tersimpan di akun ini.</span><button aria-label="Tutup" onClick={() => setData({ ...data, demo: false })}>×</button></div>}
            {notice && <div className="notice-error" role="status">{notice}</div>}
            <div className="page-content">{renderPage()}</div>
            <footer className="app-footer"><span>RuangUsaha {new Date().getFullYear()} · Asisten keuangan untuk UMKM</span><span>Alat bantu keputusan, bukan pengganti saran akuntan.</span>{demoSession && <button className="panel-link" onClick={handleSignOut}>Keluar dari akun demo</button>}</footer>
        </main>
        {showForm && <TransactionModal initial={editing} initialAsset={data.assets.find((asset) => asset.id === editing?.assetId)} initialKind={newTransactionKind} onClose={() => { setShowForm(false); setEditing(null); }} onSave={(tx, asset) => { setData((old) => ({ ...old, demo: false, transactions: old.transactions.some((item) => item.id === tx.id) ? old.transactions.map((item) => item.id === tx.id ? tx : item) : [...old.transactions, tx], assets: asset ? old.assets.some((item) => item.id === asset.id) ? old.assets.map((item) => item.id === asset.id ? asset : item) : [...old.assets, asset] : old.assets.filter((item) => item.id !== editing?.assetId) })); setPeriod(monthOf(tx.date)); setShowForm(false); setEditing(null); notify("Transaksi berhasil disimpan."); }} />}
    </div>;
}

function makeAnalysis(data, report) {
    const prev = report.previous, comparable = Boolean(prev && prev.revenue > 0 && report.revenue > 0), revenueGrowth = comparable ? (report.revenue - prev.revenue) / prev.revenue : null;
    const cogsGrowth = comparable && prev.cogs > 0 ? (report.cogs - prev.cogs) / prev.cogs : null;
    const findings = [];
    if (comparable && cogsGrowth !== null && revenueGrowth !== null && cogsGrowth > revenueGrowth) {
        findings.push({ id: "cost", severity: "Perlu diperiksa", title: "Biaya bahan tumbuh lebih cepat dari pendapatan", summary: "Porsi biaya bahan terhadap penjualan naik. Ini indikasi awal, bukan bukti bahwa biaya pasti tidak wajar.", evidence: [["Pertumbuhan pendapatan", percent(revenueGrowth * 100)], ["Pertumbuhan COGS", percent(cogsGrowth * 100)], ["COGS Ratio", `${(report.cogsRatio * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`]], chain: ["Pendapatan dibandingkan", "COGS tumbuh lebih cepat", "COGS Ratio naik", "Periksa bahan baku & harga jual"], advice: "Bandingkan harga supplier dan pemakaian bahan, lalu tinjau harga jual. Periksa product mix sebelum menyimpulkan penyebab margin." });
        if (prev.grossMargin !== null && report.grossMargin !== null && report.grossMargin < prev.grossMargin) findings.push({ id: "margin", severity: "Perlu diperiksa", title: "Margin kotor menurun", summary: "Gross margin periode ini lebih rendah dari bulan sebelumnya, bersamaan dengan kenaikan relatif COGS.", evidence: [["Gross margin bulan lalu", `${(prev.grossMargin * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`], ["Gross margin periode ini", `${(report.grossMargin * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`]], chain: ["COGS tumbuh lebih cepat", "Biaya bahan menyerap lebih banyak penjualan", "Gross margin turun", "Periksa bahan & harga jual"], advice: "Periksa harga bahan baku, pemakaian atau waste, product mix, dan harga jual. Data persediaan belum digunakan." });
    }
    for (const [key, label, current, prior] of [["opex", "Beban operasional", report.opex, prev?.opex], ["marketing", "Biaya pemasaran", report.marketing, prev?.marketing]]) {
        if (comparable && prior > 0 && current / prior - 1 > revenueGrowth) findings.push({ id: key, severity: "Pantau", title: `${label} tumbuh lebih cepat dari pendapatan`, summary: "Rasio pengeluaran terhadap pendapatan berpotensi meningkat. Kenaikan belum otomatis berarti pemborosan.", evidence: [["Pertumbuhan pendapatan", percent(revenueGrowth * 100)], [`Pertumbuhan ${label.toLowerCase()}`, percent((current / prior - 1) * 100)]], chain: ["Bandingkan bulan sebelumnya", `${label} tumbuh lebih cepat`, "Rasio biaya berpotensi naik", "Periksa rincian biaya"], advice: "Tinjau rincian biaya dan hubungkan pengeluaran dengan aktivitas atau hasil usaha terkait." });
    }
    if (comparable && prev.netMargin !== null && report.netMargin !== null && report.netMargin < prev.netMargin) findings.push({ id: "profit", severity: "Pantau", title: "Margin laba bersih menurun", summary: "Porsi laba bersih dari pendapatan turun dibanding bulan sebelumnya.", evidence: [["Net margin bulan lalu", `${(prev.netMargin * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`], ["Net margin periode ini", `${(report.netMargin * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`]], chain: ["Bandingkan net margin", "Net margin turun", "Telusuri pendapatan & beban", "Pantau periode berikutnya"], advice: "Telusuri perubahan COGS, OPEX, marketing, dan penyusutan; pastikan kategori transaksi benar." });
    if (report.changeCash < 0) findings.push({ id: "cash", severity: "Perlu diperiksa", title: report.netProfit > 0 ? "Laba positif, tetapi kas berkurang" : "Saldo kas berkurang", summary: "Laba dan kas menjawab pertanyaan berbeda. Investasi, prive, dan pembayaran pokok pinjaman dapat mengurangi kas.", evidence: [["Laba bersih tercatat", money(report.netProfit, true)], ["Perubahan kas", money(report.changeCash, true)], ["Arus kas investasi", money(report.investingCashFlow, true)], ["Arus kas pendanaan", money(report.financingCashFlow, true)]], chain: ["Hitung kas masuk & keluar", "Pisahkan operasi, investasi, pendanaan", "Laba berbeda dari perubahan kas", "Periksa transaksi penyebab"], advice: "Cek arus kas investasi, setoran/prive, dan pembayaran pokok. Laba ini berdasarkan transaksi yang dicatat, bukan laporan akrual lengkap." });
    const reasons = [];
    if (!comparable) reasons.push("Data pendapatan dua bulan berurutan belum cukup untuk membandingkan tren.");
    if (!report.revenue) reasons.push("Belum ada pendapatan tercatat; margin tidak dapat dihitung.");
    if (!data.opening.confirmed) reasons.push("Saldo awal belum dikonfirmasi; posisi kas dan neraca mungkin belum akurat.");
    if (!findings.length && !reasons.length) reasons.push("Tidak ada aturan perhatian yang terpenuhi. Ini bukan jaminan semua aspek keuangan sehat.");
    return { report, findings, reasons, comparable, revenueGrowth, cogsGrowth };
}
function toReasonerPayload(analysis) {
    const { report, comparable, revenueGrowth, cogsGrowth } = analysis;
    const numbers = { hasNetProfit: report.netProfit, hasChangeInCash: report.changeCash, hasOperatingCashFlow: report.operatingCashFlow };
    const movements = [];
    if (comparable && report.previous) {
        const prev = report.previous;
        numbers.hasRevenueGrowth = revenueGrowth;
        if (cogsGrowth !== null) numbers.hasCOGSGrowth = cogsGrowth;
        numbers.hasOPEXGrowth = prev.opex ? (report.opex - prev.opex) / prev.opex : 0;
        numbers.hasMarketingGrowth = prev.marketing ? (report.marketing - prev.marketing) / prev.marketing : 0;
        if (report.grossMargin !== null && prev.grossMargin !== null) { numbers.hasGrossMargin = report.grossMargin; numbers.hasGrossMarginLowerBound = prev.grossMargin; }
        if (report.netMargin !== null && prev.netMargin !== null) { numbers.hasNetMargin = report.netMargin; numbers.hasNetMarginLowerBound = prev.netMargin; }
        const priorRows = report.previous.rows || [];
        numbers.hasOwnerDrawAmount = amountFor(report.rows, (tx) => tx.kind === "draw");
        numbers.hasPreviousOwnerDrawAmount = amountFor(priorRows, (tx) => tx.kind === "draw");
        const candidates = [["COGS", report.cogs, prev.cogs], ["OPEX", report.opex, prev.opex], ["Marketing", report.marketing, prev.marketing]].filter((item) => item[2] > 0);
        let top = -1;
        candidates.forEach((item, index) => { if (top < 0 || item[1] - item[2] > candidates[top][1] - candidates[top][2]) top = index; });
        candidates.forEach((item, index) => movements.push({ name: item[0], growth: (item[1] - item[2]) / item[2], is_top: index === top && item[1] > item[2] }));
    }
    return { numbers, movements };
}

function PageHeading({ eyebrow, title, subtitle, actions }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div><div className="heading-actions">{actions}</div></div>; }
function MonthPicker({ value, onChange, months }) { return <select className="period-select" aria-label="Pilih periode" value={value} onChange={(event) => onChange(event.target.value)}>{months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select>; }
function Stats({ report, analysis }) {
    const prev = report.previous;
    const cards = [["Pendapatan", money(report.revenue, true), "↗", prev?.revenue ? percent((report.revenue - prev.revenue) / prev.revenue * 100) : "Total pendapatan tercatat"], ["Laba bersih*", money(report.netProfit, true), "◉", "Pendapatan − biaya − penyusutan"], ["Saldo kas & bank", money(report.cash + report.bank, true), "▣", `Perubahan kas ${money(report.changeCash, true)}`], ["Gross margin", report.grossMargin === null ? "—" : `${(report.grossMargin * 100).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`, "◌", `COGS ${money(report.cogs, true)}`]];
    return <section className="stats-grid">{cards.map(([label, value, icon, foot]) => <article className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot"><span className={`delta ${label === "Saldo kas & bank" ? (report.changeCash >= 0 ? "positive" : "negative") : "neutral"}`}>{label === "Saldo kas & bank" ? (report.changeCash >= 0 ? "Naik" : "Turun") : ""}</span>{foot}</div></article>)}</section>;
}
function ReasonerStatus({ reasoner }) {
    if (reasoner.status === "loading") return <div className="reasoner-pill">Mengirim fakta ke knowledge base OWL/Pellet…</div>;
    if (reasoner.status === "ok") {
        const visible = reasoner.result.inferred.filter((name) => ["CostEscalation", "MarginPressure", "OPEXPressure", "MarketingEfficiencyReview", "ProfitPressure", "ProfitCashGap", "LiquidityPressure", "OwnerDrawLiquidityPressure", "LiquidityCritical"].includes(name));
        return <div className="reasoner-pill"><strong>{reasoner.result.engine} aktif</strong> · {reasoner.result.java} · {visible.length ? visible.join(", ") : "belum ada kelas temuan"} · {reasoner.result.elapsed_ms} ms</div>;
    }
    return <div className={`reasoner-pill ${reasoner.status === "error" ? "error" : ""}`}>{reasoner.status === "error" ? `Reasoner OWL error: ${reasoner.error}` : reasoner.error || "Reasoner menunggu data pembanding."}</div>;
}
function Dashboard({ data, report, trend, analysis, period, setPeriod, months, setPage, openTransaction, reasoner }) {
    const max = Math.max(1, ...trend.map((item) => item.revenue));
    const latest = analysis.findings[0];
    const latestTransactions = data.transactions.filter((tx) => monthOf(tx.date) === period).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    return <><PageHeading eyebrow="RINGKASAN USAHA" title={`Halo, ${data.profile.ownerName} 👋`} subtitle={`Berikut gambaran keuangan ${data.profile.businessName} untuk ${monthLabel(period)}.`} actions={<><MonthPicker value={period} onChange={setPeriod} months={months} /><button className="button button-primary" onClick={() => openTransaction("revenue")}>＋ Catat transaksi</button></>} />
        <Stats report={report} analysis={analysis} /><div className="report-note report-data-note">* Laba dihitung dari transaksi yang dicatat dan estimasi penyusutan. Laporan akrual bisa memerlukan data persediaan, piutang, atau utang.</div>
        <div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Tren keuangan</h2><p className="panel-caption">Pendapatan dibandingkan biaya utama yang dicatat</p></div><button className="panel-link" onClick={() => setPage("reports")}>Lihat laporan →</button></div><div className="chart-legend"><span><i className="legend-dot" />Pendapatan</span><span><i className="legend-dot orange" />COGS</span><span><i className="legend-dot gray" />Laba</span></div><div className="trend-chart">{trend.map(({ month, revenue, cogs, netProfit }) => <div className="trend-month" key={month}><div className="bars"><i className="bar" style={{ height: `${Math.max(2, revenue / max * 100)}%` }} /><i className="bar expense" style={{ height: `${Math.max(2, cogs / max * 100)}%` }} /><i className="bar profit" style={{ height: `${Math.max(2, Math.max(0, netProfit) / max * 100)}%` }} /></div><span className="month-label">{MONTHS[Number(month.slice(5, 7)) - 1].slice(0, 3)}</span></div>)}</div></section>
            <section className="health-card health-warning"><div className="health-label"><i />STATUS PERIODE INI</div><h2 className="health-title">{analysis.findings.length ? "Ada yang perlu ditinjau" : "Data masih terbatas"}</h2><p className="health-copy">{analysis.findings.length ? `${analysis.findings.length} indikasi ditemukan. Buka bukti dan alur penalaran sebelum mengambil tindakan.` : analysis.reasons.join(" ")}</p><button className="health-link" onClick={() => setPage("analysis")}>Buka analisis KBR →</button><ReasonerStatus reasoner={reasoner} /></section></div>
        <div className="lower-grid"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Transaksi terbaru</h2><p className="panel-caption">{data.transactions.filter((tx) => monthOf(tx.date) === period).length} transaksi pada periode ini</p></div><button className="panel-link" onClick={() => setPage("transactions")}>Semua transaksi →</button></div>{latestTransactions.map((tx) => <MiniTransaction key={tx.id} tx={tx} />)}{!latestTransactions.length && <div className="empty-state"><strong>Belum ada transaksi</strong>Mulai catat transaksi untuk melihat ringkasan.</div>}</section><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Dari sistem KBR</h2><p className="panel-caption">Bukti → aturan → hal yang perlu diperiksa</p></div></div><ReasonerStatus reasoner={reasoner} />{latest ? <div className="reasoning-teaser"><h3>{latest.title}</h3>{latest.chain.slice(0, 3).map((step, index) => <div className="reasoning-line" key={step}><span className="step-dot">{index + 1}</span>{step}</div>)}<button className="panel-link" onClick={() => setPage("analysis")}>Telusuri reasoning →</button></div> : <div className="reasoning-teaser"><h3>Belum ada diagnosis</h3><p>Lengkapi data periode ini dan bulan pembanding.</p></div>}</section></div>
    </>;
}
function MiniTransaction({ tx }) {
    const isTransfer = tx.kind === "transfer";
    const positive = cashDelta(tx) > 0;
    const title = tx.kind === "asset" ? tx.description : isTransfer ? "Pemindahan saldo" : KIND_NAMES[tx.kind];
    const detail = isTransfer ? `${accountLabel(tx.account)} → ${accountLabel(tx.transferTo)}` : `${tx.category} · ${accountLabel(tx.account)}`;
    return <div className="mini-row"><span className={`mini-symbol ${isTransfer ? "transfer" : positive ? "" : "out"}`}>{isTransfer ? "↔" : positive ? "↗" : "↙"}</span><span className="mini-copy"><strong>{title}</strong><small>{detail} · {dateLabel(tx.date)}</small>{tx.note?.trim() && <small className="mini-note">{tx.note}</small>}</span><span className={`mini-amount ${isTransfer ? "" : positive ? "in" : "out"}`}>{isTransfer ? "" : positive ? "+" : "−"}{money(tx.amount, true)}</span></div>;
}
function TransactionList({ kind, rows, onEdit, onRemove }) {
    const isTransfer = kind === "transfer";
    return <div className="transaction-type-list">
        {rows.length ? <div className="transaction-record-list">
            {rows.map((tx) => <article className="transaction-record" key={tx.id}>
                <div className="transaction-record-main">
                    <div className="transaction-record-info">
                        <div className="transaction-record-meta"><span>{dateLabel(tx.date)}</span><span className="category-badge">{tx.kind === "asset" ? tx.description : tx.category}</span></div>
                        <div className="transaction-record-account">{isTransfer ? `${accountLabel(tx.account)} → ${accountLabel(tx.transferTo)}` : accountLabel(tx.account)}</div>
                    </div>
                    <div className="transaction-record-side">
                        <strong className={`transaction-record-amount ${kind === "revenue" || kind === "capital" || kind === "loan" ? "in" : kind === "expense" || kind === "draw" || kind === "principal" || kind === "asset" ? "out" : "transfer-amount"}`}>{kind === "revenue" || kind === "capital" || kind === "loan" ? "+" : kind === "expense" || kind === "draw" || kind === "principal" || kind === "asset" ? "−" : "↔ "}{money(tx.amount)}</strong>
                        <div className="table-actions"><button onClick={() => onEdit(tx)}>Ubah</button><button onClick={() => onRemove(tx)}>Hapus</button></div>
                    </div>
                </div>
                {tx.note?.trim() && <p className="transaction-record-note">{tx.note}</p>}
            </article>)}
        </div> : <div className="transaction-type-empty">Belum ada transaksi pada periode ini.</div>}
    </div>;
}
function TransactionTypePanel({ kind, rows, total, openTransaction, onEdit, onRemove }) {
    const isRevenue = kind === "revenue";
    return <section className={`panel transaction-type-panel ${isRevenue ? "income" : "expense"}`}>
        <div className="panel-header"><div><span className="eyebrow">{isRevenue ? "UANG MASUK" : "UANG KELUAR"}</span><h2 className="panel-title section-gap">{isRevenue ? "Pendapatan & penjualan" : "Pengeluaran"}</h2><p className="panel-caption">{monthLabel(rows.period)}</p></div><strong className={`transaction-total ${isRevenue ? "positive" : "negative"}`}>{money(total)}</strong></div>
        <TransactionList kind={kind} rows={rows.items} onEdit={onEdit} onRemove={onRemove} />
        <button className="button button-secondary transaction-add-button" onClick={() => openTransaction(kind)}>＋ Catat {isRevenue ? "pendapatan" : "pengeluaran"}</button>
    </section>;
}
function Transactions({ data, setData, period, setPeriod, setEditing, setShowForm, setNewTransactionKind, openTransaction, notify }) {
    const [view, setView] = useState("income-expense");
    const periodRows = data.transactions.filter((tx) => monthOf(tx.date) === period);
    const incomes = periodRows.filter((tx) => tx.kind === "revenue");
    const expenses = periodRows.filter((tx) => tx.kind === "expense");
    const selectedKind = view === "income-expense" ? null : view;
    const selectedRows = selectedKind ? [...periodRows].filter((tx) => tx.kind === selectedKind).sort((a, b) => b.date.localeCompare(a.date)) : [];
    function remove(tx) { if (!window.confirm(`Hapus transaksi "${tx.description}"?`)) return; setData((old) => ({ ...old, transactions: old.transactions.filter((item) => item.id !== tx.id), assets: tx.assetId ? old.assets.filter((asset) => asset.id !== tx.assetId) : old.assets })); notify("Transaksi dihapus."); }
    function exportCsv() { const records = [["Tanggal", "Jenis", "Kategori", "Detail", "Metode", "Akun tujuan", "Nominal", "Catatan"], ...data.transactions.map((tx) => [tx.date, KIND_NAMES[tx.kind], tx.category, tx.kind === "asset" ? tx.description : tx.kind === "transfer" ? `${accountLabel(tx.account)} ke ${accountLabel(tx.transferTo)}` : tx.category, accountLabel(tx.account), tx.transferTo ? accountLabel(tx.transferTo) : "", tx.amount, tx.note || ""])]; const content = `\uFEFF${records.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`; const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "transaksi-ruangusaha.csv"; link.click(); URL.revokeObjectURL(url); }
    function openEdit(tx) { setEditing(tx); setNewTransactionKind(tx.kind); setShowForm(true); }
    function openCurrentForm() { openTransaction(view === "income-expense" ? "revenue" : view); }
    const selectedLabel = TRANSACTION_VIEWS.find(([key]) => key === view)?.[1] || "Transaksi";
    const selectedTotal = amountFor(selectedRows, () => true);
    const panelTitle = view === "principal" ? "Pembayaran pokok pinjaman" : view === "asset" ? "Pembelian aset" : selectedLabel;
    return <>
        <PageHeading eyebrow="CATATAN USAHA" title="Transaksi usaha" subtitle="Pilih jenis transaksi untuk melihat, menambah, mengubah, atau menghapus catatan." actions={<><MonthPicker value={period} onChange={setPeriod} months={[...new Set([...data.transactions.map((tx) => monthOf(tx.date)), period])].sort().reverse()} /><button className="button button-secondary" onClick={exportCsv}>↓ Ekspor CSV</button></>} />
        <section className="panel transaction-selector-panel"><label className="field transaction-selector"><span>Jenis transaksi</span><select className="input-control" value={view} onChange={(event) => setView(event.target.value)}>{TRANSACTION_VIEWS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></section>
        {view === "income-expense" ? <div className="transaction-types-grid section-gap">
            <TransactionTypePanel kind="revenue" rows={{ items: incomes, period }} total={amountFor(incomes, () => true)} openTransaction={openTransaction} onEdit={openEdit} onRemove={remove} />
            <TransactionTypePanel kind="expense" rows={{ items: expenses, period }} total={amountFor(expenses, () => true)} openTransaction={openTransaction} onEdit={openEdit} onRemove={remove} />
        </div> : <section className={`panel section-gap transaction-single-panel ${view}`}>
            <div className="panel-header"><div><span className="eyebrow">{monthLabel(period).toLocaleUpperCase("id-ID")}</span><h2 className="panel-title section-gap">{panelTitle}</h2><p className="panel-caption">{selectedRows.length} catatan pada periode ini</p></div><strong className={`transaction-total ${view === "capital" || view === "loan" ? "positive" : view === "draw" || view === "principal" || view === "asset" ? "negative" : ""}`}>{money(selectedTotal)}</strong></div>
            <div className="transaction-single-actions"><button className="button button-primary" onClick={openCurrentForm}>＋ Tambah {panelTitle.toLocaleLowerCase("id-ID")}</button></div>
            <TransactionList kind={selectedKind} rows={selectedRows} onEdit={openEdit} onRemove={remove} />
            {view === "transfer" && <div className="report-note">Transfer hanya memindahkan saldo antara Cash dan Rekening; total uang tidak berubah.</div>}
            {["capital", "loan", "draw", "principal"].includes(view) && <div className="report-note">{view === "capital" ? "Setoran modal menambah ekuitas, bukan pendapatan." : view === "loan" ? "Pinjaman masuk menambah utang, bukan pendapatan." : view === "draw" ? "Prive mengurangi ekuitas, bukan beban usaha." : "Pembayaran pokok mengurangi utang, bukan beban laba rugi."}</div>}
        </section>}
    </>;
}
function SideMetric({ label, value, text }) { return <div className="report-side-item"><small>{label}</small><strong>{value}</strong><p>{text}</p></div>; }
function Reports({ data, report, period, setPeriod, months, tab, setTab }) {
    const tabs = [["profit", "Laba rugi"], ["cash", "Arus kas"], ["balance", "Neraca"]];
    return <><PageHeading eyebrow="LAPORAN KEUANGAN" title="Angka yang saling terhubung" subtitle="Laporan disusun dari transaksi, saldo awal, dan aset yang kamu catat." actions={<MonthPicker value={period} onChange={setPeriod} months={months} />} /><div className="report-tabs">{tabs.map(([key, label]) => <button key={key} className={`report-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>)}</div><div className="report-layout section-gap"><div className="report-card">{tab === "profit" ? <IncomeReport report={report} /> : tab === "cash" ? <CashReport report={report} /> : <BalanceReport data={data} report={report} />}</div><aside className="report-card-side"><SideMetric label="Kas + rekening akhir periode" value={money(report.cash + report.bank, true)} text="Uang tersedia bukan ukuran laba." /><SideMetric label="Laba bersih tercatat" value={money(report.netProfit, true)} text="Modal, prive, aset, dan pembayaran pokok dipisahkan dari laba." /><SideMetric label="Perubahan kas periode ini" value={money(report.changeCash, true)} text="Termasuk arus operasi, investasi, dan pendanaan." /></aside></div></>;
}
function IncomeReport({ report: r }) {
    const ob = r.opexBreakdown || {};
    const hasBreakdown = Boolean(ob.payroll || ob.utilities || ob.operational || ob.maintenance);

    return <>
        <span className="eyebrow">KINERJA USAHA</span>
        <h2 style={{ marginTop: 5 }}>Laporan laba rugi</h2>
        <p className="panel-caption">{monthLabel(r.month)} · transaksi tercatat</p>
        <table className="report-table">
            <tbody>
                <ReportRow label="Pendapatan" value={r.revenue} subtotal />
                <ReportRow label="− COGS / HPP" value={r.cogs} indent />
                <ReportRow label="Laba kotor" value={r.grossProfit} total />
                <ReportRow label="− Total OPEX (Beban Operasional)" value={r.opex} indent subtotal={hasBreakdown} />
                {hasBreakdown && (
                    <>
                        <ReportRow label="• Beban Pegawai (HR/Payroll)" value={ob.payroll || 0} indentLevel={2} />
                        <ReportRow label="• Beban Utilitas & Tempat" value={ob.utilities || 0} indentLevel={2} />
                        <ReportRow label="• Beban Operasional & Umum" value={ob.operational || 0} indentLevel={2} />
                        <ReportRow label="• Beban Pemeliharaan" value={ob.maintenance || 0} indentLevel={2} />
                        {Boolean(ob.general) && <ReportRow label="• OPEX Lainnya" value={ob.general} indentLevel={2} />}
                    </>
                )}
                <ReportRow label="− Beban Pemasaran (Marketing/Selling)" value={r.marketing} indent />
                <ReportRow label="− Penyusutan aset" value={r.depreciation} indent />
                <ReportRow label="Laba operasional" value={r.operatingProfit} subtotal />
                <ReportRow label="+ Pendapatan non-operasional" value={r.nonOperatingIncome} indent />
                <ReportRow label="− Beban non-operasional" value={r.nonOperatingExpense} indent />
                <ReportRow label="Laba bersih tercatat" value={r.netProfit} total />
                <tr><td>Gross margin</td><td>{r.grossMargin === null ? "Belum dapat dihitung" : `${(r.grossMargin * 100).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</td></tr>
                <tr><td>COGS Ratio</td><td>{r.cogsRatio === null ? "Belum dapat dihitung" : `${(r.cogsRatio * 100).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</td></tr>
            </tbody>
        </table>
        <div className="report-note warning">HPP akrual yang akurat dapat memerlukan data persediaan, pembelian kredit, serta barang yang benar-benar terjual.</div>
    </>;
}
function ReportRow({ label, value, indent, indentLevel, subtotal, total }) {
    const indentClass = indentLevel === 2 ? "indent-2" : indent ? "indent" : "";
    return <tr className={`${indentClass} ${subtotal ? "subtotal" : ""} ${total ? "total" : ""}`}><td>{label}</td><td>{money(value)}</td></tr>;
}
function CashReport({ report: r }) { return <><span className="eyebrow">PERGERAKAN UANG</span><h2 style={{ marginTop: 5 }}>Laporan arus kas</h2><p className="panel-caption">{monthLabel(r.month)} · transaksi kas tercatat</p><table className="report-table"><tbody><ReportRow label="Kas awal periode*" value={r.cashOpening} /><ReportRow label="Arus kas operasi" value={r.operatingCashFlow} /><ReportRow label="Arus kas investasi" value={r.investingCashFlow} /><ReportRow label="Arus kas pendanaan" value={r.financingCashFlow} /><ReportRow label="Perubahan kas" value={r.changeCash} total /><ReportRow label="Kas akhir periode*" value={r.cashClosing} subtotal /></tbody></table><div className="report-note">* Saldo kas awal/akhir berasal dari saldo awal dan hanya menghitung total Cash + Rekening. Perpindahan antara akun tidak mengubah total arus kas.</div></>; }
function BalanceReport({ data, report: r }) { return <><span className="eyebrow">POSISI KEUANGAN</span><h2 style={{ marginTop: 5 }}>Neraca sederhana</h2><p className="panel-caption">Per {dateLabel(endOfMonth(r.month))} · bergantung pada saldo awal</p><table className="report-table"><tbody><tr className="subtotal"><td>ASET</td><td /></tr><ReportRow label="Kas" value={r.cash} indent /><ReportRow label="Rekening bank" value={r.bank} indent /><ReportRow label="Aset tetap bersih" value={r.fixedAssets} indent /><ReportRow label="Total aset" value={r.assetsTotal} total /><tr className="subtotal"><td>LIABILITAS</td><td /></tr><ReportRow label="Utang / pinjaman tercatat" value={r.liabilities} indent /><tr className="subtotal"><td>EKUITAS</td><td /></tr><ReportRow label="Modal awal & setoran modal" value={data.opening.equity + amountFor(r.rows, (tx) => tx.kind === "capital")} indent /><ReportRow label="Laba tercatat setelah prive" value={r.equity - data.opening.equity - amountFor(r.rows, (tx) => tx.kind === "capital")} indent /><ReportRow label="Total liabilitas & ekuitas" value={r.liabilities + r.equity} total /></tbody></table><div className={`report-note ${!data.opening.confirmed ? "warning" : Math.abs(r.balanceDifference) > 1 ? "error" : ""}`}>{data.opening.confirmed ? `Selisih neraca: ${money(r.balanceDifference)}. ${Math.abs(r.balanceDifference) > 1 ? "Periksa saldo awal, aset, utang, atau transaksi." : "Aset = liabilitas + ekuitas berdasarkan data yang dimasukkan."}` : "Saldo awal belum dikonfirmasi. Neraca belum dapat dianggap lengkap; isi kas, aset, utang, dan ekuitas awal."}</div></>; }
function Analysis({ analysis, period, setPeriod, months, reasoner }) {
    const severity = analysis.findings.length ? "warning" : "";
    return <><PageHeading eyebrow="KNOWLEDGE-BASED REASONING" title="Bukan cuma lampu merah atau hijau" subtitle="Setiap indikasi menampilkan evidence, aturan, urutan inferensi, dan bagian yang dapat diperiksa." actions={<MonthPicker value={period} onChange={setPeriod} months={months} />} /><div className={`analysis-summary ${severity}`}><span className="summary-check">{analysis.findings.length ? "!" : "✓"}</span><div><strong>{analysis.findings.length ? `${analysis.findings.length} indikasi untuk ditinjau` : "Belum ada indikasi dari aturan yang tersedia"}</strong><p>{analysis.reasons.join(" ") || "Hasil mengikuti data dan aturan untuk periode ini; bukan penilaian menyeluruh atas kesehatan usaha."}</p></div></div><ReasonerStatus reasoner={reasoner} /><div className="diagnosis-list">{analysis.findings.map((finding) => <article className="diagnosis-card" key={finding.id}><div className="diagnosis-head"><div><span className="eyebrow">DIAGNOSIS · {monthLabel(period).toUpperCase()}</span><h3 style={{ marginTop: 6 }}>{finding.title}</h3></div><span className="severity-badge">{finding.severity}</span></div><p>{finding.summary}</p><div className="evidence-grid">{finding.evidence.map(([label, value]) => <div className="evidence-item" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="reasoning-chain">{finding.chain.map((step, index) => <span key={`${finding.id}-${step}`} style={{ display: "contents" }}>{index > 0 && <span className="reason-arrow">→</span>}<span className={`reason-node ${index < finding.chain.length - 1 ? "active" : ""}`}>{step}</span></span>)}</div><div className="advisory-box"><strong>Yang bisa diperiksa:</strong> {finding.advice}</div></article>)}</div><div className="why-not"><strong>WHY-NOT · Mengapa kondisi lain tidak disimpulkan?</strong>{analysis.comparable ? "Sistem tidak menyimpulkan masalah biaya bila perubahan relatifnya tidak memenuhi aturan pembanding." : analysis.reasons.join(" ")}<br />Aturan tidak mengisi data yang tidak diketahui dengan asumsi.</div><div className="report-note section-gap">Analisis menggunakan bulan sebelumnya dan transaksi yang dicatat. Persediaan, piutang, dan utang usaha belum dimodelkan. Hasil adalah indikasi untuk ditinjau, bukan kesimpulan profesional.</div></>;
}
function Assets({ data, report, openTransaction }) { return <><PageHeading eyebrow="PENGELOLAAN ASET" title="Aset usaha" subtitle="Pembelian aset dicatat sebagai investasi; penyusutan menjadi beban berkala." actions={<button className="button button-primary" onClick={() => openTransaction("asset")}>＋ Catat pembelian aset</button>} /><div className="asset-grid">{data.assets.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-top"><span className="asset-symbol">▧</span><span className="asset-status">Aktif</span></div><h3>{asset.name}</h3><div className="asset-value">{money(asset.cost, true)}</div><p>Nilai perolehan · umur manfaat {asset.lifeMonths} bulan</p><div className="asset-meta"><span>Penyusutan per bulan</span><strong>{money((asset.cost - asset.residual) / asset.lifeMonths, true)}</strong></div><div className="asset-meta"><span>Mulai digunakan</span><span>{dateLabel(asset.startDate)}</span></div></article>)}{!data.assets.length && <div className="panel"><div className="empty-state"><strong>Belum ada aset terdaftar</strong>Catat transaksi pembelian aset untuk mulai menghitung penyusutan.</div></div>}</div><div className="report-note section-gap">Penyusutan bulan ini {money(report.depreciation)} menggunakan metode garis lurus. Konfirmasikan umur manfaat dan nilai residu.</div></>; }
function Settings({ data, setData, notify, onSignOut }) {
    function submitProfile(event) { event.preventDefault(); const form = new FormData(event.currentTarget); setData((old) => ({ ...old, profile: { businessName: String(form.get("businessName")).trim(), ownerName: String(form.get("ownerName")).trim(), businessType: String(form.get("businessType")).trim() } })); notify("Profil tersimpan."); }
    function submitOpening(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const cash = Number(form.get("cash")) || 0;
        const bank = Number(form.get("bank")) || 0;
        const fixedAssets = Number(form.get("fixedAssets")) || 0;
        const liabilities = Number(form.get("liabilities")) || 0;
        const values = [cash, bank, fixedAssets, liabilities];
        if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
            notify("Saldo harus berupa bilangan bulat rupiah nol atau lebih.");
            return;
        }
        // Ekuitas dihitung otomatis: Total Aset - Utang (Persamaan Dasar Akuntansi)
        const autoEquity = Math.max(0, cash + bank + fixedAssets - liabilities);
        setData((old) => ({
            ...old,
            opening: {
                date: String(form.get("date")),
                cash,
                bank,
                fixedAssets,
                liabilities,
                equity: autoEquity,
                confirmed: form.get("confirmed") === "on"
            }
        }));
        notify("Saldo awal tersimpan (Ekuitas dihitung otomatis).");
    }

    const [openingValues, setOpeningValues] = useState({
        cash: data.opening.cash || 0,
        bank: data.opening.bank || 0,
        fixedAssets: data.opening.fixedAssets || 0,
        liabilities: data.opening.liabilities || 0,
    });

    const autoEquity = Math.max(0, openingValues.cash + openingValues.bank + openingValues.fixedAssets - openingValues.liabilities);

    return <><PageHeading eyebrow="PROFIL & SALDO AWAL" title="Pengaturan usaha" subtitle="Saldo awal menjadi titik awal pencatatan laporan keuangan usahamu." actions={onSignOut ? <button className="button button-secondary" onClick={onSignOut}>Keluar</button> : <button className="button button-secondary" onClick={() => { if (window.confirm("Reset semua data contoh?")) setData(sampleData()); }}>Muat data contoh</button>} /><div className="settings-layout"><div className="panel"><h2 className="panel-title">Profil usaha</h2><form className="settings-form" onSubmit={submitProfile}><label className="field field-wide"><span>Nama usaha</span><input name="businessName" defaultValue={data.profile.businessName} required /></label><label className="field"><span>Nama pemilik</span><input name="ownerName" defaultValue={data.profile.ownerName} required /></label><label className="field"><span>Jenis usaha</span><input name="businessType" defaultValue={data.profile.businessType} /></label><button className="button button-primary settings-save">Simpan profil</button></form><h2 className="panel-title section-gap">Saldo awal</h2><form className="settings-form" onSubmit={submitOpening}><label className="field field-wide"><span>Tanggal saldo awal</span><input type="date" name="date" defaultValue={data.opening.date} required /></label>
        {[
            ["cash", "Cash awal di tangan (Rp)"],
            ["bank", "Saldo rekening bank awal (Rp)"],
            ["fixedAssets", "Aset tetap awal (peralatan, mesin, dll) (Rp)"],
            ["liabilities", "Utang / pinjaman awal (Rp)"]
        ].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input name={key} type="number" min="0" step="1" defaultValue={data.opening[key] || 0} required onChange={(e) => setOpeningValues(v => ({ ...v, [key]: Number(e.target.value) || 0 }))} /></label>)}

        <div className="field field-wide" style={{ background: "#f5f8f4", padding: "12px 14px", borderRadius: 8, border: "1px solid #e2e8e0", margin: "4px 0" }}>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Ekuitas / Modal Awal</span>
            <strong style={{ fontSize: 18, color: "var(--green-dark)", marginTop: 4, display: "block" }}>{money(autoEquity)}</strong>
        </div>

        <label className="field-checkbox field-wide">
            <input name="confirmed" type="checkbox" defaultChecked={data.opening.confirmed} />
            <span>Saya sudah memeriksa saldo awal ini</span>
        </label>
        <button className="button button-primary settings-save">Simpan saldo awal</button>
    </form></div><aside className="report-card-side"><div className="report-card"><h2 className="panel-title">Cash ≠ laba ≠ modal</h2><p className="panel-caption" style={{ lineHeight: 1.8 }}>Setoran modal menambah uang dan ekuitas, bukan pendapatan. Laba dihitung dari pendapatan dikurangi biaya serta penyusutan. Saldo uang berubah juga karena investasi, pinjaman, dan prive.</p></div><div className="settings-note"><strong>Posisi Keuangan Rapi.</strong><br />Saldo awal menjadi acuan untuk menghitung neraca dan arus kas berjalan usahamu.</div></aside></div></>;
}
function TransactionModal({ initial, initialAsset, initialKind, onClose, onSave }) {
    const [kind, setKind] = useState(initial?.kind || initialKind || "revenue");
    const [category, setCategory] = useState(initial?.category || CATEGORIES[initial?.kind || initialKind || "revenue"][0]);
    const [account, setAccount] = useState(initial?.account || "cash");
    const [transferTo, setTransferTo] = useState(initial?.transferTo || (initial?.account === "bank" ? "cash" : "bank"));
    const [error, setError] = useState("");
    function submit(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const amount = Number(form.get("amount")); if (!Number.isSafeInteger(amount) || amount <= 0) { setError("Nominal harus berupa bilangan bulat rupiah yang lebih besar dari nol."); return; } if (kind === "transfer" && account === transferTo) { setError("Akun asal dan tujuan harus berbeda."); return; } const lifeMonths = Number(form.get("lifeMonths")); const residual = Number(form.get("residual")); if (kind === "asset" && (!Number.isSafeInteger(lifeMonths) || lifeMonths <= 0 || !Number.isSafeInteger(residual) || residual < 0 || residual > amount)) { setError("Umur manfaat harus bilangan bulat lebih dari nol dan nilai residu tidak boleh melebihi harga aset."); return; } const assetId = kind === "asset" ? (initial?.assetId || id()) : undefined; const assetName = kind === "asset" ? String(form.get("assetName")).trim() : ""; const description = kind === "asset" ? assetName : kind === "transfer" ? `${accountLabel(account)} ke ${accountLabel(transferTo)}` : category; const tx = { id: initial?.id || id(), date: String(form.get("date")), description, kind, category, amount, account, note: String(form.get("note") || "").trim(), ...(kind === "transfer" ? { transferTo } : {}), ...(assetId ? { assetId } : {}) }; const asset = kind === "asset" ? { id: assetId, name: assetName, cost: amount, residual, lifeMonths, startDate: tx.date, account, opening: false } : null; onSave(tx, asset); }
    const hint = { revenue: "Pendapatan menambah saldo dan pendapatan usaha. Setoran modal bukan pendapatan.", expense: "Pengeluaran masuk ke laporan laba rugi sesuai kategori.", capital: "Setoran modal menambah saldo dan ekuitas, bukan pendapatan atau laba.", loan: "Pinjaman masuk menambah saldo dan utang, bukan pendapatan usaha.", draw: "Prive mengurangi saldo dan ekuitas, bukan beban operasional.", principal: "Pembayaran pokok pinjaman mengurangi saldo dan utang, bukan beban laba rugi.", transfer: "Perpindahan saldo mengurangi akun asal dan menambah akun tujuan. Total uang dan laba tidak berubah." };
    const accountOptions = <><option value="cash">Cash</option><option value="bank">Rekening</option></>;
    return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-box" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal-heading"><div><span className="eyebrow">{KIND_NAMES[kind].toLocaleUpperCase("id-ID")}</span><h2 id="transaction-title">{initial ? `Ubah ${KIND_NAMES[kind].toLocaleLowerCase("id-ID")}` : `Tambah ${KIND_NAMES[kind].toLocaleLowerCase("id-ID")}`}</h2></div><button className="modal-close" onClick={onClose} aria-label="Tutup">×</button></div><form onSubmit={submit}><div className="form-grid">{kind === "asset" && <label className="field field-wide"><span>Nama aset</span><input name="assetName" defaultValue={initialAsset?.name || initial?.description} required maxLength="90" placeholder="Contoh: Mesin produksi" /></label>}{kind !== "transfer" && <label className="field"><span>Kategori</span><select name="category" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES[kind].map((item) => <option key={item}>{item}</option>)}</select></label>}<label className="field"><span>Nominal (Rp)</span><input name="amount" type="number" min="1" step="1" defaultValue={initial?.amount} required /></label><label className="field"><span>Tanggal</span><input name="date" type="date" defaultValue={initial?.date || today()} required /></label><label className="field"><span>{kind === "transfer" ? "Dari akun" : "Metode penerimaan / pembayaran"}</span><select name="account" value={account} onChange={(event) => { setAccount(event.target.value); if (kind === "transfer") setTransferTo(event.target.value === "cash" ? "bank" : "cash"); }}>{accountOptions}</select></label>{kind === "transfer" && <label className="field"><span>Ke akun</span><select value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>{accountOptions}</select></label>}{kind === "asset" && <><label className="field"><span>Umur manfaat (bulan)</span><input name="lifeMonths" type="number" min="1" step="1" defaultValue={initialAsset?.lifeMonths || 12} required /></label><label className="field"><span>Nilai residu (Rp)</span><input name="residual" type="number" min="0" step="1" defaultValue={initialAsset?.residual || 0} required /></label></>}<label className="field field-wide"><span>Catatan</span><textarea name="note" rows="2" defaultValue={initial?.note} placeholder="Tulis detail tambahan, misalnya dari mana atau untuk keperluan apa." /></label></div><div className="form-hint">{hint[kind]}</div>{error && <div className="notice-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Batal</button><button className="button button-primary">Simpan catatan</button></div></form></section></div>;
}
function AuthPage({ mode, setMode, onSubmit, error, message, submitting, onDemo }) {
    function submit(event) {
        if (mode !== "signup") return;
        const form = new FormData(event.currentTarget);
        if (form.get("password") !== form.get("confirmPassword")) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.elements.namedItem("confirmPassword").setCustomValidity("Kata sandi belum sama.");
            event.currentTarget.reportValidity();
        }
    }
    return <main className="prototype-auth">
        <span className="brand-mark">R</span>
        <h1>{mode === "signup" ? "Buat akun RuangUsaha" : "Masuk ke RuangUsaha"}</h1>
        <p>{mode === "signup" ? "Workspace baru akan dibuat khusus untuk akunmu." : "Masuk untuk membuka workspace keuangan milikmu."}</p>
        <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 14px", fontSize: "0.84rem", marginBottom: 16, color: "var(--text-muted, #ccc)" }}>
            <strong>Akun Testing / Uji Coba:</strong><br />
            Username: <code style={{ color: "#8be9fd" }}>admin_trial</code> | Password: <code style={{ color: "#8be9fd" }}>12345</code>
        </div>
        <form onSubmit={(event) => { submit(event); if (!event.defaultPrevented) onSubmit(event); }}>
            {mode === "signup" && <label className="field"><span>Nama pemilik / usaha</span><input name="fullName" autoComplete="name" maxLength="80" required placeholder="Contoh: Budi Santoso" /></label>}
            <label className="field"><span>Username / Email</span><input type="text" name="email" autoComplete="username" required placeholder="admin_trial atau email kamu" /></label>
            <label className="field"><span>Kata sandi</span><input type="password" name="password" minLength="4" autoComplete={mode === "signup" ? "new-password" : "current-password"} required placeholder="Minimal 4 karakter" onChange={(event) => { const confirm = event.currentTarget.form.elements.namedItem("confirmPassword"); if (confirm?.value) confirm.setCustomValidity(confirm.value === event.currentTarget.value ? "" : "Kata sandi belum sama."); }} /></label>
            {mode === "signup" && <label className="field"><span>Ulangi kata sandi</span><input type="password" name="confirmPassword" minLength="4" autoComplete="new-password" required placeholder="Ulangi kata sandi" onChange={(event) => { event.currentTarget.setCustomValidity(event.currentTarget.value === event.currentTarget.form.elements.namedItem("password").value ? "" : "Kata sandi belum sama."); }} /></label>}
            {error && <div className="notice-error" role="alert">{error}</div>}
            {message && <div className="auth-message" role="status">{message}</div>}
            <button className="button button-primary" type="submit" style={{ width: "100%", marginTop: 14 }} disabled={submitting}>{submitting ? "Memproses…" : mode === "signup" ? "Buat akun baru" : "Masuk"}</button>
        </form>
        <p className="auth-switch">{mode === "signup" ? "Sudah punya akun?" : "Belum punya akun?"} <button className="panel-link" type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Masuk" : "Daftar sekarang"}</button></p>
        <div className="auth-divider"><span>atau</span></div>
        <button className="button button-secondary auth-demo-button" type="button" onClick={onDemo}>Masuk sebagai Tamu (Guest Demo)</button>
        <p className="auth-footnote">Setiap akun memiliki workspace catatan keuangan tersendiri yang terpisah.</p>
    </main>;
}

export default App;
