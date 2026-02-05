"""
MultiWA Python SDK - Contacts Client

Client for managing WhatsApp contacts.
"""

from typing import Optional, List, Dict, Any
import httpx

from .types import Contact


class ContactsClient:
    """Synchronous Contacts API client"""
    
    def __init__(self, http: httpx.Client):
        self._http = http
    
    def create(
        self,
        profile_id: str,
        phone: str,
        name: Optional[str] = None,
        email: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Contact:
        """Create a new contact"""
        response = self._http.post("/contacts", json={
            "profileId": profile_id,
            "phone": phone,
            "name": name,
            "email": email,
            "tags": tags or [],
            "metadata": metadata or {},
        })
        response.raise_for_status()
        return Contact(**response.json())
    
    def get(self, contact_id: str) -> Contact:
        """Get a contact by ID"""
        response = self._http.get(f"/contacts/{contact_id}")
        response.raise_for_status()
        return Contact(**response.json())
    
    def update(
        self,
        contact_id: str,
        name: Optional[str] = None,
        email: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Contact:
        """Update a contact"""
        data = {}
        if name is not None:
            data["name"] = name
        if email is not None:
            data["email"] = email
        if tags is not None:
            data["tags"] = tags
        if metadata is not None:
            data["metadata"] = metadata
            
        response = self._http.patch(f"/contacts/{contact_id}", json=data)
        response.raise_for_status()
        return Contact(**response.json())
    
    def delete(self, contact_id: str) -> Dict[str, bool]:
        """Delete a contact"""
        response = self._http.delete(f"/contacts/{contact_id}")
        response.raise_for_status()
        return response.json()
    
    def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> List[Contact]:
        """List contacts for a profile"""
        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if search:
            params["search"] = search
        if tags:
            params["tags"] = ",".join(tags)
            
        response = self._http.get(f"/contacts/profile/{profile_id}", params=params)
        response.raise_for_status()
        return [Contact(**c) for c in response.json()]
    
    def add_tags(
        self,
        contact_id: str,
        tags: List[str],
    ) -> Contact:
        """Add tags to a contact"""
        response = self._http.post(f"/contacts/{contact_id}/tags", json={
            "tags": tags,
        })
        response.raise_for_status()
        return Contact(**response.json())
    
    def remove_tags(
        self,
        contact_id: str,
        tags: List[str],
    ) -> Contact:
        """Remove tags from a contact"""
        response = self._http.delete(f"/contacts/{contact_id}/tags", json={
            "tags": tags,
        })
        response.raise_for_status()
        return Contact(**response.json())


class AsyncContactsClient:
    """Asynchronous Contacts API client"""
    
    def __init__(self, http: httpx.AsyncClient):
        self._http = http
    
    async def create(
        self,
        profile_id: str,
        phone: str,
        name: Optional[str] = None,
        email: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Contact:
        """Create a new contact"""
        response = await self._http.post("/contacts", json={
            "profileId": profile_id,
            "phone": phone,
            "name": name,
            "email": email,
            "tags": tags or [],
            "metadata": metadata or {},
        })
        response.raise_for_status()
        return Contact(**response.json())
    
    async def get(self, contact_id: str) -> Contact:
        """Get a contact by ID"""
        response = await self._http.get(f"/contacts/{contact_id}")
        response.raise_for_status()
        return Contact(**response.json())
    
    async def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> List[Contact]:
        """List contacts for a profile"""
        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if search:
            params["search"] = search
            
        response = await self._http.get(f"/contacts/profile/{profile_id}", params=params)
        response.raise_for_status()
        return [Contact(**c) for c in response.json()]
