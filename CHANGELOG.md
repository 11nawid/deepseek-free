# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v1.1.0] — 2026-09-23

### Added
- 🔴 **Screen Recorder**: window/screen picker with live thumbnails, live preview,
  Record / Pause / Resume / Stop, quality presets (720p / 1080p / 4K),
  system-audio + mic toggles, review playback, and save to
  `Videos/deepseek-free-recording/<random>.mp4` (Quick save + Save as… + Show in folder).
- Recorder auto-minimizes to a draggable floating pill with timer while capturing;
  closing the panel mid-capture minimizes instead of stopping the recording.
- Electron IPC: `screen-get-sources`, `screen-get-default-path`,
  `screen-save-dialog`, `screen-save-file`, `screen-open-folder`.
- README demo video + screenshots, badges, star history, topics.

### Fixed
- Recorder icons now use `lucide-react` (reliable rendering).
- Stream re-attaches to preview when un-minimizing; live size readout while recording.

## [v1.0.0] — Initial public release

- Electron desktop shell + Next.js UI + FastAPI backend + free DeepSeek (`dsk/`) wrapper.
- Chat modes (Instant / Expert / Vision), Agent mode with 8 filesystem tools,
  voice calls with local TTS/STT.
- Secrets scrubbed; `.env.example` + `cookies.example.json` publish flow.

[v1.1.0]: https://github.com/11nawid/deepseek-free/releases/tag/v1.1.0
[v1.0.0]: https://github.com/11nawid/deepseek-free/releases/tag/v1.0.0
