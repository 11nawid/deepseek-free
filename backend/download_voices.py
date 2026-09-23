import os
import urllib.request

VOICES = {
    'kusal-medium': 'en_US-kusal-medium',
    'cori-medium': 'en_GB-cori-medium'
}

BASE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en'

def download_voice(voice_id):
    parts = voice_id.split('-')
    lang = parts[0]
    name = parts[1]
    quality = parts[2]
    url_base = f'{BASE_URL}/{lang}/{name}/{quality}/{voice_id}'
    os.makedirs(f'voices/{voice_id}', exist_ok=True)
    onnx_url = f'{url_base}.onnx'
    onnx_path = f'voices/{voice_id}/{voice_id}.onnx'
    if not os.path.exists(onnx_path):
        print(f'Downloading {onnx_url}...')
        urllib.request.urlretrieve(onnx_url, onnx_path)
    json_url = f'{url_base}.onnx.json'
    json_path = f'voices/{voice_id}/{voice_id}.onnx.json'
    if not os.path.exists(json_path):
        print(f'Downloading {json_url}...')
        urllib.request.urlretrieve(json_url, json_path)

if __name__ == '__main__':
    for v in VOICES.values():
        download_voice(v)
    print('Done!')
