# Hyperframes Composition Brief: InvestWise

## Objective
Create a short launch-style brag video for InvestWise.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `D:\my project\Investwise_app_source_code\investwise_web_app`
- Primary files read: `README.md`, `APP_CONTEXT.md`, `app/globals.css`, `app/layout.tsx`, `tailwind.config.ts`, `app/page.tsx`
- Product name: InvestWise
- Tagline / strongest claim: "Every deposit. Every share. Accounted for." / "Enterprise Investment Management Platform"
- Key UI or visual moment to recreate: the dark ERP shell — left sidebar, hairline cards, KPI stat cards, compact table; the deposit desk; the dividend run result.
- Copy that must appear verbatim:
  - "InvestWise"
  - "Enterprise Investment Management Platform"
  - "Every deposit. Every share. Accounted for."
  - "Distributed", "Deposit saved" (toast strings matching the app's success keywords)

## Creative Direction
- Tone preset: polished
- Creative direction: quiet premium enterprise product film
- Interpretation: 3-4 scenes, longer holds, soft crossfades, restrained motion. No glitches, no confetti, no waveforms.
- Angle: InvestWise runs a real investment fund's money — the video shows the actual flow: dashboard → post deposit → dividend run.
- Hook: typed line "Every deposit. Every share. Accounted for."
- Outro / punchline: logo lockup + "Enterprise Investment Management Platform".
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign

## Visual Identity
- Background: oklch(0.155 0.02 265) (ink, ~#181b26)
- Card surface: oklch(0.205 0.025 265) (~#222636)
- Text: oklch(0.965 0.008 260) (~#f2f4f8)
- Accent: oklch(0.72 0.135 185) (bright teal, ~#3fd4c0)
- Muted text: oklch(0.72 0.022 250)
- Display font: Plus Jakarta Sans (local variable font in `public/fonts/`)
- Body font: Plus Jakarta Sans
- Visual references from the project: sidebar + hairline borders, status pills, compact tables, teal KPI numerals on dark cards, Skeleton of ERP shells (`components/dashboard`, `components/layout`).

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 3s — typed line "Every deposit. Every share. Accounted for." with teal caret on ink
2. Dashboard reveal — 6s — sidebar shell, 4 KPI stat cards arrive one by one, table rows cascade
3. Post a deposit — 6s — member/fund/month selects, amount "12,500.00", Save → "Deposit saved" toast → ledger row with reference number
4. Dividend run + outro — 5s — split preview rows, Confirm → "Distributed", then logo lockup

## Audio
- Audio role: warm bed with sparse professional accents
- Audio arc: quiet anticipation (typing ticks) → satisfying build (card drops) → decisive (click, toast drop) → payoff (bell on "Distributed") → calm logo settle.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: fade in over ~0.5s to volume ~0.35, hold, fade down under final logo.
- Music cue guidance: bundled preset `.agents/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (~110 BPM). Strong-cue locks: "Distributed" payoff → 17.47s; logo settle → 18.56s. Dashboard card arrivals snap to beat grid 4.39/4.91/5.34/6.00 (±0.10s). Mark these `// beat-locked` and `// beat-grid`.
- Audio-reactive treatment: subtle — use music RMS to gently breathe the teal accent glow / hero card presence. No waveform or equalizer visuals.
- Audio-coupled moments:
  - Hook typing — keyboard keypress ticks (randomized files)
  - Stat cards arriving — casino/card-place or interface/drop per card
  - Save click / toast — interface/click + drop
  - Dividend "Distributed" — impact/impactBell_heavy
  - Logo settle — soft impactSoft
- SFX selection guidance: sparse (5-7 cues total), low/medium high-frequency risk only, at 0.6-0.8 volume.
- SFX analysis guidance: `.agents/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes picks filenames, timestamps, and volumes to match the final animation.
- Audio files: music copied to `brag-output/composition/assets/music/`; SFX selected by Hyperframes copied under `brag-output/composition/assets/sfx/`.

## Hyperframes Instructions
- Requirements: show at least one real UI element/copy from the project (dashboard shell, deposit desk, dividend status). Keep text readable. 15-25s total. Music + SFX layer included. Treat brag audio notes as guidance. Honor music treatment. Use local assets. Run `hyperframes check` before render. Keep creation/rendering local.
