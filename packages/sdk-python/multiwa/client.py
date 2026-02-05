"""
MultiWA Python SDK - Core Client

Main client class for synchronous and asynchronous API access.
"""

from typing import Optional, Dict, Any
import httpx

from .messages import MessagesClient, AsyncMessagesClient
from .contacts import ContactsClient, AsyncContactsClient
from .broadcasts import BroadcastsClient, AsyncBroadcastsClient
from .profiles import ProfilesClient, AsyncProfilesClient
from .webhooks import WebhooksClient, AsyncWebhooksClient


class MultiWA:
    """
    Synchronous MultiWA API Client
    
    Example:
        client = MultiWA(
            base_url="https://your-instance.com/api",
            api_key="your-api-key"
        )
        result = client.messages.send_text(profile_id, to, "Hello!")
    """
    
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        
        self._http = httpx.Client(
            base_url=self.base_url,
            headers={
                "X-API-Key": api_key,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )
        
        # Initialize API clients
        self.messages = MessagesClient(self._http)
        self.contacts = ContactsClient(self._http)
        self.broadcasts = BroadcastsClient(self._http)
        self.profiles = ProfilesClient(self._http)
        self.webhooks = WebhooksClient(self._http)
    
    def close(self):
        """Close the HTTP client"""
        self._http.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        self.close()
    
    def request(
        self,
        method: str,
        path: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make a raw API request"""
        response = self._http.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()


class AsyncMultiWA:
    """
    Asynchronous MultiWA API Client
    
    Example:
        async with AsyncMultiWA(base_url, api_key) as client:
            result = await client.messages.send_text(profile_id, to, "Hello!")
    """
    
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "X-API-Key": api_key,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )
        
        # Initialize API clients
        self.messages = AsyncMessagesClient(self._http)
        self.contacts = AsyncContactsClient(self._http)
        self.broadcasts = AsyncBroadcastsClient(self._http)
        self.profiles = AsyncProfilesClient(self._http)
        self.webhooks = AsyncWebhooksClient(self._http)
    
    async def close(self):
        """Close the HTTP client"""
        await self._http.aclose()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, *args):
        await self.close()
    
    async def request(
        self,
        method: str,
        path: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make a raw API request"""
        response = await self._http.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()
