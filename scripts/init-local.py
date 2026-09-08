from pathlib import Path
import secrets
root = Path(__file__).resolve().parents[1]
target = root / 'deploy/local/.env'
if target.exists():
    raise SystemExit('deploy/local/.env already exists; leaving it unchanged.')
text = (target.parent / '.env.example').read_text()
text = text.replace('replace-with-random-password', secrets.token_hex(24))
text = text.replace('replace-with-at-least-32-random-characters', secrets.token_hex(32), 1)
text = text.replace('replace-with-at-least-32-random-characters', secrets.token_hex(32), 1)
target.write_text(text)
target.chmod(0o600)
print('Created deploy/local/.env with fresh secrets.')
