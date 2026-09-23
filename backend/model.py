import time
import json
import os
import logging
import traceback
from dsk.api import DeepSeekAPI

log = logging.getLogger("backend.model")
log.setLevel(logging.DEBUG)

class AIModel:
    def __init__(self):
        self._api = None
        self._current_token = None
        
    def get_api(self, token=None):
        if not token:
            token = os.getenv("DEEPSEEK_AUTH_TOKEN")
            
        if not token:
            raise RuntimeError("DEEPSEEK_AUTH_TOKEN is missing. Please provide it in the UI or .env")
            
        # If token changed or api doesn't exist, recreate it
        if not self._api or self._current_token != token:
            self._current_token = token
            self._api = DeepSeekAPI(token)
            log.info("[MODEL] Created new DeepSeekAPI instance")
            
        return self._api
        
    def generate(self, messages, settings, stream=False, session_id=None, parent_id=None, token=None):
        api = self.get_api(token)
        
        last_message = messages[-1]['content'] if messages else ""
        thinking_enabled = settings.get('thinking', True)
        search_enabled = settings.get('search', False)
        vision_enabled = settings.get('vision', False)
        
        log.info(f"[MODEL] generate: stream={stream}, thinking={thinking_enabled}, "
                 f"search={search_enabled}, vision={vision_enabled}, "
                 f"session={session_id}, parent={parent_id}, "
                 f"msg_count={len(messages)}, last_msg={last_message[:80]}")
        
        if thinking_enabled and search_enabled and not vision_enabled:
            log.info("[MODEL] >>> EXPERT MODE: thinking=True, search=True — DeepSeek will use full reasoning + web search")
        elif vision_enabled:
            log.info("[MODEL] >>> VISION MODE: image will be processed by DeepSeek vision model")
        else:
            log.info(f"[MODEL] >>> INSTANT MODE: thinking={thinking_enabled}, search={search_enabled}")
        
        ref_file_ids = []
        image_data = settings.get("image_data")
        if image_data:
            import base64
            b64_content = image_data.get('base64', '')
            if b64_content.startswith('data:'):
                b64_content = b64_content.split(',')[1]
            content = base64.b64decode(b64_content)
            filename = image_data.get('filename', 'image.png')
            content_type = image_data.get('content_type', 'image/png')
            vision_enabled = True
            log.info(f"[MODEL] Uploading image: {filename} ({len(content)} bytes, {content_type})")
            try:
                file_id = api.upload_file(filename, content, content_type, model_type="vision")
                ref_file_ids.append(file_id)
                log.info(f"[MODEL] Image uploaded: file_id={file_id}, model_type=vision (forced)")
            except Exception as e:
                log.error(f"[MODEL] Image upload failed: {e}\n{traceback.format_exc()}")
                raise

        if not session_id:
            log.info("[MODEL] No session_id, creating new session...")
            session_id = api.create_chat_session()
            
        if stream:
            def streamer():
                log.info(f"[MODEL] Starting streamer: session={session_id}, parent={parent_id}, "
                         f"ref_files={ref_file_ids}")
                chunk_count = 0
                for chunk in api.chat_completion(
                    session_id, last_message,
                    parent_message_id=parent_id,
                    thinking_enabled=thinking_enabled,
                    search_enabled=search_enabled,
                    vision_enabled=vision_enabled,
                    ref_file_ids=ref_file_ids
                ):
                    chunk_count += 1
                    yield chunk
                log.info(f"[MODEL] Streamer complete: {chunk_count} chunks")
            return streamer(), session_id, api
        else:
            full_response = ""
            for chunk in api.chat_completion(session_id, last_message, parent_message_id=parent_id, thinking_enabled=thinking_enabled, search_enabled=search_enabled, vision_enabled=vision_enabled, ref_file_ids=ref_file_ids):
                if chunk.get("type") == "text" and chunk.get("content"):
                    full_response += chunk.get("content")
            return full_response, session_id, api._last_response_message_id
            
    def generate_json(self, messages, settings):
        prompt = messages[-1]['content'] if messages else ""
        prompt += "\n\nRespond ONLY with valid JSON. No markdown formatting or extra text."
        
        api = self.get_api()
        session_id = api.create_chat_session()
        
        full_response = ""
        for chunk in api.chat_completion(session_id, prompt, thinking_enabled=False):
            if chunk.get("type") == "text" and chunk.get("content"):
                full_response += chunk.get("content")
                
        # Clean markdown code blocks if the model wrapped it
        full_response = full_response.strip()
        if full_response.startswith("```json"):
            full_response = full_response[7:]
        if full_response.startswith("```"):
            full_response = full_response[3:]
        if full_response.endswith("```"):
            full_response = full_response[:-3]
            
        return full_response.strip()

model_instance = AIModel()
