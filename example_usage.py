"""Contoh: bagaimana backend memakai Finance_Health_Expert_System_v2.owl

1. Backend menghitung angka bulanan (growth, margin, batas dari riwayat sendiri, perubahan kas, dst).
2. Fungsi analyze() membuat satu MonthlyFinancialState berisi angka itu, menjalankan reasoner (Pellet),
   lalu membaca kelas hasil klasifikasi.

Jalankan:  python example_usage.py      (butuh: pip install owlready2, dan Java 25+)
"""
import glob, os, re, subprocess
import owlready2
from owlready2 import World, sync_reasoner_pellet


def detect_java():
    candidates = []
    env_java = os.environ.get("JAVA25", "").strip()
    if env_java:
        candidates.append(env_java)
    candidates += glob.glob("/usr/lib/jvm/java-2[5-9]*/bin/java")
    candidates += [
        r"C:\Program Files\BellSoft\LibericaJDK-25\bin\java.exe",
        r"C:\Program Files\Zulu\zulu-25\bin\java.exe",
        r"C:\Program Files\Eclipse Adoptium\jdk-25\bin\java.exe",
        r"C:\Program Files\Microsoft\jdk-25\bin\java.exe",
        r"C:\Program Files\Java\jdk-25\bin\java.exe",
    ]
    for cand in candidates:
        if cand and os.path.exists(cand):
            return cand
    try:
        java_on_path = subprocess.run(["java", "-version"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except Exception:
        java_on_path = None
    if java_on_path and java_on_path.returncode == 0:
        return "java"
    return None


def java_is_compatible(path):
    try:
        out = subprocess.run([path, "-version"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout
    except Exception:
        return False, "Unable to execute Java"
    match = re.search(r'"(\d+)(?:\.(\d+))?', out)
    if not match:
        return False, "Unable to determine Java version"
    major = int(match.group(1))
    return major >= 25, f"Java {major}"


JAVA_EXE = detect_java()
if not JAVA_EXE:
    raise RuntimeError("Java 25+ is required for Pellet. Install JDK 25 and ensure `java` is on PATH or set JAVA25 to the Java binary.")
compatible, msg = java_is_compatible(JAVA_EXE)
if not compatible:
    raise RuntimeError(f"Java version is too old ({msg}). Pellet requires Java 25+; install JDK 25 and set JAVA25 to the correct binary.")
owlready2.JAVA_EXE = JAVA_EXE

OWL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Finance_Health_Expert_System_v2.owl")


def analyze(numbers, category_moves=()):
    """numbers: dict nama_property -> angka (lihat property 'has...' pada MonthlyFinancialState).
    category_moves: list dict {name, growth, is_top} untuk profit bridge.
    Mengembalikan dict berisi banner, temuan, langkah penalaran, area cek, dan pendorong biaya."""
    world = World()                                   # dunia terpisah: tiap analisis bersih
    onto = world.get_ontology("file://" + OWL_PATH).load()
    with onto:
        state = onto.MonthlyFinancialState("state_now")
        for prop, value in numbers.items():
            setattr(state, prop, float(value))
        moves = []
        for i, m in enumerate(category_moves):
            mv = onto.CategoryMovement(f"move_{i}")
            mv.hasCategoryName = m["name"]
            mv.hasCategoryGrowth = float(m["growth"])
            mv.isTopContributor = bool(m["is_top"])
            moves.append(mv)
        state.hasCategoryMovement = moves
    with onto:
        sync_reasoner_pellet(world, infer_property_values=True, infer_data_property_values=True, debug=0)

    got = {c.name for c in state.INDIRECT_is_a if hasattr(c, "name")}
    names = lambda root: {c.name for c in root.descendants()} - {root.name}
    warnings = got & names(onto.WarningCondition)
    criticals = got & names(onto.CriticalCondition)
    observations = got & names(onto.FinancialCondition)
    banner = "Kritis" if criticals else "Perlu perhatian" if warnings else "Sehat"   # Healthy = default backend
    return {
        "banner": banner,
        "temuan": sorted(warnings | criticals),
        "langkah_penalaran": sorted(observations),
        "perlu_dicek": sorted(str(a.label.first() or a.name) for a in state.recommendsInvestigation),
        "pendorong_biaya": sorted(m.hasCategoryName for m in state.hasCostDriver),
    }


if __name__ == "__main__":
    # Angka September (sama dengan data demo di dalam file .owl)
    sep = dict(hasRevenueGrowth=100 / 90 - 1, hasCOGSGrowth=46.5 / 38 - 1, hasOPEXGrowth=32 / 30 - 1,
               hasMarketingGrowth=6.5 / 4 - 1, hasGrossMargin=0.535, hasGrossMarginLowerBound=0.56,
               hasNetProfit=14_000_000, hasNetMargin=0.14, hasNetMarginLowerBound=0.17,
               hasOperatingCashFlow=15_000_000, hasChangeInCash=-7_000_000,
               hasOwnerDrawAmount=8_000_000, hasPreviousOwnerDrawAmount=3_000_000,
               hasCashRunwayMonths=23 / 8, hasRunwayMinimumMonths=2.0)
    moves = [dict(name="COGS", growth=46.5 / 38 - 1, is_top=True),
             dict(name="Marketing", growth=6.5 / 4 - 1, is_top=True),
             dict(name="OPEX", growth=32 / 30 - 1, is_top=False)]
    hasil = analyze(sep, moves)
    for k, v in hasil.items():
        print(f"{k:18}: {v}")
