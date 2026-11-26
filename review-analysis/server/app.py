"""리뷰 분류 API 서버 (로컬 검증용, Python 표준 라이브러리만 사용).

실행 (저장소 폴더에서):
  python server/app.py [--port 8765] [--host 127.0.0.1]

엔드포인트
  GET  /                → 테스트 페이지 (server/static/index.html)
  GET  /api/health      → {"status": "ok"|"loading", "model": {"finetuned": bool, "note": str}, ...}
  POST /api/classify    → 요청 {"reviews": [{"content": "...", "rating": 1~5}, ...]}
                           응답 {"results": [{"sentiment", "topics", "source", "truncated"}], "elapsed_ms"}

안전장치
- 요청 본문 최대 256KB, 한 번에 최대 50건. 넘으면 413/400.
- 모델 로딩과 분류는 전용 작업 스레드 하나에서만 실행한다. HTTP 서버는 요청마다 새 스레드를 만드는데,
  PyTorch는 처음 보는 스레드마다 작업용 메모리를 따로 잡고 돌려주지 않아서, 요청 스레드에서 바로 돌리면
  메모리가 계속 늘었다(실측: 3,250건에 private 2.6GB → 5.1GB). 동시 요청은 순서대로 처리돼서 대기 시간이 늘어난다.
- 모델은 서버 시작 때 백그라운드로 불러오고, 그동안 분류 요청에는 503을 돌려준다.
- 기본으로 127.0.0.1(이 컴퓨터)에서만 접속을 받는다. 외부에 공개하려면 앞단에 HTTPS 프록시를 두고
  --host 0.0.0.0으로 실행한다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
STATIC = os.path.join(ROOT, "server", "static")

MAX_BODY = 256 * 1024
MAX_ITEMS = 50

_state = {"status": "loading", "load_seconds": None, "error": None, "requests": 0}
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="model")  # 모델 전용 스레드
ml = None


def _load():
    global ml
    t = time.time()
    try:
        import ml_classify
        ml_classify.load_model(serving=True)
        ml = ml_classify
        _state.update(status="ok", load_seconds=round(time.time() - t, 1))
    except Exception as e:  # 로딩 실패는 health로 알린다
        _state.update(status="error", error=f"{type(e).__name__}: {e}")
        traceback.print_exc()


def _model_info():
    """어떤 모델로 판정하는지. 미세조정 모델 폴더가 없으면 기존 모델로만 판정한다(ml_classify.ft_status)."""
    if ml is None:
        return None
    b = ml.load_model()
    if not any(getattr(b["review"], "ft_w", (0, 0))):
        return {"finetuned": False, "note": "기존 모델(미세조정 미사용 설정)"}
    st = ml.ft_status()
    # 방문자에게는 서버 폴더 경로를 보여 주지 않는다 (자세한 원인은 서버 로그의 [경고]에 있음)
    return {"finetuned": st["active"], "note": "미세조정 모델 사용 중" if st["active"] else
            "미세조정 모델이 없어 기존 모델로만 판정 중 (어려운 리뷰 정확도 낮음)"}


class Handler(BaseHTTPRequestHandler):
    server_version = "ReviewClassifier/1.0"

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _error(self, code: int, msg: str):
        self._json(code, {"error": msg})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            with open(os.path.join(STATIC, "index.html"), "rb") as f:
                return self._send(200, f.read(), "text/html; charset=utf-8")
        if self.path == "/api/health":
            return self._json(200, {**_state, "model": _model_info(), "max_items": MAX_ITEMS,
                                    "max_chars": getattr(ml, "MAX_CHARS", None)})
        self._error(404, "없는 경로입니다")

    def do_POST(self):
        if self.path != "/api/classify":
            return self._error(404, "없는 경로입니다")
        if _state["status"] != "ok":
            return self._error(503, "모델을 불러오는 중입니다. 잠시 후 다시 시도하세요" if _state["status"] == "loading"
                               else "모델을 불러오지 못했습니다")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._error(415, "Content-Type은 application/json이어야 합니다")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._error(400, "Content-Length가 잘못됐습니다")
        if n > MAX_BODY:
            return self._error(413, f"요청이 너무 큽니다 (최대 {MAX_BODY // 1024}KB)")
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._error(400, "JSON 형식이 아닙니다")
        reviews = data.get("reviews") if isinstance(data, dict) else None
        if not isinstance(reviews, list) or not all(isinstance(r, dict) for r in reviews):
            return self._error(400, '본문은 {"reviews": [{"content": ..., "rating": ...}]} 형식이어야 합니다')
        if len(reviews) > MAX_ITEMS:
            return self._error(400, f"한 번에 최대 {MAX_ITEMS}건까지 보낼 수 있습니다")
        t = time.time()
        try:
            results = _worker.submit(ml.classify_reviews, reviews).result()
        except ValueError as e:
            return self._error(400, str(e))
        except Exception:
            traceback.print_exc()
            return self._error(500, "분류 중 오류가 났습니다")
        _state["requests"] += 1
        self._json(200, {"results": results, "model": _model_info(), "elapsed_ms": round((time.time() - t) * 1000)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    _worker.submit(_load)  # 로딩도 같은 작업 스레드에서
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"서버 시작: http://{a.host}:{a.port}  (모델은 백그라운드에서 불러오는 중)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
