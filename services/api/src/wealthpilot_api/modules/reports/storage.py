"""Export artifact storage behind a small interface: local filesystem (dev/tests) or S3 (production).

Artifacts are short-lived (``WP_EXPORT_TTL_HOURS``); access is only through the signed download endpoint, never
through a public bucket URL.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Protocol

from ...core.config import Settings

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


def make_storage(settings: Settings) -> ArtifactStorage:
    if settings.storage_backend == "s3":
        if not settings.s3_bucket:
            raise ValueError("WP_S3_BUCKET is required when WP_STORAGE_BACKEND=s3")
        return S3Storage(
            settings.s3_bucket, settings.s3_prefix, region=settings.s3_region, endpoint_url=settings.s3_endpoint_url
        )
    return LocalStorage(settings.export_dir)
