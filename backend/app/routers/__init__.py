from __future__ import annotations

from .dashboard import router as dashboard_router
from .reports import router as reports_router
from .closing import router as closing_router
from .kbr import router as kbr_router

__all__ = [
    "dashboard_router",
    "reports_router",
    "closing_router",
    "kbr_router",
]

