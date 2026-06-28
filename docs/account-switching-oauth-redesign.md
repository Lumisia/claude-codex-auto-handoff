# AI Handoff v2 — Claude/Codex 계정 전환 + OAuth 설계 정리

작성일: 2026-06-27  
상태: 설계 보강안  
대상: `ai-handoff` Rust CLI/TUI, daemon, optional Tauri GUI  
관련 기존 문서: `account-add-oauth-design.md`, `ai-handoff-v2-agent-skills-research-v3.md`

---

## 0. 결론

`OAuth로 계정 추가`와 `앱/CLI의 계정 전환`은 같은 문제가 아니다.

- **OAuth 로그인**은 새 계정의 인증 정보를 얻어 **credential slot**을 만드는 단계다.
- **계정 전환**은 Claude/Codex가 실제로 읽는 live credential을 바꾸거나, 특정 profile home으로 Claude/Codex를 새로 실행하는 단계다.
- 이미 실행 중인 Claude/Codex 앱, CLI, IDE extension이 credential 변경을 즉시 반영한다고 가정하면 안 된다.
- 안정적인 v2 설계는 **공식 CLI OAuth login으로 계정을 추가하고, ai-handoff가 credential profile vault를 관리하며, 전환 후에는 해당 agent를 재시작 또는 reload하도록 안내**하는 구조다.

권장 기본 정책:

```text
계정 추가:
  공식 CLI 로그인 사용
  Codex  -> codex login / codex login --device-auth
  Claude -> claude auth login

계정 저장:
  ai-handoff account vault에 credential snapshot 저장

계정 전환:
  1순위: profile home으로 새 프로세스 실행
  2순위: live credential 파일을 원자적으로 교체한 뒤 agent 재시작
  3순위: 앱 hot-switch는 공식 API가 확인되기 전까지 지원하지 않음

Business 계정:
  Codex는 ChatGPT Business 플랜에서 지원된다.
  단, workspace/admin policy, forced workspace, device-auth 허용 여부, SSO/MFA에 따라 전환 UX가 제한될 수 있다.
```

---

## 1. 기존 설계에서 유지할 것과 바꿀 것

업로드한 `account-add-oauth-design.md`의 핵심 방향은 맞다. 기존 문서는 `+ 계정 추가하기`를 현재 로그인 계정 스냅샷이 아니라 **공식 OAuth 로그인으로 새 계정을 인증해 추가**하는 방식으로 정의했고, 공식 CLI가 자격증명을 기록한 뒤 ai-handoff가 그 결과 파일을 account pool에 보관하는 구조를 제안했다.

유지할 것:

```text
- raw OAuth flow를 ai-handoff가 직접 재구현하지 않는다.
- 공식 CLI가 로그인하고 credential을 기록한다.
- ai-handoff는 결과 credential을 vault에 캡처한다.
- 전환/삭제는 credential slot 기반으로 관리한다.
- token은 agent transcript, log, skill, hook stdout에 절대 노출하지 않는다.
```

수정할 것:

```text
기존 문서:
  Claude 추가 = claude 실행 후 사용자가 /login 입력

보강안:
  Claude 추가 = claude auth login 우선 사용
  /login은 fallback 또는 interactive fallback으로만 사용
```

공식 Claude Code CLI reference에는 `claude auth login`, `claude auth logout`, `claude auth status`가 명시되어 있다. 따라서 TUI에서 Claude 계정 추가는 `claude` 세션 내부 `/login` 입력보다 `claude auth login`을 우선해야 한다.

또한 기존 문서에서는 Codex device-code 플래그명을 구현 시 재확인하라고 했는데, 공식 Codex authentication 문서 기준 headless login은 `codex login --device-auth`다. 따라서 문서와 구현에서는 `--device-auth`를 기본 이름으로 사용하고, 실제 실행 전 `codex login --help`로도 한 번 더 검증한다.

---

## 2. OAuth로 하면 Claude/Codex 앱도 바로 계정 전환되나?

### 짧은 답

**보장되지 않는다.** OAuth login은 credential을 생성하거나 갱신하는 절차이고, 이미 떠 있는 앱/CLI/IDE extension이 그 credential 변경을 즉시 다시 읽는지는 별도 문제다.

### 표면별 판단

| 대상 | OAuth login으로 credential 생성 | ai-handoff 전환 지원 가능성 | live app hot-switch | 권장 UX |
|---|---:|---:|---:|---|
| Codex CLI | 가능 | 높음 | 보장 안 됨 | profile로 새 CLI 실행 또는 전환 후 재시작 |
| Codex IDE extension | 가능, CLI와 cached login 공유 | 중간 | 보장 안 됨 | 전환 후 IDE extension reload 안내 |
| Codex desktop app | 가능성이 있으나 앱별 캐시 영향 | 중간/실험적 | 보장 안 됨 | 전환 후 app restart 또는 `codex app` 재실행 |
| Codex web/cloud | local credential swap과 별개 | 낮음 | 불가 | 브라우저/ChatGPT workspace에서 직접 전환 |
| Claude Code CLI | 가능 | 높음 | 보장 안 됨 | `CLAUDE_CONFIG_DIR` profile 실행 또는 live 전환 후 재시작 |
| Claude Desktop Code tab | 앱 auth/cache 영향 | 중간 | 보장 안 됨 | app menu sign out/in 또는 app restart 안내 |
| Claude web/mobile | local credential swap과 별개 | 낮음 | 불가 | 웹/앱에서 직접 전환 |

---

## 3. Codex 계정 전환 조사 정리

### 3.1 Codex 공식 로그인 방식

Codex는 크게 두 인증 방식을 지원한다.

1. ChatGPT 계정 로그인
2. OpenAI API key 기반 로그인

Codex app, CLI, IDE extension은 ChatGPT sign-in과 API key sign-in을 지원하고, Codex cloud는 ChatGPT sign-in이 필요하다. ChatGPT 로그인 시 Codex는 ChatGPT workspace 권한과 관리자 정책을 따른다. API key 사용 시에는 OpenAI Platform organization 기준의 billing, data sharing, retention 정책을 따른다.

Codex CLI의 기본 흐름은 유효한 session이 없으면 ChatGPT 로그인으로 유도하는 것이다. `codex login`은 ChatGPT OAuth, device auth, API key, stdin access token을 통한 인증을 지원한다.

### 3.2 Codex credential 위치

공식 문서 기준 Codex CLI/IDE extension은 login details를 cache하며, CLI와 IDE extension이 cached login details를 공유한다. file storage를 사용할 경우 credential은 기본적으로 `~/.codex/auth.json`에 저장된다. `CODEX_HOME`이 설정되면 그 아래 `auth.json`을 사용한다.

Codex credential store는 설정으로 선택할 수 있다.

```toml
cli_auth_credentials_store = "file"    # CODEX_HOME/auth.json
cli_auth_credentials_store = "keyring" # OS credential store
cli_auth_credentials_store = "auto"    # 기본 자동 선택
```

ai-handoff의 계정 vault 구현에서는 **capture/switch가 쉬운 file mode를 우선**으로 한다. keyring mode는 OS별 구현 복잡도가 높으므로 별도 phase로 둔다.

### 3.3 Codex 계정 추가 설계

권장 흐름:

```text
TUI Account 탭에서 [+ Codex 계정 추가]
  -> TUI suspend
  -> 임시 CODEX_HOME 생성
  -> 임시 CODEX_HOME/config.toml에 cli_auth_credentials_store = "file" 기록
  -> codex login 실행
     또는 headless 환경이면 codex login --device-auth 실행
  -> CODEX_HOME/auth.json 생성 확인
  -> id_token/account metadata 파싱
  -> vault에 slot 저장
  -> TUI resume
```

예시 내부 실행:

```bash
CODEX_HOME="$AI_HANDOFF_HOME/tmp/login/codex/<uuid>" codex login
```

headless fallback:

```bash
CODEX_HOME="$AI_HANDOFF_HOME/tmp/login/codex/<uuid>" codex login --device-auth
```

### 3.4 Codex 계정 전환 설계

Codex는 `~/.codex/auth.json` 하나를 live credential로 사용하는 구조가 가장 단순하다. 다만 사용자 환경에 따라 `CODEX_HOME`이나 OS credential store가 있을 수 있으므로 세 가지 mode를 둔다.

#### Mode A — launch profile, 권장

ai-handoff가 Codex를 직접 실행할 때만 특정 account slot을 적용한다.

```bash
ai-handoff account launch codex work -- codex
```

내부 실행:

```bash
CODEX_HOME="$AI_HANDOFF_HOME/profiles/codex/work" codex
```

장점:

```text
- 기본 ~/.codex를 덜 건드림
- 여러 계정 병렬 사용 가능성이 가장 높음
- 되돌리기 쉬움
```

단점:

```text
- 사용자가 그냥 codex를 실행하면 기본 계정이 뜸
- desktop app/IDE extension에는 바로 적용되지 않을 수 있음
```

#### Mode B — live switch, 전역 전환

vault slot의 `auth.json`을 live `~/.codex/auth.json`으로 원자적으로 복원한다.

```bash
ai-handoff account switch codex work --mode live
```

동작:

```text
1. 실행 중인 codex/codex app/IDE extension 감지
2. 실행 중이면 경고
3. 기존 ~/.codex/auth.json 백업
4. slot auth.json을 tmp에 쓰고 rename으로 교체
5. 사용자가 Codex CLI/app/IDE extension을 재시작하도록 안내
```

장점:

```text
- 사용자가 평소처럼 codex를 실행해도 전환된 계정 사용
```

단점:

```text
- 실행 중인 세션에서 race 가능
- IDE/app cache가 즉시 반영되지 않을 수 있음
```

#### Mode C — app launch, 실험적

Codex CLI reference에는 `codex app` 명령이 있고, macOS/Windows desktop app을 여는 용도다. 다만 app이 `CODEX_HOME`을 얼마나 안정적으로 존중하는지는 별도 검증이 필요하다.

```bash
ai-handoff account launch codex work --app
```

내부적으로는 다음을 시도할 수 있다.

```bash
CODEX_HOME="$AI_HANDOFF_HOME/profiles/codex/work" codex app
```

단, community 도구들도 Codex App integration은 official app/CLI 변화에 취약하다고 경고한다. 따라서 이 mode는 `experimental`로 표시한다.

---

## 4. Codex Business 계정 전환 가능 여부

### 결론

**가능한 방향으로 설계할 수 있다.** Codex는 ChatGPT Business 플랜에서 지원된다. 따라서 Business workspace에 속한 사용자가 `codex login`으로 로그인하면 Business account slot으로 저장할 수 있다.

다만 제한이 있다.

```text
- workspace admin이 login method를 제한할 수 있다.
- workspace admin이 특정 ChatGPT workspace ID를 강제할 수 있다.
- device auth는 workspace security settings에서 admin이 허용해야 할 수 있다.
- SAML SSO/MFA가 있으면 브라우저 OAuth 과정에서 사용자가 직접 인증해야 한다.
- 잘못된 workspace credential을 활성화하면 Codex가 logout/exit할 수 있다.
```

### Business 계정 slot metadata

Codex Business account slot에는 최소한 다음 metadata를 저장한다.

```json
{
  "agent": "codex",
  "label": "work-business",
  "kind": "chatgpt_oauth",
  "plan_hint": "business",
  "account_id": "...",
  "workspace_id": "...",
  "email": "user@company.com",
  "credential_store": "file",
  "created_at": "2026-06-27T00:00:00Z",
  "last_verified_at": "2026-06-27T00:00:00Z"
}
```

`workspace_id`는 token claim 또는 Codex status output에서 안전하게 얻을 수 있을 때만 저장한다. token payload 전체를 log에 남기면 안 된다.

### Business 전환 UX

TUI에서는 다음처럼 표시한다.

```text
Accounts > Codex

● personal        alice@gmail.com         ChatGPT Plus       active
○ work-business   alice@company.com       Business           workspace: acme
○ api-platform    sk-...                  API key            org: org_xxx

Enter switch · a add · d delete · v verify · o open docs
```

Business 전환 시:

```text
Switch Codex to work-business?

This account belongs to a ChatGPT Business workspace.
If your Codex config enforces a different workspace_id, Codex may log out or exit.
Running Codex sessions should be closed before switching.

[Switch for next launch] [Switch live now] [Cancel]
```

---

## 5. Claude 계정 전환 조사 정리

### 5.1 Claude 공식 로그인 방식

Claude Code는 개인 Claude.ai 계정, Teams/Enterprise 계정, Console 계정, Bedrock/Vertex/Foundry 같은 여러 인증 방식을 지원한다. 첫 실행 시 `claude`가 브라우저를 열어 OAuth 인증을 진행할 수 있고, CLI reference에는 별도 `claude auth login`, `claude auth logout`, `claude auth status` 명령이 있다.

Claude Code의 공식 CLI 명령:

```bash
claude auth login
claude auth logout
claude auth status
```

지원 옵션 예:

```bash
claude auth login --console
claude auth login --sso
claude auth login --email user@example.com
```

`claude setup-token`은 CI/scripts용 long-lived OAuth token을 생성하는 명령이고, token을 출력하지만 저장하지 않는다. 일반 interactive account switching의 기본 경로로 쓰지 않는다.

### 5.2 Claude credential 위치

공식 문서 기준:

| OS | 기본 credential 위치 |
|---|---|
| macOS | Keychain encrypted storage |
| Linux | `~/.claude/.credentials.json`, permission `0600` |
| Windows | `%USERPROFILE%\.claude\.credentials.json` |
| Linux/Windows with `CLAUDE_CONFIG_DIR` | `$CLAUDE_CONFIG_DIR/.credentials.json` |

또한 Claude Desktop은 CLI와 같은 underlying engine을 쓰고, `~/.claude.json`, `~/.claude/settings.json`, hooks, skills, project memory 등을 공유한다고 설명한다. 하지만 Desktop app의 auth session이 CLI credential file 변경을 즉시 반영한다고 보장하는 공식 문서는 확인하지 못했다.

### 5.3 Claude 계정 추가 설계

Linux/Windows 권장:

```bash
CLAUDE_CONFIG_DIR="$AI_HANDOFF_HOME/tmp/login/claude/<uuid>" claude auth login
```

옵션 pass-through:

```bash
ai-handoff account add claude --label work --sso
ai-handoff account add claude --label console --console
ai-handoff account add claude --label work --email user@company.com
```

내부 흐름:

```text
TUI suspend
  -> CLAUDE_CONFIG_DIR 임시 디렉터리 생성
  -> claude auth login 실행
  -> .credentials.json 생성 확인
  -> 필요한 경우 .claude.json/oauthAccount metadata 병합
  -> vault slot 저장
TUI resume
```

macOS 권장:

```text
MVP:
  공식 claude auth login 실행
  로그인 완료 후 현재 계정을 live slot으로 capture
  전환은 Keychain snapshot/restore를 별도 구현한 뒤 지원

Full support:
  macOS Keychain service entry를 읽고 쓰는 adapter 구현
  security CLI 또는 native Security framework 사용
```

macOS는 Keychain 때문에 `CLAUDE_CONFIG_DIR`만으로 완전한 account isolation이 되지 않을 수 있다. GitHub issue와 community 도구들은 Claude Code credential이 단일 Keychain entry에 저장되어 여러 계정 격리가 깨질 수 있음을 보고한다. 따라서 macOS Claude multi-account는 반드시 별도 검증이 필요하다.

### 5.4 Claude 계정 전환 설계

#### Mode A — launch profile, Linux/Windows 권장

```bash
ai-handoff account launch claude work -- claude
```

내부 실행:

```bash
CLAUDE_CONFIG_DIR="$AI_HANDOFF_HOME/profiles/claude/work" claude
```

장점:

```text
- Linux/Windows에서 가장 깨끗한 격리
- 여러 계정 병렬 사용 가능성이 높음
```

단점:

```text
- macOS Keychain에서는 추가 검증 필요
- 사용자가 그냥 claude를 실행하면 기본 계정 사용
```

#### Mode B — live switch

vault slot의 credential set을 live 위치로 복원한다.

```bash
ai-handoff account switch claude work --mode live
```

복원 대상:

```text
Linux/Windows:
  ~/.claude/.credentials.json
  ~/.claude.json 의 oauthAccount 필드만 수술적 갱신
  필요한 경우 ~/.claude/settings.json 일부

macOS:
  Keychain credential entry
  ~/.claude.json 의 oauthAccount 필드
```

주의:

```text
- ~/.claude.json 전체 교체 금지
- oauthAccount 같은 계정 metadata만 갱신
- 실행 중인 Claude Code/Claude Desktop이 있으면 restart 필요 안내
```

#### Mode C — Desktop app 지원

Claude Desktop은 macOS/Windows에서 사용 가능하고, CLI/Desktop이 settings, hooks, skills, project memory를 공유한다. 하지만 auth hot-switch 공식 API는 확인되지 않았다.

따라서 Desktop 지원은 다음 정책으로 제한한다.

```text
- ai-handoff는 credential slot을 전환할 수 있다.
- 이미 열린 Claude Desktop이 즉시 계정을 바꾸는 것은 보장하지 않는다.
- 전환 후 Claude Desktop restart 또는 app menu sign out/in을 안내한다.
- Desktop app의 Code tab 403 같은 문제는 공식 문서처럼 sign out/in을 안내한다.
```

---

## 6. OAuth 직접 구현 여부

### Codex

Codex OAuth를 직접 구현하는 것은 가능성이 있지만, 기본 전략으로 추천하지 않는다.

가능한 근거:

```text
- openai/codex 공식 구현에는 browser OAuth와 device auth flow가 있다.
- community cc-switch는 Codex device-code manager를 자체 구현한다.
```

하지만 기본 제품에서는 직접 구현하지 않는다.

이유:

```text
- OAuth client id, PKCE, token endpoint, refresh 정책을 계속 추적해야 한다.
- 공급자 변경에 취약하다.
- 보안 검증 부담이 커진다.
- 공식 CLI가 이미 검증된 flow를 제공한다.
```

정책:

```text
MVP:
  공식 CLI login subprocess 사용

Advanced:
  Codex device auth만 선택적으로 native 구현 가능
  단, official codex-rs source와 version compatibility check가 필요
```

### Claude

Claude OAuth는 직접 구현하지 않는다.

정책:

```text
- claude auth login 사용
- 필요 시 /login fallback
- setup-token은 CI/script credential용으로 별도 취급
- Keychain/file credential은 결과물로만 캡처
```

---

## 7. Account vault 구조

### 디렉터리

```text
<AI_HANDOFF_HOME>/accounts/
  codex/
    personal/
      account.json
      auth.json
    work-business/
      account.json
      auth.json
    api-platform/
      account.json
      auth.json 또는 env.json

  claude/
    personal/
      account.json
      .credentials.json
      claude-json-patch.json
    work-team/
      account.json
      .credentials.json
      claude-json-patch.json
```

### 권한

```text
Directory:
  Unix: 0700
  Windows: current user ACL only

Files:
  Unix: 0600
  Windows: current user ACL only
```

### `account.json` 예시

```json
{
  "schema_version": 1,
  "agent": "codex",
  "label": "work-business",
  "display_name": "Work Business",
  "email": "alice@company.com",
  "auth_kind": "chatgpt_oauth",
  "plan_hint": "business",
  "workspace_id": "ws_...",
  "credential_store": "file",
  "created_at": "2026-06-27T00:00:00Z",
  "last_verified_at": "2026-06-27T00:00:00Z",
  "source": "official-cli-login",
  "notes": []
}
```

절대 저장하지 말 것:

```text
- access_token value in logs
- refresh_token value in logs
- id_token raw value in logs
- auth.json 전체를 terminal preview로 출력
- agent prompt/capsule에 token 포함
```

---

## 8. CLI/TUI 명령 설계

### 기본 명령

```bash
ai-handoff account list
ai-handoff account add codex --label personal
ai-handoff account add codex --label work --device-auth
ai-handoff account add claude --label personal
ai-handoff account add claude --label work --sso
ai-handoff account switch codex work
ai-handoff account switch claude work
ai-handoff account launch codex work -- codex
ai-handoff account launch claude work -- claude
ai-handoff account status
ai-handoff account verify codex work
ai-handoff account remove codex work
ai-handoff account doctor
```

### JSON output

```bash
ai-handoff account list --json
ai-handoff account status --json
ai-handoff account verify codex work --json
```

### TUI Account 탭

```text
AI Handoff > Accounts

Agent   Active  Label           Email                Plan       Storage  Notes
Codex   ●       personal        alice@gmail.com      Plus       file     ok
Codex   ○       work-business   alice@company.com    Business   file     restart needed
Claude  ●       personal        alice@gmail.com      Max        file     ok
Claude  ○       work-team       alice@company.com    Team       file     mac keychain caveat

Keys:
  a add account
  s switch
  l launch with profile
  v verify
  d delete
  r repair
  ? help
```

### Switch confirmation

```text
Switch Codex to work-business?

Running Codex sessions detected:
  - codex pid 12345
  - Codex App pid 22345

Live switching can cause stale credential cache.
Recommended: close running sessions first.

[Set for next launch] [Switch live anyway] [Cancel]
```

---

## 9. Agent app/CLI별 실제 전환 정책

### Codex CLI

```text
지원 수준: strong
권장 방식: CODEX_HOME profile launch
전역 전환: auth.json live swap + restart
```

구현:

```bash
# profile launch
CODEX_HOME="$AI_HANDOFF_HOME/profiles/codex/work" codex

# live switch
cp slot/auth.json ~/.codex/auth.json.tmp
mv ~/.codex/auth.json.tmp ~/.codex/auth.json
```

### Codex IDE extension

```text
지원 수준: medium
공식 문서상 CLI와 IDE extension은 cached login details를 공유한다.
전환 후 extension reload 또는 IDE restart 필요 가능성이 높다.
```

TUI 문구:

```text
Codex IDE extension may need reload after account switch.
```

### Codex desktop app

```text
지원 수준: experimental
공식 CLI에 codex app 명령은 있지만, 계정 hot-switch API는 확인되지 않음.
```

정책:

```text
- 기본은 live switch 후 app restart 안내
- CODEX_HOME + codex app launch는 experimental flag에서만 제공
```

### Claude Code CLI

```text
지원 수준: strong on Linux/Windows
권장 방식: CLAUDE_CONFIG_DIR profile launch
전역 전환: .credentials.json live swap + ~/.claude.json oauthAccount patch + restart
```

### Claude Desktop

```text
지원 수준: medium
settings/hooks/skills/project memory는 CLI와 공유하지만, auth hot-switch는 공식 보장 없음.
```

정책:

```text
- live credential switch 후 Desktop restart 안내
- Desktop Code tab 403 또는 auth mismatch는 app menu sign out/in 안내
```

### Claude macOS Keychain

```text
지원 수준: MVP에서는 cautious
공식 문서상 macOS는 Keychain encrypted storage를 사용한다.
CLAUDE_CONFIG_DIR만으로 완전 분리된다고 가정하지 않는다.
```

정책:

```text
- macOS Claude account switching은 Keychain adapter 구현 후 stable 표시
- adapter 전에는 login/capture는 지원하되 live switch는 warning 표시
```

---

## 10. Business/Team/Enterprise 관련 정책

### Codex Business

Codex는 ChatGPT Business 플랜에서 지원된다. Business 플랜은 dedicated workspace, admin controls, SAML SSO, MFA, business data 미학습 기본값 같은 기능을 제공한다.

전환 시 고려할 점:

```text
- Business workspace SSO/MFA는 사용자가 직접 OAuth flow에서 처리한다.
- workspace admin이 device auth를 비활성화하면 --device-auth가 실패할 수 있다.
- managed config로 login method 또는 workspace id가 강제될 수 있다.
- 강제 workspace와 다른 account slot을 활성화하면 Codex가 logout/exit할 수 있다.
```

### Claude Team/Enterprise

Claude Code는 Team/Enterprise 계정 로그인을 지원한다. Team/Enterprise 사용자는 Claude.ai 계정으로 로그인하고, `/logout` 또는 `claude auth logout`으로 재인증할 수 있다.

전환 시 고려할 점:

```text
- SSO가 있으면 브라우저 기반 로그인 필요
- macOS Keychain 영향 큼
- Desktop app auth는 CLI file swap과 다르게 동작할 수 있음
```

---

## 11. 구현 단계

### Phase A — 문서/명령 재정리

```text
- Account 탭 용어 정리
  계정 불러오기 -> 계정 추가하기
  계정 전환 -> 활성 계정 변경
  profile launch -> 이 계정으로 실행

- Claude 경로 업데이트
  /login 우선이 아니라 claude auth login 우선

- Codex device flag 업데이트
  --device-code 추정 제거
  --device-auth 기준
```

### Phase B — Codex file-mode account vault

```text
- CODEX_HOME temp login
- cli_auth_credentials_store = "file" 강제
- codex login subprocess
- codex login --device-auth fallback
- auth.json capture
- account metadata 추출
- switch live
- launch profile
```

### Phase C — Claude Linux/Windows account vault

```text
- CLAUDE_CONFIG_DIR temp login
- claude auth login subprocess
- --sso/--console/--email pass-through
- .credentials.json capture
- ~/.claude.json oauthAccount patch 생성
- switch live
- launch profile
```

### Phase D — macOS Claude Keychain adapter

```text
- Keychain service discovery
- safe export/import
- slot encryption
- Desktop/CLI restart guard
- edge case tests
```

### Phase E — app integration

```text
- Codex App restart/launch support
- Claude Desktop restart guidance
- IDE extension reload guidance
- process detection
```

### Phase F — Business verification

```text
- Codex Business login test
- Business workspace SSO/MFA login test
- managed config forced workspace test
- device-auth disabled test
- Claude Team/Enterprise login test
```

---

## 12. Failure cases

| Failure | Cause | UX |
|---|---|---|
| OAuth canceled | user closed browser | no slot saved |
| auth file missing | CLI login failed or used keyring | show repair: force file mode or use keyring adapter |
| wrong account active | app cached old credential | restart/reload guidance |
| Business device auth failed | admin disabled device auth | browser login fallback |
| forced workspace mismatch | managed config policy | refuse switch or mark incompatible |
| macOS Claude slot not isolated | Keychain single entry | require keychain adapter or show unsupported |
| running sessions detected | live switch race risk | warn, offer next launch only |

---

## 13. Security rules

```text
1. ai-handoff never implements Claude OAuth flow directly.
2. Codex direct device auth implementation is optional advanced mode only.
3. Default account add uses official vendor CLI.
4. Credential files are stored under current-user-only permissions.
5. Vault entries are never shown in agent prompts, logs, capsules, or hook output.
6. Account switching is not exposed as an agent skill by default.
7. Account switching is CLI/TUI/GUI only.
8. Hooks must never switch accounts automatically.
9. Running sessions must be detected before live switch.
10. Business/Enterprise policies override ai-handoff preferences.
```

Why account switching should not be an agent skill:

```text
- It touches credentials.
- It can change billing/workspace context.
- It can invalidate active sessions.
- It should require explicit local user action in CLI/TUI/GUI.
```

Allowed agent-facing skill:

```text
handoff-profile
  Agent may request or suggest a target profile label for the next handoff.
  Agent must not read, switch, print, or modify credentials.
```

---

## 14. Final recommended UX

### Add Codex account

```bash
ai-handoff account add codex --label work-business
```

Output:

```text
Opening Codex OAuth login...
Login complete.
Saved account slot:
  Agent: Codex
  Label: work-business
  Email: alice@company.com
  Plan: Business

This account is not active yet.
Run:
  ai-handoff account switch codex work-business
or:
  ai-handoff account launch codex work-business -- codex
```

### Add Claude account

```bash
ai-handoff account add claude --label work-team --sso
```

Output:

```text
Opening Claude OAuth login...
Login complete.
Saved account slot:
  Agent: Claude
  Label: work-team
  Email: alice@company.com

This account is not active yet.
Run:
  ai-handoff account switch claude work-team
or:
  ai-handoff account launch claude work-team -- claude
```

### Switch account

```bash
ai-handoff account switch codex work-business
```

Output:

```text
Codex active account changed to work-business.
Restart Codex CLI/app/IDE extension for the change to take effect.
```

---

## 15. Sources checked

### Official Codex/OpenAI

- OpenAI Codex authentication docs: ChatGPT/API key auth, cached login, `~/.codex/auth.json`, credential store, device auth, enterprise access token, workspace restrictions.  
  https://developers.openai.com/codex/auth
- OpenAI Codex CLI reference: `codex login`, `codex logout`, `codex app`, `--profile`, command stability.  
  https://developers.openai.com/codex/cli/reference
- OpenAI Codex pricing: Codex included in Free/Go/Plus/Pro/Business/Edu/Enterprise; Business feature list.  
  https://developers.openai.com/codex/pricing
- OpenAI blog: Codex flexible pricing for teams and 2026-06-24 update that new Codex pay-as-you-go seats are no longer available for Business plans.  
  https://openai.com/index/codex-flexible-pricing-for-teams/
- OpenAI Codex GitHub README: install/sign-in overview and ChatGPT plan support.  
  https://github.com/openai/codex

### Official Claude/Anthropic

- Claude Code authentication docs: account types, `/logout`, credential locations, `CLAUDE_CONFIG_DIR`, macOS Keychain.  
  https://code.claude.com/docs/en/authentication
- Claude Code CLI reference: `claude auth login/logout/status`, `claude setup-token`.  
  https://code.claude.com/docs/en/cli-reference
- Claude Desktop docs: Desktop Code tab, CLI/Desktop shared config/project memory, sign out/in guidance.  
  https://support.anthropic.com/en/articles/12298533-using-claude-code-with-claude-for-desktop

### Community references, not authoritative

- `coding_agent_account_manager`: account backup/activate for Claude/Codex/Gemini.  
  https://github.com/Dicklesworthstone/coding_agent_account_manager
- `codex-account-switcher`: snapshots and restores Codex `auth.json`.  
  https://github.com/jakkow3/codex-account-switcher
- `cc-switch`: multi-provider account/session manager.  
  https://github.com/anthropics/claude-code/issues/70697
- Claude Code multi-account gist using `CLAUDE_CONFIG_DIR`.  
  https://gist.github.com/Zebiano/a1433c5bbd79f1553af113d78af1e3c6
- `ClaudeCodeMultiAccounts`: local Claude Code account switching via credential snapshots.  
  https://github.com/sanyueyu/ClaudeCodeMultiAccounts
- `codex-auth`: experimental Codex App support using `CODEX_HOME`/`CODEX_CLI_PATH`.  
  https://github.com/wojto/codex-auth
- `Codex-Multi-Account-Manager`: web UI/vault around Codex App/CLI account switching.  
  https://github.com/FoxSensei/Codex-Multi-Account-Manager

---

## 16. 최종 설계 문장

```text
AI Handoff account switching is not OAuth hot-switching.
It is official OAuth login + local credential slot management + safe profile activation.

Codex Business accounts are supported when the user can authenticate through ChatGPT OAuth,
but Business workspace policies may restrict device auth, login method, and workspace selection.

Claude/Codex app hot-switch is not guaranteed.
AI Handoff should switch credentials for the next launch and guide users to restart/reload apps.
```
