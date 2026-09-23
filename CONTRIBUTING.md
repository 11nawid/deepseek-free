# Contributing to DeepSeek Free

Thanks for stopping by! Contributions of all sizes are welcome — bug fixes, features, docs, themes, translations.

## Ground rules

1. **Never commit secrets.** No `.env`, no `dsk/cookies.json`, no `data/*.json`, no tokens in code or screenshots. Run `git status` before every commit.
2. Be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
3. One PR per focused change. Small PRs get merged faster.

## Dev setup

```bash
git clone https://github.com/11nawid/deepseek-free.git
cd deepseek-free
cp .env.example .env            # add your DEEPSEEK_AUTH_TOKEN
cp dsk/cookies.example.json dsk/cookies.json

python -m venv .venv
.venv/Scripts/activate          # or: source .venv/bin/activate
pip install -r requirements.txt
cd webside && npm install && cd ..

python main.py                  # full stack: backend :8000 + frontend :8180
```

Or the Electron shell from the repo root:

```bash
npm install
npm run dev
```

## Branch & commit style

- Branch: `feature/screen-recorder-4k` / `fix/stt-empty-result` / `docs/readme-badges`
- Commits: short, imperative — `fix: stop timer leak in recorder`, `feat: add 4K preset`
- Frontend lives in `webside/`, backend in `backend/`, desktop shell is `electron-app.js` + `preload.js`.

## Pull requests

- [ ] Describe what changed and why
- [ ] Include a screenshot or clip for UI changes
- [ ] `git status` is clean of secrets (`.env`, cookies, `data/*.json`)
- [ ] Existing checks pass (`npm run lint` in `webside/`, backend imports cleanly)

## Good first issues

Look for the `good first issue` label — recorder presets, theme polish, Linux packaging tests, and docs are great starting points.
