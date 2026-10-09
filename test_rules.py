"""Rule tests for Finance_Health_Expert_System_v2.owl

Run:  python test_rules.py [path/to/ontology.owl]
Needs: pip install owlready2, and Java 25+ (Pellet in Owlready2 uses a recent Apache Jena).
Set JAVA25 below if your java is elsewhere.
"""
import sys, os, glob, re, subprocess
import owlready2
from owlready2 import get_ontology, sync_reasoner_pellet


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

PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "Finance_Health_Expert_System_v2.owl")
onto = get_ontology("file://" + os.path.abspath(PATH)).load()
S = onto.MonthlyFinancialState

# ---- test cases: (name, numbers on the state, must be inferred, must NOT be inferred)
CASES = [
    ("CostEscalation +", dict(hasCOGSGrowth=0.20, hasRevenueGrowth=0.05), {"COGSGrowthExceedsRevenue", "CostEscalation"}, set()),
    ("CostEscalation boundary (equal)", dict(hasCOGSGrowth=0.05, hasRevenueGrowth=0.05), set(), {"CostEscalation"}),
    ("CostEscalation - (COGS slower than revenue)", dict(hasCOGSGrowth=0.02, hasRevenueGrowth=0.05), set(), {"CostEscalation"}),
    ("MarginPressure +", dict(hasGrossMargin=0.50, hasGrossMarginLowerBound=0.56, hasCOGSGrowth=0.20, hasRevenueGrowth=0.10), {"GrossMarginDecline", "MarginPressure"}, set()),
    ("MarginPressure - (COGS slower than revenue)", dict(hasGrossMargin=0.50, hasGrossMarginLowerBound=0.56, hasCOGSGrowth=0.05, hasRevenueGrowth=0.10), {"GrossMarginDecline"}, {"MarginPressure"}),
    ("MarginPressure boundary (margin == bound)", dict(hasGrossMargin=0.56, hasGrossMarginLowerBound=0.56, hasCOGSGrowth=0.20, hasRevenueGrowth=0.10), set(), {"GrossMarginDecline", "MarginPressure"}),
    ("OPEXPressure +", dict(hasOPEXGrowth=0.15, hasRevenueGrowth=0.05), {"OPEXPressure"}, set()),
    ("OPEXPressure -", dict(hasOPEXGrowth=0.02, hasRevenueGrowth=0.05), set(), {"OPEXPressure"}),
    ("Marketing +", dict(hasMarketingGrowth=0.60, hasRevenueGrowth=0.10), {"MarketingEfficiencyReview"}, set()),
    ("Marketing -", dict(hasMarketingGrowth=0.05, hasRevenueGrowth=0.10), set(), {"MarketingEfficiencyReview"}),
    ("ProfitPressure + (user example: revenue flat, profit 30->15)", dict(hasNetMargin=0.15, hasNetMarginLowerBound=0.25), {"NetMarginDecline", "ProfitPressure"}, set()),
    ("ProfitPressure boundary (== bound)", dict(hasNetMargin=0.25, hasNetMarginLowerBound=0.25), set(), {"ProfitPressure"}),
    ("ProfitCashGap + (profit>0, cash down)", dict(hasNetProfit=5_000_000, hasChangeInCash=-2_000_000), {"ProfitCashGap", "LiquidityPressure"}, set()),
    ("ProfitCashGap - (profit>0, cash up)", dict(hasNetProfit=5_000_000, hasChangeInCash=1_000_000), set(), {"ProfitCashGap", "LiquidityPressure"}),
    ("ProfitCashGap - (loss, cash down)", dict(hasNetProfit=-1_000_000, hasChangeInCash=-2_000_000), {"LiquidityPressure"}, {"ProfitCashGap"}),
    ("OwnerDraw +", dict(hasOwnerDrawAmount=8_000_000, hasPreviousOwnerDrawAmount=3_000_000, hasChangeInCash=-2_000_000, hasOperatingCashFlow=5_000_000), {"OwnerDrawLiquidityPressure"}, set()),
    ("OwnerDraw - (OCF covers draw)", dict(hasOwnerDrawAmount=8_000_000, hasPreviousOwnerDrawAmount=3_000_000, hasChangeInCash=-2_000_000, hasOperatingCashFlow=15_000_000), set(), {"OwnerDrawLiquidityPressure"}),
    ("OwnerDraw - (draw not higher)", dict(hasOwnerDrawAmount=3_000_000, hasPreviousOwnerDrawAmount=3_000_000, hasChangeInCash=-2_000_000, hasOperatingCashFlow=1_000_000), set(), {"OwnerDrawLiquidityPressure"}),
    ("LiquidityCritical +", dict(hasChangeInCash=-1_000_000, hasCashRunwayMonths=1.5, hasRunwayMinimumMonths=2.0), {"LiquidityPressure", "LiquidityCritical"}, set()),
    ("LiquidityCritical - (runway ok)", dict(hasChangeInCash=-1_000_000, hasCashRunwayMonths=2.5, hasRunwayMinimumMonths=2.0), {"LiquidityPressure"}, {"LiquidityCritical"}),
    ("Missing data -> silent (open world)", dict(hasRevenueGrowth=0.10), set(), {"CostEscalation", "MarginPressure", "OPEXPressure", "MarketingEfficiencyReview",
                                                                                  "ProfitPressure", "ProfitCashGap", "LiquidityPressure", "OwnerDrawLiquidityPressure", "LiquidityCritical", "WarningCondition", "CriticalCondition"}),
]

states = []
with onto:
    for i, (name, props, must, mustnot) in enumerate(CASES):
        s = S(f"T{i:02d}")
        for k, v in props.items():
            setattr(s, k, float(v))
        states.append((name, s, must, mustnot))
    # cost-driver test: a top-contributor category outgrowing revenue vs. one that does not
    ts = S("T_driver")
    ts.hasRevenueGrowth = 0.10
    m1 = onto.CategoryMovement("T_m_cogs"); m1.hasCategoryGrowth = 0.25; m1.isTopContributor = True
    m2 = onto.CategoryMovement("T_m_opex"); m2.hasCategoryGrowth = 0.02; m2.isTopContributor = True
    m3 = onto.CategoryMovement("T_m_small"); m3.hasCategoryGrowth = 0.40; m3.isTopContributor = False
    ts.hasCategoryMovement = [m1, m2, m3]

with onto:
    sync_reasoner_pellet(infer_property_values=True, infer_data_property_values=True, debug=0)


def classes_of(x):
    return {c.name for c in x.INDIRECT_is_a if hasattr(c, "name")}


fails, total = 0, 0
print(f"{'':2}{'case':62} result")
for name, s, must, mustnot in states:
    got = classes_of(s)
    miss = must - got
    bad = mustnot & got
    ok = not miss and not bad
    total += 1
    fails += (not ok)
    print(f"{'OK' if ok else 'XX':2}{name:62} {'' if ok else 'missing=%s unexpected=%s' % (sorted(miss), sorted(bad))}")

# cost driver
total += 1
drivers = {m.name for m in ts.hasCostDriver}
ok = drivers == {"T_m_cogs"} and "CostDriverMovement" in classes_of(m1) and "CostDriverMovement" not in classes_of(m2) | classes_of(m3)
fails += (not ok)
print(f"{'OK' if ok else 'XX':2}{'CostDriver: only top contributor that outgrows revenue':62} drivers={sorted(drivers)}")

# advisory inferred from class-level knowledge
total += 1
cs = [s for n, s, _, _ in states if n.startswith("CostEscalation +")][0]
areas = {a.name for a in cs.recommendsInvestigation}
ok = {"Area_SupplierPrice", "Area_MaterialPrice", "Area_ProductionWaste"} <= areas
fails += (not ok)
print(f"{'OK' if ok else 'XX':2}{'Advisory inferred (CostEscalation -> supplier/material/waste)':62} {sorted(areas)}")

# demo months shipped in the file
aug, sep = onto.Demo_State_2026_08, onto.Demo_State_2026_09
FINDINGS = {"CostEscalation", "MarginPressure", "OPEXPressure", "MarketingEfficiencyReview", "ProfitPressure",
            "ProfitCashGap", "LiquidityPressure", "OwnerDrawLiquidityPressure", "LiquidityCritical"}
total += 1
got = classes_of(aug) & FINDINGS
ok = not got
fails += (not ok)
print(f"{'OK' if ok else 'XX':2}{'Demo Aug 2026: no finding (banner = Healthy by default)':62} {sorted(got)}")
total += 1
got = classes_of(sep) & FINDINGS
want = {"CostEscalation", "MarginPressure", "MarketingEfficiencyReview", "ProfitPressure", "ProfitCashGap", "LiquidityPressure"}
ok = got == want
fails += (not ok)
print(f"{'OK' if ok else 'XX':2}{'Demo Sep 2026: expected findings only':62} {sorted(got)}")
print("   Sep not flagged (WHY-NOT): OPEXPressure, OwnerDrawLiquidityPressure, LiquidityCritical ->",
      sorted({"OPEXPressure", "OwnerDrawLiquidityPressure", "LiquidityCritical"} & got) or "correct")
print("   Sep cost drivers:", sorted(m.hasCategoryName for m in sep.hasCostDriver))
print("   Sep investigation areas:", sorted(a.name for a in sep.recommendsInvestigation))

print(f"\n{total - fails}/{total} passed")
sys.exit(1 if fails else 0)
