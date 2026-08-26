#!/bin/bash
# Chạy demo short-drama + phụ đề Việt. Không hardcode key trong server.js.
export API52_KEY="KeXgHY5fjRL8V2WLCHeFatULcG"

# --- Phụ đề tiếng Việt (Whisper + Gemini) ---
# Dán Gemini API key vào đây để bật dịch (lấy tại https://aistudio.google.com/apikey):
export GEMINI_API_KEY=""
export GEMINI_MODEL="gemini-2.0-flash"
# Model Whisper: tiny (nhanh, kém) | small (cân bằng) | medium/large-v3 (chuẩn, chậm)
export WHISPER_MODEL="small"

exec node server.js
