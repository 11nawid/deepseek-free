import json
def parse_token(auth_header: str) -> str:
    if not auth_header: return None
    token = auth_header.strip()
    if token.startswith('{'):
        try:
            data = json.loads(token)
            token = data.get('value', token)
        except: pass
    return token.replace('Bearer ', '').strip()
print(parse_token('Bearer {\
value\:\nN/C3n0RXJ2HEzFY2zXbQGimGp6Crvn9JL23fOseUbH2k0zX4cirUbqSvjVztwFS\,\__version\:\0\}'))
print(parse_token('{\
value\:\nN/C3n0RXJ2HEzFY2zXbQGimGp6Crvn9JL23fOseUbH2k0zX4cirUbqSvjVztwFS\,\__version\:\0\}'))
print(parse_token('{\
value\:\Bearer
nN/C3n0RXJ2HEzFY2zXbQGimGp6Crvn9JL23fOseUbH2k0zX4cirUbqSvjVztwFS\,\__version\:\0\}'))
