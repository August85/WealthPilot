"""Export artifact storage behind a small interface: local filesystem (dev/tests), S3 (container hosts) or a
Postgres table (serverless hosts without a persistent disk, the default on Vercel).

Artifacts are short-lived (``WP_EXPORT_TTL_HOURS``); access is only through the signed download endpoint, never
through a public bucket URL.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert

from ...core.config import Settings
from .models import ExportArtifact

if TYPE_CHECKING:
    from ...core.db import Database

_SAFE_KEY = re.compile(r"^[A-Za-z0-9._/-]+$")


class ArtifactStorage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> str: ...

    def get(self, ref: str) -> bytes: ...

    def delete(self, ref: str) -> None: ...


def _check_key(key: str) -> str:
    if not _SAFE_KEY.match(key) or ".." in key or key.startswith("/"):
        raise ValueError("unsafe storage key")
    return key


class LocalStorage:
    def __init__(self, base_dir: str | Path) -> None:
        self.base = Path(base_dir).resolve()

    def _path(self, ref: str) -> Path:
        p = (self.base / _check_key(ref)).resolve()
        if self.base not in p.parents:
            raise ValueError("unsafe storage key")
        return p

    def put(self, key: str, data: bytes, content_type: str) -> str:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(p)
        return key

    def get(self, ref: str) -> bytes:
        return self._path(ref).read_bytes()

    def delete(self, ref: str) -> None:
        p = self._path(ref)
        if p.exists():
            p.unlink()


class S3Storage:
    def __init__(
        self,
        bucket: str,
        prefix: str = "",
        client: Any = None,
        region: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        if client is None:
            import boto3

            client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url)
        self.client = client
        self.bucket = bucket
        self.prefix = prefix

    def put(self, key: str, data: bytes, content_type: str) -> str:
        ref = self.prefix + _check_key(key)
        self.client.put_object(
            Bucket=self.bucket, Key=ref, Body=data, ContentType=content_type, ServerSideEncryption="AES256"
        )
        return ref

    def get(self, ref: str) -> bytes:
        obj = self.client.get_object(Bucket=self.bucket, Key=ref)
        return obj["Body"].read()

    def delete(self, ref: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=ref)


class PostgresStorage:
    """Stores artifacts in ``export_artifacts`` (bytea). Each call uses its own short transaction.

    ``get`` raises ``KeyError`` for missing or expired rows (the download endpoint answers 410).
    """

    def __init__(self, db: Database, ttl_hours: int = 24) -> None:
        self.db = db
        self.ttl = timedelta(hours=ttl_hours)

    def put(self, key: str, data: bytes, content_type: str) -> str:
        ref = _check_key(key)
        expires = datetime.now(UTC) + self.ttl
        stmt = insert(ExportArtifact).values(key=ref, data=data, content_type=content_type, expires_at=expires)
        stmt = stmt.on_conflict_do_update(
            index_elements=[ExportArtifact.key],
            set_={"data": data, "content_type": content_type, "expires_at": expires},
        )
        with self.db.session() as s:
            s.execute(stmt)
            s.commit()
        return ref

    def get(self, ref: str) -> bytes:
        now = datetime.now(UTC)
        with self.db.session() as s:
            data = s.scalar(
                select(ExportArtifact.data).where(
                    ExportArtifact.key == ref,
                    or_(ExportArtifact.expires_at.is_(None), ExportArtifact.expires_at > now),
                )
            )
        if data is None:
            raise KeyError(ref)
        return bytes(data)

    def delete(self, ref: str) -> None:
        with self.db.session() as s:
            s.execute(delete(ExportArtifact).where(ExportArtifact.key == ref))
            s.commit()

    def purge_expired(self, now: datetime | None = None) -> int:
        with self.db.session() as s:
            res = s.execute(delete(ExportArtifact).where(ExportArtifact.expires_at < (now or datetime.now(UTC))))
            s.commit()
        return res.rowcount or 0


def make_storage(settings: Settings, db: Database | None = None) -> ArtifactStorage:
    if settings.storage_backend == "postgres":
        if db is None:
            raise ValueError("the postgres storage backend needs a database")
        return PostgresStorage(db, settings.export_ttl_hours)
    if settings.storage_backend == "s3":
        if not settings.s3_bucket:
            raise ValueError("WP_S3_BUCKET is required when WP_STORAGE_BACKEND=s3")
        return S3Storage(
            settings.s3_bucket, settings.s3_prefix, region=settings.s3_region, endpoint_url=settings.s3_endpoint_url
        )
    return LocalStorage(settings.export_dir)
