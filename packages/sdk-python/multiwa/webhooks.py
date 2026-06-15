"""
MultiWA Python SDK - Webhooks Client

Client for managing webhook configurations.
"""

import hashlib
import hmac
from typing import Optional, List, Dict, Any, Union

import httpx

from .types import Webhook


def verify_webhook_signature(
    payload: Union[str, bytes],
    signature: Optional[str],
    secret: str,
) -> bool:
    """Verify a MultiWA webhook HMAC-SHA256 signature.

    MultiWA signs every webhook with HMAC-SHA256 over the **raw request body**
    and sends it in the ``X-MultiWA-Signature`` header as ``sha256=<hex>``.
    Pass the RAW body — a re-serialized object will not match.

    Returns ``True`` when the signature is valid, ``False`` otherwise.
    """
    if not signature or not secret:
        return False
    body = payload.encode() if isinstance(payload, str) else payload
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


class WebhooksClient:
    """Synchronous Webhooks API client"""
    
    def __init__(self, http: httpx.Client):
        self._http = http
    
    def create(
        self,
        profile_id: str,
        url: str,
        events: List[str],
        secret: Optional[str] = None,
    ) -> Webhook:
        """Create a new webhook"""
        response = self._http.post("/webhooks", json={
            "profileId": profile_id,
            "url": url,
            "events": events,
            "secret": secret,
        })
        response.raise_for_status()
        return Webhook(**response.json())
    
    def get(self, webhook_id: str) -> Webhook:
        """Get a webhook by ID"""
        response = self._http.get(f"/webhooks/{webhook_id}")
        response.raise_for_status()
        return Webhook(**response.json())
    
    def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Webhook]:
        """List webhooks for a profile"""
        response = self._http.get(
            f"/webhooks/profile/{profile_id}",
            params={"limit": limit, "offset": offset}
        )
        response.raise_for_status()
        return [Webhook(**w) for w in response.json()]
    
    def update(
        self,
        webhook_id: str,
        url: Optional[str] = None,
        events: Optional[List[str]] = None,
        is_active: Optional[bool] = None,
        secret: Optional[str] = None,
    ) -> Webhook:
        """Update a webhook"""
        data = {}
        if url is not None:
            data["url"] = url
        if events is not None:
            data["events"] = events
        if is_active is not None:
            data["isActive"] = is_active
        if secret is not None:
            data["secret"] = secret
            
        response = self._http.patch(f"/webhooks/{webhook_id}", json=data)
        response.raise_for_status()
        return Webhook(**response.json())
    
    def delete(self, webhook_id: str) -> Dict[str, bool]:
        """Delete a webhook"""
        response = self._http.delete(f"/webhooks/{webhook_id}")
        response.raise_for_status()
        return response.json()
    
    def test(self, webhook_id: str) -> Dict[str, Any]:
        """Test a webhook by sending a test event"""
        response = self._http.post(f"/webhooks/{webhook_id}/test")
        response.raise_for_status()
        return response.json()


class AsyncWebhooksClient:
    """Asynchronous Webhooks API client"""
    
    def __init__(self, http: httpx.AsyncClient):
        self._http = http
    
    async def create(
        self,
        profile_id: str,
        url: str,
        events: List[str],
        secret: Optional[str] = None,
    ) -> Webhook:
        """Create a new webhook"""
        response = await self._http.post("/webhooks", json={
            "profileId": profile_id,
            "url": url,
            "events": events,
            "secret": secret,
        })
        response.raise_for_status()
        return Webhook(**response.json())
    
    async def get(self, webhook_id: str) -> Webhook:
        """Get a webhook by ID"""
        response = await self._http.get(f"/webhooks/{webhook_id}")
        response.raise_for_status()
        return Webhook(**response.json())
    
    async def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Webhook]:
        """List webhooks for a profile"""
        response = await self._http.get(
            f"/webhooks/profile/{profile_id}",
            params={"limit": limit, "offset": offset}
        )
        response.raise_for_status()
        return [Webhook(**w) for w in response.json()]
    
    async def delete(self, webhook_id: str) -> Dict[str, bool]:
        """Delete a webhook"""
        response = await self._http.delete(f"/webhooks/{webhook_id}")
        response.raise_for_status()
        return response.json()
