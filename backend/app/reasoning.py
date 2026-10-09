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
