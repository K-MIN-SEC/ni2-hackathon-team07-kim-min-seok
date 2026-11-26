"""한국어 문장 임베딩 모델(jhgan/ko-sroberta-multitask)을 우리 라벨로 미세조정한다 (CPU 전용).

지금 ml_classify.py는 임베딩 모델을 고정한 채 그 위에 로지스틱 회귀만 학습한다. 이 스크립트는 임베딩 모델 자체를
감성(4클래스) + 주제(8개 이진) 다중 과제로 학습시켜, "걱정 vs 불만", "요청 vs 불만"처럼 범용 모델이 구분하지 못하던
차이를 배우게 한다. 학습된 모델의 확률은 ml_classify.py의 TF-IDF 모델 확률과 평균해서 쓴다.

CPU에서 돌리려고 아래쪽 층(임베딩 + 하위 FREEZE_LAYERS개 층)은 고정하고 위쪽 층만 학습한다.
리뷰는 길이순으로 묶어 배치를 만들어(패딩 최소화) 한 겹에 10~15분 정도 걸린다.

사용법
  python scripts/finetune.py cv      # 5-겹 교차검증 (ml_classify.py와 같은 분할) → work/ft/oof_*.npy
  python scripts/finetune.py train   # 전체 데이터로 학습 → work/ft/model/
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import time

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from merge_labels import TOPICS  # noqa: E402

SENTS = ["긍정", "부정", "중립", "혼합"]
BASE = "jhgan/ko-sroberta-multitask"
OUT = os.path.join(ROOT, "work", "ft")
LABELED = os.path.join(ROOT, "data", "reviews_labeled.csv")
SEED = 2026
MAX_LEN = 128
FREEZE_LAYERS = 6      # 12층 중 아래 6층 고정
EPOCHS = 3
LR = 4e-5              # 학습하는 인코더 층
LR_HEAD = 1e-3         # 분류 헤드
TOK_PER_BATCH = 1600   # 배치당 토큰 수 상한 (짧은 리뷰는 한 배치에 많이 담긴다)
MAX_BATCH = 64
HARD_W = 3.0           # 규칙이 확신 못 한(AI가 판정한) 리뷰의 손실 가중치
TOPIC_LOSS_W = 0.5
THREADS = 8


def model_input(content, rating) -> str:
    """별점을 문장 앞에 붙여 모델이 함께 보게 한다 (TF-IDF 모델도 별점을 특징으로 쓴다)."""
    c = content if isinstance(content, str) else ""
    return f"별점 {int(rating)}점. {c}"


def folds(lab: pd.DataFrame):
    """work/cv_folds.csv에 고정한 분할 (ml_classify.py evaluate()와 같은 분할)."""
    f = pd.read_csv(os.path.join(ROOT, "work", "cv_folds.csv"), encoding="utf-8-sig", dtype={"review_id": str})
    fold = lab.review_id.map(dict(zip(f.review_id, f.fold))).values
    return [(np.where(fold != k)[0], np.where(fold == k)[0]) for k in range(5)]


def build_net(base: str = BASE):
    import torch
    from transformers import AutoModel

    class Net(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.enc = AutoModel.from_pretrained(base)
            h = self.enc.config.hidden_size
            self.drop = torch.nn.Dropout(0.1)
            self.sent = torch.nn.Linear(h, len(SENTS))
            self.topic = torch.nn.Linear(h, len(TOPICS))

        def pool(self, ids, mask):
            hid = self.enc(input_ids=ids, attention_mask=mask).last_hidden_state
            m = mask.unsqueeze(-1).float()
            return (hid * m).sum(1) / m.sum(1).clamp(min=1)  # 평균 풀링 (sroberta 방식)

        def forward(self, ids, mask):
            z = self.drop(self.pool(ids, mask))
            return self.sent(z), self.topic(z)

    return Net()


def _batches(lengths, shuffle: bool, rng: random.Random):
    """길이가 비슷한 리뷰끼리 묶는다. 학습 때는 길이 구간 안에서 섞고, 배치 순서도 섞는다."""
    idx = sorted(range(len(lengths)), key=lambda i: (lengths[i], rng.random() if shuffle else 0))
    out, cur, mx = [], [], 0
    for i in idx:
        L = lengths[i]
        if cur and (max(mx, L) * (len(cur) + 1) > TOK_PER_BATCH or len(cur) >= MAX_BATCH):
            out.append(cur)
            cur, mx = [], 0
        cur.append(i)
        mx = max(mx, L)
    if cur:
        out.append(cur)
    if shuffle:
        rng.shuffle(out)
    return out


def _encode(tok, texts):
    enc = tok(texts, truncation=True, max_length=MAX_LEN)
    return enc["input_ids"]


def _pad(ids_list, pad_id):
    import torch
    L = max(len(x) for x in ids_list)
    ids = torch.full((len(ids_list), L), pad_id, dtype=torch.long)
    mask = torch.zeros((len(ids_list), L), dtype=torch.long)
    for k, x in enumerate(ids_list):
        ids[k, :len(x)] = torch.tensor(x)
        mask[k, :len(x)] = 1
    return ids, mask


def fit(texts, y_sent, y_topic, w, log=print, epochs: int = EPOCHS):
    import torch
    from transformers import AutoTokenizer
    torch.manual_seed(SEED)
    torch.set_num_threads(THREADS)
    rng = random.Random(SEED)
    tok = AutoTokenizer.from_pretrained(BASE)
    net = build_net()
    # 아래쪽 층 고정
    for p in net.enc.embeddings.parameters():
        p.requires_grad = False
    for layer in net.enc.encoder.layer[:FREEZE_LAYERS]:
        for p in layer.parameters():
            p.requires_grad = False
    enc_params = [p for p in net.enc.parameters() if p.requires_grad]
    head_params = list(net.sent.parameters()) + list(net.topic.parameters())
    opt = torch.optim.AdamW([{"params": enc_params, "lr": LR}, {"params": head_params, "lr": LR_HEAD}],
                            weight_decay=0.01)
    ids = _encode(tok, texts)
    lengths = [len(x) for x in ids]
    n_steps = epochs * len(_batches(lengths, False, rng))
    warm = max(1, int(0.06 * n_steps))
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min((s + 1) / warm, max(0.0, (n_steps - s) / max(1, n_steps - warm))))
    ys = torch.tensor(y_sent, dtype=torch.long)
    yt = torch.tensor(y_topic, dtype=torch.float)
    ww = torch.tensor(w, dtype=torch.float)
    ce = torch.nn.CrossEntropyLoss(reduction="none")
    bce = torch.nn.BCEWithLogitsLoss(reduction="none")
    step, t0 = 0, time.time()
    tot = 0.0
    for ep in range(epochs):
        net.train()
        for b in _batches(lengths, True, rng):
            x, m = _pad([ids[i] for i in b], tok.pad_token_id)
            ls, lt = net(x, m)
            wb = ww[b]
            loss = (ce(ls, ys[b]) * wb).sum() / wb.sum() + \
                TOPIC_LOSS_W * (bce(lt, yt[b]).mean(1) * wb).sum() / wb.sum()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(enc_params + head_params, 1.0)
            opt.step()
            sched.step()
            opt.zero_grad()
            tot += loss.item()
            step += 1
            if step % 50 == 0:
                log(f"    step {step}/{n_steps} loss {tot / 50:.3f} ({time.time() - t0:.0f}s)")
                tot = 0.0
    net.eval()
    return tok, net


def predict(tok, net, texts, return_emb: bool = False):
    """(감성 확률 (n,4), 주제 확률 (n,8)[, 임베딩 (n,768)])"""
    import torch
    torch.set_num_threads(THREADS)
    ids = _encode(tok, texts)
    lengths = [len(x) for x in ids]
    ps = np.zeros((len(texts), len(SENTS)), np.float32)
    pt = np.zeros((len(texts), len(TOPICS)), np.float32)
    em = np.zeros((len(texts), net.enc.config.hidden_size), np.float32) if return_emb else None
    with torch.no_grad():
        for b in _batches(lengths, False, random.Random(0)):
            x, m = _pad([ids[i] for i in b], tok.pad_token_id)
            z = net.pool(x, m)
            ps[b] = torch.softmax(net.sent(z), -1).numpy()
            pt[b] = torch.sigmoid(net.topic(z)).numpy()
            if return_emb:
                em[b] = torch.nn.functional.normalize(z, dim=-1).numpy()
    return (ps, pt, em) if return_emb else (ps, pt)


def load_xy(lab: pd.DataFrame):
    texts = [model_input(c, r) for c, r in zip(lab.content, lab.rating)]
    y_sent = np.array([SENTS.index(s) for s in lab.sentiment])
    tps = lab.topics.fillna("").str.split("|")
    y_topic = np.array([[tp in t for tp in TOPICS] for t in tps], dtype=np.float32)
    w = np.where(lab.label_source.values == "manual", HARD_W, 1.0)
    return texts, y_sent, y_topic, w


def cv():
    os.makedirs(OUT, exist_ok=True)
    logf = open(os.path.join(OUT, "cv.log"), "a", encoding="utf-8")

    def log(s):
        print(s, flush=True)
        logf.write(s + "\n")
        logf.flush()

    lab = pd.read_csv(LABELED, encoding="utf-8-sig", dtype={"review_id": str})
    texts, y_sent, y_topic, w = load_xy(lab)
    n = len(lab)
    oof_s = np.zeros((n, len(SENTS)), np.float32)
    oof_t = np.zeros((n, len(TOPICS)), np.float32)
    oof_e = np.zeros((n, 768), np.float32)
    done = np.zeros(n, bool)
    ck = os.path.join(OUT, "oof_partial.npz")
    if os.path.exists(ck):  # 중단됐다가 다시 돌리면 끝난 겹은 건너뛴다
        z = np.load(ck)
        oof_s, oof_t, oof_e, done = z["s"], z["t"], z["e"], z["done"]
    log(f"설정 freeze={FREEZE_LAYERS} epochs={EPOCHS} lr={LR} hard_w={HARD_W} max_len={MAX_LEN}")
    for f, (tr, te) in enumerate(folds(lab)):
        if done[te].all():
            log(f"fold {f + 1}/5 이미 완료, 건너뜀")
            continue
        t0 = time.time()
        log(f"fold {f + 1}/5 학습 {len(tr)}건")
        tok, net = fit([texts[i] for i in tr], y_sent[tr], y_topic[tr], w[tr], log)
        ps, pt, em = predict(tok, net, [texts[i] for i in te], return_emb=True)
        oof_s[te], oof_t[te], oof_e[te] = ps, pt, em
        done[te] = True
        np.savez(ck, s=oof_s, t=oof_t, e=oof_e, done=done)
        hard = (lab.label_source.values[te] == "manual")
        acc = (ps.argmax(1) == y_sent[te])
        log(f"fold {f + 1}/5 끝 ({time.time() - t0:.0f}s) 감성 정확도 전체 {acc.mean():.3f} / 어려운 건 {acc[hard].mean():.3f}")
    np.save(os.path.join(OUT, "oof_sent.npy"), oof_s)
    np.save(os.path.join(OUT, "oof_topic.npy"), oof_t)
    np.save(os.path.join(OUT, "oof_emb.npy"), oof_e)
    hard = (lab.label_source.values == "manual")
    acc = oof_s.argmax(1) == y_sent
    res = {"all_acc": float(acc.mean()), "hard_acc": float(acc[hard].mean()),
           "config": {"freeze": FREEZE_LAYERS, "epochs": EPOCHS, "lr": LR, "hard_w": HARD_W, "max_len": MAX_LEN}}
    json.dump(res, open(os.path.join(OUT, "cv_result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"완료: {res}")


def train():
    import torch
    lab = pd.read_csv(LABELED, encoding="utf-8-sig", dtype={"review_id": str})
    texts, y_sent, y_topic, w = load_xy(lab)
    tok, net = fit(texts, y_sent, y_topic, w)
    d = os.path.join(OUT, "model")
    os.makedirs(d, exist_ok=True)
    net.enc.save_pretrained(d)
    tok.save_pretrained(d)
    torch.save({"sent": net.sent.state_dict(), "topic": net.topic.state_dict(),
                "sents": SENTS, "topics": TOPICS}, os.path.join(d, "heads.pt"))
    print("저장", d)


_loaded = None


def load(path: str = os.path.join(OUT, "model")):
    """학습된 미세조정 모델을 불러온다 (서빙용)."""
    global _loaded
    if _loaded is None:
        import torch
        from transformers import AutoTokenizer
        tok = AutoTokenizer.from_pretrained(path)
        net = build_net(path)
        h = torch.load(os.path.join(path, "heads.pt"), weights_only=True)
        net.sent.load_state_dict(h["sent"])
        net.topic.load_state_dict(h["topic"])
        net.eval()
        _loaded = (tok, net)
    return _loaded


def predict_reviews(contents, ratings):
    tok, net = load()
    return predict(tok, net, [model_input(c, r) for c, r in zip(contents, ratings)])


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "cv"
    {"cv": cv, "train": train}[cmd]()
