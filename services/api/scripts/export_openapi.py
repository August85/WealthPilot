"""Write the authoritative OpenAPI document to ``packages/contracts/openapi.json``.

    uv run python scripts/export_openapi.py [--check]

``--check`` exits non-zero when the committed file is out of date (for CI). No database or network is needed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from wealthpilot_api.core.config import Settings
from wealthpilot_api.core.db import Database
from wealthpilot_api.main import create_app

OUT = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "openapi.json"


def render() -> str:
    settings = Settings(env="development", auth_mode="oidc")
    app = create_app(settings, db=Database(settings.database_url))  # engine is lazy: no connection is made
    return json.dumps(app.openapi(), indent=2, sort_keys=False, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    doc = render()
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != doc:
            print(f"{OUT} is out of date; run scripts/export_openapi.py", file=sys.stderr)
            return 1
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(doc, encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
