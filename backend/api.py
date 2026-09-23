from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import asyncio
import logging
import traceback

from backend.model import model_instance
import backend.chat_storage as db
import backend.prompts as prompts

log = logging.getLogger("backend.api")
log.setLevel(logging.DEBUG)

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
for noisy in ("uvicorn.access", "httpcore", "httpx"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

app = FastAPI(title="AI Workspace API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- OPENAI COMPATIBLE API ----
import time
import uuid

@app.get("/v1/models")
async def list_models():
    """OpenAI-compatible models list."""
    models = [
        {"id": "deepseek-chat",     "object": "model", "created": 1700000000, "owned_by": "deepseek"},
        {"id": "deepseek-reasoner", "object": "model", "created": 1700000000, "owned_by": "deepseek"},
        {"id": "deepseek-expert",   "object": "model", "created": 1700000000, "owned_by": "deepseek"},
    ]
    return JSONResponse({"object": "list", "data": models})


@app.post("/v1/chat/completions")
async def openai_chat_completions(request: Request):
    data = await request.json()
    messages  = data.get("messages", [])
    stream    = data.get("stream", False)
    model     = data.get("model", "deepseek-chat")
    # Allow session reuse for agent loops (prevents separate DeepSeek chat per tool step)
    session_id = data.get("session_id")
    parent_id  = data.get("parent_id")

    # Extract token from Authorization header (same as chat endpoint)
    token = parse_token(request.headers.get("Authorization", ""))

    # Map model name → feature flags
    thinking = ("reasoner" in model) or ("expert" in model) or bool(data.get("thinking", False))
    search   = bool(data.get("search", False))

    settings = {"thinking": thinking, "search": search}

    # FIX: System prompt not being sent — the proxy only used last_message, so system + history were lost.
    # For free mode tool loop, we need full history in every request. Build combined prompt.
    # This ensures the AI sees the system tool instructions on every turn, not just first.
    if messages and len(messages) > 1:
        try:
            system_texts = [m.get("content","") for m in messages if m.get("role") == "system" and m.get("content")]
            system_combined = "\n\n".join(system_texts).strip()
            # Build history text from all non-system messages
            history_parts = []
            for m in messages:
                if m.get("role") == "system":
                    continue
                r = m.get("role","user")
                c = m.get("content","")
                if not c:
                    continue
                # Keep tool result markers clear
                history_parts.append(f"{r.upper()}: {c}")
            if history_parts:
                combined_history = "\n\n".join(history_parts)
                # Rebuild messages to ensure system is preserved and last message contains full context
                # Keep system as first message, and last user message contains combined history
                # This way DeepSeek sees full conversation even when session is new
                new_messages = []
                if system_combined:
                    new_messages.append({"role": "system", "content": system_combined})
                # For session reuse, we still want full context in last message to be safe
                # Use combined history as the user message content for the API call
                # But to avoid token explosion, truncate if too long
                if len(combined_history) > 15000:
                    combined_history = combined_history[-15000:]
                    combined_history = "[...earlier truncated...]\n\n" + combined_history
                new_messages.append({"role": "user", "content": combined_history})
                # Only replace if we have a meaningful combined history
                # Keep original last message as fallback if combined is empty
                if combined_history.strip():
                    messages = new_messages
        except Exception as e:
            log.warning(f"[OPENAI] Failed to build combined history: {e}")

    if stream:
        async def openai_stream():
            chunk_id = f"chatcmpl-{uuid.uuid4()}"
            created  = int(time.time())
            # Reuse session for agent loops to avoid separate DeepSeek chat per tool step
            _session_id = session_id
            _parent_id = parent_id
            try:
                streamer, _session_id, _api = model_instance.generate(
                    messages, settings, stream=True, token=token,
                    session_id=_session_id, parent_id=_parent_id
                )
                for chunk in streamer:
                    content      = chunk.get("content", "")
                    chunk_type   = chunk.get("type", "text")
                    finish_reason = chunk.get("finish_reason")

                    delta = {}
                    if chunk_type == "thinking":
                        delta["reasoning_content"] = content
                        delta["content"] = ""
                    else:
                        delta["content"] = content

                    openai_chunk = {
                        "id":      chunk_id,
                        "object":  "chat.completion.chunk",
                        "created": created,
                        "model":   model,
                        "choices": [{
                            "index":         0,
                            "delta":         delta,
                            "finish_reason": finish_reason
                        }]
                    }
                    yield f"data: {json.dumps(openai_chunk)}\n\n"
                    await asyncio.sleep(0)
            except Exception as e:
                err_chunk = {
                    "id": chunk_id, "object": "chat.completion.chunk",
                    "created": created, "model": model,
                    "choices": [{"index": 0, "delta": {"content": f"\n\n**Error:** {str(e)}"}, "finish_reason": "stop"}]
                }
                yield f"data: {json.dumps(err_chunk)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(openai_stream(), media_type="text/event-stream")
    else:
        try:
            response, _session_id, _parent_id = model_instance.generate(
                messages, settings, stream=False, token=token,
                session_id=session_id, parent_id=parent_id
            )
        except Exception as e:
            return JSONResponse({"error": {"message": str(e), "type": "api_error"}}, status_code=500)

        return JSONResponse({
            "id":      f"chatcmpl-{uuid.uuid4()}",
            "object":  "chat.completion",
            "created": int(time.time()),
            "model":   model,
            "session_id": _session_id,
            "parent_id": _parent_id,
            "choices": [{
                "index":   0,
                "message": {"role": "assistant", "content": response},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        })



# ---- CHAT ENDPOINTS ----

@app.get("/api/chat")
async def get_chats():
    return JSONResponse(db.get_all_conversations())

@app.post("/api/chat")
async def create_chat():
    conv = db.create_conversation()
    return JSONResponse(conv)

@app.get("/api/chat/{conv_id}")
async def get_chat(conv_id: str):
    conv = db.get_conversation(conv_id)
    if not conv:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(conv)

@app.delete("/api/chat/{conv_id}")
async def delete_chat(conv_id: str):
    log.info(f"[DELETE] Deleting conversation: {conv_id}")
    success = db.delete_conversation(conv_id)
    log.info(f"[DELETE] Result: {success}")
    return JSONResponse({"success": success})

@app.delete("/api/chat")
async def delete_all_chats():
    log.info("[DELETE] Deleting ALL conversations")
    conversations = db.get_all_conversations()
    for conv in conversations:
        db.delete_conversation(conv["id"])
    log.info(f"[DELETE] Deleted {len(conversations)} conversations")
    return JSONResponse({"success": True})

def parse_token(auth_header: str) -> str:
    if not auth_header:
        return None
    token = auth_header.replace("Bearer ", "").strip()
    if token.startswith("{"):
        try:
            import json
            data = json.loads(token)
            token = data.get("value", token)
            token = token.replace("Bearer ", "").strip()
        except:
            pass
    return token

@app.post("/api/chat/{conv_id}/message")
async def send_message(conv_id: str, request: Request):
    data = await request.json()
    message = data.get("message")
    settings = data.get("settings", {})
    
    token = parse_token(request.headers.get("Authorization", ""))
    
    # Add user message
    image_data_payload = settings.get("image_data")
    has_image = isinstance(image_data_payload, dict) and image_data_payload.get("base64")
    log.info(f"[MSG] conv={conv_id}, has_image={bool(has_image)}, "
             f"thinking={settings.get('thinking')}, search={settings.get('search')}, "
             f"vision={settings.get('vision')}, stream={data.get('stream')}")
    if has_image:
        log.info(f"[MSG] Image: filename={image_data_payload.get('filename')}, "
                 f"content_type={image_data_payload.get('content_type')}, "
                 f"base64_len={len(image_data_payload.get('base64', ''))}")
    
    image_data_str = image_data_payload.get("base64") if isinstance(image_data_payload, dict) else image_data_payload
    conv = db.add_message(conv_id, "user", message, image_data=image_data_str)
    if not conv:
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
    
    messages = conv["messages"]
    if data.get("system_prompt"):
        messages.insert(0, {"role": "system", "content": data.get("system_prompt")})
        
    # The frontend sends all flags inside the "settings" object.
    # Pull them out properly — do NOT overwrite with top-level data keys that don't exist.
    thinking = settings.get("thinking", False)
    search   = settings.get("search", False)
    vision   = settings.get("vision", False)
    image_data = settings.get("image_data", None)
    
    # Rebuild settings cleanly so model.generate() gets the right values
    settings = {
        "thinking": thinking,
        "search":   search,
        "vision":   vision,
        "image_data": image_data,
    }
    
    mode_label = "EXPERT" if (thinking and search and not vision) else "VISION" if vision else "INSTANT"
    log.info(f"[MSG] Mode={mode_label} (thinking={thinking}, search={search}, vision={vision})")
    
    stream = data.get("stream", True)
    
    if stream:
        async def stream_generator():
            full_text = ""
            full_thinking = ""
            search_results = []
            session_id = None
            current_api = None
            
            try:
                log.info(f"[STREAM] Starting generate: session={conv.get('ds_session_id')}, parent={conv.get('ds_parent_id')}")
                streamer, session_id, current_api = model_instance.generate(
                    messages, settings, stream=True, 
                    session_id=conv.get("ds_session_id"), 
                    parent_id=conv.get("ds_parent_id"),
                    token=token
                )
                chunk_count = 0
                for chunk in streamer:
                    chunk_count += 1
                    chunk_type = chunk.get("type")
                    finish = chunk.get("finish_reason")
                    content_len = len(chunk.get("content", ""))
                    
                    if chunk_type == "text":
                        full_text += chunk.get("content", "")
                    elif chunk_type == "thinking":
                        full_thinking += chunk.get("content", "")
                    elif chunk_type == "search":
                        res = chunk.get("search_results", [])
                        if isinstance(res, list):
                            search_results.extend(res)
                        else:
                            search_results.append(res)
                    
                    log.debug(f"[STREAM] chunk#{chunk_count}: type={chunk_type}, finish={finish}, content_len={content_len}")
                    
                    yield json.dumps({"chunk": chunk}) + "\n"
                    await asyncio.sleep(0)
                    if finish == "file_content_empty":
                        log.warning(f"[STREAM] file_content_empty received, stopping stream")
                        return
                log.info(f"[STREAM] Generator done. chunks={chunk_count}, text_len={len(full_text)}, think_len={len(full_thinking)}")
            except Exception as e:
                log.error(f"[STREAM] Error: {e}\n{traceback.format_exc()}")
                yield json.dumps({"chunk": {"type": "text", "content": f"\n\n**Error:** {str(e)}"}}) + "\n"
            finally:
                if full_text:
                    db.add_message(conv_id, "assistant", full_text, type="text", search_results=search_results)
                if full_thinking:
                    db.add_message(conv_id, "assistant", full_thinking, type="thinking")
                if session_id and current_api and hasattr(current_api, '_last_response_message_id'):
                    db.update_ds_meta(conv_id, session_id, current_api._last_response_message_id)
                
        return StreamingResponse(stream_generator(), media_type="application/x-ndjson")
    else:
        response, session_id, parent_id = model_instance.generate(
            messages, settings, stream=False,
            session_id=conv.get("ds_session_id"), 
            parent_id=conv.get("ds_parent_id")
        )
        db.add_message(conv_id, "assistant", response)
        db.update_ds_meta(conv_id, session_id, parent_id)
        return JSONResponse({"response": response})


# ---- PLAYGROUND ENDPOINTS ----

@app.post("/api/playground/run")
async def playground_run(request: Request):
    data = await request.json()
    system_prompt = data.get("system_prompt", "")
    user_prompt = data.get("user_prompt", "")
    settings = data.get("settings", {})
    stream = settings.get("stream", False)
    
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})
    
    if stream:
        async def stream_generator():
            streamer = model_instance.generate(messages, settings, stream=True)
            for chunk in streamer:
                yield json.dumps({"chunk": chunk}) + "\n"
                await asyncio.sleep(0)
        return StreamingResponse(stream_generator(), media_type="application/x-ndjson")
    else:
        response = model_instance.generate(messages, settings, stream=False)
        return JSONResponse({"response": response})

@app.post("/api/playground/analyze")
async def playground_analyze(request: Request):
    data = await request.json()
    action = data.get("action")
    text = data.get("text")
    settings = data.get("settings", {})
    
    prompt = prompts.get_analyzer_prompt(action, text)
    messages = [{"role": "user", "content": prompt}]
    
    response = model_instance.generate(messages, settings, stream=False)
    return JSONResponse({"response": response})

@app.post("/api/playground/extract")
async def playground_extract(request: Request):
    data = await request.json()
    text = data.get("text")
    fields = data.get("fields")
    settings = data.get("settings", {})
    
    prompt = prompts.get_extract_prompt(text, fields)
    messages = [{"role": "user", "content": prompt}]
    
    # Ideally use generate_json here if fields imply JSON structure, but text is fine too.
    response = model_instance.generate(messages, settings, stream=False)
    return JSONResponse({"response": response})

@app.post("/api/playground/classify")
async def playground_classify(request: Request):
    data = await request.json()
    text = data.get("text")
    categories = data.get("categories")
    settings = data.get("settings", {})
    
    prompt = prompts.get_classifier_prompt(text, categories)
    messages = [{"role": "user", "content": prompt}]
    
    response = model_instance.generate(messages, settings, stream=False)
    return JSONResponse({"response": response})

@app.post("/api/playground/json")
async def playground_json(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    settings = data.get("settings", {})
    
    messages = [{"role": "user", "content": prompt}]
    
    response = model_instance.generate_json(messages, settings)
    # Parse to ensure it's valid JSON
    try:
        json_obj = json.loads(response)
        return JSONResponse({"response": json.dumps(json_obj, indent=2)})
    except json.JSONDecodeError:
        return JSONResponse({"response": response, "error": "Model did not return valid JSON"})

@app.post("/api/playground/transform")
async def playground_transform(request: Request):
    data = await request.json()
    action = data.get("action")
    text = data.get("text")
    settings = data.get("settings", {})
    
    prompt = prompts.get_transformer_prompt(action, text)
    messages = [{"role": "user", "content": prompt}]
    
    response = model_instance.generate(messages, settings, stream=False)
    return JSONResponse({"response": response})

@app.post("/api/playground/compare")
async def playground_compare(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    config_a = data.get("configA", {})
    config_b = data.get("configB", {})
    
    messages = [{"role": "user", "content": prompt}]
    
    # Run sequentially for simplicity, or concurrently if actual model supports it
    response_a = model_instance.generate(messages, config_a, stream=False)
    response_b = model_instance.generate(messages, config_b, stream=False)
    
    return JSONResponse({"responseA": response_a, "responseB": response_b})

# ---- END OF API ROUTES ----


from pydantic import BaseModel
import wave
import io
import os
from fastapi.responses import Response

class TTSRequest(BaseModel):
    text: str
    voice: str = 'kusal-medium'

piper_voices = {}

def get_piper_voice(voice_id):
    if voice_id in piper_voices:
        return piper_voices[voice_id]
    try:
        from piper import PiperVoice
    except ImportError:
        return None
    mapping = {
        'kusal-medium': 'en_US-kusal-medium',
        'cori-medium': 'en_GB-cori-medium'
    }
    vid = mapping.get(voice_id, mapping['kusal-medium'])
    model_path = os.path.join(os.path.dirname(__file__), 'voices', vid, f'{vid}.onnx')
    if os.path.exists(model_path):
        voice = PiperVoice.load(model_path)
        piper_voices[voice_id] = voice
        return voice
    return None

@app.post('/api/tts')
async def text_to_speech(req: TTSRequest):
    voice = get_piper_voice(req.voice)
    if not voice:
        return JSONResponse({'error': 'Voice model not found'}, status_code=404)
    audio_stream = io.BytesIO()
    with wave.open(audio_stream, 'wb') as wav:
        voice.synthesize_wav(req.text, wav)
    audio_stream.seek(0)
    return Response(content=audio_stream.read(), media_type='audio/wav')

from fastapi import UploadFile, File
import backend.stt as stt

@app.post('/api/stt')
async def speech_to_text(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    filename = file.filename or "audio.webm"
    ext = os.path.splitext(filename)[1] or ".webm"
    text = stt.transcribe_audio(audio_bytes, file_ext=ext)
    return {"text": text}
