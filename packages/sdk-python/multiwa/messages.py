"""
MultiWA Python SDK - Messages Client

Client for messaging endpoints: send text, images, videos, polls, etc.
"""

from typing import Optional, List, Dict, Any
import httpx

from .types import MessageResult


class MessagesClient:
    """Synchronous Messages API client"""
    
    def __init__(self, http: httpx.Client):
        self._http = http
    
    def send_text(
        self,
        profile_id: str,
        to: str,
        text: str,
        quoted_message_id: Optional[str] = None,
    ) -> MessageResult:
        """Send a text message"""
        response = self._http.post("/messages/text", json={
            "profileId": profile_id,
            "to": to,
            "text": text,
            "quotedMessageId": quoted_message_id,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_image(
        self,
        profile_id: str,
        to: str,
        url: Optional[str] = None,
        base64: Optional[str] = None,
        caption: Optional[str] = None,
        mimetype: Optional[str] = None,
    ) -> MessageResult:
        """Send an image message"""
        response = self._http.post("/messages/image", json={
            "profileId": profile_id,
            "to": to,
            "url": url,
            "base64": base64,
            "caption": caption,
            "mimetype": mimetype,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_video(
        self,
        profile_id: str,
        to: str,
        url: Optional[str] = None,
        base64: Optional[str] = None,
        caption: Optional[str] = None,
        mimetype: Optional[str] = None,
    ) -> MessageResult:
        """Send a video message"""
        response = self._http.post("/messages/video", json={
            "profileId": profile_id,
            "to": to,
            "url": url,
            "base64": base64,
            "caption": caption,
            "mimetype": mimetype,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_audio(
        self,
        profile_id: str,
        to: str,
        url: Optional[str] = None,
        base64: Optional[str] = None,
        mimetype: Optional[str] = None,
        ptt: bool = False,
    ) -> MessageResult:
        """Send an audio message or voice note"""
        response = self._http.post("/messages/audio", json={
            "profileId": profile_id,
            "to": to,
            "url": url,
            "base64": base64,
            "mimetype": mimetype,
            "ptt": ptt,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_document(
        self,
        profile_id: str,
        to: str,
        filename: str,
        url: Optional[str] = None,
        base64: Optional[str] = None,
        mimetype: Optional[str] = None,
    ) -> MessageResult:
        """Send a document/file"""
        response = self._http.post("/messages/document", json={
            "profileId": profile_id,
            "to": to,
            "filename": filename,
            "url": url,
            "base64": base64,
            "mimetype": mimetype,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_location(
        self,
        profile_id: str,
        to: str,
        latitude: float,
        longitude: float,
        name: Optional[str] = None,
        address: Optional[str] = None,
    ) -> MessageResult:
        """Send a location"""
        response = self._http.post("/messages/location", json={
            "profileId": profile_id,
            "to": to,
            "latitude": latitude,
            "longitude": longitude,
            "name": name,
            "address": address,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_contact(
        self,
        profile_id: str,
        to: str,
        name: str,
        phone: str,
        email: Optional[str] = None,
    ) -> MessageResult:
        """Send a contact card (vCard)"""
        response = self._http.post("/messages/contact", json={
            "profileId": profile_id,
            "to": to,
            "contacts": [{
                "name": name,
                "phone": phone,
                "email": email,
            }],
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_poll(
        self,
        profile_id: str,
        to: str,
        question: str,
        options: List[str],
        allow_multiple_answers: bool = False,
    ) -> MessageResult:
        """Send an interactive poll"""
        response = self._http.post("/messages/poll", json={
            "profileId": profile_id,
            "to": to,
            "question": question,
            "options": options,
            "allowMultipleAnswers": allow_multiple_answers,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def send_reaction(
        self,
        profile_id: str,
        message_id: str,
        emoji: str,
    ) -> MessageResult:
        """React to a message with an emoji"""
        response = self._http.post("/messages/reaction", json={
            "profileId": profile_id,
            "messageId": message_id,
            "emoji": emoji,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        message_type: Optional[str] = None,
        direction: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List messages for a profile"""
        params = {
            "limit": limit,
            "offset": offset,
        }
        if message_type:
            params["type"] = message_type
        if direction:
            params["direction"] = direction
            
        response = self._http.get(f"/messages/profile/{profile_id}", params=params)
        response.raise_for_status()
        return response.json()


class AsyncMessagesClient:
    """Asynchronous Messages API client"""
    
    def __init__(self, http: httpx.AsyncClient):
        self._http = http
    
    async def send_text(
        self,
        profile_id: str,
        to: str,
        text: str,
        quoted_message_id: Optional[str] = None,
    ) -> MessageResult:
        """Send a text message"""
        response = await self._http.post("/messages/text", json={
            "profileId": profile_id,
            "to": to,
            "text": text,
            "quotedMessageId": quoted_message_id,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    async def send_image(
        self,
        profile_id: str,
        to: str,
        url: Optional[str] = None,
        base64: Optional[str] = None,
        caption: Optional[str] = None,
        mimetype: Optional[str] = None,
    ) -> MessageResult:
        """Send an image message"""
        response = await self._http.post("/messages/image", json={
            "profileId": profile_id,
            "to": to,
            "url": url,
            "base64": base64,
            "caption": caption,
            "mimetype": mimetype,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    async def send_poll(
        self,
        profile_id: str,
        to: str,
        question: str,
        options: List[str],
        allow_multiple_answers: bool = False,
    ) -> MessageResult:
        """Send an interactive poll"""
        response = await self._http.post("/messages/poll", json={
            "profileId": profile_id,
            "to": to,
            "question": question,
            "options": options,
            "allowMultipleAnswers": allow_multiple_answers,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    async def send_location(
        self,
        profile_id: str,
        to: str,
        latitude: float,
        longitude: float,
        name: Optional[str] = None,
        address: Optional[str] = None,
    ) -> MessageResult:
        """Send a location"""
        response = await self._http.post("/messages/location", json={
            "profileId": profile_id,
            "to": to,
            "latitude": latitude,
            "longitude": longitude,
            "name": name,
            "address": address,
        })
        response.raise_for_status()
        return MessageResult(**response.json())
    
    async def send_contact(
        self,
        profile_id: str,
        to: str,
        name: str,
        phone: str,
        email: Optional[str] = None,
    ) -> MessageResult:
        """Send a contact card (vCard)"""
        response = await self._http.post("/messages/contact", json={
            "profileId": profile_id,
            "to": to,
            "contacts": [{
                "name": name,
                "phone": phone,
                "email": email,
            }],
        })
        response.raise_for_status()
        return MessageResult(**response.json())
