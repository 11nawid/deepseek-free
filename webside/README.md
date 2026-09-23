# webside — DeepSeek Free frontend

Next.js 16 + React 19 + Tailwind CSS 4 UI for [DeepSeek Free](../README.md).

## Run it

```bash
npm install
npm run dev     # http://localhost:8180 (port set in package.json)
npm run build   # production build
npm start       # serve production build on :8180
npm run lint
```

> Normally you don't run this directly — `python main.py` (repo root) or
> Electron (`npm run dev` at root) starts the backend + this frontend together.

## Structure

```text
src/
├── app/
│   ├── page.tsx                 # main screen: chat, agent, voice, recorder entry
│   └── api/agent/               # Agent mode routes (tool-loop, sessions)
├── components/
│   ├── ScreenRecorder.tsx       # screen recorder: picker, preview, capture, save
│   ├── VoiceCallScreen.tsx      # voice call UI
│   ├── AgentWorkspacePanel.tsx  # agent activity + files
│   ├── PromptInput.tsx / Sidebar.tsx / Header.tsx / TitleBar.tsx / ...
├── hooks/
│   ├── useChat.ts               # chat backend (FastAPI :8000)
│   └── useAgent.ts              # agent backend (/api/agent)
└── lib/                         # i18n, theme, whisper helpers
```

## Environment

No secrets live in code. Auth token comes from the user at runtime
(Settings → Auth → `localStorage.apiKey`) or the backend's `.env`.
See the root [README](../README.md) and [SECURITY.md](../SECURITY.md).
