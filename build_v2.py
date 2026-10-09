import re
from decimal import Decimal
from rdflib import Graph, Namespace, URIRef, Literal, BNode, RDF, RDFS, OWL, XSD

BASE = "http://www.semanticweb.org/otniel/ontologies/2026/9/financial-health-expert-system"
NS = Namespace(BASE + "#")
SWRL = Namespace("http://www.w3.org/2003/11/swrl#")
SWRLB = Namespace("http://www.w3.org/2003/11/swrlb#")
SWRLA = Namespace("http://swrl.stanford.edu/ontologies/3.3/swrla.owl#")

g = Graph()
for p, n in [("", NS), ("owl", OWL), ("rdf", RDF), ("rdfs", RDFS), ("xsd", XSD),
             ("swrl", SWRL), ("swrlb", SWRLB), ("swrla", SWRLA)]:
    g.bind(p, n)

CLASSES, OPROPS, DPROPS = set(), set(), set()


def split_camel(name):
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name).replace("_", " ")


def lab(node, text, lang="en"):
    g.add((node, RDFS.label, Literal(text, lang=lang)))


def com(node, text):
    g.add((node, RDFS.comment, Literal(text, lang="en")))


def cls(name, parent=None, comment=None):
    c = NS[name]
    CLASSES.add(name)
    g.add((c, RDF.type, OWL.Class))
    lab(c, split_camel(name))
    for p in ([] if parent is None else parent if isinstance(parent, list) else [parent]):
        g.add((c, RDFS.subClassOf, NS[p]))
    if comment:
        com(c, comment)
    return c


def oprop(name, dom, rng, comment=None, functional=False, inverse=None):
    p = NS[name]
    OPROPS.add(name)
    g.add((p, RDF.type, OWL.ObjectProperty))
    lab(p, split_camel(name))
    g.add((p, RDFS.domain, NS[dom]))
    g.add((p, RDFS.range, NS[rng]))
    if functional:
        g.add((p, RDF.type, OWL.FunctionalProperty))
    if inverse:
        g.add((p, OWL.inverseOf, NS[inverse]))
    if comment:
        com(p, comment)


def dprop(name, dom, xsd, comment=None, functional=True):
    p = NS[name]
    DPROPS.add(name)
    g.add((p, RDF.type, OWL.DatatypeProperty))
    lab(p, split_camel(name))
    g.add((p, RDFS.domain, NS[dom]))
    g.add((p, RDFS.range, xsd))
    if functional:
        g.add((p, RDF.type, OWL.FunctionalProperty))
    if comment:
        com(p, comment)


def dec(x):
    return Literal(Decimal(str(round(x, 6))), datatype=XSD.decimal)


def ind(name, types, label=None):
    i = NS[name]
    g.add((i, RDF.type, OWL.NamedIndividual))
    for t in ([types] if isinstance(types, str) else types):
        g.add((i, RDF.type, NS[t]))
    if label:
        g.add((i, RDFS.label, Literal(label, lang="id")))
    return i


# ------------------------------------------------------------------ ontology header
onto = URIRef(BASE)
g.add((onto, RDF.type, OWL.Ontology))
g.add((onto, OWL.versionInfo, Literal("2.1.0")))
g.add((onto, RDFS.label, Literal("Financial Health Expert System for F&B MSMEs")))
g.add((onto, RDFS.comment, Literal(
    "Knowledge base for diagnosing the financial health of small F&B businesses. "
    "Numbers (growth, margins, baseline bounds, cash change) are computed by the backend and "
    "asserted on a MonthlyFinancialState individual; SWRL rules compare them and the reasoner "
    "classifies the state. v2: BusinessProfile removed (F&B only), per-month state added, "
    "SWRL variables correctly typed swrl:Variable, numeric comparison moved into SWRL. "
    "v2.1: reseller/segment analysis removed for the MVP (rules use total figures and the business's own baseline).")))

for ap in ["sourceStatus", "sourceNote"]:
    g.add((NS[ap], RDF.type, OWL.AnnotationProperty))
    lab(NS[ap], split_camel(ap))
g.add((SWRLA.isRuleEnabled, RDF.type, OWL.AnnotationProperty))

# ------------------------------------------------------------------ core classes
cls("Business", comment="A small business (v2: F&B only). Its monthly condition is described by MonthlyFinancialState individuals.")
cls("Period", comment="A calendar month. Linked to the previous month with previousPeriod.")
cls("MonthlyFinancialState",
    comment="Snapshot of one business in one month. The backend asserts computed numbers on it; "
            "the reasoner classifies it into observation and finding classes.")

# observations (intermediate reasoning steps)
cls("FinancialCondition", "MonthlyFinancialState",
    "Observation classes: simple facts derived by comparing numbers. They are the intermediate steps shown in the reasoning path.")
OBS = {
    "COGSGrowthExceedsRevenue": "Total COGS grew faster than total revenue (md 20.1).",
    "OPEXGrowthExceedsRevenue": "OPEX (excluding marketing) grew faster than revenue (md 20.3).",
    "MarketingGrowthExceedsRevenue": "Marketing spend grew faster than revenue (md 20.4).",
    "GrossMarginDecline": "Gross margin is below the lower bound derived from the business's own history (no universal threshold).",
    "NetMarginDecline": "Net profit margin is below the lower bound derived from the business's own history.",
    "PositiveProfit": "Net profit is greater than zero.",
    "CashDecline": "Cash balance decreased during the month (change in cash < 0).",
}
for k, v in OBS.items():
    cls(k, "FinancialCondition", v)

# findings (overall status)
cls("FinancialStatus", "MonthlyFinancialState",
    "Findings. Banner rule used by the application: Critical if the state is in CriticalCondition, else Warning if in "
    "WarningCondition, else Healthy (Healthy is a backend default; OWL is open-world, so it is never inferred).")
cls("HealthyCondition", "FinancialStatus", "Backend default when no warning/critical finding was inferred.")
cls("WarningCondition", "FinancialStatus", "At least one warning finding was inferred.")
cls("CriticalCondition", "FinancialStatus", "At least one critical finding was inferred. Not disjoint from WarningCondition: a state can have both; the highest severity wins.")
FIND_W = {
    "CostEscalation": "COGS is growing faster than revenue (early signal). This version does not tell apart higher purchase prices from a shift in what is sold; both are listed as things to check.",
    "MarginPressure": "Gross margin fell below the business's own baseline while COGS grew faster than revenue.",
    "OPEXPressure": "Operating expenses grew faster than revenue.",
    "MarketingEfficiencyReview": "Marketing spend grew faster than revenue; its efficiency should be reviewed (not a conclusion that it is wasteful).",
    "ProfitPressure": "Net profit margin fell below its own baseline (e.g. same revenue, lower profit).",
    "ProfitCashGap": "Net profit is positive but the cash balance fell. Cash left through non-expense flows (owner draw, facility purchase, loan principal).",
    "LiquidityPressure": "Cash balance fell during the month.",
    "OwnerDrawLiquidityPressure": "Owner draw increased, cash fell, and operating cash flow did not cover the draw.",
}
for k, v in FIND_W.items():
    cls(k, "WarningCondition", v)
cls("LiquidityCritical", "CriticalCondition",
    "Cash is falling and cash runway is below the minimum runway the owner/accountant configured (policy parameter, not a universal threshold).")
g.add((NS["HealthyCondition"], OWL.disjointWith, NS["WarningCondition"]))
g.add((NS["HealthyCondition"], OWL.disjointWith, NS["CriticalCondition"]))

# category movement (profit bridge)
cls("CategoryMovement", comment="Month-over-month movement of one cost category (COGS, OPEX, Marketing, Depreciation). One individual per category per month; computed by the backend (profit bridge).")
cls("CostDriverMovement", "CategoryMovement", "A cost category that grew faster than revenue and is among the top contributors to the profit change. Inferred by rule.")

# investigation areas
cls("InvestigationArea", comment="Something the owner should check. Linked from findings through recommendsInvestigation.")

# data quality
cls("DataQualityStatus", comment="Completeness of the data behind a state.")

# indicators
cls("FinancialIndicator", comment="An amount (Rupiah) for one month, kept for evidence and display.")
cls("Revenue", "FinancialIndicator")
cls("COGS", "FinancialIndicator", "Cost of goods sold (raw materials, or goods bought for resale). Product groups/segments are a future extension.")
cls("OPEX", "FinancialIndicator", "Operating expenses.")
for c in ["FixedOPEX", "VariableOPEX", "MarketingOPEX"]:
    cls(c, "OPEX")
for c in ["GrossProfit", "GrossMargin", "OperatingProfit", "NetProfit", "DepreciationExpense"]:
    cls(c, "FinancialIndicator")
cls("CashFlow", "FinancialIndicator")
for c in ["OperatingCashFlow", "InvestingCashFlow", "FinancingCashFlow"]:
    cls(c, "CashFlow")
cls("InvestmentMetric", "FinancialIndicator")
for c in ["CapexAmount", "PaybackAmount", "ROIPercentage"]:
    cls(c, "InvestmentMetric")

# simple financial position (kas + aset tetap); rest = future extension
cls("BalanceSheetAccount", comment="Simple financial position (cash + fixed assets) is the MVP scope. Inventory, receivables and payables are future extensions.")
cls("Asset", "BalanceSheetAccount")
cls("CurrentAsset", "Asset")
cls("CashAndBank", "CurrentAsset")
cls("Inventory", "CurrentAsset", "Future extension (not in MVP).")
cls("Receivable", "CurrentAsset", "Future extension (not in MVP).")
cls("FixedAsset", "Asset", "Facility/equipment purchased; depreciated monthly instead of expensed at once.")
cls("AccumulatedDepreciation", "Asset", "Contra-asset.")
cls("Liability", "BalanceSheetAccount")
cls("CurrentLiability", "Liability")
cls("AccountsPayable", "CurrentLiability", "Future extension (not in MVP).")
cls("Loan", "Liability")
cls("Equity", "BalanceSheetAccount")
for c in ["OwnerCapital", "InvestorCapital", "RetainedEarnings"]:
    cls(c, "Equity")
cls("OwnerDraw", "Equity", "Prive. Not an expense; reduces equity and cash.")
dj = BNode()
g.add((dj, RDF.type, OWL.AllDisjointClasses))
lst = BNode()
from rdflib.collection import Collection
Collection(g, lst, [NS["Asset"], NS["Liability"], NS["Equity"]])
g.add((dj, OWL.members, lst))

# explanation layer (composed by the backend from inferred classes)
cls("FinancialDiagnosis", comment="Diagnosis record composed by the backend from the classes the reasoner inferred.")
cls("ReasoningEvidence")
cls("Explanation", "ReasoningEvidence")
cls("ReasoningPath", "ReasoningEvidence")
cls("ReasoningStep", "ReasoningEvidence")
cls("Advisory")

# ------------------------------------------------------------------ object properties
oprop("hasState", "Business", "MonthlyFinancialState", "Business has a monthly state.", inverse="stateOf")
oprop("stateOf", "MonthlyFinancialState", "Business", functional=True)
oprop("forPeriod", "MonthlyFinancialState", "Period", "Month that the state describes.", functional=True)
oprop("previousPeriod", "Period", "Period", "The month before this one.", functional=True)
oprop("comparedWith", "MonthlyFinancialState", "MonthlyFinancialState", "The previous month's state used as comparison.", functional=True)
oprop("hasIndicator", "MonthlyFinancialState", "FinancialIndicator", "Amounts kept as evidence.")
oprop("hasAccount", "Business", "BalanceSheetAccount")
oprop("hasDataQuality", "MonthlyFinancialState", "DataQualityStatus", functional=True)
oprop("hasCategoryMovement", "MonthlyFinancialState", "CategoryMovement")
oprop("hasCostDriver", "MonthlyFinancialState", "CostDriverMovement", "Inferred: categories that drive the profit decrease.")
oprop("recommendsInvestigation", "MonthlyFinancialState", "InvestigationArea",
      "Inferred from class-level knowledge: each finding class carries a hasValue restriction to the areas worth checking.")
oprop("hasDiagnosis", "MonthlyFinancialState", "FinancialDiagnosis")
oprop("derivedFrom", "FinancialDiagnosis", "FinancialIndicator")
oprop("hasEvidence", "FinancialDiagnosis", "ReasoningEvidence")
oprop("hasExplanation", "FinancialDiagnosis", "Explanation")
oprop("hasReasoningStep", "ReasoningPath", "ReasoningStep")
oprop("hasAdvisory", "FinancialDiagnosis", "Advisory")

# ------------------------------------------------------------------ data properties
D = XSD.decimal
state_nums = [
    ("hasRevenueGrowth", "Total revenue growth vs previous month (0.10 = +10%)."),
    ("hasCOGSGrowth", "Total COGS growth vs previous month."),
    ("hasOPEXGrowth", "OPEX growth, excluding marketing."),
    ("hasMarketingGrowth", "Marketing growth."),
    ("hasGrossMargin", "Gross margin this month (fraction)."),
    ("hasGrossMarginLowerBound", "Backend: own-history baseline minus tolerance. Omit when history is insufficient; the rule then stays silent."),
    ("hasNetProfit", "Net profit (Rupiah)."),
    ("hasNetMargin", "Net profit / revenue."),
    ("hasNetMarginLowerBound", "Backend: own-history baseline minus tolerance."),
    ("hasOperatingCashFlow", "Cash-basis operating cash flow = net profit + depreciation (Rupiah)."),
    ("hasChangeInCash", "Ending cash minus opening cash (Rupiah)."),
    ("hasEndingCash", "Ending cash balance (Rupiah)."),
    ("hasOwnerDrawAmount", "Owner draw (prive) this month (Rupiah)."),
    ("hasPreviousOwnerDrawAmount", "Owner draw previous month (Rupiah)."),
    ("hasCapexAmount", "Cash spent on facilities this month (Rupiah)."),
    ("hasLoanPrincipalPaid", "Loan principal repaid this month (Rupiah)."),
    ("hasCashRunwayMonths", "Ending cash / essential monthly outflow."),
    ("hasRunwayMinimumMonths", "Policy parameter set by the owner/accountant, not a universal constant."),
]
for n, c in state_nums:
    dprop(n, "MonthlyFinancialState", D, c)

dprop("hasCategoryName", "CategoryMovement", XSD.string, "Category label, e.g. COGS, Marketing, Listrik.")
dprop("hasCategoryAmount", "CategoryMovement", D)
dprop("hasCategoryGrowth", "CategoryMovement", D)
dprop("hasProfitContribution", "CategoryMovement", D, "Effect on profit change (negative = reduces profit).")
dprop("hasContributionRank", "CategoryMovement", XSD.integer)
dprop("isTopContributor", "CategoryMovement", XSD.boolean, "Backend flag: among the largest contributors to the profit change.")
dprop("hasPeriodStart", "Period", XSD.date)
dprop("hasAmount", "FinancialIndicator", D)
dprop("hasSource", "FinancialIndicator", XSD.string)
dprop("hasPeriodLabel", "FinancialIndicator", XSD.string)
dprop("hasDepreciationPerMonth", "CapexAmount", D)
dprop("hasUsefulLifeMonths", "CapexAmount", XSD.integer)
dprop("hasResidualValue", "CapexAmount", D)
dprop("hasPaybackMonths", "PaybackAmount", D)
dprop("hasIncrementalProfit", "InvestmentMetric", D)
dprop("hasROIPercentage", "ROIPercentage", D)
dprop("hasDiagnosisMessage", "FinancialDiagnosis", XSD.string)
dprop("hasConfidenceNote", "FinancialDiagnosis", XSD.string)
dprop("hasReasoningText", "ReasoningStep", XSD.string)
dprop("hasAdvisoryText", "Advisory", XSD.string)

# ------------------------------------------------------------------ investigation areas + class-level advice
AREAS = {
    "Area_SupplierPrice": "Harga dari supplier",
    "Area_MaterialPrice": "Harga bahan baku",
    "Area_ProductionWaste": "Bahan terbuang / waste",
    "Area_ProductMix": "Komposisi penjualan: apakah porsi produk bermargin rendah naik",
    "Area_OperatingExpenseDetail": "Rincian biaya operasional",
    "Area_MarketingEfficiency": "Hasil promosi/iklan terhadap penjualan",
    "Area_CostBreakdown": "Rincian kenaikan biaya per kategori (profit bridge)",
    "Area_OwnerDrawPolicy": "Besar dan pola pengambilan kas pribadi (prive)",
    "Area_FacilityPurchase": "Pembelian fasilitas/peralatan",
    "Area_LoanRepayment": "Cicilan pokok pinjaman",
    "Area_CashPosition": "Posisi dan arus kas",
    "Area_CashRunway": "Berapa bulan kas bisa menutup biaya wajib",
}
for k, v in AREAS.items():
    ind(k, "InvestigationArea", v)

ADVICE = {
    "CostEscalation": ["Area_SupplierPrice", "Area_MaterialPrice", "Area_ProductionWaste", "Area_ProductMix"],
    "MarginPressure": ["Area_SupplierPrice", "Area_MaterialPrice", "Area_ProductionWaste", "Area_ProductMix"],
    "OPEXPressure": ["Area_OperatingExpenseDetail"],
    "MarketingEfficiencyReview": ["Area_MarketingEfficiency"],
    "ProfitPressure": ["Area_CostBreakdown"],
    "ProfitCashGap": ["Area_OwnerDrawPolicy", "Area_FacilityPurchase", "Area_LoanRepayment", "Area_CashPosition"],
    "LiquidityPressure": ["Area_CashPosition"],
    "OwnerDrawLiquidityPressure": ["Area_OwnerDrawPolicy", "Area_CashPosition"],
    "LiquidityCritical": ["Area_CashRunway", "Area_CashPosition"],
}
for c, areas in ADVICE.items():
    for a in areas:
        r = BNode()
        g.add((r, RDF.type, OWL.Restriction))
        g.add((r, OWL.onProperty, NS["recommendsInvestigation"]))
        g.add((r, OWL.hasValue, NS[a]))
        g.add((NS[c], RDFS.subClassOf, r))

for q in ["Complete", "Partial", "Missing"]:
    ind("Data_" + q, "DataQualityStatus", q)

# ------------------------------------------------------------------ SWRL rules
BUILTINS = {"greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual", "equal"}


def var(n):
    v = NS["var_" + n]
    g.add((v, RDF.type, SWRL.Variable))
    return v


def arg(tok):
    tok = tok.strip()
    if tok.startswith("?"):
        return var(tok[1:])
    if tok in ("true", "false"):
        return Literal(tok == "true")
    return Literal(Decimal(tok), datatype=XSD.decimal)


def make_atom(text):
    m = re.match(r"\s*(\w+)\((.*)\)\s*$", text)
    name, args = m.group(1), [a.strip() for a in m.group(2).split(",")]
    a = BNode()
    if name in BUILTINS:
        g.add((a, RDF.type, SWRL.BuiltinAtom))
        g.add((a, SWRL.builtin, SWRLB[name]))
        l = BNode()
        Collection(g, l, [arg(x) for x in args])
        g.add((a, SWRL.arguments, l))
    elif name in CLASSES:
        g.add((a, RDF.type, SWRL.ClassAtom))
        g.add((a, SWRL.classPredicate, NS[name]))
        g.add((a, SWRL.argument1, arg(args[0])))
    elif name in DPROPS:
        g.add((a, RDF.type, SWRL.DatavaluedPropertyAtom))
        g.add((a, SWRL.propertyPredicate, NS[name]))
        g.add((a, SWRL.argument1, arg(args[0])))
        g.add((a, SWRL.argument2, arg(args[1])))
    elif name in OPROPS:
        g.add((a, RDF.type, SWRL.IndividualPropertyAtom))
        g.add((a, SWRL.propertyPredicate, NS[name]))
        g.add((a, SWRL.argument1, arg(args[0])))
        g.add((a, SWRL.argument2, arg(args[1])))
    else:
        raise ValueError("unknown predicate " + name)
    return a


def atom_list(texts):
    atoms = [make_atom(t) for t in re.split(r"\s*,\s*(?=\w+\()", texts.strip())]
    head = BNode()
    cur = head
    for i, a in enumerate(atoms):
        g.add((cur, RDF.type, SWRL.AtomList))
        g.add((cur, RDF.first, a))
        if i == len(atoms) - 1:
            g.add((cur, RDF.rest, RDF.nil))
        else:
            nxt = BNode()
            g.add((cur, RDF.rest, nxt))
            cur = nxt
    return head


RULES = []


def rule(rid, text, comment, note):
    body, head = text.split("->")
    imp = BNode()
    g.add((imp, RDF.type, SWRL.Imp))
    g.add((imp, SWRL.body, atom_list(body)))
    g.add((imp, SWRL.head, atom_list(head)))
    g.add((imp, RDFS.label, Literal(rid)))
    g.add((imp, RDFS.comment, Literal(comment)))
    g.add((imp, SWRLA.isRuleEnabled, Literal(True)))
    g.add((imp, NS["sourceStatus"], Literal("Draft-unvalidated")))
    g.add((imp, NS["sourceNote"], Literal(note)))
    RULES.append(rid)


S = "MonthlyFinancialState(?s)"
# --- observations
rule("O01_COGSGrowthExceedsRevenue",
     f"{S}, hasCOGSGrowth(?s,?c), hasRevenueGrowth(?s,?r), greaterThan(?c,?r) -> COGSGrowthExceedsRevenue(?s)",
     "Total COGS growth > revenue growth.", "md 20.1, 20.6")
rule("O02_OPEXGrowthExceedsRevenue",
     f"{S}, hasOPEXGrowth(?s,?o), hasRevenueGrowth(?s,?r), greaterThan(?o,?r) -> OPEXGrowthExceedsRevenue(?s)",
     "OPEX growth > revenue growth.", "md 20.3")
rule("O03_MarketingGrowthExceedsRevenue",
     f"{S}, hasMarketingGrowth(?s,?m), hasRevenueGrowth(?s,?r), greaterThan(?m,?r) -> MarketingGrowthExceedsRevenue(?s)",
     "Marketing growth > revenue growth.", "md 20.4")
rule("O04_GrossMarginDecline",
     f"{S}, hasGrossMargin(?s,?g), hasGrossMarginLowerBound(?s,?lb), lessThan(?g,?lb) -> GrossMarginDecline(?s)",
     "Gross margin below own-history lower bound (baseline of the last ~3 months, computed by backend).", "md 14, 20.1")
rule("O05_NetMarginDecline",
     f"{S}, hasNetMargin(?s,?n), hasNetMarginLowerBound(?s,?lb), lessThan(?n,?lb) -> NetMarginDecline(?s)",
     "Net margin below own-history lower bound (covers 'same revenue, lower profit').", "User example: revenue flat, profit 30jt -> 15jt")
rule("O06_PositiveProfit",
     f"{S}, hasNetProfit(?s,?p), greaterThan(?p,0) -> PositiveProfit(?s)",
     "Net profit > 0.", "Accounting identity")
rule("O07_CashDecline",
     f"{S}, hasChangeInCash(?s,?c), lessThan(?c,0) -> CashDecline(?s)",
     "Change in cash < 0.", "md 27 (cash outflow > inflow)")
# --- findings
rule("F01_CostEscalation",
     f"{S}, COGSGrowthExceedsRevenue(?s) -> CostEscalation(?s)",
     "COGS growing faster than revenue indicates cost escalation (early signal).", "md 20.6; needs accountant validation")
rule("F02_MarginPressure",
     f"{S}, GrossMarginDecline(?s), COGSGrowthExceedsRevenue(?s) -> MarginPressure(?s)",
     "Margin below baseline while COGS outgrows revenue.", "md 20.1; needs accountant validation")
rule("F03_OPEXPressure",
     f"{S}, OPEXGrowthExceedsRevenue(?s) -> OPEXPressure(?s)",
     "OPEX outgrows revenue.", "md 20.3")
rule("F04_MarketingEfficiencyReview",
     f"{S}, MarketingGrowthExceedsRevenue(?s) -> MarketingEfficiencyReview(?s)",
     "Marketing outgrows revenue; review efficiency.", "md 20.4")
rule("F05_ProfitPressure",
     f"{S}, NetMarginDecline(?s) -> ProfitPressure(?s)",
     "Net margin below baseline.", "User example; needs accountant validation")
rule("F06_ProfitCashGap",
     f"{S}, PositiveProfit(?s), CashDecline(?s) -> ProfitCashGap(?s)",
     "Profit positive but cash fell (replaces v1 CashFlowDivergence, which cannot fire under cash-basis recording).",
     "Cash-basis identity: OCF = net profit + depreciation")
rule("F07_LiquidityPressure",
     f"{S}, CashDecline(?s) -> LiquidityPressure(?s)",
     "Cash fell during the month.", "md 27")
rule("F08_OwnerDrawLiquidityPressure",
     f"{S}, hasOwnerDrawAmount(?s,?d), hasPreviousOwnerDrawAmount(?s,?pd), greaterThan(?d,?pd), CashDecline(?s), "
     f"hasOperatingCashFlow(?s,?ocf), lessThan(?ocf,?d) -> OwnerDrawLiquidityPressure(?s)",
     "Owner draw rose, cash fell, and operating cash flow was smaller than the draw.",
     "md 20.7; 'OCF not strong enough' interpreted as OCF < owner draw; needs accountant validation")
rule("F09_LiquidityCritical",
     f"{S}, LiquidityPressure(?s), hasCashRunwayMonths(?s,?r), hasRunwayMinimumMonths(?s,?m), lessThan(?r,?m) -> LiquidityCritical(?s)",
     "Cash falling and runway below configured minimum.", "Draft; minimum is a policy parameter")
rule("F10_CostDriver",
     f"{S}, hasCategoryMovement(?s,?m), hasCategoryGrowth(?m,?g), hasRevenueGrowth(?s,?r), greaterThan(?g,?r), "
     f"isTopContributor(?m,true) -> CostDriverMovement(?m), hasCostDriver(?s,?m)",
     "A top-contributing cost category that outgrows revenue is a cost driver (profit bridge).", "Draft; ranking computed by backend")

# ------------------------------------------------------------------ demo data (F&B, [DEMO])
b = ind("Demo_WarkopKusuma", "Business", "[DEMO] Warkop Kusuma")
p_aug = ind("Demo_Period_2026_08", "Period", "[DEMO] Agustus 2026")
p_sep = ind("Demo_Period_2026_09", "Period", "[DEMO] September 2026")
g.add((p_sep, NS["previousPeriod"], p_aug))
g.add((p_aug, NS["hasPeriodStart"], Literal("2026-08-01", datatype=XSD.date)))
g.add((p_sep, NS["hasPeriodStart"], Literal("2026-09-01", datatype=XSD.date)))

# Aug (Rp juta -> rupiah penuh): rev 90, COGS 38, OPEX 30, Mkt 4, Dep 1 => NP 17
# Sep: rev 100, COGS 46.5, OPEX 32, Mkt 6.5, Dep 1 => NP 14
M = 1_000_000
aug = {"rev": 90, "cogs": 38, "opex": 30, "mkt": 4, "dep": 1}
sep = {"rev": 100, "cogs": 46.5, "opex": 32, "mkt": 6.5, "dep": 1}
np_aug = aug["rev"] - aug["cogs"] - aug["opex"] - aug["mkt"] - aug["dep"]
np_sep = sep["rev"] - sep["cogs"] - sep["opex"] - sep["mkt"] - sep["dep"]
assert (np_aug, np_sep) == (17, 14), (np_aug, np_sep)

s_aug = ind("Demo_State_2026_08", "MonthlyFinancialState", "[DEMO] Kondisi Agustus 2026")
s_sep = ind("Demo_State_2026_09", "MonthlyFinancialState", "[DEMO] Kondisi September 2026")
for s_, per, a_ in [(s_aug, p_aug, "Demo_State_2026_08"), (s_sep, p_sep, "")]:
    g.add((b, NS["hasState"], s_))
    g.add((s_, NS["forPeriod"], per))
g.add((s_sep, NS["comparedWith"], s_aug))
g.add((s_aug, NS["hasDataQuality"], NS["Data_Complete"]))
g.add((s_sep, NS["hasDataQuality"], NS["Data_Complete"]))


def setn(s_, name, val):
    g.add((s_, NS[name], dec(val)))


# August: a "normal" month; none of the rules should fire
for k, v in [("hasRevenueGrowth", 0.05), ("hasCOGSGrowth", 0.04), ("hasOPEXGrowth", 0.02), ("hasMarketingGrowth", 0.0),
             ("hasGrossMargin", 52 / 90), ("hasGrossMarginLowerBound", 0.56),
             ("hasNetProfit", np_aug * M), ("hasNetMargin", np_aug / 90), ("hasNetMarginLowerBound", 0.17),
             ("hasOperatingCashFlow", 18 * M), ("hasChangeInCash", 13 * M), ("hasEndingCash", 30 * M),
             ("hasOwnerDrawAmount", 3 * M), ("hasPreviousOwnerDrawAmount", 3 * M),
             ("hasCapexAmount", 0), ("hasLoanPrincipalPaid", 2 * M),
             ("hasCashRunwayMonths", 30 / 8), ("hasRunwayMinimumMonths", 2.0)]:
    setn(s_aug, k, v)

# September: cost escalation + margin pressure + profit pressure + marketing + profit-cash gap
for k, v in [("hasRevenueGrowth", 100 / 90 - 1), ("hasCOGSGrowth", 46.5 / 38 - 1),
             ("hasOPEXGrowth", 32 / 30 - 1), ("hasMarketingGrowth", 6.5 / 4 - 1),
             ("hasGrossMargin", 53.5 / 100), ("hasGrossMarginLowerBound", 0.56),
             ("hasNetProfit", np_sep * M), ("hasNetMargin", np_sep / 100), ("hasNetMarginLowerBound", 0.17),
             ("hasOperatingCashFlow", (np_sep + 1) * M),
             ("hasChangeInCash", ((np_sep + 1) - 12 - 8 - 2) * M), ("hasEndingCash", 23 * M),
             ("hasOwnerDrawAmount", 8 * M), ("hasPreviousOwnerDrawAmount", 3 * M),
             ("hasCapexAmount", 12 * M), ("hasLoanPrincipalPaid", 2 * M),
             ("hasCashRunwayMonths", 23 / 8), ("hasRunwayMinimumMonths", 2.0)]:
    setn(s_sep, k, v)

# evidence amounts (September)
for nm, typ, val in [("Demo_Sep_Revenue", "Revenue", sep["rev"]), ("Demo_Sep_COGS", "COGS", sep["cogs"]),
                     ("Demo_Sep_OPEX", "FixedOPEX", sep["opex"]), ("Demo_Sep_Marketing", "MarketingOPEX", sep["mkt"]),
                     ("Demo_Sep_Depreciation", "DepreciationExpense", sep["dep"]), ("Demo_Sep_NetProfit", "NetProfit", np_sep)]:
    i = ind(nm, typ, "[DEMO] " + nm.replace("Demo_Sep_", "") + " Sep 2026")
    g.add((i, NS["hasAmount"], dec(val * M)))
    g.add((i, NS["hasPeriodLabel"], Literal("2026-09")))
    g.add((i, NS["hasSource"], Literal("demo data")))
    g.add((s_sep, NS["hasIndicator"], i))

# profit bridge categories (September): cost increases vs August
for nm, name, cur, prev, rank, top in [("Demo_Sep_Move_COGS", "COGS", 46.5, 38, 1, True),
                                       ("Demo_Sep_Move_Marketing", "Marketing", 6.5, 4, 2, True),
                                       ("Demo_Sep_Move_OPEX", "OPEX (non-marketing)", 32, 30, 3, False)]:
    i = ind(nm, "CategoryMovement", "[DEMO] " + name + " Sep 2026")
    g.add((i, NS["hasCategoryName"], Literal(name)))
    g.add((i, NS["hasCategoryAmount"], dec(cur * M)))
    g.add((i, NS["hasCategoryGrowth"], dec(cur / prev - 1)))
    g.add((i, NS["hasProfitContribution"], dec(-(cur - prev) * M)))
    g.add((i, NS["hasContributionRank"], Literal(rank, datatype=XSD.integer)))
    g.add((i, NS["isTopContributor"], Literal(top)))
    g.add((s_sep, NS["hasCategoryMovement"], i))

# diagnosis record composed by the backend (not by rules)
dg = ind("Demo_Sep_Diagnosis", "FinancialDiagnosis", "[DEMO] Diagnosis September 2026")
g.add((s_sep, NS["hasDiagnosis"], dg))
g.add((dg, NS["hasDiagnosisMessage"], Literal(
    "Omzet naik 11,1% tetapi untung bersih turun dari Rp17 juta ke Rp14 juta. Biaya bahan (COGS) naik 22,4%, lebih cepat dari omzet, "
    "sehingga margin kotor turun di bawah kebiasaan usaha ini; promosi juga naik 62,5%. Kenaikan harga bahan atau pergeseran produk yang "
    "terjual perlu dicek karena sistem belum membedakan keduanya. "
    "Kas turun Rp7 juta walau untung positif karena pembelian fasilitas Rp12 juta, prive Rp8 juta, dan cicilan pokok Rp2 juta.")))
g.add((dg, NS["hasConfidenceNote"], Literal("Indikasi dari data yang dicatat; bukan nasihat keuangan resmi.")))
g.add((dg, NS["derivedFrom"], NS["Demo_Sep_NetProfit"]))
ex = ind("Demo_Sep_Explanation", "Explanation")
g.add((ex, RDFS.comment, Literal("Reasoning path: GrossMarginDecline + COGSGrowthExceedsRevenue -> MarginPressure")))
g.add((dg, NS["hasExplanation"], ex))
ad = ind("Demo_Sep_Advisory", "Advisory")
g.add((ad, NS["hasAdvisoryText"], Literal("Periksa harga bahan dari supplier, bahan terbuang, dan komposisi penjualan; tinjau hasil promosi; periksa pengambilan prive, pembelian fasilitas, dan cicilan.")))
g.add((dg, NS["hasAdvisory"], ad))

from pathlib import Path

out_path = Path(__file__).resolve().with_name("Finance_Health_Expert_System_v2.owl")
g.serialize(str(out_path), format="xml")
print("OK classes", len(CLASSES), "oprops", len(OPROPS), "dprops", len(DPROPS), "rules", len(RULES), "wrote", out_path)
