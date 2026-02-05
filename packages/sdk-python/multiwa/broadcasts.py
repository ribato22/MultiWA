"""
MultiWA Python SDK - Broadcasts Client

Client for managing broadcast campaigns.
"""

from typing import Optional, List, Dict, Any
import httpx

from .types import Broadcast


class BroadcastsClient:
    """Synchronous Broadcasts API client"""
    
    def __init__(self, http: httpx.Client):
        self._http = http
    
    def create(
        self,
        profile_id: str,
        name: str,
        recipients: List[str],
        template_id: Optional[str] = None,
        message: Optional[str] = None,
        schedule_at: Optional[str] = None,
    ) -> Broadcast:
        """Create a new broadcast campaign"""
        response = self._http.post("/broadcasts", json={
            "profileId": profile_id,
            "name": name,
            "recipients": recipients,
            "templateId": template_id,
            "message": message,
            "scheduleAt": schedule_at,
        })
        response.raise_for_status()
        return Broadcast(**response.json())
    
    def get(self, broadcast_id: str) -> Broadcast:
        """Get a broadcast by ID"""
        response = self._http.get(f"/broadcasts/{broadcast_id}")
        response.raise_for_status()
        return Broadcast(**response.json())
    
    def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> List[Broadcast]:
        """List broadcasts for a profile"""
        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if status:
            params["status"] = status
            
        response = self._http.get(f"/broadcasts/profile/{profile_id}", params=params)
        response.raise_for_status()
        return [Broadcast(**b) for b in response.json()]
    
    def start(self, broadcast_id: str) -> Broadcast:
        """Start a broadcast"""
        response = self._http.post(f"/broadcasts/{broadcast_id}/start")
        response.raise_for_status()
        return Broadcast(**response.json())
    
    def pause(self, broadcast_id: str) -> Broadcast:
        """Pause a broadcast"""
        response = self._http.post(f"/broadcasts/{broadcast_id}/pause")
        response.raise_for_status()
        return Broadcast(**response.json())
    
    def cancel(self, broadcast_id: str) -> Broadcast:
        """Cancel a broadcast"""
        response = self._http.post(f"/broadcasts/{broadcast_id}/cancel")
        response.raise_for_status()
        return Broadcast(**response.json())
    
    def delete(self, broadcast_id: str) -> Dict[str, bool]:
        """Delete a broadcast"""
        response = self._http.delete(f"/broadcasts/{broadcast_id}")
        response.raise_for_status()
        return response.json()
    
    def stats(self, broadcast_id: str) -> Dict[str, Any]:
        """Get broadcast statistics"""
        response = self._http.get(f"/broadcasts/{broadcast_id}/stats")
        response.raise_for_status()
        return response.json()


class AsyncBroadcastsClient:
    """Asynchronous Broadcasts API client"""
    
    def __init__(self, http: httpx.AsyncClient):
        self._http = http
    
    async def create(
        self,
        profile_id: str,
        name: str,
        recipients: List[str],
        template_id: Optional[str] = None,
        message: Optional[str] = None,
        schedule_at: Optional[str] = None,
    ) -> Broadcast:
        """Create a new broadcast campaign"""
        response = await self._http.post("/broadcasts", json={
            "profileId": profile_id,
            "name": name,
            "recipients": recipients,
            "templateId": template_id,
            "message": message,
            "scheduleAt": schedule_at,
        })
        response.raise_for_status()
        return Broadcast(**response.json())
    
    async def get(self, broadcast_id: str) -> Broadcast:
        """Get a broadcast by ID"""
        response = await self._http.get(f"/broadcasts/{broadcast_id}")
        response.raise_for_status()
        return Broadcast(**response.json())
    
    async def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Broadcast]:
        """List broadcasts for a profile"""
        response = await self._http.get(
            f"/broadcasts/profile/{profile_id}",
            params={"limit": limit, "offset": offset}
        )
        response.raise_for_status()
        return [Broadcast(**b) for b in response.json()]
    
    async def start(self, broadcast_id: str) -> Broadcast:
        """Start a broadcast"""
        response = await self._http.post(f"/broadcasts/{broadcast_id}/start")
        response.raise_for_status()
        return Broadcast(**response.json())
