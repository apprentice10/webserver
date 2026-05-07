"""
engine/utils.py
---------------
Shared utility functions used across engine modules.
"""

import re
from datetime import datetime, timezone
from typing import Optional


def now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"[\s]+", "_", text)
    text = re.sub(r"_+", "_", text)
    return text.strip("_") or "tool"


def format_log_entry(rev: str, field: str, old_val, new_val) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    old = f"'{old_val}'" if old_val else "—"
    new = f"'{new_val}'" if new_val else "—"
    return f"[{ts} REV {rev}] {field.upper()}: {old} → {new}"


def append_log(existing: Optional[str], entry: str) -> str:
    return entry + "\n" + existing if existing else entry
