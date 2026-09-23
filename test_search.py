import warnings; warnings.filterwarnings('ignore')
from dsk.api import DeepSeekAPI
import os, json, pathlib
from dotenv import load_dotenv
load_dotenv(pathlib.Path(__file__).resolve().parent / '.env')
api = DeepSeekAPI(os.getenv('DEEPSEEK_AUTH_TOKEN'))
sid = api.create_chat_session()
resp = __import__('curl_cffi').requests.post(
    f'{api.BASE_URL}/chat/completion',
    headers=api._get_headers(pow_response=api.pow_solver.solve_challenge(api._get_pow_challenge())),
    json={'chat_session_id': sid,'parent_message_id':None,'prompt':'What is the current price of Bitcoin?','ref_file_ids':[],'thinking_enabled':False,'search_enabled':True},
    cookies=api.cookies, impersonate='chrome120', stream=True, timeout=None)
events=set(); paths=set()
for i,line in enumerate(resp.iter_lines()):
    if line.startswith(b'event: '):
        ev = line[7:].decode()
        events.add(ev)
        print(f'EVENT: {ev}')
    elif line.startswith(b'data: '):
        try:
            d=json.loads(line[6:])
            if 'p' in d:
                paths.add(d['p'])
                v = d.get('v','')
                vs = str(v)[:200]
                print(f'  PATH={d["p"]}  val_preview={vs}')
            elif 'content' in d:
                print(f'  STANDALONE content={str(d["content"])[:200]}')
            else:
                print(f'  keys={list(d.keys())}  preview={str(d)[:200]}')
        except:
            pass
    if b'FINISHED' in line:
        print('  >>> FINISHED')
        break
print()
print('ALL PATHS:', sorted(paths))
print('ALL EVENTS:', sorted(events))
