"""로컬 문장 임베딩 (sentence-transformers). 인터넷은 모델을 처음 받을 때만 쓰고, 이후에는 로컬 캐시로 돈다.

- 리뷰 텍스트 → 고정 길이 벡터. 의미가 비슷한 문장은 비슷한 벡터가 된다
  ("게임 잘 만드셨네요" ≈ "완성도 높아요"처럼 단어가 달라도 가깝다).
- 일괄 처리(학습·평가) 때는 결과를 work/emb_<모델>.npz에 텍스트별로 캐시해서, 같은 리뷰는 다시 계산하지 않는다.
- 웹 서버처럼 요청마다 새 문장이 들어오는 곳에서는 set_cache_mode("read")로 바꾼다.
  기존 캐시는 읽기만 하고, 새 문장은 계산만 한 뒤 저장하지 않는다(파일·메모리가 계속 커지거나,
  동시 요청이 같은 파일을 쓰다 깨지는 문제를 막음).

사용: python scripts/embeddings.py [모델이름]   # data/reviews.csv 전체를 미리 계산
"""
from __future__ import annotations

import hashlib
import os
import sys
import tempfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 저장소 폴더
DEFAULT_MODEL = "jhgan/ko-sroberta-multitask"

_models: dict = {}
_caches: dict[str, dict[str, np.ndarray]] = {}
_cache_mode = "write"  # "write": 새 결과를 캐시에 추가·저장 / "read": 읽기만 / "off": 캐시 안 씀


def set_cache_mode(mode: str) -> None:
    global _cache_mode
    if mode not in ("write", "read", "off"):
        raise ValueError(mode)
    _cache_mode = mode


def _key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _cache_path(model: str) -> str:
    return os.path.join(ROOT, "work", "emb_" + model.replace("/", "__") + ".npz")


def _load_cache(model: str) -> dict[str, np.ndarray]:
    if model not in _caches:
        p = _cache_path(model)
        if _cache_mode != "off" and os.path.exists(p):
            z = np.load(p)
            _caches[model] = dict(zip(z["keys"].tolist(), z["vecs"]))
        else:
            _caches[model] = {}
    return _caches[model]


def _save_cache(model: str):
    """임시 파일에 쓴 뒤 교체해서, 저장 도중 중단돼도 기존 캐시 파일이 깨지지 않게 한다."""
    c = _caches[model]
    path = _cache_path(model)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".npz", dir=os.path.dirname(path))
    os.close(fd)
    np.savez(tmp, keys=np.array(list(c.keys())), vecs=np.vstack(list(c.values())))
    os.replace(tmp, path)


def get_model(model: str = DEFAULT_MODEL):
    """모델을 불러온다(서버 시작 때 미리 불러 두면 첫 요청이 느려지지 않는다)."""
    if model not in _models:
        from sentence_transformers import SentenceTransformer
        _models[model] = SentenceTransformer(model, device="cpu")
    return _models[model]


def embed(texts, model: str = DEFAULT_MODEL, batch_size: int = 64) -> np.ndarray:
    """텍스트 목록 → (n, d) 정규화된 임베딩."""
    texts = [str(t) if isinstance(t, str) else "" for t in texts]
    cache = _load_cache(model)
    todo = sorted({t for t in texts if _key(t) not in cache})
    fresh: dict[str, np.ndarray] = {}
    if todo:
        m = get_model(model)
        inp = [("query: " + t) if "e5" in model else t for t in todo]  # e5 계열은 접두어 필요
        vecs = m.encode(inp, batch_size=batch_size, normalize_embeddings=True, show_progress_bar=len(todo) > 500)
        fresh = {_key(t): v.astype(np.float32) for t, v in zip(todo, vecs)}
        if _cache_mode == "write":
            cache.update(fresh)
            _save_cache(model)
    return np.vstack([fresh.get(_key(t), cache.get(_key(t))) for t in texts])


if __name__ == "__main__":
    import pandas as pd
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    model = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL
    d = pd.read_csv(os.path.join(ROOT, "data", "reviews.csv"), encoding="utf-8-sig")
    E = embed(d.content.tolist(), model)
    print(model, E.shape, "→", _cache_path(model))
