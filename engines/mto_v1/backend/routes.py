"""
MTO V1 combined router — aggregates all MTO sub-routers.
The dynamic loader in main.py picks up this module's `router` attribute.
"""

from fastapi import APIRouter
from . import (routes_tools, routes_typicals, routes_utilities,
               routes_materials, routes_materials_ext,
               routes_images, routes_placements, routes_import,
               routes_export, routes_export_excel)

router = APIRouter(prefix="/api/engines/mto", tags=["mto"])
router.include_router(routes_tools.router)
router.include_router(routes_typicals.router)
router.include_router(routes_utilities.router)
# Extended batch/insert routes before core (avoids row_id matching "batch-update" etc.)
router.include_router(routes_materials_ext.router)
router.include_router(routes_materials.router)
router.include_router(routes_images.router)
router.include_router(routes_placements.router)
router.include_router(routes_import.router)
router.include_router(routes_export.router)
router.include_router(routes_export_excel.router)
