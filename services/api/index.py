"""Vercel entrypoint (Python runtime, FastAPI preset). Vercel loads the top-level ``app`` from this file; see
``[tool.vercel]`` in ``pyproject.toml`` and ``vercel.json``. Other hosts run ``uvicorn wealthpilot_api.main:app``.

Dependencies (this package and the ``wealthpilot-calc`` path dependency) are installed by Vercel from ``uv.lock``
with ``uv sync --no-editable``, so both are real packages in the function bundle.
"""

from wealthpilot_api.main import create_app

app = create_app()
