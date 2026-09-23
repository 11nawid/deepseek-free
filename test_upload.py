import os, json
from dotenv import load_dotenv
load_dotenv()
from dsk.api import DeepSeekAPI
api = DeepSeekAPI(os.getenv('DEEPSEEK_AUTH_TOKEN'))
def my_pow():
  res = api._make_request('POST', '/chat/create_pow_challenge', {'target_path': '/api/v0/file/upload_file'})
  return res['data']['biz_data']['challenge']

import uuid
boundary = uuid.uuid4().hex
body = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--{boundary}--\r\n'.encode('utf-8')
headers = api._get_headers(api.pow_solver.solve_challenge(my_pow()))
headers['content-type'] = f'multipart/form-data; boundary={boundary}'
from curl_cffi import requests
res = requests.post('https://chat.deepseek.com/api/v0/file/upload_file', headers=headers, cookies=api.cookies, impersonate='chrome120', data=body)
print(res.status_code, res.text)
