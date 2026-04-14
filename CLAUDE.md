# RemoteCamera

## Project
Web app that turns old phones into live surveillance cameras (school project).

## Stack
- **Phone client**: Vanilla JS, WebRTC (`getUserMedia`), runs in mobile browser
- **Server**: Node.js, Express, WebSocket (`ws` package)
- **Dashboard**: React (Vite) or Vanilla JS
- **Signaling**: WebSocket over local network

## Repo Layout

## Conventions
- Use ES modules (`import/export`), not CommonJS
- Async/await over callbacks
- No TypeScript for v1 (keep it simple)
- All ports configurable via `.env`

## Agents
- `phone-client-agent` — owns /client (camera capture, WebRTC, mobile UI)
- `server-agent` — owns /server (Express, WebSocket signaling, camera registry)
- `dashboard-agent` — owns /dashboard (stream viewer, camera grid UI; uses ui-ux-pro-max)
- `test-agent` — owns /server/test (TDD signaling tests; uses test-driven-development)

## 하네스: RemoteCamera

**목표:** 3개 에이전트(server/client/dashboard)를 조율하여 LAN WebRTC 카메라 앱을 빌드한다.

**트리거:** RemoteCamera 구현/수정 작업 시 `remotecamera-orchestrator` 스킬을 사용하라. 단순 질문은 직접 응답 가능.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-04-13 | 초기 구성 | 전체 | - |
| 2026-04-13 | test-agent 추가, dashboard-agent에 ui-ux-pro-max 연결 | agents/, skills/ | 사용자 요청 |

## Key Constraints
- Must work on LAN without internet
- Phone client must work in mobile Safari + Chrome with no install
- Keep dependencies minimal