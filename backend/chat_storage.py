import json
import os
import uuid
from datetime import datetime

DATA_FILE = "data/conversations.json"

def _load_data():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}

def _save_data(data):
    os.makedirs(os.path.dirname(DATA_FILE) or ".", exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

def get_all_conversations():
    data = _load_data()
    # Return list of summaries (id, title, updated_at) sorted by updated_at descending
    convos = []
    for cid, conv in data.items():
        convos.append({
            "id": cid,
            "title": conv.get("title", "New Chat"),
            "updated_at": conv.get("updated_at", "")
        })
    convos.sort(key=lambda x: x["updated_at"], reverse=True)
    return convos

def get_conversation(conv_id):
    data = _load_data()
    return data.get(conv_id)

def create_conversation(title="New Chat"):
    data = _load_data()
    conv_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    data[conv_id] = {
        "id": conv_id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "messages": [],
        "ds_session_id": None,
        "ds_parent_id": None
    }
    _save_data(data)
    return data[conv_id]

def update_ds_meta(conv_id, session_id, parent_id):
    data = _load_data()
    if conv_id in data:
        data[conv_id]["ds_session_id"] = session_id
        data[conv_id]["ds_parent_id"] = parent_id
        _save_data(data)

def add_message(conv_id, role, content, type="text", search_results=None, image_data=None):
    data = _load_data()
    if conv_id not in data:
        return None
    msg = {
        "role": role,
        "content": content,
        "type": type,
        "timestamp": datetime.now().isoformat()
    }
    if search_results:
        msg["search_results"] = search_results
    if image_data:
        msg["image"] = image_data
    data[conv_id]["messages"].append(msg)
    data[conv_id]["updated_at"] = datetime.now().isoformat()
    
    # Auto-generate title if it's the first user message and title is "New Chat"
    if len(data[conv_id]["messages"]) == 1 and role == "user":
        # simple title generation (first 30 chars)
        title = content[:30] + ("..." if len(content) > 30 else "")
        data[conv_id]["title"] = title
        
    _save_data(data)
    return data[conv_id]

def delete_conversation(conv_id):
    data = _load_data()
    if conv_id in data:
        del data[conv_id]
        _save_data(data)
        return True
    return False

def update_title(conv_id, title):
    data = _load_data()
    if conv_id in data:
        data[conv_id]["title"] = title
        data[conv_id]["updated_at"] = datetime.now().isoformat()
        _save_data(data)
        return True
    return False
