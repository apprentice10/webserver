"""
Sheet V1 combined router — aggregates all Sheet sub-routers.
The dynamic loader in main.py picks up this module's `router` attribute.
"""

from fastapi import APIRouter
from . import routes_main, routes_flags, routes_export, routes_revisions

router = APIRouter()
router.include_router(routes_flags.router)
router.include_router(routes_main.router)
router.include_router(routes_export.router)
router.include_router(routes_revisions.router)
