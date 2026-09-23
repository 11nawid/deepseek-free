from curl_cffi import requests
from typing import Optional, Dict, Any, Generator, Literal
import json
from .pow import DeepSeekPOW
import sys
from pathlib import Path
import subprocess
import time
import logging
import traceback

try:
    import importlib.metadata as importlib_metadata
except ImportError:
    import importlib_metadata

log = logging.getLogger("dsk.api")
log.setLevel(logging.DEBUG)

ThinkingMode = Literal['detailed', 'simple', 'disabled']
SearchMode = Literal['enabled', 'disabled']

class DeepSeekError(Exception):
    """Base exception for all DeepSeek API errors"""
    pass

class AuthenticationError(DeepSeekError):
    """Raised when authentication fails"""
    pass

class RateLimitError(DeepSeekError):
    """Raised when API rate limit is exceeded"""
    pass

class NetworkError(DeepSeekError):
    """Raised when network communication fails"""
    pass

class CloudflareError(DeepSeekError):
    """Raised when Cloudflare blocks the request"""
    pass

class APIError(DeepSeekError):
    """Raised when API returns an error response"""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code

class DeepSeekAPI:
    BASE_URL = "https://chat.deepseek.com/api/v0"

    def __init__(self, auth_token: str):
        if not auth_token or not isinstance(auth_token, str):
            raise AuthenticationError("Invalid auth token provided")

        try:
            curl_cffi_version = importlib_metadata.version('curl-cffi')
            if curl_cffi_version not in ('0.8.1b9', '0.13.0'):
                print("\033[93mWarning: DeepSeek API was tested with curl-cffi 0.8.1b9", file=sys.stderr)
                print("Current version is {}. If requests fail, try: pip install curl-cffi==0.8.1b9\033[0m".format(curl_cffi_version), file=sys.stderr)
        except importlib_metadata.PackageNotFoundError:
            print("\033[93mWarning: curl-cffi not found. Please install version 0.8.1b9:", file=sys.stderr)
            print("pip install curl-cffi==0.8.1b9\033[0m", file=sys.stderr)

        self.auth_token = auth_token
        self.pow_solver = DeepSeekPOW()
        self._last_path = None
        self._last_fragment_type = 'RESPONSE'
        self._last_response_message_id = None
        self._last_request_message_id = None

        # Load cookies from JSON file
        cookies_path = Path(__file__).parent / 'cookies.json'
        try:
            with open(cookies_path, 'r') as f:
                cookie_data = json.load(f)
                self.cookies = cookie_data.get('cookies', {})
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"\033[93mWarning: Could not load cookies from {cookies_path}: {e}\033[0m", file=sys.stderr)
            self.cookies = {}

    def _get_headers(self, pow_response: Optional[str] = None) -> Dict[str, str]:
        headers = {
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'authorization': f'Bearer {self.auth_token}',
            'content-type': 'application/json',
            'origin': 'https://chat.deepseek.com',
            'referer': 'https://chat.deepseek.com/',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'x-client-bundle-id': 'com.deepseek.chat',
            'x-client-locale': 'en_US',
            'x-client-platform': 'web',
            'x-client-version': '2.4.0',
            'x-client-timezone-offset': '0',
            'x-app-version': '20241129.1'
        }

        if pow_response:
            headers['x-ds-pow-response'] = pow_response

        return headers

    def _refresh_cookies(self) -> None:
        """Run the cookie refresh script and reload cookies"""
        try:
            # Get path to bypass.py
            script_path = Path(__file__).parent / 'bypass.py'

            # Run the script
            subprocess.run([sys.executable, script_path], check=True)

            # Wait briefly for cookies file to be written
            time.sleep(2)

            # Reload cookies
            cookies_path = Path(__file__).parent / 'cookies.json'
            with open(cookies_path, 'r') as f:
                cookie_data = json.load(f)
                self.cookies = cookie_data.get('cookies', {})

        except Exception as e:
            print(f"\033[93mWarning: Failed to refresh cookies: {e}\033[0m", file=sys.stderr)

    def _make_request(self, method: str, endpoint: str, json_data: Dict[str, Any], pow_required: bool = False) -> Any:
        url = f"{self.BASE_URL}{endpoint}"

        retry_count = 0
        max_retries = 2

        while retry_count < max_retries:
            try:
                headers = self._get_headers()
                if pow_required:
                    challenge = self._get_pow_challenge()
                    pow_response = self.pow_solver.solve_challenge(challenge)
                    headers = self._get_headers(pow_response)

                response = requests.request(
                    method=method,
                    url=url,
                    headers=headers,
                    json=json_data,
                    cookies=self.cookies,
                    impersonate='chrome120',
                    timeout=None
                )

                # Check if we hit Cloudflare protection
                if "<!DOCTYPE html>" in response.text and "Just a moment" in response.text:
                    print("\033[93mWarning: Cloudflare protection detected. Bypassing...\033[0m", file=sys.stderr)
                    if retry_count < max_retries - 1:
                        self._refresh_cookies()  # Refresh cookies
                        retry_count += 1
                        continue

                # Handle other response codes
                if response.status_code == 401:
                    raise AuthenticationError("Invalid or expired authentication token")
                elif response.status_code == 429:
                    raise RateLimitError("API rate limit exceeded")
                elif response.status_code >= 500:
                    raise APIError(f"Server error occurred: {response.text}", response.status_code)
                elif response.status_code != 200:
                    raise APIError(f"API request failed: {response.text}", response.status_code)

                return response.json()

            except requests.exceptions.RequestException as e:
                raise NetworkError(f"Network error occurred: {str(e)}")
            except json.JSONDecodeError:
                raise APIError("Invalid JSON response from server")

        raise APIError("Failed to bypass Cloudflare protection after multiple attempts")

    def _get_pow_challenge(self, target_path: str = '/api/v0/chat/completion') -> Dict[str, Any]:
        try:
            response = self._make_request(
                'POST',
                '/chat/create_pow_challenge',
                {'target_path': target_path}
            )
            return response['data']['biz_data']['challenge']
        except KeyError:
            raise APIError("Invalid challenge response format from server")

    def upload_file(self, filename: str, content: bytes, content_type: str = 'application/octet-stream', model_type: str = 'default') -> str:
        """Upload a file and return its file ID for use in ref_file_ids."""
        from curl_cffi import CurlMime
        
        log.info(f"[UPLOAD] Uploading file: {filename} ({len(content)} bytes, type={content_type}, model_type={model_type})")
        pow_challenge = self._get_pow_challenge('/api/v0/file/upload_file')
        pow_response = self.pow_solver.solve_challenge(pow_challenge)
        headers = self._get_headers(pow_response)
            
        # Remove explicitly set content-type so requests can auto-generate the multipart boundary
        if 'content-type' in headers:
            del headers['content-type']
        
        headers['x-model-type'] = model_type
        headers['x-file-size'] = str(len(content))
        
        url = f"{self.BASE_URL}/file/upload_file"
        
        mp = CurlMime()
        mp.addpart(
            name="file",
            content_type=content_type,
            filename=filename,
            data=content
        )
        
        try:
            response = requests.post(url, headers=headers, cookies=self.cookies, impersonate='chrome120', multipart=mp)
            if response.status_code != 200:
                log.error(f"[UPLOAD] Failed with status {response.status_code}: {response.text[:500]}")
                raise APIError(f"Upload failed: {response.text}", response.status_code)
            data = response.json()
            if data.get('code') != 0:
                log.error(f"[UPLOAD] API error: {data.get('msg')}")
                raise APIError(f"Upload API error: {data.get('msg')}")
            file_id = data['data']['biz_data']['id']
            log.info(f"[UPLOAD] File uploaded successfully: file_id={file_id}")
            file_status = self._wait_for_file_ready(file_id)
            log.info(f"[UPLOAD] File processing complete: file_id={file_id}, final_status={file_status}")
            return file_id
        except Exception as e:
            log.error(f"[UPLOAD] Error: {e}")
            raise APIError(f"File upload error: {str(e)}")
        finally:
            mp.close()

    def _wait_for_file_ready(self, file_id: str, timeout: int = 30):
        """Wait for the uploaded file to finish processing"""
        import time
        start_time = time.time()
        url = f"{self.BASE_URL}/file/fetch_files?file_ids={file_id}"
        headers = self._get_headers()
        
        while time.time() - start_time < timeout:
            try:
                response = requests.get(url, headers=headers, cookies=self.cookies, impersonate='chrome120')
                if response.status_code == 200:
                    data = response.json()
                    files = data.get('data', {}).get('biz_data', {}).get('files', [])
                    if files:
                        status = files[0].get('status')
                        model_kind = files[0].get('model_kind', 'UNKNOWN')
                        elapsed = time.time() - start_time
                        log.debug(f"[FILE_WAIT] file_id={file_id}, status={status}, model_kind={model_kind}, elapsed={elapsed:.1f}s")
                        if status in ('SUCCESS', 'CONTENT_EMPTY'):
                            return status
                        elif status in ('ERROR', 'FAILED'):
                            log.error(f"[FILE_WAIT] File processing failed: status={status}")
                            raise APIError(f"File processing failed with status: {status}")
                time.sleep(1)
            except Exception as e:
                if isinstance(e, APIError):
                    raise
                time.sleep(1)
        log.error(f"[FILE_WAIT] Timeout after {timeout}s waiting for file_id={file_id}")
        raise APIError("File processing timeout")

    def create_chat_session(self) -> str:
        """Creates a new chat session and returns the session ID"""
        try:
            log.info("[SESSION] Creating new chat session...")
            response = self._make_request(
                'POST',
                '/chat_session/create',
                {'character_id': None}
            )
            
            if response.get('code') != 0:
                error_msg = response.get('msg', 'Unknown server error')
                if response.get('code') == 40003 or 'invalid token' in error_msg.lower():
                    raise APIError(f"Authentication failed: The DeepSeek token you provided is invalid. Make sure you copied the correct userToken value. Server message: {error_msg}")
                raise APIError(f"DeepSeek Server Error: {error_msg}")
            
            data_block = response.get('data')
            if not data_block:
                raise APIError("Account might be restricted or banned (data block is null).")
                
            biz_data = data_block.get('biz_data')
            if not biz_data:
                raise APIError("Account might be restricted or banned (biz_data is null).")
                
            # Handle different API version formats
            if 'chat_session' in biz_data:
                session_id = biz_data['chat_session']['id']
            else:
                session_id = biz_data['id']
            log.info(f"[SESSION] Created session: {session_id}")
            return session_id
        except APIError:
            raise
        except Exception as e:
            raise APIError(f"Invalid session creation response format from server: {str(e)}")

    def delete_all_sessions(self) -> bool:
        """Deletes all chat sessions on the DeepSeek server"""
        try:
            response = self._make_request('POST', '/chat_session/delete_all', {})
            return response.get('code') == 0
        except Exception as e:
            raise APIError(f"Failed to delete all sessions: {str(e)}")

    def chat_completion(self,
                    chat_session_id: str,
                    prompt: str,
                    parent_message_id: Optional[str] = None,
                    thinking_enabled: bool = True,
                    search_enabled: bool = False,
                    vision_enabled: bool = False,
                    ref_file_ids: Optional[list] = None) -> Generator[Dict[str, Any], None, None]:
        if not prompt or not isinstance(prompt, str):
            raise ValueError("Prompt must be a non-empty string")
        if not chat_session_id or not isinstance(chat_session_id, str):
            raise ValueError("Chat session ID must be a non-empty string")

        json_data = {
            'chat_session_id': chat_session_id,
            'parent_message_id': parent_message_id,
            'prompt': prompt,
            'ref_file_ids': ref_file_ids or [],
            'thinking_enabled': thinking_enabled,
            'search_enabled': search_enabled
        }

        # Remove parent_message_id if it's None to match official client closely
        if parent_message_id is None:
            del json_data['parent_message_id']

        if vision_enabled:
            json_data['model_type'] = 'vision'

        log.info(f"[CHAT_COMPLETION] session={chat_session_id}, parent={parent_message_id}, "
                 f"thinking={thinking_enabled}, search={search_enabled}, vision={vision_enabled}, "
                 f"ref_files={ref_file_ids or []}, prompt={prompt[:100]}...")

        try:
            self._last_path = None
            self._last_fragment_type = 'RESPONSE'
            headers = self._get_headers(
                pow_response=self.pow_solver.solve_challenge(
                    self._get_pow_challenge()
                )
            )

            response = requests.post(
                f"{self.BASE_URL}/chat/completion",
                headers=headers,
                json=json_data,
                cookies=self.cookies,  # Add cookies
                impersonate='chrome120',
                stream=True,
                timeout=None
            )

            if response.status_code != 200:
                error_text = next(response.iter_lines(), b'').decode('utf-8', 'ignore')
                log.error(f"[CHAT_COMPLETION] HTTP {response.status_code}: {error_text[:500]}")
                if response.status_code == 401:
                    raise AuthenticationError("Invalid or expired authentication token")
                elif response.status_code == 429:
                    raise RateLimitError("API rate limit exceeded")
                else:
                    raise APIError(f"API request failed: {error_text}", response.status_code)

            log.info(f"[CHAT_COMPLETION] Stream started, reading chunks...")
            chunk_count = 0
            yielded_count = 0
            for chunk in response.iter_lines():
                chunk_count += 1
                if chunk_count <= 5:
                    log.debug(f"[CHAT_COMPLETION] RAW chunk #{chunk_count}: {chunk[:300]}")
                elif chunk_count % 50 == 0:
                    log.debug(f"[CHAT_COMPLETION] ...still streaming, {chunk_count} chunks received, {yielded_count} yielded")

                if chunk and chunk.startswith(b'{'):
                    try:
                        err_data = json.loads(chunk)
                        if err_data.get('code') != 0:
                            raise APIError(f"DeepSeek Server Error: {err_data.get('msg', 'Unknown')}")
                    except json.JSONDecodeError:
                        pass
                
                try:
                    parsed = self._parse_chunk(chunk)
                    if parsed:
                        yielded_count += 1
                        if yielded_count <= 10 or parsed.get('finish_reason'):
                            log.info(f"[CHAT_COMPLETION] YIELDED #{yielded_count}: type={parsed.get('type')}, "
                                     f"finish={parsed.get('finish_reason')}, content_len={len(parsed.get('content', ''))}")
                        log.debug(f"[CHAT_COMPLETION] Full chunk: {json.dumps(parsed, default=str)[:300]}")
                        yield parsed
                        if parsed.get('finish_reason') == 'stop':
                            log.info(f"[CHAT_COMPLETION] Stream finished (stop). Total: {chunk_count} chunks, {yielded_count} yielded")
                            break
                        if parsed.get('finish_reason') == 'file_content_empty':
                            log.warning(f"[CHAT_COMPLETION] Stream finished (file_content_empty). Total: {chunk_count} chunks")
                            break
                except Exception as e:
                    log.error(f"[CHAT_COMPLETION] Parse error on chunk #{chunk_count}: {e}\n{traceback.format_exc()}")
                    if isinstance(e, APIError):
                        raise
                    raise APIError(f"Error parsing response chunk: {str(e)}")
            
            if chunk_count == 0:
                raise APIError("Empty response from DeepSeek Server. This usually means their WAF/Anti-Bot instantly closed the connection. Check your token and try again.")
            
            log.info(f"[CHAT_COMPLETION] Stream complete. Total: {chunk_count} chunks, {yielded_count} yielded")
        except requests.exceptions.RequestException as e:
            log.error(f"[CHAT_COMPLETION] Network error: {e}")
            raise NetworkError(f"Network error occurred during streaming: {str(e)}")

    def _parse_chunk(self, chunk: bytes) -> Optional[Dict[str, Any]]:
        if not chunk:
            return None
        
        if isinstance(chunk, bytes):
            chunk = chunk.decode('utf-8', 'ignore')
        
        if chunk.startswith('event:'):
            log.debug(f"[PARSE] Skipping event line: {chunk[:120]}")
            return None
        if not chunk.startswith('data: '):
            return None
        
        try:
            data = json.loads(chunk[6:])
        except json.JSONDecodeError:
            log.warning(f"[PARSE] Failed to parse JSON: {chunk[:200]}")
            return None

        try:
            # Capture message IDs for threading
            if 'response_message_id' in data:
                self._last_response_message_id = data['response_message_id']
                self._last_request_message_id = data.get('request_message_id')
                log.info(f"[PARSE] Message IDs: request={self._last_request_message_id}, response={self._last_response_message_id}")
                return None

            # Detect hint events with file_content_empty (image sent to non-vision model)
            if data.get('finish_reason') == 'file_content_empty':
                log.warning(f"[PARSE] HINT: file_content_empty detected! content={data.get('content', '')[:200]}")
                return {'content': '', 'type': 'text', 'finish_reason': 'file_content_empty'}

            # OpenAI-compatible fallback
            if 'choices' in data and data['choices']:
                choice = data['choices'][0]
                if 'delta' in choice:
                    delta = choice['delta']
                    return {
                        'content': delta.get('content', ''),
                        'type': delta.get('type', 'text') or 'text',
                        'finish_reason': choice.get('finish_reason')
                    }

            # Track path for shorthand {"v": ...} chunks
            if 'p' in data:
                self._last_path = data['p']
            
            path = self._last_path
            value = data.get('v')
            op = data.get('o', 'SET')
            
            # --- INITIAL FULL OBJECT ---
            # {"v": {"response": {"fragments": [...]}}}
            if isinstance(value, dict) and 'response' in value:
                resp = value['response']
                log.info(f"[PARSE] INITIAL OBJECT: status={resp.get('status')}, "
                         f"model={resp.get('model')}, mode={resp.get('conversation_mode')}, "
                         f"frags={len(resp.get('fragments', []))}")
                for frag in resp.get('fragments', []):
                    ftype = frag.get('type', 'RESPONSE')
                    status = frag.get('status', '')
                    content_preview = (frag.get('content', '') or '')[:80]
                    results = frag.get('results', [])
                    log.info(f"[PARSE] Fragment: type={ftype}, status={status}, "
                             f"content_len={len(frag.get('content', ''))}, has_results={bool(results)}")
                    if results:
                        return {'content': '', 'search_results': results, 'type': 'search', 'finish_reason': None}
                    frag_content = frag.get('content', '')
                    if frag_content:
                        self._last_fragment_type = ftype
                        return {'content': frag_content, 'type': 'thinking' if ftype == 'THINK' else 'text', 'finish_reason': None}
                return None
            
            # --- BATCH OP ---
            # {"p": "response", "o": "BATCH", "v": [{"p": "fragments", "o": "APPEND", "v": [{frag}]}]}
            if op == 'BATCH' and isinstance(value, list):
                for op_item in value:
                    if not isinstance(op_item, dict): continue
                    if op_item.get('p') == 'fragments' and op_item.get('o') == 'APPEND':
                        frags = op_item.get('v', [])
                        if not isinstance(frags, list): frags = [frags]
                        for frag in frags:
                            ftype = frag.get('type', 'RESPONSE')
                            self._last_fragment_type = ftype
                            frag_content = frag.get('content', '')
                            log.info(f"[PARSE] BATCH FRAGMENT: type={ftype}, content_len={len(frag_content)}")
                            if frag_content:
                                return {'content': frag_content, 'type': 'thinking' if ftype == 'THINK' else 'text', 'finish_reason': None}
                return None
            
            # --- DIRECT FRAGMENT APPEND (THINK → RESPONSE transition) ---
            # {"p": "response/fragments", "o": "APPEND", "v": [{"type": "RESPONSE", "content": "Hi", ...}]}
            # Also handle op=SET for new fragment addition
            if path == 'response/fragments' and isinstance(value, list):
                frags = value
                for frag in frags:
                    if not isinstance(frag, dict): continue
                    ftype = frag.get('type', 'RESPONSE')
                    self._last_fragment_type = ftype
                    frag_content = frag.get('content', '')
                    log.info(f"[PARSE] FRAGMENT ADD (op={op}): type={ftype}, content_len={len(frag_content)}")
                    if frag_content:
                        return {'content': frag_content, 'type': 'thinking' if ftype == 'THINK' else 'text', 'finish_reason': None}
                return None
            
            # --- STREAM FINISHED ---
            if path == 'response/status' and value == 'FINISHED':
                log.info("[PARSE] STREAM FINISHED")
                return {'content': '', 'type': 'text', 'finish_reason': 'stop'}
            
            # --- SEARCH RESULTS ---
            if path and path.endswith('/results') and 'fragments' in path:
                if isinstance(value, list) and value:
                    log.info(f"[PARSE] SEARCH RESULTS: {len(value)} results")
                    return {'content': '', 'search_results': value, 'type': 'search', 'finish_reason': None}
                return None

            # --- CONVERSATION MODE ---
            if path == 'response/conversation_mode':
                log.info(f"[PARSE] Conversation mode: {value}")
                return None
            
            # --- ELAPSED SECS / METADATA ---
            if path and path.endswith('/elapsed_secs'):
                log.debug(f"[PARSE] Elapsed secs: {value}")
                return None
            if path and path.endswith('/status') and 'fragments' in path:
                log.debug(f"[PARSE] Fragment status: {value}")
                return None
            
            # --- CONTENT TOKENS ---
            if path and 'fragments' in path and path.endswith('/content'):
                if value is not None and isinstance(value, str):
                    ftype = getattr(self, '_last_fragment_type', 'RESPONSE')
                    return {'content': value, 'type': 'thinking' if ftype == 'THINK' else 'text', 'finish_reason': None}

            # --- LEGACY PATH FORMAT (fallback) ---
            if value is not None and isinstance(value, str) and path and 'fragments' not in path:
                if path == 'response/content':
                    return {'content': value, 'type': 'text', 'finish_reason': None}
                elif path == 'response/thinking_content':
                    return {'content': value, 'type': 'thinking', 'finish_reason': None}
            
            log.debug(f"[PARSE] UNHANDLED: path={path}, op={op}, value_type={type(value).__name__}, "
                      f"value_preview={str(value)[:120]}")
                
        except Exception as e:
            log.error(f"[PARSE] Exception: {e}\n{traceback.format_exc()}")
            
        return None
