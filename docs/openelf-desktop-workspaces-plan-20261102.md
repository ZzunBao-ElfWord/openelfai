# OpenElf desktop workspace redesign proposal

Status: proposed product and engineering structure; not implemented or deployed.

## Product goal

Users describe a goal through OpenElf. A lightweight coordinator proposes a plan and chooses allowed model/tool capabilities. OpenElf executes the task, delivers editable artifacts, and lets the user explicitly publish chosen artifacts on the platform. Ordinary questions do not require an AI character or a publication.

## Current implementation findings

- `app/lib/widgets/workbench_panel.dart`: `_dispatch` currently opens CharacterStudioPage or CreatePostSheet. Its default path also opens CreatePostSheet. This is a creation launcher, not a persistent task conversation.
- `app/lib/pages/home_shell.dart`: the existing Create navigation opens CreateElfPage (AI character creation). Preserve this workflow, including existing minting rules, but give it an explicit destination under My AI.
- `app/lib/pages/create_post_sheet.dart`: existing skill-based creation UI can supply adapters during migration.
- `app/lib/state/app_state.dart`: manualPost and uploadAiVideo connect to existing publication operations. Do not claim these are a private draft pipeline. Split generation and publication before enabling the new creation workflow.
- `app/lib/pages/generator_works_page.dart`: the generator gallery/mine is a specific artifact collection, not a complete cross-media library.

## Proposed navigation

Work: Conversation, Creative Studio, My Works, Publish Management.

Platform: World, Videos, Discover.

Resources: My AI, Skills and Tools. Wallet, account and settings remain accessible in the account area.

Conversation owns goal clarification and general task execution. Creative Studio offers guided text/image/video workflows backed by the same task service. My Works holds private outputs, uploaded assets and versions. Publish Management prepares titles/covers/attribution, shows actual moderation and publication states, and links to published works.

My AI owns character creation, management and the existing minting flow. Skills and Tools lists actual connected capabilities. Do not create inactive controls that appear available.

If multiple task tabs are requested, they belong inside Conversation and Creative Studio, not separate native application windows. Each tab references a stable task ID. Closing a tab does not cancel execution or delete content. Cancelling a running task is a separate explicit action. Backend task history is authoritative across devices.

## Content-area layout

Left: grouped workspace navigation and recent tasks. Main: task tabs (if selected), conversation or editor, input. Optional collapsible right panel: plan, step status, generated artifact preview and actual cost summary. Allow the main editor to expand when the panel is collapsed. Preserve readable text and responsive scrolling.

## Shared data and services

- Task: owner, goal, messages, plan, steps, status, budget reservation, actual usage and artifact references.
- Artifact: owner, type, task/source reference, storage reference, versions and AI provenance. Private by default.
- Publication: artifact version, selected AI identity when required, title/caption/cover, moderation status and platform post reference.
- Model capability catalog: supported modalities, tools, context limits, prices and health; server owns the allowlist.
- Idempotent operations for task creation, step execution, publication and ledger settlement.

Keep task execution state separate from publication/moderation state. A failed publication must not erase a successful generation. Model output cannot authorize spending, bypass login, select arbitrary endpoints or publish by itself.

## Delivery order

1. Navigation and workspace shell: preserve existing destinations and login/credit access; distinguish general conversation from character creation. UI-only preview must not advertise real orchestration before it exists.
2. Text task vertical slice: persistent conversation, bounded execution, one real configured provider, progress, cancel/failure handling, private artifact save and existing ledger integration.
3. Artifact editing and explicit platform publication: version selected output; connect real moderation/publication endpoints; verify ownership.
4. Lightweight coordinator and model selection: compare rules-only baseline with small-model decisions on representative Chinese tasks; validate tool arguments, budget limits, fallback and execution loops.
5. Image/video workflows and optional task tabs: use the same task/artifact contracts, check restart recovery, concurrent ownership, upload limits and repeated-submit behavior.

## Acceptance boundaries

- Ordinary Conversation works without creating an AI character.
- New generated outputs stay private until the user publishes a selected version.
- A user can leave a task and return without losing drafts or execution status.
- Retrying or reconnecting cannot duplicate posts or charges.
- Publishing under an AI preserves current ownership and attribution requirements.
- Existing payment, CAPTCHA, character/minting, platform feeds and single-instance behavior remain available.
- Small-model routing and generation are shown as implemented only after real end-to-end verification, not because navigation and mock states render.

Pending user preference: left workspace entries only, or workspace entries plus multiple in-app task tabs. Suggested default: workspace entries with a tab-ready task model; show tabs once persistence is implemented.
