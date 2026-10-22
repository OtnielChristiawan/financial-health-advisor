from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import owlready2
from owlready2 import World, sync_reasoner_pellet


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ONTOLOGY_PATH = PROJECT_ROOT / "Finance_Health_Expert_System_v2.owl"
ALLOWED_NUMBER_PROPERTIES = {
    "hasCOGSGrowth", "hasRevenueGrowth", "hasOPEXGrowth", "hasMarketingGrowth",
    "hasGrossMargin", "hasGrossMarginLowerBound", "hasNetProfit", "hasNetMargin",
    "hasNetMarginLowerBound", "hasChangeInCash", "hasOperatingCashFlow",
    "hasOwnerDrawAmount", "hasPreviousOwnerDrawAmount",
    "hasCashRunwayMonths", "hasRunwayMinimumMonths",
    "hasCapexAmount", "hasLoanPrincipalPaid", "hasEndingCash",
}


def find_java() -> str:
    candidates = []
    configured = os.environ.get("JAVA25", "").strip()
    if configured:
        candidates.append(configured)
    candidates.extend(
        [
            "/usr/lib/jvm/java-25-openjdk-amd64/bin/java",
            "/usr/lib/jvm/java-25-openjdk/bin/java",
            "/opt/java25/bin/java",
            r"C:\Program Files\BellSoft\LibericaJDK-25\bin\java.exe",
            r"C:\Program Files\Zulu\zulu-25\bin\java.exe",
            r"C:\Program Files\Eclipse Adoptium\jdk-25\bin\java.exe",
            r"C:\Program Files\Microsoft\jdk-25\bin\java.exe",
            r"C:\Program Files\Java\jdk-25\bin\java.exe",
        ]
    )
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    java_on_path = shutil.which("java")
    if java_on_path:
        return java_on_path
    raise RuntimeError("Java 25+ tidak ditemukan. Install JDK 25 atau atur JAVA25.")


def java_version(executable: str) -> tuple[int, str]:
    result = subprocess.run(
        [executable, "-version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=True,
    )
    match = re.search(r'"(\d+)', result.stdout)
    if not match:
        raise RuntimeError("Versi Java tidak dapat dibaca.")
    major = int(match.group(1))
    if major < 25:
        raise RuntimeError(f"Java {major} ditemukan; reasoning membutuhkan Java 25+.")
    return major, f"Java {major}"


JAVA_EXE = find_java()
JAVA_MAJOR, JAVA_VERSION = java_version(JAVA_EXE)
owlready2.JAVA_EXE = JAVA_EXE


def _valid_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    numbers = payload.get("numbers", {})
    movements = payload.get("movements", [])
    if not isinstance(numbers, dict) or not isinstance(movements, list):
        raise ValueError("'numbers' harus objek dan 'movements' harus berupa daftar.")
    unknown = set(numbers) - ALLOWED_NUMBER_PROPERTIES
    if unknown:
        raise ValueError(f"Properti indikator tidak dikenal: {', '.join(sorted(unknown))}.")
    if any(not _valid_number(value) for value in numbers.values()):
        raise ValueError("Semua indikator harus berupa angka finite.")
    for movement in movements:
        if (
            not isinstance(movement, dict)
            or not isinstance(movement.get("name"), str)
            or not movement["name"].strip()
            or len(movement["name"]) > 80
            or not _valid_number(movement.get("growth"))
            or not isinstance(movement.get("is_top"), bool)
        ):
            raise ValueError("Format pergerakan kategori tidak valid.")
    if not ONTOLOGY_PATH.is_file():
        raise FileNotFoundError(f"Ontology tidak ditemukan: {ONTOLOGY_PATH}")

    started = time.perf_counter()
    world = World()
    ontology = world.get_ontology("file://" + str(ONTOLOGY_PATH)).load()
    with ontology:
        state = ontology.MonthlyFinancialState("Web_Analysis")
        for property_name, value in numbers.items():
            setattr(state, property_name, float(value))
        category_individuals = []
        for index, movement in enumerate(movements):
            category = ontology.CategoryMovement(f"Web_Movement_{index}")
            category.hasCategoryName = movement["name"]
            category.hasCategoryGrowth = float(movement["growth"])
            category.isTopContributor = movement["is_top"]
            category_individuals.append(category)
        if category_individuals:
            state.hasCategoryMovement = category_individuals

    with ontology:
        sync_reasoner_pellet(
            world,
            infer_property_values=True,
            infer_data_property_values=True,
            debug=0,
        )

    inferred = sorted(entity.name for entity in state.INDIRECT_is_a if hasattr(entity, "name"))
    recommendations = sorted({
        str(area.label.first() or area.name) for area in state.recommendsInvestigation
    })
    cost_drivers = sorted(
        movement.hasCategoryName
        for movement in state.hasCostDriver
        if movement.hasCategoryName
    )
    return {
        "engine": "OWL + SWRL / Pellet",
        "java": JAVA_VERSION,
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
        "inferred": inferred,
        "recommendations": recommendations,
        "cost_drivers": cost_drivers,
    }


FINDING_METADATA: dict[str, dict[str, Any]] = {
    "CostEscalation": {
        "title": "Eskalasi Biaya Bahan Baku (Cost Escalation)",
        "domain": "Efisiensi Biaya",
        "severity": "Waspada",
        "rule": "F01_CostEscalation",
        "explanation": "Pertumbuhan biaya bahan baku (COGS) melampaui pertumbuhan omzet penjualan.",
        "chain": [
            "Hitung pertumbuhan omzet dan COGS",
            "COGS tumbuh lebih cepat dari pendapatan",
            "Indikasi eskalasi biaya bahan",
            "Tinjau harga supplier & porsi resep",
        ],
        "advice": "Periksa fluktuasi harga bahan dari supplier, pantau waste/bahan terbuang di bar/kitchen, dan evaluasi porsi resep menu.",
    },
    "MarginPressure": {
        "title": "Tekanan Margin Kotor (Margin Pressure)",
        "domain": "Profitabilitas",
        "severity": "Waspada",
        "rule": "F02_MarginPressure",
        "explanation": "Gross profit margin berada di bawah baseline historis bersamaan dengan kenaikan biaya bahan yang melebihi pendapatan.",
        "chain": [
            "Bandingkan gross margin dengan baseline",
            "COGS tumbuh lebih cepat dari omzet",
            "Gross margin turun di bawah ambang batas",
            "Evaluasi harga jual menu & product mix",
        ],
        "advice": "Tinjau harga jual menu, periksa apakah terjadi pergeseran penjualan ke menu ber-margin rendah (product mix), dan audit harga pembelian bahan.",
    },
    "OPEXPressure": {
        "title": "Beban Operasional Tumbuh Melebihi Omzet (OPEX Pressure)",
        "domain": "Efisiensi Biaya",
        "severity": "Waspada",
        "rule": "F03_OPEXPressure",
        "explanation": "Beban operasional (di luar pemasaran) bertumbuh lebih cepat daripada pendapatan usaha.",
        "chain": [
            "Hitung pertumbuhan OPEX non-marketing",
            "Pertumbuhan beban > pertumbuhan omzet",
            "Rasio beban operasional berpotensi meningkat",
            "Audit pos beban operasional terbesar",
        ],
        "advice": "Tinjau rincian beban pegawai, utilitas (listrik/air/gas), dan supplies. Pastikan kenaikan biaya sejalan dengan peningkatan kapasitas usaha.",
    },
    "MarketingEfficiencyReview": {
        "title": "Evaluasi Efisiensi Biaya Pemasaran (Marketing Efficiency)",
        "domain": "Efisiensi Biaya",
        "severity": "Waspada",
        "rule": "F04_MarketingEfficiencyReview",
        "explanation": "Biaya pemasaran/promosi tumbuh lebih cepat daripada pertumbuhan omzet penjualan.",
        "chain": [
            "Hitung pengeluaran iklan, promo & MDR",
            "Biaya marketing tumbuh lebih cepat dari omzet",
            "Tinjau efektivitas pengembalian promosi",
            "Optimalkan kanal promosi berkonversi tinggi",
        ],
        "advice": "Evaluasi kanal promosi (iklan medsos, potongan fee MDR/QRIS, diskon menu). Alihkan anggaran ke kanal promosi yang terbukti menghasilkan penjualan langsung.",
    },
    "ProfitPressure": {
        "title": "Tekanan Margin Laba Bersih (Profit Pressure)",
        "domain": "Profitabilitas",
        "severity": "Waspada",
        "rule": "F05_ProfitPressure",
        "explanation": "Margin laba bersih (net profit margin) berada di bawah batas wajar historis usaha.",
        "chain": [
            "Bandingkan net margin dengan baseline",
            "Porsi laba bersih terhadap omzet tertekan",
            "Beban usaha menggerus profitabilitas",
            "Audit pos pengeluaran & kebocoran biaya",
        ],
        "advice": "Telusuri pemicu penurunan laba bersih dari pos HPP, beban operasional, dan penyusutan; periksa apakah ada pengeluaran insidental yang tidak proporsional.",
    },
    "ProfitCashGap": {
        "title": "Kesenjangan Laba dan Kas (Profit-Cash Gap)",
        "domain": "Likuiditas",
        "severity": "Waspada",
        "rule": "F06_ProfitCashGap",
        "explanation": "Usaha mencatat laba bersih positif, namun saldo uang kas justru berkurang.",
        "chain": [
            "Laba bersih tercatat positif",
            "Perubahan kas periode ini negatif",
            "Kas keluar lewat pos non-laba-rugi",
            "Periksa prive, pembelian aset & pokok utang",
        ],
        "advice": "Laba bukan kas: periksa arus kas keluar untuk prive pemilik, pembelian aset tetap (peralatan), atau pembayaran pokok cicilan pinjaman.",
    },
    "LiquidityPressure": {
        "title": "Penurunan Saldo Kas (Liquidity Pressure)",
        "domain": "Likuiditas",
        "severity": "Waspada",
        "rule": "F07_LiquidityPressure",
        "explanation": "Total saldo kas dan rekening bank mengalami penurunan bersih sepanjang periode ini.",
        "chain": [
            "Hitung saldo awal kas dan penerimaan",
            "Arus kas keluar melampaui arus kas masuk",
            "Penurunan saldo kas bersih",
            "Kendalikan jadwal pengeluaran kas",
        ],
        "advice": "Pantau arus kas harian secara ketat, tunda pengeluaran non-prioritas, dan pastikan penerimaan omzet disetor ke rekening/kas secara disiplin.",
    },
    "OwnerDrawLiquidityPressure": {
        "title": "Prive Menekan Likuiditas Usaha (Owner Draw Pressure)",
        "domain": "Struktur Modal",
        "severity": "Waspada",
        "rule": "F08_OwnerDrawLiquidityPressure",
        "explanation": "Penarikan prive pemilik meningkat dan tidak tertutup oleh arus kas operasi, sehingga menguras cadangan kas.",
        "chain": [
            "Prive pemilik meningkat dari bulan lalu",
            "Arus kas operasi lebih kecil dari total prive",
            "Kas usaha mengalami penurunan",
            "Disiplinkan kebijakan penarikan kas pribadi",
        ],
        "advice": "Batasi penarikan prive pemilik agar tidak melebihi kemampuan arus kas operasional riil usaha. Jangan menggunakan kas operasional sebagai cadangan pribadi.",
    },
    "LiquidityCritical": {
        "title": "Krisis Likuiditas / Cadangan Kas Kritis (Liquidity Critical)",
        "domain": "Likuiditas",
        "severity": "Kritis",
        "rule": "F09_LiquidityCritical",
        "explanation": "Kas terus menurun dan cadangan kas (cash runway) kurang dari ambang batas aman (di bawah 2 bulan biaya wajib).",
        "chain": [
            "Saldo kas mengalami penurunan",
            "Sisa cadangan kas < ambang batas aman (2 bulan)",
            "Risiko gagal bayar operasional wajib",
            "Ambil tindakan pengamanan kas darurat",
        ],
        "advice": "Tindakan darurat: Moratorium penarikan prive, tunda seluruh pembelian aset baru, negosiasikan termin pembayaran, dan prioritaskan kas hanya untuk gaji dan bahan baku pokok.",
    },
}


def _format_money(value: float | int) -> str:
    val = float(value)
    if abs(val) >= 1_000_000:
        return f"Rp{val / 1_000_000:.1f} jt"
    return f"Rp{val:,.0f}"


def _format_pct(val: float | None) -> str:
    if val is None or not math.isfinite(val):
        return "—"
    sign = "+" if val > 0 else ""
    return f"{sign}{val * 100:.1f}%"


def diagnose_finance(report: dict[str, Any]) -> dict[str, Any]:
    """
    Authoritative OWL/SWRL diagnosis generator.
    Evaluates data completeness, prepares parameters, runs Pellet reasoner,
    and returns explainable signals with Indonesian recommendations.
    """
    prev = report.get("previous")
    rev = float(report.get("revenue") or 0)
    prev_rev = float(prev.get("revenue") or 0) if prev else 0.0

    is_comparable = bool(prev and prev_rev > 0 and rev > 0)
    is_provisional = bool(report.get("isProvisional", False))
    is_closed = bool(report.get("isClosed", False))

    notes = []
    if not prev:
        notes.append("Data transaksi bulan sebelumnya belum tersedia; aturan perbandingan tren belum dapat dijalankan.")
    elif prev_rev <= 0:
        notes.append("Pendapatan bulan pembanding nihil; pertumbuhan persentase tidak dapat dihitung.")
    if rev <= 0:
        notes.append("Belum ada omzet penjualan tercatat pada periode ini; rasio margin belum dapat dievaluasi.")
    if is_provisional:
        notes.append("Laporan masih berstatus estimasi/belum tutup buku fisik; angka HPP dan laba belum final.")

    if not is_comparable:
        return {
            "status": "DATA_TIDAK_CUKUP",
            "status_label": "Data Belum Cukup",
            "level": "limited",
            "summary": "Sistem membutuhkan data minimal 2 bulan transaksi berurutan untuk menganalisis tren dan sinyal kesehatan keuangan secara andal.",
            "data_completeness": {
                "is_comparable": False,
                "has_previous": bool(prev),
                "is_provisional": is_provisional,
                "is_closed": is_closed,
                "notes": notes,
            },
            "findings": [],
            "why_not": [
                "Aturan inferensi SWRL berbasis komparasi tren (pertumbuhan omzet, margin, dan biaya) membutuhkan data bulan sebelumnya.",
                "Sistem menganut Open World Assumption: ketiadaan data tidak dianggap sebagai kondisi sehat.",
            ],
            "cost_drivers": [],
            "recommendations": [
                "Lengkapi pencatatan transaksi untuk minimal 2 bulan berurutan.",
                "Lakukan stock opname fisik di menu Tutup Buku untuk menetapkan HPP yang akurat.",
            ],
            "inferred_classes": [],
            "engine": "OWL + SWRL / Pellet",
            "elapsed_ms": 0,
        }

    # Prepare numbers for ontology
    rev_growth = (rev - prev_rev) / prev_rev
    cogs = float(report.get("cogs") or 0)
    prev_cogs = float(prev.get("cogs") or 0)
    cogs_growth = (cogs - prev_cogs) / prev_cogs if prev_cogs > 0 else 0.0

    opex = float(report.get("opex") or 0)
    prev_opex = float(prev.get("opex") or 0)
    opex_growth = (opex - prev_opex) / prev_opex if prev_opex > 0 else 0.0

    mkt = float(report.get("marketing") or 0)
    prev_mkt = float(prev.get("marketing") or 0)
    mkt_growth = (mkt - prev_mkt) / prev_mkt if prev_mkt > 0 else 0.0

    gross_margin = report.get("grossMargin")
    prev_gross_margin = prev.get("grossMargin")

    net_margin = report.get("netMargin")
    prev_net_margin = prev.get("netMargin")

    net_profit = float(report.get("netProfit") or 0)
    change_cash = float(report.get("changeCash") or 0)
    ocf = float(report.get("operatingCashFlow") or 0)

    rows = report.get("rows") or []
    prev_rows = prev.get("rows") or []

    owner_draw = sum(float(r["amount"]) for r in rows if r.get("kind") == "draw")
    prev_owner_draw = sum(float(r["amount"]) for r in prev_rows if r.get("kind") == "draw")

    cash_runway = float(report.get("cashRunwayMonths") or 99.0)
    runway_min = float(report.get("runwayMinimumMonths") or 2.0)

    numbers: dict[str, float] = {
        "hasRevenueGrowth": rev_growth,
        "hasCOGSGrowth": cogs_growth,
        "hasOPEXGrowth": opex_growth,
        "hasMarketingGrowth": mkt_growth,
        "hasNetProfit": net_profit,
        "hasChangeInCash": change_cash,
        "hasOperatingCashFlow": ocf,
        "hasOwnerDrawAmount": owner_draw,
        "hasPreviousOwnerDrawAmount": prev_owner_draw,
        "hasCashRunwayMonths": cash_runway,
        "hasRunwayMinimumMonths": runway_min,
    }
    if gross_margin is not None and prev_gross_margin is not None:
        numbers["hasGrossMargin"] = float(gross_margin)
        numbers["hasGrossMarginLowerBound"] = float(prev_gross_margin)
    if net_margin is not None and prev_net_margin is not None:
        numbers["hasNetMargin"] = float(net_margin)
        numbers["hasNetMarginLowerBound"] = float(prev_net_margin)

    # Cost movements for profit bridge & cost driver rule
    candidates = [
        ("COGS", cogs, prev_cogs),
        ("OPEX", opex, prev_opex),
        ("Marketing", mkt, prev_mkt),
    ]
    valid_candidates = [c for c in candidates if c[2] > 0]
    top_name = None
    if valid_candidates:
        top_name = max(valid_candidates, key=lambda c: c[1] - c[2])[0]

    movements = []
    for name, cur_val, p_val in valid_candidates:
        growth = (cur_val - p_val) / p_val
        is_top = (name == top_name and cur_val > p_val)
        movements.append({"name": name, "growth": growth, "is_top": is_top})

    # Invoke Pellet reasoner
    reasoner_res = analyze({"numbers": numbers, "movements": movements})
    inferred_set = set(reasoner_res.get("inferred", []))

    findings = []
    for fid, meta in FINDING_METADATA.items():
        if fid in inferred_set:
            # Build specific evidence
            evidence = []
            if fid in ("CostEscalation", "MarginPressure"):
                evidence = [
                    ["Pertumbuhan omzet", _format_pct(rev_growth)],
                    ["Pertumbuhan COGS", _format_pct(cogs_growth)],
                    ["Gross margin periode ini", _format_pct(gross_margin)],
                    ["Gross margin baseline lalu", _format_pct(prev_gross_margin)],
                ]
            elif fid == "OPEXPressure":
                evidence = [
                    ["Pertumbuhan omzet", _format_pct(rev_growth)],
                    ["Pertumbuhan OPEX", _format_pct(opex_growth)],
                    ["Total OPEX periode ini", _format_money(opex)],
                ]
            elif fid == "MarketingEfficiencyReview":
                evidence = [
                    ["Pertumbuhan omzet", _format_pct(rev_growth)],
                    ["Pertumbuhan biaya pemasaran", _format_pct(mkt_growth)],
                    ["Biaya pemasaran periode ini", _format_money(mkt)],
                ]
            elif fid == "ProfitPressure":
                evidence = [
                    ["Net margin periode ini", _format_pct(net_margin)],
                    ["Net margin baseline lalu", _format_pct(prev_net_margin)],
                    ["Laba bersih tercatat", _format_money(net_profit)],
                ]
            elif fid == "ProfitCashGap":
                evidence = [
                    ["Laba bersih tercatat", _format_money(net_profit)],
                    ["Perubahan kas bersih", _format_money(change_cash)],
                    ["Arus kas operasi", _format_money(ocf)],
                    ["Penarikan prive pemilik", _format_money(owner_draw)],
                ]
            elif fid == "LiquidityPressure":
                evidence = [
                    ["Perubahan kas bersih", _format_money(change_cash)],
                    ["Saldo kas & bank akhir", _format_money(report.get("cashClosing", 0))],
                    ["Arus kas operasi", _format_money(ocf)],
                ]
            elif fid == "OwnerDrawLiquidityPressure":
                evidence = [
                    ["Prive periode ini", _format_money(owner_draw)],
                    ["Prive bulan sebelumnya", _format_money(prev_owner_draw)],
                    ["Arus kas operasi (OCF)", _format_money(ocf)],
                    ["Perubahan kas bersih", _format_money(change_cash)],
                ]
            elif fid == "LiquidityCritical":
                evidence = [
                    ["Estimasi cadangan kas (runway)", f"{cash_runway:.1f} bulan"],
                    ["Batas aman minimum (policy)", f"{runway_min:.1f} bulan"],
                    ["Perubahan kas periode ini", _format_money(change_cash)],
                    ["Saldo kas akhir", _format_money(report.get("cashClosing", 0))],
                ]

            findings.append({
                "id": fid,
                "title": meta["title"],
                "domain": meta["domain"],
                "severity": meta["severity"],
                "rule": meta["rule"],
                "explanation": meta["explanation"],
                "evidence": evidence,
                "chain": meta["chain"],
                "advice": meta["advice"],
            })

    # Determine overall status
    has_critical = any(f["severity"] == "Kritis" for f in findings)
    has_warning = any(f["severity"] == "Waspada" for f in findings)

    if has_critical:
        status = "KRITIS"
        status_label = "Kondisi Kritis"
        level = "critical"
        summary = f"Terdeteksi {len(findings)} indikasi risiko keuangan, termasuk risiko likuiditas kritis yang membutuhkan tindakan penanganan segera."
    elif has_warning:
        status = "WASPADA"
        status_label = "Perlu Diperiksa"
        level = "danger"
        summary = f"Terdeteksi {len(findings)} indikasi perhatian keuangan berdasarkan penalaran aturan SWRL. Telusuri bukti dan rekomendasi di bawah."
    else:
        status = "SEHAT"
        status_label = "Kondisi Sehat"
        level = "healthy"
        summary = "Tidak ada indikasi risiko signifikan yang terdeteksi oleh aturan SWRL. Rasio margin, biaya, dan likuiditas berada dalam batas wajar historis."

    why_not = []
    for fid, meta in FINDING_METADATA.items():
        if fid not in inferred_set:
            if fid == "CostEscalation":
                why_not.append("CostEscalation tidak disimpulkan karena pertumbuhan COGS tidak melebihi pertumbuhan omzet.")
            elif fid == "MarginPressure":
                why_not.append("MarginPressure tidak disimpulkan karena gross margin tidak turun di bawah baseline historis bersamaan dengan eskalasi COGS.")
            elif fid == "OPEXPressure":
                why_not.append("OPEXPressure tidak disimpulkan karena beban operasional tumbuh terkendali di bawah omzet.")
            elif fid == "LiquidityCritical":
                why_not.append(f"LiquidityCritical tidak disimpulkan karena cadangan kas ({cash_runway:.1f} bulan) masih berada di atas batas minimum {runway_min:.1f} bulan.")
            elif fid == "OwnerDrawLiquidityPressure":
                why_not.append("OwnerDrawPressure tidak disimpulkan karena penarikan prive pemilik masih tertutup oleh arus kas operasional.")

    return {
        "status": status,
        "status_label": status_label,
        "level": level,
        "summary": summary,
        "data_completeness": {
            "is_comparable": is_comparable,
            "has_previous": bool(prev),
            "is_provisional": is_provisional,
            "is_closed": is_closed,
            "notes": notes,
        },
        "findings": findings,
        "why_not": why_not[:4],
        "cost_drivers": reasoner_res.get("cost_drivers", []),
        "recommendations": reasoner_res.get("recommendations", []),
        "inferred_classes": inferred_set,
        "engine": "OWL + SWRL / Pellet",
        "elapsed_ms": reasoner_res.get("elapsed_ms", 0),
    }

