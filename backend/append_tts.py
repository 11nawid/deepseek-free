with open('api.py', 'a') as f:
    f.write('''

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
    model_path = os.path.join('voices', vid, f'{vid}.onnx')
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
        voice.synthesize(req.text, wav)
    audio_stream.seek(0)
    return Response(content=audio_stream.read(), media_type='audio/wav')
''')
