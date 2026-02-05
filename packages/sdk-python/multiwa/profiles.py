"""
MultiWA Python SDK - Profiles Client

Client for managing WhatsApp profiles/accounts.
"""

from typing import Optional, List, Dict, Any
import httpx

from .types import Profile


class ProfilesClient:
    """Synchronous Profiles API client"""
    
    def __init__(self, http: httpx.Client):
        self._http = http
    
    def create(
        self,
        workspace_id: str,
        name: str,
        engine: str = "whatsapp-web-js",
    ) -> Profile:
        """Create a new profile"""
        response = self._http.post("/profiles", json={
            "workspaceId": workspace_id,
            "name": name,
            "engine": engine,
        })
        response.raise_for_status()
        return Profile(**response.json())
    
    def get(self, profile_id: str) -> Profile:
        """Get a profile by ID"""
        response = self._http.get(f"/profiles/{profile_id}")
        response.raise_for_status()
        return Profile(**response.json())
    
    def list(
        self,
        workspace_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Profile]:
        """List profiles"""
        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if workspace_id:
            params["workspaceId"] = workspace_id
            
        response = self._http.get("/profiles", params=params)
        response.raise_for_status()
        return [Profile(**p) for p in response.json()]
    
    def update(
        self,
        profile_id: str,
        name: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Profile:
        """Update a profile"""
        data = {}
        if name is not None:
            data["name"] = name
        if is_active is not None:
            data["isActive"] = is_active
            
        response = self._http.patch(f"/profiles/{profile_id}", json=data)
        response.raise_for_status()
        return Profile(**response.json())
    
    def delete(self, profile_id: str) -> Dict[str, bool]:
        """Delete a profile"""
        response = self._http.delete(f"/profiles/{profile_id}")
        response.raise_for_status()
        return response.json()
    
    def connect(self, profile_id: str) -> Dict[str, Any]:
        """Connect a profile to WhatsApp"""
        response = self._http.post(f"/profiles/{profile_id}/connect")
        response.raise_for_status()
        return response.json()
    
    def disconnect(self, profile_id: str) -> Dict[str, bool]:
        """Disconnect a profile from WhatsApp"""
        response = self._http.post(f"/profiles/{profile_id}/disconnect")
        response.raise_for_status()
        return response.json()
    
    def get_qr(self, profile_id: str) -> Dict[str, str]:
        """Get QR code for authentication"""
        response = self._http.get(f"/profiles/{profile_id}/qr")
        response.raise_for_status()
        return response.json()
    
    def status(self, profile_id: str) -> Dict[str, Any]:
        """Get profile connection status"""
        response = self._http.get(f"/profiles/{profile_id}/status")
        response.raise_for_status()
        return response.json()


class AsyncProfilesClient:
    """Asynchronous Profiles API client"""
    
    def __init__(self, http: httpx.AsyncClient):
        self._http = http
    
    async def create(
        self,
        workspace_id: str,
        name: str,
        engine: str = "whatsapp-web-js",
    ) -> Profile:
        """Create a new profile"""
        response = await self._http.post("/profiles", json={
            "workspaceId": workspace_id,
            "name": name,
            "engine": engine,
        })
        response.raise_for_status()
        return Profile(**response.json())
    
    async def get(self, profile_id: str) -> Profile:
        """Get a profile by ID"""
        response = await self._http.get(f"/profiles/{profile_id}")
        response.raise_for_status()
        return Profile(**response.json())
    
    async def list(
        self,
        workspace_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Profile]:
        """List profiles"""
        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if workspace_id:
            params["workspaceId"] = workspace_id
            
        response = await self._http.get("/profiles", params=params)
        response.raise_for_status()
        return [Profile(**p) for p in response.json()]
    
    async def connect(self, profile_id: str) -> Dict[str, Any]:
        """Connect a profile to WhatsApp"""
        response = await self._http.post(f"/profiles/{profile_id}/connect")
        response.raise_for_status()
        return response.json()
    
    async def get_qr(self, profile_id: str) -> Dict[str, str]:
        """Get QR code for authentication"""
        response = await self._http.get(f"/profiles/{profile_id}/qr")
        response.raise_for_status()
        return response.json()
