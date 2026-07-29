# Progress — Phân tích tài khoản (feat/account-analysis)

Plan: docs/superpowers/plans/2026-07-24-phan-tich-tai-khoan.md
Execution: subagent-driven, LOCAL edit+test+commit only; controller deploys at 2 checkpoints.

Task 0: complete (env setup, test script) — commit cb6fad8
Task 1: complete (engagementRate + filterAccountVideos) — commits cb6fad8..7008cd9, review clean (1 Important fixed: keep video when createTime unknown)
Task 2: next
Task 2: complete (normalizeAccountInput) — commit b0a18fe, review clean (nits only)
Task 3: complete (resolveAccount + ApiGet) — commit ca304c3, review clean (minors only)
Task 4: complete (fetchAccountVideos) — commit 4589442, review clean. MODULE account.ts DONE (23/23 tests).
Task 5: complete (db.ts migration cột account) — controller edit, verify at Checkpoint A (PRAGMA)
Task 6: complete (runAccountJob + routes search/job/create) — commit 9a66705, review clean, tsc clean
Task 7: complete (finalize account + synthesize route + cohort GET synthesis) — commit 8c6b40e, review clean, no campaign/ads regression
Task 8: complete (resumeSearchJobs account branch) — commit d68d7e5, review clean. BACKEND COMPLETE (5-8).
Next: CHECKPOINT A (deploy backend + verify).
CHECKPOINT A: DONE — deployed backend (rsync 4 files + docker rebuild). Migration applied (5 cols + synthesis). Startup clean. TikTok resolve+fetch+filter validated LIVE in container. Douyin fetch-shape to validate at Checkpoint B (real link). DB backed up: db.sqlite.bak-preaccount-20260724-175443.
Task 9: complete (frontend types + client API) — commit 92ca7b3, review clean
Task 10: complete (AccountView tab in App.tsx) — commit 303363e, review SPEC ✅ Approved, vite+tsc clean.
  MINOR (for final review triage): (a) AccountView doesn't persist searching job across reload like CampaignView (localStorage); (b) count/cap not clamped client-side (server clamps). Non-blocking.
Next: CHECKPOINT B (deploy frontend + E2E).
CHECKPOINT B: DONE — deployed frontend (App.tsx/types.ts/lib/api.ts) + rebuild. Container Up, HTTP 200, bundle contains account tab. Fixed a deploy bug: rsync mis-placed src/lib/api.ts as src/api.ts → corrected + removed stray + rebuilt.
Douyin fetch-shape: still to validate via a REAL Douyin account link (UI E2E by user). TikTok fully validated live.
Next: final whole-branch review.
FINAL REVIEW (opus, whole-branch): 1 Important (account jobs leak into Campaign job list) — FIXED (commit 24b7be4, kind filter on /api/campaign/jobs) + redeployed. Minors #2-5 accepted non-blocking (logged/pre-existing/UX). Verdict now: clean.
BUGFIX (E2E, systematic-debugging): fetchAccountVideos chỉ lấy 10 video. Root cause: tokapi TikTok posts phân trang qua offset=<max_cursor trước>, không phải param max_cursor. Fix TikTok path dùng offset (Douyin giữ max_cursor). Test cập nhật 23/23. Live verify: @tintinunin → 100 video. Commit ab4a2ad, deployed.
BUGFIX 2 (E2E): "Vì sao tài khoản thành công" kẹt 52/55. Root cause: nút synthesis gated doneCount===totalCount, nhưng 3 video failed → completed(52)<total(55) mãi mãi. Fix: gating theo settled (no pending/processing) + ≥2 completed; failed bỏ qua. Commit 24500cc local / 5a09681 server, deployed.

---

# Progress — Mac Render Farm 247drama (feat/mac-render-farm)

Plan: docs/superpowers/plans/2026-07-27-mac-render-farm-247drama.md
Execution: subagent-driven. Implementers do code + offline unit tests + commit.
Controller runs live-ops checkpoints (BINGNET drive, HK proxy, prod Mongo/uploads, 52api, server restart) with user confirmation for impactful steps.
Vendored verbatim from server (out of review scope): util/*.js, models/*.model.js, scripts/ocr_subs.py, types/constant.js.
Task 1: complete (commit ca3171e, review clean — Approved, no issues)
Task 2: complete (controller ops). ffmpeg 8.1.2+ffprobe via brew (arm64, first on PATH); OCR venv on python 3.12.13 (rapidocr 1.4.4 + onnxruntime 1.28) — OCR verified on sample clip; BINGNET dirs created+writable; HK tunnel script committed, SOCKS exits 47.76.79.169. NOTE: rapidocr needs python<3.13 → used brew python@3.12 (plan said 3.13 fallback, actual trigger was rapidocr not onnxruntime). NOTE: ops/hk-tunnel.sh hand-written, defer to final review.
Task 3: complete (commit b2e894f, test 2/2). Implementer agent cut off by API error mid-report but work landed; controller verified directly: config.js byte-matches brief, buildFilename/buildVideoUrl/buildSubtitleConfig correct, .env created by controller (Mongo secret, gitignored, mongoUri loads). Review = controller direct verification (55 lines plan-verbatim).
Task 4: complete (commit d697428, unit 2/2). Live checkpoint PASSED: findPendingWork against prod → 6 phim, 447 tập thiếu (Trở về 90 17/34, Trọng Sinh 12/76, Tam Sinh 80/80, Người hầu 81/81, Mười mấy năm 74/74, Xuyên không 2000 183/183). loadSettings injects ocrThreads=3. db.js/work.js/computeMissingEpisodes proven end-to-end.
PLAN FIX before Task 5: render.js FREE_LIMIT was module-load (=1, wrong) → moved to call-time freeLimit inside renderEpisode (=6). Edited plan doc.
Task 5: render.js committed (5dadbde), loads OK. Live checkpoint EXPOSED ENV BUG (not code): first render returned sub=none because brew-core ffmpeg 8.1.2 ships WITHOUT libass (no subtitles/ass filter). OCR (found Chinese lines) + translate + venv all verified working; only the burn step failed. FIX: uninstall core ffmpeg, install homebrew-ffmpeg/ffmpeg/ffmpeg (has libass+fontconfig+freetype+ffprobe) — building in background. render.js code UNCHANGED (correct). Will re-run live checkpoint after ffmpeg install. Task 2 env note: plan's "brew reinstall ffmpeg" is insufficient — needs the homebrew-ffmpeg tap for libass.
Task 5: complete. Live checkpoint PASSED after ffmpeg-libass fix: sub=vi 39 câu, frame verified (CN "宋家于我有恩" + VI "Nhà Tống có ơn với tôi." aligned), file on server, record shape correct (videoUrl/coin/isLocked/subLang/duration). Deleted 1 bad sub=none record (from pre-libass run) for re-render. Review (sonnet): Important finding = hg-only codec guard → broadened to all providers (fix commit). Minors: rsync password quoting fragility (current pw safe, noted), output file not cleaned on failure (benign). render.js loads OK post-fix. Commits d697428..5dadbde + fix.
Task 6: worker.js committed (2cfb496), syntax OK. Loop verification folded into Task 8 real run (loop is trivial p-limit over proven renderEpisode).
Task 7: complete (controller ops, user-confirmed restart). TWO PROD-CRITICAL FIXES found via live checkpoint:
  (1) rsync -a preserved Mac mode 700 -> nginx www-data 403 -> ALL Mac renders unplayable. FIX: rsync --chmod=F644 (commit b6d4300). Re-chmod'd existing.
  (2) importConcurrency=0 is a NO-OP (getImportConcurrency n||1 ->1). Real disable = block 52api DNS on server via /etc/hosts (reversible; Mac unaffected). disable-server-pipeline.sh rewritten to hosts-block. Server now 0 OCR procs, load 0.5, app streams 200.
  Also self-inflicted: `find -user 501 chmod 644` hit the uploads DIR -> stripped x -> whole /uploads 403 for ~2min; restored dir to 755. Lesson: chmod files only (-type f).
Task 8: full backlog run LAUNCHED background (PID 132, concurrency 4), log on BINGNET. Verifying loop start via wait-loop.
FINAL REVIEW (opus, whole-branch a64799e..HEAD): verdict "needs fixes"; core render/upsert/idempotency/concurrency confirmed CORRECT.
Fixes applied (commits f01912d, 7657942):
  - Critical#1 secrets: ops scripts now read HK/SERVER passwords from gitignored .env (added HK_PASSWORD/HK_HOST); redacted plan doc. RESIDUAL: passwords still in EARLIER commits' history (23eefe3, b6d4300) + branch is LOCAL/unpushed → user decision on history-scrub + rotation.
  - Important#2 mkdir fail-fast: reviewer's mkdir suggestion was flawed (mkdir -p succeeds on main disk if BINGNET unmounted → would write to 91%-full disk). Implemented st_dev mount check instead.
  - Important#3 output cleanup: delete burned output from BINGNET after successful upsert (keep raw download per keepOriginal).
  - Minor#4 sourceEpisodeCount hoisted to once-per-movie.
  - Minor#5 subSource: NOT a fix — server sample also leaves subSource:"" so worker already matches.
Running worker (PID 132) uses pre-fix in-memory code (fine); fixes take effect next run.
Task 8 backlog still rendering. Waiting on completion + doing acceptance after.
BUGFIX (Task 8, systematic): first full run (PID 132) upserted 0/439 — rsync --chmod=F644 is INVALID on macOS openrsync (protocol 29) → "invalid argument", every episode failed AT rsync after wasting download+OCR+translate (Gemini quota). 17 failed before kill. Root cause: --chmod fix (b6d4300) reasoned but never single-episode-tested before full launch.
FIX (commit 7ace9aa): rsync -t (transfer only) + explicit `ssh chmod 644` after copy (exFAT source has fake 700 mode → nginx 403 without it). Single hm episode verified → HTTP 200, -rw-r--r--. Broken-run episodes weren't upserted so they just re-render (no orphan records/files).
Relaunched full run (PID 2609). Confirming first upserts at scale.
Task 8 relaunch (PID 2609): CONFIRMED healthy at scale — 8 ok / 0 fail / 0 sub=none, all sub=vi. rsync -t + ssh chmod fix works.
User Q resolved: "2 tập chưa dịch trong output" = stale scratch leftovers (hg_ep1 pre-libass no-sub render + broken-run files), NOT in Mongo/app. Cleaned hg leftovers. Output self-cleans (new code deletes after upsert). Watching for any sub=none during run.
FEATURE (user request): realtime render dashboard. status.js (per-episode phase tải/sub/upload + per-movie/overall counters, ETA, throughput) pushed to server /uploads/render-status.json every 3s via ssh; render-status.html (nginx static) polls every 2s. render.js/worker.js instrumented. No server code changes. Commit 340f350. Worker restarted (PID 5387) to activate. Dashboard: http://103.179.185.196/uploads/render-status.html
DECISION (user): "để nguyên" — giữ mật khẩu root trong lịch sử git nhánh feat/mac-render-farm, KHÔNG scrub history, KHÔNG đổi mật khẩu. Final-review Critical#1 = resolved-by-acceptance (repo local, chưa push). CẢNH BÁO: không push/chia sẻ nhánh này ra remote công khai (root creds trong history 23eefe3/b6d4300 + plan doc cũ).
BUGFIX 3 (E2E): Douyin account fail. Root cause: fetch_user_post_videos ~1MB gzip/chunked đôi khi (a) control char thô, (b) truncate tạm thời -> JSON.parse ném -> hỏng cả job. Fix: parseJsonLenient + retry 3x/trang + break giữ video đã lấy. Verify live 22-42 video. Commit 88bd255/server 9fa5a87.
BUGFIX 4 (E2E): lịch sử toàn "Hôm nay". Root cause: history.date hardcode "Hôm nay"/"Vừa xong". Fix: nowVN() (dd/mm/yyyy HH:mm) khi insert + backfill phiếu cụm từ ads_cohorts.created. Phiếu single cũ giữ placeholder (mất nguồn ngày). Commit 5146f09/server. Prod: ~295 phiếu có ngày thật, 637 single cũ giữ placeholder.
