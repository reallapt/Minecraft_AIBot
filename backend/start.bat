@echo off
chcp 65001 >nul
title MC Bot Controller - 一键启动（新版 AI 控制面）
cd /d "%~dp0"

echo ============================================
echo    MC Bot Controller 一键启动脚本
echo    Backend(AI控制面) + Ollama (qwen3:8b)
echo ============================================
echo.

rem ---------------- [1/3] Ollama 服务 ----------------
echo [1/3] 检查 Ollama 服务...
curl -s --max-time 3 http://192.168.9.6:11434/api/tags >nul 2>&1
if not errorlevel 1 goto ollama_ok

echo       Ollama 未运行，正在启动...
start "" "C:\Users\Administrator\AppData\Local\Programs\Ollama\ollama app.exe"

:wait_ollama
echo       等待 Ollama 就绪...
timeout /t 2 /nobreak >nul
curl -s --max-time 3 http://192.168.9.6:11434/api/tags >nul 2>&1
if errorlevel 1 goto wait_ollama

:ollama_ok
echo       Ollama 已就绪  (http://192.168.9.6:11434)
echo.

rem ---------------- [2/3] 预热 qwen3:8b ----------------
echo [2/3] 预热 qwen3:8b 模型（首次加载需一点时间）...
curl -s --max-time 180 http://192.168.9.6:11434/api/generate ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"qwen3:8b\",\"prompt\":\"ping\",\"stream\":false,\"keep_alive\":\"30m\"}" >nul 2>&1
echo       qwen3:8b 已加载到内存，可直接调用
echo.

rem ---------------- [3/3] 后端服务 ----------------
echo [3/3] 启动 FastAPI 后端（AI 控制面）...
if not exist ".venv\Scripts\python.exe" (
    echo       未找到虚拟环境，正在用 uv 创建并安装依赖...
    uv venv .venv
    uv pip install --python .venv\Scripts\python.exe -e ".[dev]"
)
start "MC-Backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --env-file .env --host 127.0.0.1 --port 8000"
echo.
echo ============================================
echo   启动完成！
echo   API 文档:      http://127.0.0.1:8000/docs
echo   AI 状态:       http://127.0.0.1:8000/api/v1/ai/config
echo   健康检查:      http://127.0.0.1:8000/health
echo   Ollama API:    http://192.168.9.6:11434
echo ============================================
timeout /t 4 /nobreak >nul
start http://127.0.0.1:8000/docs
pause >nul
