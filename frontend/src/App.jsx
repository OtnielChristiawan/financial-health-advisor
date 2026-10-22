import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase";

const STORAGE_KEY = "ruangusaha-financial-v1";
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const TITLES = {
    dashboard: "Ringkasan",
    transactions: "Transaksi",
    closing: "Tutup Buku & Stok Opname",
    reports: "Laporan keuangan",
    analysis: "Analisis KBR",
    assets: "Aset usaha",
    settings: "Pengaturan usaha",
};
const CATEGORIES = {
    revenue: ["Penjualan", "Pendapatan jasa", "Pendapatan usaha lainnya", "Pendapatan non-operasional"],
    expense: [
        "Pembelian Bahan Baku",
        "COGS / HPP",
        "Beban Pegawai (HR/Payroll)",
        "Beban Utilitas & Tempat",
        "Beban Operasional & Umum",
        "Beban Pemasaran (Marketing/Selling)",
        "Beban Pemeliharaan",
        "Beban non-operasional",
    ],
    capital: ["Setoran modal pemilik"],
    loan: ["Penerimaan pinjaman"],
    draw: ["Prive / pengambilan pribadi"],
    principal: ["Pembayaran pokok pinjaman"],
    transfer: ["Perpindahan saldo"],
    asset: ["Aset tetap"],
};
const KIND_NAMES = {
    revenue: "Pendapatan",
    expense: "Pengeluaran",
    capital: "Setoran modal",
    loan: "Pinjaman masuk",
    draw: "Prive",
    principal: "Bayar pokok pinjaman",
    transfer: "Perpindahan saldo",
    asset: "Pembelian aset",
};
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
    if (!month) return today();
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
    add("2026-08-05", "Pembelian bahan baku (biji kopi & susu)", "expense", "Pembelian Bahan Baku", 38_000_000);
    add("2026-08-08", "Gaji barista & kitchen", "expense", "Beban Pegawai (HR/Payroll)", 18_000_000);
    add("2026-08-10", "Sewa ruko & tagihan listrik/air", "expense", "Beban Utilitas & Tempat", 7_000_000);
    add("2026-08-12", "Cup, sedotan, plastik & ATK", "expense", "Beban Operasional & Umum", 3_500_000);
    add("2026-08-14", "Servis grinder & filter air", "expense", "Beban Pemeliharaan", 1_500_000);
    add("2026-08-15", "Iklan IG & potongan MDR QRIS", "expense", "Beban Pemasaran (Marketing/Selling)", 4_000_000);
    add("2026-08-25", "Pengambilan pemilik", "draw", CATEGORIES.draw[0], 3_000_000);
    add("2026-08-27", "Pembayaran pokok pinjaman", "principal", CATEGORIES.principal[0], 2_000_000);

    add("2026-09-03", "Penjualan September", "revenue", "Penjualan", 100_000_000);
    add("2026-09-05", "Pembelian bahan baku (biji kopi & susu)", "expense", "Pembelian Bahan Baku", 46_500_000);
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
        opening: { date: "2026-07-31", cash: 12_000_000, bank: 15_000_000, inventory: 3_000_000, fixedAssets: 0, liabilities: 5_000_000, equity: 25_000_000, confirmed: true },
        transactions,
        assets: [{ id: assetId, name: "Mesin kopi espresso", cost: 12_000_000, residual: 0, lifeMonths: 12, startDate: "2026-09-12", account: "cash", opening: false }],
        customCategories: [],
        closings: [
            {
                period: "2026-08",
                status: "closed",
                stockOpnameDate: "2026-08-31",
                openingInventory: 3_000_000,
                purchases: 38_000_000,
                endingInventory: 3_000_000,
                rawMaterialConsumption: 38_000_000,
                notes: "Stock opname fisik akhir Agustus selesai.",
                closedAt: "2026-08-31T21:00:00Z",
                closedBy: "Andi Rahman",
            }
        ],
    };
}

function emptyData(ownerName = "Pemilik usaha") {
    return {
        version: 1, demo: false,
        profile: { businessName: "Usaha Saya", ownerName, businessType: "Kuliner" },
        opening: { date: today(), cash: 0, bank: 0, inventory: 0, fixedAssets: 0, liabilities: 0, equity: 0, confirmed: false },
        transactions: [],
        assets: [],
        customCategories: [],
        closings: [],
    };
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
    if (!localStorage.getItem(`${STORAGE_KEY}-admin_trial`)) {
        try {
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

    // Muat workspace berdasarkan sesi
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
        if (Array.isArray(data.closings)) {
            data.closings.forEach((c) => { if (c.period) found.add(c.period); });
        }
        return [...found].filter(Boolean).sort().reverse();
    }, [data.transactions, data.opening.date, data.closings, period]);

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
    const diagnosis = financialReport.status === "ok" ? reportBody?.diagnosis || null : null;

    // Reasoner state diisi langsung secara otoritatif dari diagnosa backend OWL
    useEffect(() => {
        if (diagnosis) {
            setReasoner({
                status: "ok",
                result: {
                    engine: diagnosis.engine || "OWL + SWRL / Pellet",
                    java: "Java 25",
                    elapsed_ms: diagnosis.elapsed_ms || 0,
                    inferred: Array.from(diagnosis.inferred_classes || []),
                    recommendations: diagnosis.recommendations || [],
                    cost_drivers: diagnosis.cost_drivers || [],
                },
                error: "",
            });
        } else if (financialReport.status === "error") {
            setReasoner({ status: "error", result: null, error: financialReport.error });
        }
    }, [diagnosis, financialReport.status, financialReport.error]);

    const currentEmailOrUser = session?.user?.email || localSession?.username || (demoSession ? "Tamu (Mode Demo)" : "Pengguna");
    const currentOwner = data.profile.ownerName || localSession?.fullName || "Pemilik usaha";

    const userInitials = useMemo(() => {
        const name = (currentOwner || "").trim();
        if (!name) return "RU";
        const parts = name.split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }, [currentOwner]);

    // Single Source of Truth: Status kesehatan finansial langsung dari backend OWL diagnosis
    const healthStatus = useMemo(() => {
        if (!diagnosis) return { key: "limited", label: "Menghitung…", level: "limited", desc: "Menghubungkan ke reasoner backend..." };
        return {
            key: diagnosis.level,
            label: diagnosis.status_label,
            level: diagnosis.level,
            desc: diagnosis.summary,
        };
    }, [diagnosis]);

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
        const isClosed = data.closings?.some((c) => c.period === period && c.status === "closed");
        if (isClosed) {
            notify(`Periode ${monthLabel(period)} telah ditutup buku. Buka kembali periode di menu Tutup Buku jika perlu menambah data.`);
            return;
        }
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
        const email = String(form.get("email") || "").trim();
        const password = String(form.get("password") || "").trim();
        const fullName = String(form.get("fullName") || "").trim();

        if (!supabaseConfigured) {
            const users = getLocalUsers();
            if (authMode === "login") {
                const user = users[email];
                if (user && user.password === password) {
                    const sessionData = { username: user.username, fullName: user.fullName, workspaceKey: user.workspaceKey };
                    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sessionData));
                    setLocalSession(sessionData);
                    setDemoSession(false);
                    setAuthSubmitting(false);
                    return;
                }
                setAuthError("Username atau kata sandi lokal salah.");
                setAuthSubmitting(false);
                return;
            } else {
                if (users[email]) {
                    setAuthError("Username sudah terdaftar.");
                    setAuthSubmitting(false);
                    return;
                }
                const newUser = {
                    username: email,
                    password: password,
                    fullName: fullName || email,
                    workspaceKey: `${STORAGE_KEY}-${email}`
                };
                users[email] = newUser;
                localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
                const sessionData = { username: newUser.username, fullName: newUser.fullName, workspaceKey: newUser.workspaceKey };
                localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sessionData));
                setLocalSession(sessionData);
                setDemoSession(false);
                setAuthSubmitting(false);
                return;
            }
        }

        try {
            if (authMode === "login") {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName } },
                });
                if (error) throw error;
                setAuthMessage("Akun berhasil dibuat. Silakan periksa email untuk konfirmasi.");
            }
        } catch (error) {
            setAuthError(error.message);
        } finally {
            setAuthSubmitting(false);
        }
    }

    if (!authReady) return <div className="app-loading">Menyiapkan RuangUsaha…</div>;
    if (supabaseConfigured && !session && !demoSession) {
        return <AuthPage mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} error={authError} message={authMessage} submitting={authSubmitting} onDemo={() => setDemoSession(true)} />;
    }
    if (!supabaseConfigured && !localSession && !demoSession) {
        return <AuthPage mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} error={authError} message={authMessage} submitting={authSubmitting} onDemo={() => setDemoSession(true)} />;
    }

    if (workspaceError) return <main className="prototype-auth"><span className="brand-mark">R</span><h1>Workspace belum dapat dimuat</h1><p>{workspaceError}</p><button className="button button-primary" onClick={() => setWorkspaceRetry((value) => value + 1)}>Coba lagi</button><button className="button button-secondary" style={{ marginLeft: 8 }} onClick={handleSignOut}>Keluar</button></main>;
    if (!report) {
        if (financialReport.status === "error" && financialReport.request === reportRequest) {
            return <main className="prototype-auth"><h1>Laporan belum dapat dimuat</h1><p>{financialReport.error}</p><button className="button button-primary" onClick={() => setReportRetry((value) => value + 1)}>Coba lagi</button></main>;
        }
        return <div className="app-loading">Menghitung laporan & diagnosa KBR di backend…</div>;
    }

    const nav = [
        ["dashboard", "◫", "Ringkasan"],
        ["transactions", "↕", "Transaksi"],
        ["closing", "🔒", "Tutup Buku"],
        ["reports", "▤", "Laporan keuangan"],
        ["analysis", "✳", "Analisis KBR"],
        ["assets", "▧", "Aset usaha"],
    ];

    const renderPage = () => {
        if (page === "dashboard") return <Dashboard data={data} report={report} trend={trend} diagnosis={diagnosis} period={period} setPeriod={setPeriod} months={availableMonths} setPage={setPage} openTransaction={openTransaction} reasoner={reasoner} />;
        if (page === "transactions") return <Transactions data={data} setData={setData} period={period} setPeriod={setPeriod} setEditing={setEditing} setShowForm={setShowForm} setNewTransactionKind={setNewTransactionKind} openTransaction={openTransaction} notify={notify} setPage={setPage} />;
        if (page === "closing") return <ClosingManager data={data} setData={setData} report={report} period={period} setPeriod={setPeriod} months={availableMonths} notify={notify} currentOwner={currentOwner} />;
        if (page === "reports") return <Reports data={data} report={report} period={period} setPeriod={setPeriod} months={availableMonths} tab={reportTab} setTab={setReportTab} />;
        if (page === "analysis") return <Analysis diagnosis={diagnosis} report={report} period={period} setPeriod={setPeriod} months={availableMonths} reasoner={reasoner} />;
        if (page === "assets") return <Assets data={data} report={report} openTransaction={openTransaction} />;
        return <Settings data={data} setData={setData} notify={notify} onSignOut={handleSignOut} />;
    };

    return <div className="app-shell" onClick={() => { if (showUserMenu) setShowUserMenu(false); }}>
        <aside className="sidebar">
            <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage("dashboard"); }}><span className="brand-mark">R</span><span className="brand-copy"><strong>ruangusaha</strong><small>FINANCIAL HEALTH</small></span></a>
            <div className="business-switcher"><span className="business-avatar">{userInitials}</span><span className="business-info"><strong>{data.profile.businessName}</strong><small>{currentEmailOrUser}</small></span><span className="switch-chevron">⌄</span></div>
            <p className="nav-label">MENU UTAMA</p>
            <nav className="main-nav" aria-label="Navigasi utama">
                {nav.map(([key, icon, label]) => (
                    <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => setPage(key)}>
                        <span className="nav-icon">{icon}</span>{label}
                        {key === "closing" && <span className="nav-pill" style={{ background: "#e8f5ec", color: "#2d754e" }}>SAK</span>}
                        {key === "analysis" && <span className="nav-pill">OWL</span>}
                    </button>
                ))}
            </nav>
            <p className="nav-label nav-label-bottom">PREFERENSI</p>
            <nav className="main-nav">
                <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}>
                    <span className="nav-icon">⚙</span>Pengaturan usaha
                </button>
            </nav>
            <div className="sidebar-bottom">
                <div className="help-card">
                    <span className="help-spark">✦</span>
                    <strong>Sistem Pakar SAK EMKM.</strong>
                    <p>Integrasi akuntansi periodik F&B dan penalaran OWL/SWRL Pellet.</p>
                    <button onClick={() => setPage("analysis")}>Lihat cara kerja <span>→</span></button>
                </div>
                <div className="profile-row">
                    <span className="profile-avatar">{userInitials}</span>
                    <span><strong>{currentOwner}</strong><small>{currentEmailOrUser}</small></span>
                    <button className="profile-more" title="Keluar / Logout" aria-label="Keluar" onClick={handleSignOut}>↪</button>
                </div>
            </div>
        </aside>
        <main className="main-area">
            <header className="topbar">
                <div className="breadcrumb"><span>RuangUsaha</span><span className="crumb-sep">/</span><strong>{TITLES[page]}</strong></div>
                <div className="topbar-actions">
                    <span
                        title={supabaseConfigured && !demoSession ? "Tersambung ke Database Supabase" : "Data tersimpan di perangkat ini"}
                        style={{ display: "inline-flex", alignItems: "center", cursor: "help" }}
                    >
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#4bb56e", boxShadow: "0 0 0 3px rgba(75, 181, 110, 0.2)" }}></span>
                    </span>

                    <button
                        className={`health-status-badge ${healthStatus.level}`}
                        title={`Status Keuangan: ${healthStatus.label} (${healthStatus.desc || "Buka Analisis KBR"}). Klik untuk membuka penalaran sistem.`}
                        onClick={() => setPage("analysis")}
                    >
                        <span className="status-dot"></span>
                        <span>{healthStatus.label}</span>
                        <span className="icon-q">?</span>
                    </button>

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
                                <button className="user-dropdown-item" role="menuitem" onClick={() => { setPage("closing"); setShowUserMenu(false); }}>
                                    <span>🔒</span> Tutup Buku Bulanan
                                </button>
                                <button className="user-dropdown-item" role="menuitem" onClick={() => { setPage("settings"); setShowUserMenu(false); }}>
                                    <span>⚙</span> Pengaturan usaha
                                </button>
                                <button className="user-dropdown-item" role="menuitem" onClick={() => { setPage("analysis"); setShowUserMenu(false); }}>
                                    <span>✳</span> Analisis KBR
                                </button>
                                <div style={{ height: 1, background: "#f0f3ee", margin: "4px 0" }}></div>
                                <button className="user-dropdown-item danger" role="menuitem" onClick={() => { setShowUserMenu(false); handleSignOut(); }}>
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
            <footer className="app-footer"><span>RuangUsaha {new Date().getFullYear()} · Asisten keuangan & sistem pakar UMKM F&B</span><span>Sesuai standar SAK EMKM & inferensi OWL 2 DL / SWRL.</span>{demoSession && <button className="panel-link" onClick={handleSignOut}>Keluar dari akun demo</button>}</footer>
        </main>
        {showForm && (
            <TransactionModal
                initial={editing}
                initialAsset={data.assets.find((asset) => asset.id === editing?.assetId)}
                initialKind={newTransactionKind}
                closings={data.closings || []}
                customCategories={data.customCategories || []}
                existingNotes={[...new Set(data.transactions.map((t) => t.note).filter(Boolean))]}
                onClose={() => { setShowForm(false); setEditing(null); }}
                onSave={(tx, asset) => {
                    const isClosed = data.closings?.some((c) => c.period === monthOf(tx.date) && c.status === "closed");
                    if (isClosed) {
                        alert(`Periode ${monthLabel(monthOf(tx.date))} telah ditutup buku. Buka kembali periode di menu Tutup Buku untuk mengubah data.`);
                        return;
                    }
                    setData((old) => ({
                        ...old,
                        demo: false,
                        transactions: old.transactions.some((item) => item.id === tx.id)
                            ? old.transactions.map((item) => item.id === tx.id ? tx : item)
                            : [tx, ...old.transactions],
                        assets: asset
                            ? old.assets.some((item) => item.id === asset.id)
                                ? old.assets.map((item) => item.id === asset.id ? asset : item)
                                : [...old.assets, asset]
                            : old.assets.filter((item) => item.id !== editing?.assetId)
                    }));
                    setPeriod(monthOf(tx.date));
                    setShowForm(false);
                    setEditing(null);
                    notify("Transaksi berhasil disimpan.");
                }}
            />
        )}
    </div>;
}

function PageHeading({ eyebrow, title, subtitle, actions }) {
    return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div><div className="heading-actions">{actions}</div></div>;
}

function MonthPicker({ value, onChange, months }) {
    return <select className="period-select" aria-label="Pilih periode" value={value} onChange={(event) => onChange(event.target.value)}>{months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select>;
}

function Stats({ report }) {
    const prev = report.previous;
    const cards = [
        ["Total Penjualan", money(report.revenue, true), "↗", prev?.revenue ? percent((report.revenue - prev.revenue) / prev.revenue * 100) : "Omzet tercatat"],
        ["Laba Bersih*", money(report.netProfit, true), "◉", report.isClosed ? "Final setelah tutup buku" : "Estimasi / Belum tutup buku"],
        ["Saldo Kas & Bank", money(report.cash + report.bank, true), "▣", `Arus kas bersih ${money(report.changeCash, true)}`],
        ["Stok Akhir Bahan", money(report.endingInventory || 0, true), "📦", report.isClosed ? "Hasil stock opname fisik" : "Estimasi persediaan berjalan"],
        ["HPP / Biaya Bahan", money(report.cogs, true), "🍳", `Rasio: ${report.cogsRatio ? (report.cogsRatio * 100).toFixed(1) + "%" : "—"}`],
        ["Gross Margin", report.grossMargin === null ? "—" : `${(report.grossMargin * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, "◌", `Laba kotor ${money(report.grossProfit, true)}`],
    ];
    return <section className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>{cards.map(([label, value, icon, foot]) => <article className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot"><span className={`delta ${label === "Saldo Kas & Bank" ? (report.changeCash >= 0 ? "positive" : "negative") : "neutral"}`}>{label === "Saldo Kas & Bank" ? (report.changeCash >= 0 ? "Naik" : "Turun") : ""}</span>{foot}</div></article>)}</section>;
}

function ReasonerStatus({ reasoner }) {
    if (reasoner.status === "loading") return <div className="reasoner-pill">Mengirim fakta ke knowledge base OWL/Pellet…</div>;
    if (reasoner.status === "ok") {
        const visible = reasoner.result.inferred.filter((name) => ["CostEscalation", "MarginPressure", "OPEXPressure", "MarketingEfficiencyReview", "ProfitPressure", "ProfitCashGap", "LiquidityPressure", "OwnerDrawLiquidityPressure", "LiquidityCritical"].includes(name));
        return <div className="reasoner-pill"><strong>{reasoner.result.engine} aktif</strong> · {reasoner.result.java} · {visible.length ? visible.join(", ") : "tidak ada anomali"} · {reasoner.result.elapsed_ms} ms</div>;
    }
    return <div className={`reasoner-pill ${reasoner.status === "error" ? "error" : ""}`}>{reasoner.status === "error" ? `Reasoner OWL error: ${reasoner.error}` : reasoner.error || "Reasoner menunggu data pembanding."}</div>;
}

function Dashboard({ data, report, trend, diagnosis, period, setPeriod, months, setPage, openTransaction, reasoner }) {
    const max = Math.max(1, ...trend.map((item) => item.revenue));
    const latestFinding = diagnosis?.findings?.[0];
    const latestTransactions = data.transactions.filter((tx) => monthOf(tx.date) === period).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);

    return <>
        <PageHeading
            eyebrow="RINGKASAN USAHA"
            title={`Halo, ${data.profile.ownerName} 👋`}
            subtitle={`Berikut gambaran keuangan ${data.profile.businessName} untuk ${monthLabel(period)}.`}
            actions={<>
                <span className={`status-pill ${report.isClosed ? "closed" : "provisional"}`} style={{ marginRight: 6 }}>
                    {report.isClosed ? "🔒 Tutup Buku Final" : "⏳ Periode Berjalan (Estimasi)"}
                </span>
                <MonthPicker value={period} onChange={setPeriod} months={months} />
                <button className="button button-primary" onClick={() => openTransaction("revenue")}>＋ Catat transaksi</button>
            </>}
        />
        <Stats report={report} />
        <div className="report-note report-data-note">
            * {report.isClosed ? "Laporan telah ditutup buku secara final berdasarkan hasil stock opname fisik." : "Laba dihitung dari transaksi berjalan. Lakukan stock opname di menu Tutup Buku untuk mengonfirmasi HPP dan laba bersih final."}
        </div>
        <div className="dashboard-grid">
            <section className="panel">
                <div className="panel-header">
                    <div>
                        <h2 className="panel-title">Tren keuangan</h2>
                        <p className="panel-caption">Pendapatan dibandingkan biaya bahan (HPP) dan operasional</p>
                    </div>
                    <button className="panel-link" onClick={() => setPage("reports")}>Lihat laporan →</button>
                </div>
                <div className="chart-legend">
                    <span><i className="legend-dot" />Pendapatan</span>
                    <span><i className="legend-dot orange" />HPP</span>
                    <span><i className="legend-dot gray" />Laba</span>
                </div>
                <div className="trend-chart">
                    {trend.map(({ month, revenue, cogs, netProfit }) => (
                        <div className="trend-month" key={month}>
                            <div className="bars">
                                <i className="bar" style={{ height: `${Math.max(2, revenue / max * 100)}%` }} />
                                <i className="bar expense" style={{ height: `${Math.max(2, cogs / max * 100)}%` }} />
                                <i className="bar profit" style={{ height: `${Math.max(2, Math.max(0, netProfit) / max * 100)}%` }} />
                            </div>
                            <span className="month-label">{MONTHS[Number(month.slice(5, 7)) - 1].slice(0, 3)}</span>
                        </div>
                    ))}
                </div>
            </section>
            <section className={`health-card ${diagnosis?.level === "healthy" ? "health-ok" : "health-warning"}`}>
                <div className="health-label"><i />SISTEM PAKAR OWL/PELLET</div>
                <h2 className="health-title">{diagnosis?.status_label || "Evaluasi Keuangan"}</h2>
                <p className="health-copy">{diagnosis?.summary || "Menghitung data..."}</p>
                <button className="health-link" onClick={() => setPage("analysis")}>Buka analisis KBR lengkap →</button>
                <ReasonerStatus reasoner={reasoner} />
            </section>
        </div>
        <div className="lower-grid">
            <section className="panel">
                <div className="panel-header">
                    <div>
                        <h2 className="panel-title">Transaksi terbaru</h2>
                        <p className="panel-caption">{data.transactions.filter((tx) => monthOf(tx.date) === period).length} transaksi pada periode ini</p>
                    </div>
                    <button className="panel-link" onClick={() => setPage("transactions")}>Semua transaksi →</button>
                </div>
                {latestTransactions.map((tx) => <MiniTransaction key={tx.id} tx={tx} />)}
                {!latestTransactions.length && <div className="empty-state"><strong>Belum ada transaksi</strong>Mulai catat transaksi untuk melihat ringkasan.</div>}
            </section>
            <section className="panel">
                <div className="panel-header">
                    <div>
                        <h2 className="panel-title">Diagnosa Sistem Pakar</h2>
                        <p className="panel-caption">Bukti numerik → aturan inferensi SWRL → rekomendasi F&B</p>
                    </div>
                </div>
                <ReasonerStatus reasoner={reasoner} />
                {latestFinding ? (
                    <div className="reasoning-teaser">
                        <span className="eyebrow" style={{ color: "#8a5818" }}>{latestFinding.domain} · {latestFinding.rule}</span>
                        <h3>{latestFinding.title}</h3>
                        <p style={{ fontSize: 13, color: "#546457", margin: "4px 0 10px" }}>{latestFinding.explanation}</p>
                        {latestFinding.chain.slice(0, 3).map((step, index) => (
                            <div className="reasoning-line" key={step}><span className="step-dot">{index + 1}</span>{step}</div>
                        ))}
                        <button className="panel-link" onClick={() => setPage("analysis")} style={{ marginTop: 10 }}>Telusuri bukti & saran →</button>
                    </div>
                ) : (
                    <div className="reasoning-teaser">
                        <h3>{diagnosis?.status === "DATA_TIDAK_CUKUP" ? "Data Belum Memadai" : "Kondisi Terpantau Stabil"}</h3>
                        <p>{diagnosis?.summary || "Lengkapi transaksi dua bulan berurutan."}</p>
                    </div>
                )}
            </section>
        </div>
    </>;
}

function MiniTransaction({ tx }) {
    const isTransfer = tx.kind === "transfer";
    const positive = cashDelta(tx) > 0;
    const title = tx.kind === "asset" ? tx.description : isTransfer ? "Pemindahan saldo" : KIND_NAMES[tx.kind];
    const detail = isTransfer ? `${accountLabel(tx.account)} → ${accountLabel(tx.transferTo)}` : `${tx.category} · ${accountLabel(tx.account)}`;
    return <div className="mini-row"><span className={`mini-symbol ${isTransfer ? "transfer" : positive ? "" : "out"}`}>{isTransfer ? "↔" : positive ? "↗" : "↙"}</span><span className="mini-copy"><strong>{title}</strong><small>{detail} · {dateLabel(tx.date)}</small>{tx.note?.trim() && <small className="mini-note">{tx.note}</small>}</span><span className={`mini-amount ${isTransfer ? "" : positive ? "in" : "out"}`}>{isTransfer ? "" : positive ? "+" : "−"}{money(tx.amount, true)}</span></div>;
}

function TransactionList({ kind, rows, onEdit, onRemove, isClosed }) {
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
                        {isClosed ? (
                            <span className="lock-tag">🔒 Terkunci</span>
                        ) : (
                            <div className="table-actions"><button onClick={() => onEdit(tx)}>Ubah</button><button onClick={() => onRemove(tx)}>Hapus</button></div>
                        )}
                    </div>
                </div>
                {tx.note?.trim() && <p className="transaction-record-note">{tx.note}</p>}
            </article>)}
        </div> : <div className="transaction-type-empty">Belum ada transaksi pada periode ini.</div>}
    </div>;
}

function TransactionTypePanel({ kind, rows, total, openTransaction, onEdit, onRemove, isClosed }) {
    const isRevenue = kind === "revenue";
    return <section className={`panel transaction-type-panel ${isRevenue ? "income" : "expense"}`}>
        <div className="panel-header">
            <div>
                <span className="eyebrow">{isRevenue ? "UANG MASUK" : "UANG KELUAR"}</span>
                <h2 className="panel-title section-gap">{isRevenue ? "Pendapatan & penjualan" : "Pengeluaran"}</h2>
                <p className="panel-caption">{monthLabel(rows.period)}</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <strong className={`transaction-total ${isRevenue ? "positive" : "negative"}`}>{money(total)}</strong>
                {isClosed ? (
                    <span className="lock-tag" style={{ padding: "4px 8px" }}>🔒 Periode ditutup</span>
                ) : (
                    <button className="button button-primary" style={{ padding: "0 12px", minHeight: "32px", fontSize: "12px" }} onClick={() => openTransaction(kind)}>
                        ＋ Catat {isRevenue ? "pendapatan" : "pengeluaran"}
                    </button>
                )}
            </div>
        </div>
        <TransactionList kind={kind} rows={rows.items} onEdit={onEdit} onRemove={onRemove} isClosed={isClosed} />
    </section>;
}

function Transactions({ data, setData, period, setPeriod, setEditing, setShowForm, setNewTransactionKind, openTransaction, notify, setPage }) {
    const [view, setView] = useState("income-expense");
    const periodRows = data.transactions.filter((tx) => monthOf(tx.date) === period);
    const isClosed = Boolean(data.closings?.some((c) => c.period === period && c.status === "closed"));

    const sortTx = (a, b) => b.date.localeCompare(a.date);

    const incomes = periodRows.filter((tx) => tx.kind === "revenue").sort(sortTx);
    const expenses = periodRows.filter((tx) => tx.kind === "expense").sort(sortTx);
    const selectedKind = view === "income-expense" ? null : view;
    const selectedRows = selectedKind ? [...periodRows].filter((tx) => tx.kind === selectedKind).sort(sortTx) : [];

    function remove(tx) {
        if (isClosed) {
            alert(`Periode ${monthLabel(period)} telah ditutup buku. Buka kembali periode di menu Tutup Buku jika ingin menghapus transaksi.`);
            return;
        }
        if (!window.confirm(`Hapus transaksi "${tx.description}"?`)) return;
        setData((old) => ({
            ...old,
            transactions: old.transactions.filter((item) => item.id !== tx.id),
            assets: tx.assetId ? old.assets.filter((asset) => asset.id !== tx.assetId) : old.assets
        }));
        notify("Transaksi dihapus.");
    }

    function exportCsv() {
        const records = [["Tanggal", "Jenis", "Kategori", "Detail", "Metode", "Akun tujuan", "Nominal", "Catatan"], ...data.transactions.map((tx) => [tx.date, KIND_NAMES[tx.kind], tx.category, tx.kind === "asset" ? tx.description : tx.kind === "transfer" ? `${accountLabel(tx.account)} ke ${accountLabel(tx.transferTo)}` : tx.category, accountLabel(tx.account), tx.transferTo ? accountLabel(tx.transferTo) : "", tx.amount, tx.note || ""])];
        const content = `\uFEFF${records.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
        const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `transaksi-ruangusaha-${period}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function openEdit(tx) {
        if (isClosed) {
            alert(`Periode ${monthLabel(period)} telah ditutup buku. Buka kembali periode di menu Tutup Buku jika ingin mengubah transaksi.`);
            return;
        }
        setEditing(tx);
        setNewTransactionKind(tx.kind);
        setShowForm(true);
    }

    function openCurrentForm() {
        if (isClosed) {
            alert(`Periode ${monthLabel(period)} telah ditutup buku. Buka kembali periode di menu Tutup Buku jika ingin menambah transaksi.`);
            return;
        }
        openTransaction(view === "income-expense" ? "revenue" : view);
    }

    const selectedLabel = TRANSACTION_VIEWS.find(([key]) => key === view)?.[1] || "Transaksi";
    const selectedTotal = amountFor(selectedRows, () => true);
    const panelTitle = view === "principal" ? "Pembayaran pokok pinjaman" : view === "asset" ? "Pembelian aset" : selectedLabel;

    return <>
        <PageHeading
            eyebrow="CATATAN USAHA"
            title="Transaksi usaha"
            subtitle="Pencatatan kas harian: penjualan, pembelian bahan, operasional, aset, dan arus pendanaan."
            actions={<>
                <MonthPicker value={period} onChange={setPeriod} months={[...new Set([...data.transactions.map((tx) => monthOf(tx.date)), period])].sort().reverse()} />
                <button className="button button-secondary" onClick={exportCsv}>↓ Ekspor CSV</button>
            </>}
        />

        {isClosed && (
            <div className="period-closed-banner">
                <span style={{ fontSize: 20 }}>🔒</span>
                <div>
                    <strong>Periode {monthLabel(period)} telah Ditutup Buku (Final).</strong>
                    <p style={{ margin: "2px 0 0" }}>Transaksi pada periode ini berstatus terkunci (read-only) untuk melindungi integritas laporan keuangan. Jika perlu melakukan koreksi data, silakan <button className="panel-link" style={{ fontWeight: 700 }} onClick={() => setPage("closing")}>buka kembali periode di menu Tutup Buku →</button></p>
                </div>
            </div>
        )}

        <section className="panel transaction-selector-panel">
            <label className="field transaction-selector">
                <span>Pilih jenis transaksi</span>
                <select className="input-control" value={view} onChange={(event) => setView(event.target.value)}>
                    {TRANSACTION_VIEWS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
            </label>
        </section>

        {view === "income-expense" ? (
            <div className="transaction-types-grid section-gap">
                <TransactionTypePanel kind="revenue" rows={{ items: incomes, period }} total={amountFor(incomes, () => true)} openTransaction={openTransaction} onEdit={openEdit} onRemove={remove} isClosed={isClosed} />
                <TransactionTypePanel kind="expense" rows={{ items: expenses, period }} total={amountFor(expenses, () => true)} openTransaction={openTransaction} onEdit={openEdit} onRemove={remove} isClosed={isClosed} />
            </div>
        ) : (
            <section className={`panel section-gap transaction-single-panel ${view}`}>
                <div className="panel-header">
                    <div>
                        <span className="eyebrow">{monthLabel(period).toLocaleUpperCase("id-ID")}</span>
                        <h2 className="panel-title section-gap">{panelTitle}</h2>
                        <p className="panel-caption">{selectedRows.length} catatan pada periode ini</p>
                    </div>
                    <strong className={`transaction-total ${view === "capital" || view === "loan" ? "positive" : view === "draw" || view === "principal" || view === "asset" ? "negative" : ""}`}>
                        {money(selectedTotal)}
                    </strong>
                </div>
                {!isClosed && (
                    <div className="transaction-single-actions">
                        <button className="button button-primary" onClick={openCurrentForm}>＋ Tambah {panelTitle.toLocaleLowerCase("id-ID")}</button>
                    </div>
                )}
                <TransactionList kind={selectedKind} rows={selectedRows} onEdit={openEdit} onRemove={remove} isClosed={isClosed} />
                {view === "transfer" && <div className="report-note">Transfer hanya memindahkan saldo antara Cash dan Rekening; total uang tidak berubah.</div>}
                {["capital", "loan", "draw", "principal"].includes(view) && <div className="report-note">{view === "capital" ? "Setoran modal menambah ekuitas, bukan pendapatan." : view === "loan" ? "Pinjaman masuk menambah utang, bukan pendapatan." : view === "draw" ? "Prive mengurangi ekuitas, bukan beban usaha." : "Pembayaran pokok mengurangi utang, bukan beban laba rugi."}</div>}
            </section>
        )}
    </>;
}

function ClosingManager({ data, setData, report, period, setPeriod, months, notify, currentOwner }) {
    const currentClosing = data.closings?.find((c) => c.period === period);
    const isClosed = currentClosing?.status === "closed";

    const openingInv = report.openingInventory ?? 0;
    const purchases = report.ingredientPurchases ?? 0;
    const available = openingInv + purchases;

    const [endingInvInput, setEndingInvInput] = useState(
        currentClosing ? currentClosing.endingInventory : (report.endingInventory ?? openingInv)
    );
    const [opnameDate, setOpnameDate] = useState(
        currentClosing?.stockOpnameDate || endOfMonth(period)
    );
    const [notes, setNotes] = useState(
        currentClosing?.notes || "Stock opname fisik akhir bulan selesai."
    );

    useEffect(() => {
        const found = data.closings?.find((c) => c.period === period);
        if (found) {
            setEndingInvInput(found.endingInventory);
            setOpnameDate(found.stockOpnameDate || endOfMonth(period));
            setNotes(found.notes || "");
        } else {
            setEndingInvInput(report.endingInventory ?? report.openingInventory ?? 0);
            setOpnameDate(endOfMonth(period));
            setNotes("Stock opname fisik akhir bulan selesai.");
        }
    }, [period, data.closings, report.endingInventory, report.openingInventory]);

    const numEnding = Math.max(0, Number(endingInvInput) || 0);
    const cogsPreview = Math.max(0, available - numEnding);
    const grossProfitPreview = (report.revenue || 0) - cogsPreview;
    const netProfitPreview = grossProfitPreview - (report.opex || 0) - (report.depreciation || 0) + (report.nonOperatingIncome || 0) - (report.nonOperatingExpense || 0);
    const isExceeding = numEnding > available;

    function handleClosePeriod(e) {
        e.preventDefault();
        if (isExceeding) {
            alert(`Nilai persediaan akhir (${money(numEnding)}) tidak boleh melebihi bahan yang tersedia (${money(available)}).`);
            return;
        }
        const closingObj = {
            period,
            status: "closed",
            stockOpnameDate: opnameDate,
            openingInventory: openingInv,
            purchases,
            endingInventory: numEnding,
            rawMaterialConsumption: cogsPreview,
            notes: notes.trim(),
            closedAt: new Date().toISOString(),
            closedBy: currentOwner || "Pemilik",
        };

        const existingClosings = data.closings || [];
        const nextClosings = existingClosings.some((c) => c.period === period)
            ? existingClosings.map((c) => c.period === period ? closingObj : c)
            : [...existingClosings, closingObj];

        setData((old) => ({
            ...old,
            closings: nextClosings,
        }));
        notify(`Tutup buku periode ${monthLabel(period)} berhasil dikonfirmasi dan dikunci.`);
    }

    function handleReopenPeriod() {
        if (!window.confirm(`Buka kembali periode ${monthLabel(period)}? Transaksi pada bulan ini akan dapat diubah kembali.`)) {
            return;
        }
        const existingClosings = data.closings || [];
        const nextClosings = existingClosings.map((c) =>
            c.period === period ? { ...c, status: "draft" } : c
        );
        setData((old) => ({
            ...old,
            closings: nextClosings,
        }));
        notify(`Periode ${monthLabel(period)} dibuka kembali (mode draft).`);
    }

    return (
        <>
            <PageHeading
                eyebrow="AKUNTANSI PERIODIK & TUTUP BUKU"
                title="Tutup Buku & Stok Opname"
                subtitle="Hitung fisik bahan baku di akhir bulan, tetapkan HPP riil, dan kunci laporan keuangan periode ini."
                actions={<MonthPicker value={period} onChange={setPeriod} months={months} />}
            />

            <div className="closing-card section-gap">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, borderBottom: "1.5px solid #edf2eb", paddingBottom: 16 }}>
                    <div>
                        <span className="eyebrow">STATUS PERIODE {monthLabel(period).toUpperCase()}</span>
                        <h2 style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10 }}>
                            {isClosed ? "Periode Telah Ditutup Buku" : "Periode Terbuka (Draft / Belum Tutup Buku)"}
                            <span className={`status-pill ${isClosed ? "closed" : "provisional"}`}>
                                {isClosed ? "🔒 Selesai (Final)" : "⏳ Belum Tutup Buku"}
                            </span>
                        </h2>
                        <p className="panel-caption" style={{ marginTop: 4 }}>
                            {isClosed
                                ? `Laporan dikunci pada ${dateLabel(currentClosing.closedAt?.slice(0, 10))} oleh ${currentClosing.closedBy || "Pemilik"}. Transaksi bulan ini berstatus read-only.`
                                : "Laporan laba rugi dan HPP saat ini masih berstatus estimasi sementara hingga penghitungan fisik (stock opname) diselesaikan."}
                        </p>
                    </div>
                    {isClosed ? (
                        <button className="button button-secondary" onClick={handleReopenPeriod}>
                            🔓 Buka Kembali Periode
                        </button>
                    ) : (
                        <span style={{ fontSize: 12, color: "#6e7f72", background: "#f2f7f1", padding: "6px 12px", borderRadius: 8 }}>
                            Berdasarkan SAK EMKM: Sistem Persediaan Periodik F&B
                        </span>
                    )}
                </div>

                <div className="closing-workflow-steps">
                    {/* Langkah 1: Arus Bahan Baku */}
                    <div className="closing-step-box">
                        <div className="closing-step-head">
                            <span className="step-number-badge">1</span>
                            <span className="closing-step-title">Arus Bahan Baku Bulan Ini (Periodic Inventory)</span>
                        </div>
                        <div className="closing-metrics-grid">
                            <div className="closing-metric-tile">
                                <span>Persediaan Awal Bulan</span>
                                <strong>{money(openingInv)}</strong>
                                <small style={{ color: "#8a968c", fontSize: 11 }}>Dari stok akhir bulan lalu</small>
                            </div>
                            <div className="closing-metric-tile">
                                <span>Pembelian Bahan Bersih</span>
                                <strong style={{ color: "#2e7654" }}>+ {money(purchases)}</strong>
                                <small style={{ color: "#8a968c", fontSize: 11 }}>Transaksi pembelian bahan baku</small>
                            </div>
                            <div className="closing-metric-tile" style={{ background: "#f5f9f4" }}>
                                <span>Total Bahan Tersedia</span>
                                <strong style={{ color: "#1b4b32" }}>= {money(available)}</strong>
                                <small style={{ color: "#8a968c", fontSize: 11 }}>Persediaan Awal + Pembelian</small>
                            </div>
                        </div>
                    </div>

                    {/* Langkah 2: Hasil Stock Opname */}
                    <div className="closing-step-box" style={{ background: isClosed ? "#fbfdfa" : "#ffffff", border: isClosed ? "1.5px solid #e5ece2" : "1.5px solid #2e7654" }}>
                        <div className="closing-step-head">
                            <span className="step-number-badge">2</span>
                            <span className="closing-step-title">Hasil Penghitungan Fisik (Stock Opname) Akhir Bulan</span>
                        </div>
                        {isClosed ? (
                            <div className="closing-metrics-grid">
                                <div className="closing-metric-tile">
                                    <span>Nilai Persediaan Akhir Fisik</span>
                                    <strong style={{ color: "#22593b", fontSize: 18 }}>{money(currentClosing.endingInventory)}</strong>
                                    <small style={{ color: "#8a968c", fontSize: 11 }}>Tercatat sebagai Aset di Neraca</small>
                                </div>
                                <div className="closing-metric-tile">
                                    <span>Tanggal Stock Opname</span>
                                    <strong>{dateLabel(currentClosing.stockOpnameDate)}</strong>
                                </div>
                                <div className="closing-metric-tile" style={{ gridColumn: "span 2" }}>
                                    <span>Catatan Stock Opname</span>
                                    <p style={{ margin: 0, fontSize: 13, color: "#455348" }}>{currentClosing.notes || "—"}</p>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={handleClosePeriod}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                                    <label className="field" style={{ margin: 0 }}>
                                        <span style={{ fontWeight: 700, color: "#1f3124" }}>Nilai Rupiah Persediaan Akhir (Rp)*</span>
                                        <input
                                            className="input-control"
                                            type="number"
                                            min="0"
                                            max={available}
                                            step="1"
                                            required
                                            value={endingInvInput}
                                            onChange={(e) => setEndingInvInput(e.target.value)}
                                            placeholder="Contoh: 4000000"
                                            style={{ fontSize: 15, fontWeight: 700, padding: "10px 14px", borderColor: isExceeding ? "#dc3545" : undefined }}
                                        />
                                        <small style={{ color: isExceeding ? "#dc3545" : "#728174", fontSize: 11.5 }}>
                                            {isExceeding
                                                ? `Tidak boleh melebihi total bahan tersedia (${money(available)})`
                                                : "Total nilai bahan baku yang tersisa di dapur/chiller saat tutup bulan"}
                                        </small>
                                    </label>
                                    <label className="field" style={{ margin: 0 }}>
                                        <span style={{ fontWeight: 700, color: "#1f3124" }}>Tanggal Penghitungan Fisik</span>
                                        <input
                                            className="input-control"
                                            type="date"
                                            required
                                            value={opnameDate}
                                            onChange={(e) => setOpnameDate(e.target.value)}
                                            style={{ padding: "10px 14px" }}
                                        />
                                        <small style={{ color: "#728174", fontSize: 11.5 }}>Tanggal pelaksanaan stock opname fisik</small>
                                    </label>
                                    <label className="field field-wide" style={{ margin: 0, gridColumn: "1 / -1" }}>
                                        <span style={{ fontWeight: 700, color: "#1f3124" }}>Catatan Hasil Stock Opname</span>
                                        <input
                                            className="input-control"
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            placeholder="Contoh: Biji kopi sisa 10kg, susu segar 25 liter, cup 400 pcs..."
                                            style={{ padding: "10px 14px" }}
                                        />
                                    </label>
                                </div>

                                {/* Preview Dampak Laporan Keuangan */}
                                <div className="closing-preview-banner" style={{ marginTop: 18 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                                        <div>
                                            <strong style={{ color: "#1c4a2f", fontSize: 14 }}>
                                                Preview HPP Pemakaian Bahan Baku (SAK EMKM):
                                            </strong>
                                            <div className="closing-formula">
                                                {money(openingInv)} + {money(purchases)} − {money(numEnding)} = <span style={{ fontSize: 16, textDecoration: "underline" }}>{money(cogsPreview)}</span>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <span style={{ fontSize: 11, color: "#546e5a", display: "block" }}>Estimasi Laba Bersih Final:</span>
                                            <strong style={{ fontSize: 18, color: netProfitPreview >= 0 ? "#21683d" : "#b03a2e" }}>
                                                {money(netProfitPreview)}
                                            </strong>
                                        </div>
                                    </div>
                                    <div style={{ marginTop: 10, fontSize: 12, color: "#4c6050", display: "flex", gap: 18, flexWrap: "wrap" }}>
                                        <span>• Aset Persediaan di Neraca: <strong>{money(numEnding)}</strong></span>
                                        <span>• Gross Profit: <strong>{money(grossProfitPreview)}</strong></span>
                                        <span>• Status Neraca: <strong style={{ color: "#227040" }}>✓ Aset = Liabilitas + Ekuitas Seimbang</strong></span>
                                    </div>
                                </div>

                                <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 12 }}>
                                    <button
                                        type="submit"
                                        className="button button-primary"
                                        style={{ minHeight: 44, padding: "0 24px", fontSize: 13.5, fontWeight: 700 }}
                                        disabled={isExceeding}
                                    >
                                        🔒 Tutup Buku & Kunci Periode {monthLabel(period)}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

function SideMetric({ label, value, text }) {
    return <div className="report-side-item"><small>{label}</small><strong>{value}</strong><p>{text}</p></div>;
}

function Reports({ data, report, period, setPeriod, months, tab, setTab }) {
    const tabs = [["profit", "Laba rugi"], ["cash", "Arus kas"], ["balance", "Neraca"]];
    return <>
        <PageHeading
            eyebrow="LAPORAN KEUANGAN"
            title="Laporan Keuangan SAK EMKM"
            subtitle="Disusun secara otomatis dari pencatatan transaksi, penyusutan aset, dan persediaan periodik."
            actions={<MonthPicker value={period} onChange={setPeriod} months={months} />}
        />
        <div className="report-tabs">
            {tabs.map(([key, label]) => <button key={key} className={`report-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>)}
        </div>
        <div className="report-layout section-gap">
            <div className="report-card">
                {tab === "profit" ? <IncomeReport report={report} /> : tab === "cash" ? <CashReport report={report} /> : <BalanceReport data={data} report={report} />}
            </div>
            <aside className="report-card-side">
                <SideMetric label="Kas + rekening akhir periode" value={money(report.cash + report.bank, true)} text="Uang kas tersedia di tangan dan bank." />
                <SideMetric label="Nilai persediaan akhir" value={money(report.endingInventory || 0, true)} text="Bahan baku yang masih tersedia di dapur/gudang." />
                <SideMetric label="Laba bersih tercatat" value={money(report.netProfit, true)} text="Pendapatan dikurangi HPP, operasional, dan penyusutan." />
                <SideMetric label="Arus kas bersih periode ini" value={money(report.changeCash, true)} text="Termasuk arus kas operasi, investasi, dan pendanaan." />
            </aside>
        </div>
    </>;
}

function IncomeReport({ report: r }) {
    const ob = r.opexBreakdown || {};
    const hasBreakdown = Boolean(ob.payroll || ob.utilities || ob.operational || ob.maintenance || ob.general);

    return <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="eyebrow">KINERJA USAHA</span>
            <span className={`status-pill ${r.isClosed ? "closed" : "provisional"}`}>
                {r.isClosed ? "🔒 Tutup Buku Selesai (Final)" : "⏳ Estimasi / Belum Tutup Buku"}
            </span>
        </div>
        <h2 style={{ marginTop: 2 }}>Laporan laba rugi</h2>
        <p className="panel-caption">{monthLabel(r.month)} · SAK EMKM (Metode Periodik)</p>
        <table className="report-table">
            <tbody>
                <ReportRow label="Pendapatan (Penjualan)" value={r.revenue} subtotal />
                <ReportRow label="− HPP (Pemakaian Bahan Baku)*" value={r.cogs} indent />
                <ReportRow label="Laba kotor (Gross Profit)" value={r.grossProfit} total />
                <ReportRow label="− Total Beban Operasional (OPEX)" value={r.opex} indent subtotal={hasBreakdown} />
                {hasBreakdown && (
                    <>
                        <ReportRow label="• Beban Pegawai (HR/Payroll)" value={ob.payroll || 0} indentLevel={2} />
                        <ReportRow label="• Beban Utilitas & Tempat" value={ob.utilities || 0} indentLevel={2} />
                        <ReportRow label="• Beban Operasional & Umum" value={ob.operational || 0} indentLevel={2} />
                        <ReportRow label="• Beban Pemeliharaan" value={ob.maintenance || 0} indentLevel={2} />
                        {Boolean(ob.general) && <ReportRow label="• Beban Operasional Lainnya" value={ob.general} indentLevel={2} />}
                    </>
                )}
                <ReportRow label="− Beban Pemasaran (Marketing/Selling)" value={r.marketing} indent />
                <ReportRow label="− Penyusutan aset tetap" value={r.depreciation} indent />
                <ReportRow label="Laba operasional" value={r.operatingProfit} subtotal />
                <ReportRow label="+ Pendapatan non-operasional" value={r.nonOperatingIncome} indent />
                <ReportRow label="− Beban non-operasional" value={r.nonOperatingExpense} indent />
                <ReportRow label="Laba bersih tercatat" value={r.netProfit} total />
                <tr><td>Gross Margin</td><td>{r.grossMargin === null ? "Belum dapat dihitung" : `${(r.grossMargin * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</td></tr>
                <tr><td>COGS / HPP Ratio</td><td>{r.cogsRatio === null ? "Belum dapat dihitung" : `${(r.cogsRatio * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</td></tr>
                <tr><td>Net Margin</td><td>{r.netMargin === null ? "Belum dapat dihitung" : `${(r.netMargin * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</td></tr>
            </tbody>
        </table>
        <div className="report-note" style={{ marginTop: 14 }}>
            * <strong>Perhitungan HPP Periodik:</strong> Persediaan Awal ({money(r.openingInventory)}) + Pembelian Bersih ({money(r.ingredientPurchases)}) − Persediaan Akhir ({money(r.endingInventory)}) = <strong>{money(r.cogs)}</strong>.
            {!r.isClosed && " Nilai persediaan akhir saat ini masih estimasi. Selesaikan penghitungan fisik di menu Tutup Buku untuk angka final."}
        </div>
    </>;
}

function ReportRow({ label, value, indent, indentLevel, subtotal, total }) {
    const indentClass = indentLevel === 2 ? "indent-2" : indent ? "indent" : "";
    return <tr className={`${indentClass} ${subtotal ? "subtotal" : ""} ${total ? "total" : ""}`}><td>{label}</td><td>{money(value)}</td></tr>;
}

function CashReport({ report: r }) {
    return <>
        <span className="eyebrow">PERGERAKAN UANG KAS</span>
        <h2 style={{ marginTop: 5 }}>Laporan arus kas</h2>
        <p className="panel-caption">{monthLabel(r.month)} · Metode Langsung (Direct Cash Movements)</p>
        <table className="report-table">
            <tbody>
                <ReportRow label="Kas & bank awal periode*" value={r.cashOpening} />
                <ReportRow label="Arus kas operasi (Penerimaan omzet − Pembelian bahan & beban operasional)" value={r.operatingCashFlow} />
                <ReportRow label="Arus kas investasi (Pembelian aset tetap)" value={r.investingCashFlow} />
                <ReportRow label="Arus kas pendanaan (Setoran modal & pinjaman − Prive & cicilan pokok)" value={r.financingCashFlow} />
                <ReportRow label="Perubahan kas bersih periode ini" value={r.changeCash} total />
                <ReportRow label="Kas & bank akhir periode*" value={r.cashClosing} subtotal />
            </tbody>
        </table>
        <div className="report-note">
            * <strong>Rekonsiliasi Kas:</strong> Kas Awal ({money(r.cashOpening)}) + Perubahan Kas ({money(r.changeCash)}) = Kas Akhir ({money(r.cashClosing)}). Perpindahan antar akun (Cash ke Rekening) tidak mengubah total kas.
        </div>
    </>;
}

function BalanceReport({ data, report: r }) {
    const isBalanced = Math.abs(r.balanceDifference) < 1;
    return <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="eyebrow">POSISI KEUANGAN</span>
            <span className={`status-pill ${isBalanced ? "closed" : "provisional"}`}>
                {isBalanced ? "✓ Neraca Seimbang" : "Selisih Neraca"}
            </span>
        </div>
        <h2 style={{ marginTop: 2 }}>Neraca (Balance Sheet)</h2>
        <p className="panel-caption">Per {dateLabel(endOfMonth(r.month))} · SAK EMKM</p>
        <table className="report-table">
            <tbody>
                <tr className="subtotal"><td>ASET</td><td /></tr>
                <ReportRow label="Kas di tangan" value={r.cash} indent />
                <ReportRow label="Rekening bank" value={r.bank} indent />
                <ReportRow label="Persediaan bahan baku (Stok fisik)" value={r.inventory || 0} indent />
                <ReportRow label="Aset tetap bersih (setelah penyusutan)" value={r.fixedAssets} indent />
                <ReportRow label="Total aset" value={r.assetsTotal} total />

                <tr className="subtotal"><td>LIABILITAS</td><td /></tr>
                <ReportRow label="Utang / pinjaman tercatat" value={r.liabilities} indent />
                <ReportRow label="Total liabilitas" value={r.liabilities} subtotal />

                <tr className="subtotal"><td>EKUITAS</td><td /></tr>
                <ReportRow label="Modal awal & setoran modal" value={data.opening.equity + (r.capitalInjections || 0)} indent />
                <ReportRow label="Akumulasi laba (rugi) bersih" value={r.cumulativeNetProfit || 0} indent />
                <ReportRow label="− Prive / penarikan pemilik" value={-(r.ownerDraw || 0)} indent />
                <ReportRow label="Total ekuitas" value={r.equity} subtotal />
                <ReportRow label="Total liabilitas & ekuitas" value={r.liabilities + r.equity} total />
            </tbody>
        </table>
        <div className={`report-note ${!data.opening.confirmed ? "warning" : !isBalanced ? "error" : ""}`} style={{ background: isBalanced ? "#edf7ee" : undefined, borderColor: isBalanced ? "#c7e5cb" : undefined, color: isBalanced ? "#276738" : undefined }}>
            {data.opening.confirmed ? (
                isBalanced
                    ? `✓ Neraca Seimbang: Total Aset (${money(r.assetsTotal)}) = Liabilitas + Ekuitas (${money(r.liabilities + r.equity)}) sesuai persamaan dasar akuntansi.`
                    : `Selisih neraca: ${money(r.balanceDifference)}. Periksa kembali konsistensi saldo awal atau transaksi.`
            ) : "Saldo awal belum dikonfirmasi. Pastikan total kas, bank, persediaan, aset, dan utang awal telah diverifikasi."}
        </div>
    </>;
}

function Analysis({ diagnosis, report, period, setPeriod, months, reasoner }) {
    const diag = diagnosis || report?.diagnosis;
    const findings = diag?.findings || [];
    const whyNot = diag?.why_not || [];
    const costDrivers = diag?.cost_drivers || [];
    const completeness = diag?.data_completeness;

    return <>
        <PageHeading
            eyebrow="KNOWLEDGE-BASED REASONING (KBR)"
            title="Sistem Pakar Kesehatan Finansial"
            subtitle="Setiap indikasi terhubung secara logis ke aturan OWL/SWRL, bukti fakta numerik, rantai penalaran, dan rekomendasi aksi operasional."
            actions={<MonthPicker value={period} onChange={setPeriod} months={months} />}
        />

        <div className={`analysis-summary ${diag?.level === "healthy" ? "health-ok" : diag?.level === "critical" ? "critical" : diag?.level === "danger" ? "warning" : ""}`}>
            <span className="summary-check">{diag?.level === "healthy" ? "✓" : diag?.level === "critical" ? "✕" : "!"}</span>
            <div>
                <strong>{diag?.status_label || "Evaluasi Kesehatan Finansial"}</strong>
                <p>{diag?.summary || "Menghubungkan ke reasoner OWL/Pellet..."}</p>
            </div>
        </div>

        <ReasonerStatus reasoner={reasoner} />

        {completeness?.notes?.length > 0 && (
            <div className="report-note warning" style={{ margin: "14px 0" }}>
                <strong>Catatan Kelengkapan Data:</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                    {completeness.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
            </div>
        )}

        {costDrivers.length > 0 && (
            <div style={{ background: "#fbf6e9", border: "1.5px solid #ebd9b0", borderRadius: 10, padding: "12px 16px", margin: "14px 0", color: "#6b4e13", fontSize: "13px" }}>
                <strong>Pendorong Kenaikan Biaya (Cost Drivers): </strong>
                Kategori biaya yang tumbuh melebihi pertumbuhan omzet dan menjadi kontributor terbesar penurunan margin: <strong style={{ textDecoration: "underline" }}>{costDrivers.join(", ")}</strong>.
            </div>
        )}

        <div className="diagnosis-list">
            {findings.map((finding) => (
                <article className="diagnosis-card" key={finding.id}>
                    <div className="diagnosis-head">
                        <div>
                            <span className="eyebrow">{finding.domain?.toUpperCase()} · ATURAN {finding.rule}</span>
                            <h3 style={{ marginTop: 6 }}>{finding.title}</h3>
                        </div>
                        <span className={`severity-badge ${finding.severity === "Kritis" ? "critical" : "warning"}`}>{finding.severity}</span>
                    </div>
                    <p>{finding.explanation}</p>
                    <div className="evidence-grid">
                        {finding.evidence.map(([label, value]) => (
                            <div className="evidence-item" key={label}>
                                <small>{label}</small>
                                <strong>{value}</strong>
                            </div>
                        ))}
                    </div>
                    <div className="reasoning-chain">
                        {finding.chain.map((step, index) => (
                            <span key={`${finding.id}-${step}`} style={{ display: "contents" }}>
                                {index > 0 && <span className="reason-arrow">→</span>}
                                <span className={`reason-node ${index < finding.chain.length - 1 ? "active" : ""}`}>{step}</span>
                            </span>
                        ))}
                    </div>
                    <div className="advisory-box">
                        <strong>Yang bisa diperiksa & tindakan:</strong> {finding.advice}
                    </div>
                </article>
            ))}
        </div>

        {whyNot.length > 0 && (
            <div className="why-not section-gap">
                <strong>WHY-NOT · Mengapa kondisi risiko lain tidak disimpulkan?</strong>
                <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    {whyNot.map((item, idx) => <li key={idx}>{item}</li>)}
                </ul>
                <small style={{ display: "block", marginTop: 8, color: "#8a968c" }}>
                    Sistem menganut Open World Assumption: ketiadaan bukti anomali tidak otomatis dianggap sebagai bisnis sehat tanpa pemenuhan kriteria evaluasi lengkap.
                </small>
            </div>
        )}

        <div className="report-note section-gap">
            Analisis inferensi dijalankan secara matematis menggunakan Pellet Reasoner pada model ontologi <code>Finance_Health_Expert_System_v2.owl</code>. Rekomendasi di atas disesuaikan dengan karakteristik operasional UMKM F&B.
        </div>
    </>;
}

function Assets({ data, report, openTransaction }) {
    return <>
        <PageHeading eyebrow="PENGELOLAAN ASET" title="Aset usaha" subtitle="Pembelian aset dicatat sebagai investasi; penyusutan menjadi beban berkala." actions={<button className="button button-primary" onClick={() => openTransaction("asset")}>＋ Catat pembelian aset</button>} />
        <div className="asset-grid">
            {data.assets.map((asset) => (
                <article className="asset-card" key={asset.id}>
                    <div className="asset-top"><span className="asset-symbol">▧</span><span className="asset-status">Aktif</span></div>
                    <h3>{asset.name}</h3>
                    <div className="asset-value">{money(asset.cost, true)}</div>
                    <p>Nilai perolehan · umur manfaat {asset.lifeMonths} bulan</p>
                    <div className="asset-meta"><span>Penyusutan per bulan</span><strong>{money((asset.cost - asset.residual) / asset.lifeMonths, true)}</strong></div>
                    <div className="asset-meta"><span>Mulai digunakan</span><span>{dateLabel(asset.startDate)}</span></div>
                </article>
            ))}
            {!data.assets.length && <div className="panel"><div className="empty-state"><strong>Belum ada aset terdaftar</strong>Catat transaksi pembelian aset untuk mulai menghitung penyusutan.</div></div>}
        </div>
        <div className="report-note section-gap">
            Penyusutan bulan ini {money(report.depreciation)} menggunakan metode garis lurus. Akumulasi penyusutan di Neraca: {money(report.accumulatedDepreciation || 0)}.
        </div>
    </>;
}

function Settings({ data, setData, notify, onSignOut }) {
    function submitProfile(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setData((old) => ({
            ...old,
            profile: {
                businessName: String(form.get("businessName")).trim(),
                ownerName: String(form.get("ownerName")).trim(),
                businessType: String(form.get("businessType")).trim()
            }
        }));
        notify("Profil tersimpan.");
    }

    function submitOpening(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const cash = Number(form.get("cash")) || 0;
        const bank = Number(form.get("bank")) || 0;
        const inventory = Number(form.get("inventory")) || 0;
        const fixedAssets = Number(form.get("fixedAssets")) || 0;
        const liabilities = Number(form.get("liabilities")) || 0;
        const values = [cash, bank, inventory, fixedAssets, liabilities];
        if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
            notify("Saldo harus berupa bilangan bulat rupiah nol atau lebih.");
            return;
        }
        // Ekuitas dihitung otomatis: Total Aset - Utang
        const autoEquity = Math.max(0, cash + bank + inventory + fixedAssets - liabilities);
        setData((old) => ({
            ...old,
            opening: {
                date: String(form.get("date")),
                cash,
                bank,
                inventory,
                fixedAssets,
                liabilities,
                equity: autoEquity,
                confirmed: form.get("confirmed") === "on"
            }
        }));
        notify("Saldo awal tersimpan (Ekuitas dihitung otomatis sesuai Neraca).");
    }

    const [openingValues, setOpeningValues] = useState({
        cash: data.opening.cash || 0,
        bank: data.opening.bank || 0,
        inventory: data.opening.inventory || 0,
        fixedAssets: data.opening.fixedAssets || 0,
        liabilities: data.opening.liabilities || 0,
    });

    const autoEquity = Math.max(0, openingValues.cash + openingValues.bank + openingValues.inventory + openingValues.fixedAssets - openingValues.liabilities);

    return <>
        <PageHeading
            eyebrow="PROFIL & SALDO AWAL"
            title="Pengaturan usaha"
            subtitle="Saldo awal menjadi titik awal pencatatan laporan keuangan dan posisi neraca usahamu."
            actions={onSignOut ? <button className="button button-secondary" onClick={onSignOut}>Keluar</button> : <button className="button button-secondary" onClick={() => { if (window.confirm("Reset semua data contoh?")) setData(sampleData()); }}>Muat data contoh</button>}
        />
        <div className="settings-layout">
            <div className="panel">
                <h2 className="panel-title">Profil usaha</h2>
                <form className="settings-form" onSubmit={submitProfile}>
                    <label className="field field-wide"><span>Nama usaha</span><input name="businessName" defaultValue={data.profile.businessName} required /></label>
                    <label className="field"><span>Nama pemilik</span><input name="ownerName" defaultValue={data.profile.ownerName} required /></label>
                    <label className="field"><span>Jenis usaha</span><input name="businessType" defaultValue={data.profile.businessType} /></label>
                    <button className="button button-primary settings-save">Simpan profil</button>
                </form>

                <h2 className="panel-title section-gap">Saldo awal</h2>
                <form className="settings-form" onSubmit={submitOpening}>
                    <label className="field field-wide"><span>Tanggal saldo awal</span><input type="date" name="date" defaultValue={data.opening.date} required /></label>
                    {[
                        ["cash", "Cash awal di tangan (Rp)"],
                        ["bank", "Saldo rekening bank awal (Rp)"],
                        ["inventory", "Persediaan bahan baku awal (Rp)"],
                        ["fixedAssets", "Aset tetap awal (peralatan, mesin, dll) (Rp)"],
                        ["liabilities", "Utang / pinjaman awal (Rp)"]
                    ].map(([key, label]) => (
                        <label className="field" key={key}>
                            <span>{label}</span>
                            <input
                                name={key}
                                type="number"
                                min="0"
                                step="1"
                                defaultValue={data.opening[key] || 0}
                                required
                                onChange={(e) => setOpeningValues(v => ({ ...v, [key]: Number(e.target.value) || 0 }))}
                            />
                        </label>
                    ))}

                    <div className="field field-wide" style={{ background: "#f5f8f4", padding: "12px 14px", borderRadius: 8, border: "1px solid #e2e8e0", margin: "4px 0" }}>
                        <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Ekuitas / Modal Awal (Aset − Utang)</span>
                        <strong style={{ fontSize: 18, color: "var(--green-dark)", marginTop: 4, display: "block" }}>{money(autoEquity)}</strong>
                    </div>

                    <label className="field-checkbox field-wide">
                        <input name="confirmed" type="checkbox" defaultChecked={data.opening.confirmed} />
                        <span>Saya sudah memeriksa saldo awal ini (Pastikan Aset = Liabilitas + Ekuitas)</span>
                    </label>
                    <button className="button button-primary settings-save">Simpan saldo awal</button>
                </form>

                <h2 className="panel-title section-gap">Kategori Turunan Pengeluaran</h2>
                <p className="panel-caption">Atur semua turunan biaya untuk COGS, OPEX, dan Non-Operasional. Setiap kategori terhubung langsung ke kalkulasi backend.</p>
                <CategoryManager
                    customCategories={data.customCategories}
                    onAdd={(newCat) => {
                        const currentList = data.customCategories || DEFAULT_EXPENSE_CATEGORIES;
                        setData((old) => ({
                            ...old,
                            customCategories: [...currentList, newCat]
                        }));
                        notify(`Kategori "${newCat.name}" berhasil ditambahkan.`);
                    }}
                    onEdit={(oldName, updatedName) => {
                        const currentList = data.customCategories || DEFAULT_EXPENSE_CATEGORIES;
                        setData((old) => ({
                            ...old,
                            customCategories: currentList.map((c) =>
                                c.name === oldName ? { ...c, name: updatedName } : c
                            ),
                            transactions: old.transactions.map((tx) =>
                                tx.category === oldName ? { ...tx, category: updatedName } : tx
                            )
                        }));
                        notify(`Kategori "${oldName}" diubah menjadi "${updatedName}".`);
                    }}
                    onDelete={(catName) => {
                        if (!window.confirm(`Hapus kategori turunan "${catName}"?`)) return;
                        const currentList = data.customCategories || DEFAULT_EXPENSE_CATEGORIES;
                        setData((old) => ({
                            ...old,
                            customCategories: currentList.filter((c) => c.name !== catName)
                        }));
                        notify(`Kategori "${catName}" dihapus.`);
                    }}
                />
            </div>
            <aside className="report-card-side">
                <div className="report-card">
                    <h2 className="panel-title">Cash ≠ laba ≠ modal</h2>
                    <p className="panel-caption" style={{ lineHeight: 1.8 }}>
                        Setoran modal menambah uang dan ekuitas, bukan pendapatan. Laba dihitung dari pendapatan dikurangi biaya serta penyusutan. Pembelian bahan baku masuk ke persediaan sebelum diakui sebagai HPP saat tutup buku.
                    </p>
                </div>
                <div className="settings-note">
                    <strong>Prinsip SAK EMKM.</strong><br />
                    Neraca seimbang adalah syarat mutlak laporan keuangan yang valid.
                </div>
            </aside>
        </div>
    </>;
}

const DEFAULT_EXPENSE_CATEGORIES = [
    { id: "def-0", name: "Pembelian Bahan Baku", parent: "cogs", kind: "expense" },
    { id: "def-1", name: "COGS / HPP", parent: "cogs", kind: "expense" },
    { id: "def-2", name: "Beban Pegawai (HR/Payroll)", parent: "opex", kind: "expense" },
    { id: "def-3", name: "Beban Utilitas & Tempat", parent: "opex", kind: "expense" },
    { id: "def-4", name: "Beban Operasional & Umum", parent: "opex", kind: "expense" },
    { id: "def-5", name: "Beban Pemasaran (Marketing/Selling)", parent: "opex", kind: "expense" },
    { id: "def-6", name: "Beban Pemeliharaan", parent: "opex", kind: "expense" },
    { id: "def-7", name: "Beban non-operasional", parent: "non_ops", kind: "expense" },
];

function CategoryManager({ customCategories, onAdd, onEdit, onDelete }) {
    const [parent, setParent] = useState("cogs");
    const [name, setName] = useState("");
    const [editingItem, setEditingItem] = useState(null);
    const [editingName, setEditingName] = useState("");

    const activeList = customCategories || DEFAULT_EXPENSE_CATEGORIES;

    const parentGroups = [
        { id: "cogs", label: "📦 COGS / HPP", fullName: "Harga Pokok Penjualan", desc: "Biaya langsung pembuatan produk (bahan baku bar, kitchen, kemasan)" },
        { id: "opex", label: "🏢 OPEX", fullName: "Beban Operasional Usaha", desc: "Biaya operasional berjalan (listrik, gaji, iklan, supplies, servis)" },
        { id: "non_ops", label: "⚡ Non-Operasional", fullName: "Beban Non-Operasional", desc: "Biaya administrasi bank, denda, kerugian non-pokok" },
    ];

    function handleAdd(e) {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        if (activeList.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
            alert("Kategori dengan nama tersebut sudah ada!");
            return;
        }
        onAdd({ id: id(), name: trimmed, kind: "expense", parent });
        setName("");
    }

    function startEdit(cat) {
        setEditingItem(cat.name);
        setEditingName(cat.name);
    }

    function saveEdit(oldName) {
        const trimmed = editingName.trim();
        if (!trimmed) {
            setEditingItem(null);
            return;
        }
        if (trimmed.toLowerCase() !== oldName.toLowerCase() && activeList.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
            alert("Nama kategori sudah digunakan!");
            return;
        }
        onEdit(oldName, trimmed);
        setEditingItem(null);
    }

    return <div className="custom-categories-box" style={{ marginTop: 14 }}>
        <form onSubmit={handleAdd} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr auto", gap: 12, alignItems: "flex-end", marginBottom: 22, background: "#f8faf7", padding: "14px 16px", borderRadius: 12, border: "1.5px dashed #dbe5d8" }}>
            <label className="field" style={{ margin: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#36463a" }}>1. Pilih Pilar Utama</span>
                <select
                    className="period-select"
                    style={{ width: "100%", padding: "9px 34px 9px 12px" }}
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                >
                    {parentGroups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                </select>
            </label>
            <label className="field" style={{ margin: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#36463a" }}>2. Nama Kategori Turunan</span>
                <input
                    className="input-control"
                    style={{ width: "100%", padding: "8px 12px", minHeight: 38 }}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contoh: Gas Elpiji, Daging Ayam, R&D..."
                    required
                />
            </label>
            <button className="button button-primary" type="submit" style={{ height: 38, padding: "0 18px", whiteSpace: "nowrap" }}>
                ＋ Tambah
            </button>
        </form>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {parentGroups.map((group) => {
                const items = activeList.filter((c) => c.parent === group.id);
                return (
                    <div key={group.id} style={{ background: "#ffffff", border: "1.5px solid #e3eae0", borderRadius: 12, padding: "16px 18px", boxShadow: "0 2px 5px rgba(0,0,0,0.02)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #edf2eb" }}>
                            <div>
                                <strong style={{ fontSize: 14, color: "#1c2e22" }}>{group.label}</strong>
                                <span style={{ color: "#778579", fontSize: 12, marginLeft: 8 }}>({group.fullName})</span>
                            </div>
                            <span style={{ fontSize: 11.5, color: "#477051", background: "#edf5ed", padding: "3px 8px", borderRadius: 20, fontWeight: 600 }}>
                                {items.length} turunan aktif
                            </span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                            {items.length === 0 ? (
                                <span style={{ color: "#95a397", fontSize: "12.5px", fontStyle: "italic", padding: "4px 0" }}>
                                    Belum ada kategori turunan di pilar ini.
                                </span>
                            ) : (
                                items.map((cat) => (
                                    <div
                                        key={cat.id || cat.name}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "6px 12px",
                                            background: "#fbfdfa",
                                            border: "1.5px solid #d4ded2",
                                            borderRadius: 9,
                                            fontSize: "13px",
                                            boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
                                        }}
                                    >
                                        {editingItem === cat.name ? (
                                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                                <input
                                                    className="input-control"
                                                    style={{ padding: "3px 8px", fontSize: 12, minHeight: 28, width: 140 }}
                                                    value={editingName}
                                                    autoFocus
                                                    onChange={(e) => setEditingName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") saveEdit(cat.name);
                                                        if (e.key === "Escape") setEditingItem(null);
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => saveEdit(cat.name)}
                                                    style={{ border: "none", background: "#2e7654", color: "#fff", borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: "pointer", fontWeight: 700 }}
                                                >
                                                    Simpan
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingItem(null)}
                                                    style={{ border: "none", background: "#e0e6de", color: "#475449", borderRadius: 4, padding: "3px 6px", fontSize: 11, cursor: "pointer" }}
                                                >
                                                    Batal
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <span style={{ fontWeight: 600, color: "#192c1f" }}>{cat.name}</span>
                                                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2 }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => startEdit(cat)}
                                                        style={{ border: "none", background: "none", color: "#457655", cursor: "pointer", fontSize: 12, padding: "2px" }}
                                                        title="Ubah nama turunan ini"
                                                    >
                                                        ✏️
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => onDelete(cat.name)}
                                                        style={{ border: "none", background: "none", color: "#bc4f47", cursor: "pointer", fontWeight: "bold", fontSize: 15, padding: "0 2px" }}
                                                        title="Hapus turunan ini"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>;
}

function TransactionModal({ initial, initialAsset, initialKind, customCategories = [], existingNotes = [], closings = [], onClose, onSave }) {
    const [kind, setKind] = useState(initial?.kind || initialKind || "revenue");

    const groupedExpenseCategories = useMemo(() => {
        const baseCogs = ["Pembelian Bahan Baku", "COGS / HPP"];
        const extraCogs = customCategories.filter((c) => c.parent === "cogs").map((c) => c.name);

        const baseOpex = [
            "Beban Pegawai (HR/Payroll)",
            "Beban Utilitas & Tempat",
            "Beban Operasional & Umum",
            "Beban Pemasaran (Marketing/Selling)",
            "Beban Pemeliharaan",
        ];
        const extraOpex = customCategories.filter((c) => c.parent === "opex" || (!["cogs", "non_ops"].includes(c.parent) && (c.kind || "expense") === "expense")).map((c) => c.name);

        const baseNonOps = ["Beban non-operasional"];
        const extraNonOps = customCategories.filter((c) => c.parent === "non_ops").map((c) => c.name);

        return [
            { label: "📦 Pembelian Bahan Baku (COGS / HPP)", items: [...new Set([...baseCogs, ...extraCogs])] },
            { label: "🏢 Beban Operasional (OPEX)", items: [...new Set([...baseOpex, ...extraOpex])] },
            { label: "⚡ Beban Non-Operasional", items: [...new Set([...baseNonOps, ...extraNonOps])] },
        ];
    }, [customCategories]);

    const flatCategories = useMemo(() => {
        if (kind === "expense") {
            return groupedExpenseCategories.flatMap((g) => g.items);
        }
        const base = CATEGORIES[kind] || [];
        const extra = customCategories.filter((c) => c.kind === kind).map((c) => c.name);
        return [...new Set([...base, ...extra])];
    }, [kind, groupedExpenseCategories, customCategories]);

    const [category, setCategory] = useState(initial?.category || flatCategories[0] || "Pembelian Bahan Baku");
    const [account, setAccount] = useState(initial?.account || "cash");
    const [transferTo, setTransferTo] = useState(initial?.transferTo || (initial?.account === "bank" ? "cash" : "bank"));
    const [error, setError] = useState("");

    useEffect(() => {
        if (!initial && !flatCategories.includes(category)) {
            setCategory(flatCategories[0] || "");
        }
    }, [kind, flatCategories]);

    function submit(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const amount = Number(form.get("amount"));
        const txDate = String(form.get("date"));
        const txMonth = monthOf(txDate);

        const isClosed = closings.some((c) => c.period === txMonth && c.status === "closed");
        if (isClosed) {
            setError(`Periode ${monthLabel(txMonth)} telah ditutup buku. Buka kembali periode di menu Tutup Buku jika ingin mencatat transaksi.`);
            return;
        }

        if (!Number.isSafeInteger(amount) || amount <= 0) {
            setError("Nominal harus berupa bilangan bulat rupiah yang lebih besar dari nol.");
            return;
        }
        if (kind === "transfer" && account === transferTo) {
            setError("Akun asal dan tujuan harus berbeda.");
            return;
        }
        const lifeMonths = Number(form.get("lifeMonths"));
        const residual = Number(form.get("residual"));
        if (kind === "asset" && (!Number.isSafeInteger(lifeMonths) || lifeMonths <= 0 || !Number.isSafeInteger(residual) || residual < 0 || residual > amount)) {
            setError("Umur manfaat harus bilangan bulat lebih dari nol dan nilai residu tidak boleh melebihi harga aset.");
            return;
        }
        const assetId = kind === "asset" ? (initial?.assetId || id()) : undefined;
        const assetName = kind === "asset" ? String(form.get("assetName")).trim() : "";
        const description = kind === "asset" ? assetName : kind === "transfer" ? `${accountLabel(account)} ke ${accountLabel(transferTo)}` : category;
        const tx = {
            id: initial?.id || id(),
            date: txDate,
            description,
            kind,
            category,
            amount,
            account,
            note: String(form.get("note") || "").trim(),
            ...(kind === "transfer" ? { transferTo } : {}),
            ...(assetId ? { assetId } : {})
        };
        const asset = kind === "asset" ? { id: assetId, name: assetName, cost: amount, residual, lifeMonths, startDate: tx.date, account, opening: false } : null;
        onSave(tx, asset);
    }

    const hint = {
        revenue: "Pendapatan menambah saldo kas/bank dan pendapatan usaha. Setoran modal bukan pendapatan.",
        expense: "Pembelian bahan baku dicatat sebagai persediaan periodik. Beban operasional langsung masuk ke laba rugi.",
        capital: "Setoran modal menambah saldo kas/bank dan ekuitas, bukan pendapatan atau laba.",
        loan: "Pinjaman masuk menambah saldo kas/bank dan utang, bukan pendapatan usaha.",
        draw: "Prive mengurangi saldo kas/bank dan ekuitas, bukan beban operasional.",
        principal: "Pembayaran pokok pinjaman mengurangi saldo dan utang, bukan beban laba rugi.",
        transfer: "Perpindahan saldo mengurangi akun asal dan menambah akun tujuan. Total uang dan laba tidak berubah."
    };
    const accountOptions = <><option value="cash">Cash</option><option value="bank">Rekening</option></>;

    return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-box" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal-heading"><div><span className="eyebrow">{KIND_NAMES[kind].toLocaleUpperCase("id-ID")}</span><h2 id="transaction-title">{initial ? `Ubah ${KIND_NAMES[kind].toLocaleLowerCase("id-ID")}` : `Tambah ${KIND_NAMES[kind].toLocaleLowerCase("id-ID")}`}</h2></div><button className="modal-close" onClick={onClose} aria-label="Tutup">×</button></div><form onSubmit={submit}><div className="form-grid">{kind === "asset" && <label className="field field-wide"><span>Nama aset</span><input name="assetName" defaultValue={initialAsset?.name || initial?.description} required maxLength="90" placeholder="Contoh: Mesin espresso" /></label>}{kind !== "transfer" && <label className="field"><span>Kategori</span><select name="category" value={category} onChange={(event) => setCategory(event.target.value)}>{kind === "expense" ? groupedExpenseCategories.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item} value={item}>{item}</option>)}</optgroup>) : flatCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}<label className="field"><span>Nominal (Rp)</span><input name="amount" type="number" min="1" step="1" defaultValue={initial?.amount} required /></label><label className="field"><span>Tanggal</span><input name="date" type="date" defaultValue={initial?.date || today()} required /></label><label className="field"><span>{kind === "transfer" ? "Dari akun" : "Metode pembayaran / penerimaan"}</span><select name="account" value={account} onChange={(event) => { setAccount(event.target.value); if (kind === "transfer") setTransferTo(event.target.value === "cash" ? "bank" : "cash"); }}>{accountOptions}</select></label>{kind === "transfer" && <label className="field"><span>Ke akun</span><select value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>{accountOptions}</select></label>}{kind === "asset" && <><label className="field"><span>Umur manfaat (bulan)</span><input name="lifeMonths" type="number" min="1" step="1" defaultValue={initialAsset?.lifeMonths || 12} required /></label><label className="field"><span>Nilai residu (Rp)</span><input name="residual" type="number" min="0" step="1" defaultValue={initialAsset?.residual || 0} required /></label></>}
        <label className="field field-wide">
            <span>Catatan</span>
            <input
                list="note-suggestions"
                name="note"
                className="input-control"
                defaultValue={initial?.note || ""}
                placeholder="Ketik catatan (contoh: biji kopi arabika, susu segar...)"
                autoComplete="off"
            />
            <datalist id="note-suggestions">
                {existingNotes.map((item) => <option key={item} value={item} />)}
            </datalist>
        </label>
    </div><div className="form-hint">{hint[kind]}</div>{error && <div className="notice-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Batal</button><button className="button button-primary">Simpan catatan</button></div></form></section></div>;
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
