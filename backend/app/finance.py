from __future__ import annotations

import calendar
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


class FinanceOpening(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    date: date
    cash: StrictInt = Field(ge=0)
    bank: StrictInt = Field(ge=0)
    inventory: StrictInt = Field(default=0, ge=0)
    fixed_assets: StrictInt = Field(default=0, ge=0, alias="fixedAssets")
    liabilities: StrictInt = Field(default=0, ge=0)
    equity: StrictInt = Field(ge=0)
    confirmed: bool = False

    @model_validator(mode="after")
    def validate_balance_equation(self) -> FinanceOpening:
        if self.confirmed:
            total_assets = self.cash + self.bank + self.inventory + self.fixed_assets
            liab_eq = self.liabilities + self.equity
            if total_assets != liab_eq:
                raise ValueError(
                    f"Saldo awal tidak seimbang: Total Aset ({total_assets:,}) harus sama dengan "
                    f"Liabilitas + Ekuitas ({liab_eq:,}). Selisih: {total_assets - liab_eq:,}."
                )
        return self


class FinanceTransaction(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=100)
    date: date
    description: str = Field(min_length=1, max_length=90)
    kind: Literal["revenue", "expense", "capital", "loan", "draw", "principal", "asset", "transfer"]
    category: str = Field(min_length=1, max_length=80)
    amount: StrictInt = Field(gt=0, le=9_000_000_000_000_000)
    account: Literal["cash", "bank"]
    note: str = Field(default="", max_length=500)
    asset_id: str | None = Field(default=None, alias="assetId")
    transfer_to: Literal["cash", "bank"] | None = Field(default=None, alias="transferTo")

    @model_validator(mode="after")
    def validate_transfer_accounts(self) -> FinanceTransaction:
        if self.kind == "transfer" and self.transfer_to is None:
            raise ValueError("Akun tujuan wajib diisi untuk perpindahan saldo.")
        if self.kind == "transfer" and self.account == self.transfer_to:
            raise ValueError("Akun asal dan tujuan perpindahan saldo harus berbeda.")
        if self.kind != "transfer" and self.transfer_to is not None:
            raise ValueError("Akun tujuan hanya dapat diisi untuk perpindahan saldo.")
        return self


class FinanceAsset(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    cost: StrictInt = Field(gt=0)
    residual: StrictInt = Field(ge=0)
    life_months: StrictInt = Field(gt=0, alias="lifeMonths")
    start_date: date = Field(alias="startDate")
    account: Literal["cash", "bank"]
    opening: bool = False


class CustomCategory(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    parent: str
    kind: str = "expense"


class MonthlyClosing(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    status: Literal["draft", "review", "closed"] = "draft"
    stock_opname_date: date = Field(alias="stockOpnameDate")
    opening_inventory: StrictInt = Field(default=0, ge=0, alias="openingInventory")
    purchases: StrictInt = Field(default=0, ge=0)
    ending_inventory: StrictInt = Field(default=0, ge=0, alias="endingInventory")
    raw_material_consumption: StrictInt = Field(default=0, ge=0, alias="rawMaterialConsumption")
    notes: str = Field(default="", max_length=500)
    closed_at: str | None = Field(default=None, alias="closedAt")
    closed_by: str | None = Field(default=None, alias="closedBy")

    @model_validator(mode="after")
    def validate_stock_opname(self) -> MonthlyClosing:
        available = self.opening_inventory + self.purchases
        if self.ending_inventory > available:
            raise ValueError(
                f"Persediaan akhir (Rp{self.ending_inventory:,}) tidak boleh melebihi persediaan yang tersedia "
                f"(Persediaan Awal Rp{self.opening_inventory:,} + Pembelian Rp{self.purchases:,} = Rp{available:,})."
            )
        expected = available - self.ending_inventory
        if self.raw_material_consumption != expected:
            self.raw_material_consumption = expected
        return self


class FinanceWorkspace(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    opening: FinanceOpening
    transactions: list[FinanceTransaction] = Field(max_length=100_000)
    assets: list[FinanceAsset] = Field(default_factory=list, max_length=10_000)
    custom_categories: list[CustomCategory] = Field(default_factory=list, alias="customCategories")
    closings: list[MonthlyClosing] = Field(default_factory=list)


def _month_number(month: str) -> int:
    year, number = (int(part) for part in month.split("-"))
    return year * 12 + number - 1


def _month_string(month_number: int) -> str:
    year, zero_based_month = divmod(month_number, 12)
    return f"{year:04d}-{zero_based_month + 1:02d}"


def _month_end(month: str) -> date:
    year, number = (int(part) for part in month.split("-"))
    return date(year, number, calendar.monthrange(year, number)[1])


def _amount(transactions: list[FinanceTransaction], predicate: Any) -> int:
    return sum(transaction.amount for transaction in transactions if predicate(transaction))


def _cash_delta(transaction: FinanceTransaction) -> int:
    return transaction.amount if transaction.kind in {"revenue", "capital", "loan"} else -transaction.amount


def _account_delta(transaction: FinanceTransaction, account: str) -> int:
    if transaction.kind == "transfer":
        if transaction.account == account:
            return -transaction.amount
        if transaction.transfer_to == account:
            return transaction.amount
        return 0
    return _cash_delta(transaction) if transaction.account == account else 0


def _monthly_depreciation(assets: list[FinanceAsset], month: str) -> int:
    end_date = _month_end(month)
    month_number = _month_number(month)
    total = 0
    for asset in assets:
        if asset.residual > asset.cost:
            raise ValueError(f"Nilai residu aset {asset.name} tidak boleh melebihi biaya perolehan.")
        if asset.start_date > end_date:
            continue
        started_month = _month_number(asset.start_date.strftime("%Y-%m"))
        elapsed = month_number - started_month
        if 0 <= elapsed < asset.life_months:
            monthly_rate = round((asset.cost - asset.residual) / asset.life_months)
            total += monthly_rate
    return total


OPEX_SUBCATEGORIES = {
    "payroll": "Beban Pegawai (HR/Payroll)",
    "utilities": "Beban Utilitas & Tempat",
    "operational": "Beban Operasional & Umum",
    "marketing": "Beban Pemasaran (Marketing/Selling)",
    "maintenance": "Beban Pemeliharaan",
}

MARKETING_CATEGORIES = {
    "Marketing",
    "Beban Pemasaran (Marketing/Selling)",
    "Beban Pemasaran (Iklan, Promo, MDR)",
}

INGREDIENT_PURCHASE_CATEGORIES = {
    "COGS / HPP",
    "Pembelian Bahan Baku",
    "Bahan Baku",
    "Bahan Baku & Bahan Pembantu",
    "Bahan Makanan & Minuman",
}


def _is_cogs_purchase(tx: FinanceTransaction, custom_map: dict[str, str]) -> bool:
    if tx.kind != "expense":
        return False
    if tx.category in INGREDIENT_PURCHASE_CATEGORIES:
        return True
    if tx.category.startswith("COGS") or tx.category.startswith("Pembelian Bahan"):
        return True
    return custom_map.get(tx.category) == "cogs"


def _classify_expense(tx: FinanceTransaction, custom_map: dict[str, str]) -> str:
    """
    Classifies an expense into:
    'cogs', 'payroll', 'utilities', 'operational', 'marketing', 'maintenance',
    'general_opex', or 'non_operating_expense'.
    Guarantees no expense is ever silently omitted!
    """
    if tx.kind != "expense":
        return "not_expense"

    if _is_cogs_purchase(tx, custom_map):
        return "cogs"

    parent = custom_map.get(tx.category)
    if parent:
        if parent in ("cogs", "payroll", "utilities", "operational", "marketing", "maintenance", "non_operating_expense"):
            return parent
        if parent in ("opex", "general_opex", "ops"):
            return "general_opex"
        if parent in ("non_ops", "non_operating"):
            return "non_operating_expense"

    cat = tx.category
    if cat == "Beban non-operasional" or cat.startswith("Beban non-operasional"):
        return "non_operating_expense"
    if cat in MARKETING_CATEGORIES or cat.startswith("Beban Pemasaran") or cat.startswith("Marketing"):
        return "marketing"
    if cat == OPEX_SUBCATEGORIES["payroll"] or cat.startswith("Beban Pegawai") or cat.startswith("Gaji"):
        return "payroll"
    if cat == OPEX_SUBCATEGORIES["utilities"] or cat.startswith("Beban Utilitas") or cat.startswith("Listrik"):
        return "utilities"
    if cat == OPEX_SUBCATEGORIES["operational"] or cat.startswith("Beban Operasional") or cat.startswith("Supplies"):
        return "operational"
    if cat == OPEX_SUBCATEGORIES["maintenance"] or cat.startswith("Beban Pemeliharaan") or cat.startswith("Servis"):
        return "maintenance"
    if cat == "OPEX":
        return "general_opex"

    # Fallback to general_opex so NO expense is silently dropped
    return "general_opex"


def _report_base(workspace: FinanceWorkspace, month: str) -> dict[str, Any]:
    rows = [transaction for transaction in workspace.transactions if transaction.date.strftime("%Y-%m") == month]

    custom_map: dict[str, str] = {}
    if hasattr(workspace, "custom_categories") and workspace.custom_categories:
        for cat in workspace.custom_categories:
            if isinstance(cat, dict):
                custom_map[cat.get("name", "")] = cat.get("parent", "")
            elif hasattr(cat, "name") and hasattr(cat, "parent"):
                custom_map[cat.name] = cat.parent

    # Revenue
    revenue = _amount(
        rows,
        lambda tx: tx.kind == "revenue" and tx.category != "Pendapatan non-operasional" and custom_map.get(tx.category) not in ("non_operating_income", "non_ops")
    )

    # Net ingredient purchases during this month
    ingredient_purchases = _amount(rows, lambda tx: _is_cogs_purchase(tx, custom_map))

    # Periodic inventory handling
    closing_map = {c.period: c for c in workspace.closings}
    current_closing = closing_map.get(month)

    # Determine opening inventory for this month
    report_month_num = _month_number(month)
    prev_month_str = _month_string(report_month_num - 1)
    prev_closing = closing_map.get(prev_month_str)

    opening_date_month = workspace.opening.date.strftime("%Y-%m")
    if prev_closing is not None:
        opening_inventory = prev_closing.ending_inventory
    elif month == opening_date_month:
        opening_inventory = workspace.opening.inventory
    else:
        # If no prior closing recorded, find closest earlier closing or opening
        earlier_closings = sorted(
            [c for c in workspace.closings if _month_number(c.period) < report_month_num],
            key=lambda c: _month_number(c.period)
        )
        if earlier_closings:
            opening_inventory = earlier_closings[-1].ending_inventory
        elif report_month_num >= _month_number(opening_date_month):
            opening_inventory = workspace.opening.inventory
        else:
            opening_inventory = 0

    if current_closing is not None:
        opening_inventory = current_closing.opening_inventory
        ending_inventory = current_closing.ending_inventory
        # Periodic inventory formula: Beginning Inventory + Net Purchases - Ending Inventory = Raw Material Consumption (COGS)
        cogs = max(0, opening_inventory + ingredient_purchases - ending_inventory)
        is_closed = current_closing.status == "closed"
        is_provisional = current_closing.status != "closed"
        closing_status = current_closing.status
    else:
        # Provisional mode: physical stock opname has not been performed
        ending_inventory = opening_inventory
        cogs = ingredient_purchases
        is_closed = False
        is_provisional = True
        closing_status = "draft"

    # OPEX Breakdown - guaranteed all non-cogs expenses are accounted for
    payroll = _amount(rows, lambda tx: _classify_expense(tx, custom_map) == "payroll")
    utilities = _amount(rows, lambda tx: _classify_expense(tx, custom_map) == "utilities")
    operational = _amount(rows, lambda tx: _classify_expense(tx, custom_map) == "operational")
    marketing = _amount(rows, lambda tx: _classify_expense(tx, custom_map) == "marketing")
    maintenance = _amount(rows, lambda tx: _classify_expense(tx, custom_map) == "maintenance")
    general_opex = _amount(rows, lambda tx: _classify_expense(tx, custom_map) == "general_opex")

    opex = payroll + utilities + operational + marketing + maintenance + general_opex

    non_operating_income = _amount(
        rows,
        lambda tx: tx.kind == "revenue" and (tx.category == "Pendapatan non-operasional" or custom_map.get(tx.category) in ("non_operating_income", "non_ops"))
    )
    non_operating_expense = _amount(
        rows,
        lambda tx: _classify_expense(tx, custom_map) == "non_operating_expense"
    )

    depreciation = _monthly_depreciation(workspace.assets, month)
    gross_profit = revenue - cogs
    operating_profit = gross_profit - opex - depreciation
    net_profit = operating_profit + non_operating_income - non_operating_expense

    return {
        "rows": [transaction.model_dump(by_alias=True, mode="json") for transaction in rows],
        "revenue": revenue,
        "ingredientPurchases": ingredient_purchases,
        "openingInventory": opening_inventory,
        "endingInventory": ending_inventory,
        "cogs": cogs,
        "opex": opex,
        "opexBreakdown": {
            "payroll": payroll,
            "utilities": utilities,
            "operational": operational,
            "marketing": marketing,
            "maintenance": maintenance,
            "general": general_opex,
        },
        "marketing": marketing,
        "nonOperatingIncome": non_operating_income,
        "nonOperatingExpense": non_operating_expense,
        "depreciation": depreciation,
        "grossProfit": gross_profit,
        "operatingProfit": operating_profit,
        "netProfit": net_profit,
        "grossMargin": gross_profit / revenue if revenue else None,
        "netMargin": net_profit / revenue if revenue else None,
        "isProvisional": is_provisional,
        "isClosed": is_closed,
        "closingStatus": closing_status,
    }


def build_financial_report(workspace: FinanceWorkspace, month: str) -> dict[str, Any]:
    current = _report_base(workspace, month)
    rows = [transaction for transaction in workspace.transactions if transaction.date.strftime("%Y-%m") == month]
    sum_rows = lambda predicate: _amount(rows, predicate)

    revenue = current["revenue"]
    ingredient_purchases = current["ingredientPurchases"]
    opening_inventory = current["openingInventory"]
    ending_inventory = current["endingInventory"]
    cogs = current["cogs"]
    opex = current["opex"]
    marketing = current["marketing"]
    non_operating_income = current["nonOperatingIncome"]
    non_operating_expense = current["nonOperatingExpense"]
    depreciation = current["depreciation"]
    gross_profit = current["grossProfit"]
    operating_profit = current["operatingProfit"]
    net_profit = current["netProfit"]

    # Cash flows: Direct Method
    # Operating cash flow: cash received from revenue + non-operating revenue - cash paid for all expenses (purchases + opex + non-operating expense)
    operating_cash_flow = sum(
        transaction.amount if transaction.kind == "revenue" else
        -transaction.amount if transaction.kind == "expense" else 0
        for transaction in rows
    )
    investing_cash_flow = -sum_rows(lambda tx: tx.kind == "asset")
    financing_cash_flow = (
        sum_rows(lambda tx: tx.kind in {"capital", "loan"})
        - sum_rows(lambda tx: tx.kind in {"draw", "principal"})
    )
    change_cash = operating_cash_flow + investing_cash_flow + financing_cash_flow

    end_date = _month_end(month)
    all_through = [
        transaction
        for transaction in workspace.transactions
        if workspace.opening.date <= transaction.date <= end_date
    ]

    cash = workspace.opening.cash + sum(_account_delta(transaction, "cash") for transaction in all_through)
    bank = workspace.opening.bank + sum(_account_delta(transaction, "bank") for transaction in all_through)
    bought_assets = _amount(all_through, lambda tx: tx.kind == "asset")

    opening_month_num = _month_number(workspace.opening.date.strftime("%Y-%m"))
    report_month_num = _month_number(month)

    # Accumulated depreciation from opening date through current month
    accumulated_depreciation = 0
    for asset in workspace.assets:
        if asset.residual > asset.cost:
            raise ValueError(f"Nilai residu aset {asset.name} tidak boleh melebihi biaya perolehan.")
        started_month = _month_number(asset.start_date.strftime("%Y-%m"))
        # Assets acquired after opening date start depreciating in their purchase month
        # Opening assets start depreciating from opening month if acquired then, or opening_month_num
        first_deprec_month = max(opening_month_num, started_month)
        last_deprec_month = min(report_month_num, started_month + asset.life_months - 1)
        deprec_months = max(0, last_deprec_month - first_deprec_month + 1)
        monthly_rate = round((asset.cost - asset.residual) / asset.life_months)
        accumulated_depreciation += deprec_months * monthly_rate

    fixed_assets = workspace.opening.fixed_assets + bought_assets - accumulated_depreciation

    liabilities = (
        workspace.opening.liabilities
        + _amount(all_through, lambda tx: tx.kind == "loan")
        - _amount(all_through, lambda tx: tx.kind == "principal")
    )

    # Balance Sheet Inventory: ending inventory at the end of the report month
    inventory_asset = ending_inventory

    # Cumulative net profit across all months from opening date through report month
    # This guarantees SAK EMKM balance sheet equation: Assets = Liabilities + Equity
    cumulative_net_profit = 0
    for m_num in range(opening_month_num, report_month_num + 1):
        m_str = _month_string(m_num)
        m_rep = _report_base(workspace, m_str)
        cumulative_net_profit += m_rep["netProfit"]

    owner_draw = _amount(all_through, lambda tx: tx.kind == "draw")
    capital_injections = _amount(all_through, lambda tx: tx.kind == "capital")

    equity = (
        workspace.opening.equity
        + capital_injections
        + cumulative_net_profit
        - owner_draw
    )

    total_assets = cash + bank + inventory_asset + fixed_assets
    balance_difference = total_assets - liabilities - equity

    previous_month = _month_string(report_month_num - 1)
    previous_rows = [
        transaction
        for transaction in workspace.transactions
        if transaction.date.strftime("%Y-%m") == previous_month
    ]
    previous = _report_base(workspace, previous_month) if previous_rows else None

    # Cash runway calculation
    monthly_outflow = ingredient_purchases + opex + non_operating_expense + _amount(rows, lambda tx: tx.kind == "principal")
    cash_runway_months = round((cash + bank) / max(1, monthly_outflow), 2) if monthly_outflow > 0 else 99.0
    runway_minimum_months = 2.0

    report = {
        "month": month,
        "rows": current["rows"],
        "revenue": revenue,
        "ingredientPurchases": ingredient_purchases,
        "openingInventory": opening_inventory,
        "endingInventory": ending_inventory,
        "cogs": cogs,
        "opex": opex,
        "opexBreakdown": current.get("opexBreakdown", {}),
        "marketing": marketing,
        "nonOperatingIncome": non_operating_income,
        "nonOperatingExpense": non_operating_expense,
        "depreciation": depreciation,
        "grossProfit": gross_profit,
        "operatingProfit": operating_profit,
        "netProfit": net_profit,
        "operatingCashFlow": operating_cash_flow,
        "investingCashFlow": investing_cash_flow,
        "financingCashFlow": financing_cash_flow,
        "changeCash": change_cash,
        "cash": cash,
        "bank": bank,
        "inventory": inventory_asset,
        "fixedAssets": fixed_assets,
        "accumulatedDepreciation": accumulated_depreciation,
        "liabilities": liabilities,
        "capitalInjections": capital_injections,
        "ownerDraw": owner_draw,
        "cumulativeNetProfit": cumulative_net_profit,
        "equity": equity,
        "assetsTotal": total_assets,
        "balanceDifference": balance_difference,
        "grossMargin": current["grossMargin"],
        "cogsRatio": cogs / revenue if revenue else None,
        "netMargin": current["netMargin"],
        "previous": previous,
        "cashOpening": cash + bank - change_cash,
        "cashClosing": cash + bank,
        "isProvisional": current["isProvisional"],
        "isClosed": current["isClosed"],
        "closingStatus": current["closingStatus"],
        "cashRunwayMonths": cash_runway_months,
        "runwayMinimumMonths": runway_minimum_months,
    }

    trend = []
    for offset in range(5, -1, -1):
        trend_month = _month_string(report_month_num - offset)
        trend_report = _report_base(workspace, trend_month)
        trend.append({
            "month": trend_month,
            "revenue": trend_report["revenue"],
            "cogs": trend_report["cogs"],
            "opex": trend_report["opex"],
            "netProfit": trend_report["netProfit"],
            "isClosed": trend_report["isClosed"],
        })

    return {"report": report, "trend": trend}

