import io
import tempfile
import os

try:
    import static_ffmpeg
    static_ffmpeg.add_paths()
except Exception:
    pass

_whisper_model = None

def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
    return _whisper_model

def transcribe_audio(audio_bytes, file_ext=".webm"):
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        model = _get_whisper_model()
        segments, _ = model.transcribe(tmp_path, beam_size=1)
        text = " ".join(seg.text for seg in segments).strip()
        return text
    except Exception as e:
        print(f"Whisper STT Error: {e}")
        return ""
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except:
                pass
