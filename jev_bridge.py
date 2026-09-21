"""阴阳道判断层桥：浏览器 → /decide → system_one_adapter（或 TypeSafe 官方 SDK）。

同时兼作静态服务器，游戏与 API 同源，省掉 CORS。
  py -3.12 jev_bridge.py            # http://127.0.0.1:8731
  JEV_UPSTREAM=stub 时无 key 也能跑通整条回路（确定性假答案，只验管道不验模型）。
上游请求体/响应体形态沿用 system-one-adapter：answers = {qid: {type, choice|noul|score, confidence, probabilities}}。
"""

from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("JEV_PORT", "8731"))
UPSTREAM = os.environ.get("JEV_UPSTREAM", "adapter").lower()
PROVIDER = os.environ.get("JEV_LLM_PROVIDER", "openai")
MODEL = os.environ.get("JEV_LLM_MODEL", "gpt-4o-mini")
SAMPLES = int(os.environ.get("JEV_SAMPLES", "1"))
BASE_URL = os.environ.get("OPENAI_BASE_URL") or None

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def have_key() -> bool:
    if UPSTREAM == "stub":
        return True
    if UPSTREAM == "typesafe":
        return bool(os.environ.get("TYPESAFE_API_KEY"))
    return bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"))


_client = None


def get_client():
    global _client
    if _client is None:
        if UPSTREAM == "typesafe":
            from typesafe_sdk import TypeSafeClient  # 官方云端 Jev

            _client = TypeSafeClient()
        else:
            from system_one_adapter import SystemOneAdapterClient  # 本地/开源 drop-in

            model: object = MODEL
            if BASE_URL:  # 自定义 OpenAI 兼容端点要走 provider 实例，构造函数不吃 base_url
                from system_one_adapter.providers.openai import OpenAIProvider

                model = OpenAIProvider(MODEL, base_url=BASE_URL)
            _client = SystemOneAdapterClient(
                structured_outputs=True,
                llm_answer_mode="probabilities",
                normalize_probabilities=True,
                provider=PROVIDER,
                model=model,
            )
    return _client


def to_typed(questions: dict):
    """把线上 JSON 问题包还原成 SDK 的 typed 问题。"""
    if UPSTREAM == "typesafe":
        from typesafe_sdk import Choice, Noul, Score
    else:
        from system_one_adapter import Choice, Noul, Score

    out = {}
    for qid, q in questions.items():
        kind = q.get("type")
        if kind == "noul":
            out[qid] = Noul(instructions=q["instructions"])
        elif kind in ("choice", "score"):
            criteria = q.get("criteria") or {}
            if kind == "choice":
                out[qid] = Choice(instructions=q["instructions"], criteria=criteria)
            else:
                out[qid] = Score(instructions=q["instructions"], criteria=criteria)
    return out


def stub_answers(state: dict, questions: dict) -> dict:
    """确定性假上游：按"绕行尚需步数"最小项作答，用于零 key 验管道。"""
    answers = {}
    action = questions.get("action")
    if action:
        ids = list(action["criteria"].keys())
        steps = [i for i in ids if i.startswith("step_")]
        pick = steps[0] if steps else ids[0]
        answers["action"] = {"type": "choice", "choice": pick, "confidence": 0.7, "probabilities": {i: (1.0 if i == pick else 0.0) for i in ids}}
    if "press" in questions:
        answers["press"] = {"type": "noul", "noul": 0.7}
    if "disengage" in questions:
        answers["disengage"] = {"type": "noul", "noul": 0.1}
    return answers


def merge_samples(runs: list[dict]) -> dict:
    """多样本取均值（评测口径）；单样本直接透传。"""
    if len(runs) == 1:
        return runs[0]
    merged: dict = {}
    for answers in runs:
        for qid, a in answers.items():
            merged.setdefault(qid, []).append(a)
    out = {}
    for qid, group in merged.items():
        first = group[0]
        if first["type"] == "choice":
            tally: dict[str, float] = {}
            for a in group:
                for k, v in (a.get("probabilities") or {}).items():
                    tally[k] = tally.get(k, 0.0) + v
            probs = {k: round(v / len(group), 4) for k, v in tally.items()}
            best = max(probs, key=lambda k: probs[k])
            out[qid] = {"type": "choice", "choice": best, "confidence": probs[best], "probabilities": probs}
        else:
            vals = [a.get("noul", a.get("score", 0.0)) for a in group]
            key = "noul" if first["type"] == "noul" else "score"
            out[qid] = {"type": first["type"], key: round(sum(vals) / len(vals), 4)}
    return out


def decide(state: dict, questions: dict) -> tuple[dict, dict]:
    if UPSTREAM == "stub":
        return stub_answers(state, questions), {"input_tokens": 0, "output_tokens": 0, "model": "stub"}
    client = get_client()
    typed = to_typed(questions)
    runs, usage, model_name = [], None, MODEL if UPSTREAM != "typesafe" else None
    for _ in range(max(1, SAMPLES)):
        t0 = time.perf_counter()
        resp = client.system_one(state, typed)
        dumped = resp.model_dump(mode="json")
        dumped["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        runs.append(dumped["answers"])
        usage = dumped.get("usage")
        model_name = dumped.get("model") or model_name
    return (merge_samples(runs) if len(runs) > 1 else runs[0]), dict(usage or {}, samples=len(runs), upstream=UPSTREAM, model=model_name)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[jev] " + (fmt % args) + "\n")

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_GET(self):
        if self.path.startswith("/health"):
            body = json.dumps({"ok": True, "upstream": UPSTREAM, "provider": PROVIDER, "model": MODEL, "samples": SAMPLES, "has_key": have_key()}).encode()
            self._send(200, body, "application/json")
            return
        rel = (self.path.split("?")[0].lstrip("/") or "index.html").replace("..", "")
        target = (ROOT / rel).resolve()
        if not str(target).startswith(str(ROOT)) or not target.is_file():
            self._send(404, b"not found", "text/plain")
            return
        ctype = "text/html; charset=utf-8" if target.suffix == ".html" else "application/javascript; charset=utf-8" if target.suffix == ".js" else "text/plain; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    def do_POST(self):
        if not self.path.startswith("/decide"):
            self._send(404, b"not found", "text/plain")
            return
        if not have_key():
            msg = "missing key: set OPENAI_API_KEY / ANTHROPIC_API_KEY (JEV_UPSTREAM=adapter) or TYPESAFE_API_KEY (JEV_UPSTREAM=typesafe); 或用 JEV_UPSTREAM=stub 验管道"
            self._send(503, json.dumps({"error": msg}).encode(), "application/json")
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n) or b"{}")
            t0 = time.perf_counter()
            answers, usage = decide(payload["state"], payload["questions"])
        except Exception as exc:  # 上游失败必须让游戏侧看见并降级，不能在桥里编答案
            self._send(502, json.dumps({"error": f"{type(exc).__name__}: {exc}"}).encode(), "application/json")
            return
        body = json.dumps({"answers": answers, "usage": usage, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}).encode()
        self._send(200, body, "application/json")


if __name__ == "__main__":
    print(f"JEV 桥 · upstream={UPSTREAM} provider={PROVIDER} model={MODEL} samples={SAMPLES} has_key={have_key()}")
    print(f"游戏： http://127.0.0.1:{PORT}/?jev=bridge   健康检查： http://127.0.0.1:{PORT}/health")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
