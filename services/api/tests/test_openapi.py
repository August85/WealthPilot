from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_openapi.py"


def _module():  # type: ignore[no-untyped-def]
    spec = importlib.util.spec_from_file_location("export_openapi", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_committed_openapi_is_current() -> None:
    mod = _module()
    assert mod.OUT.read_text(encoding="utf-8") == mod.render(), "run services/api/scripts/export_openapi.py"


def test_money_fields_are_strings_in_contract() -> None:
    doc = json.loads(_module().render())
    schemas = doc["components"]["schemas"]
    nw = schemas["NetWorthOut"]["properties"]
    for field in ("gross_assets", "liabilities", "net_worth", "liquid_net_worth", "goal_eligible"):
        assert nw[field]["type"] == "string", field
    assert doc["openapi"].startswith("3.")
    assert all(p.startswith("/v1/") for p in doc["paths"])
