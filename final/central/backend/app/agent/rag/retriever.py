"""
RAG Retriever — Titan v2 임베딩 + ChromaDB 검색 + 다양성 필터링.

원본: https://github.com/jeongawon/say-6-project (feature/rag, scripts/step6_rag_orchestrator.py)
중앙 통합 시 변경:
- DB 경로: 환경변수 RAG_DB_PATH (기본 /app/rag_db, Dockerfile에서 박힘)
- 모델 ID, top_k 등은 환경변수 override 가능
"""
from __future__ import annotations

import json
import logging
import os
import time

import boto3
import chromadb
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# ── 설정 (env override 가능) ─────────────────────────────────
DB_DIR = os.getenv("RAG_DB_PATH", "/app/rag_db")
COLLECTION_NAME = os.getenv("RAG_COLLECTION", "medical_rag_collection")
EMBED_MODEL_ID = os.getenv("RAG_EMBED_MODEL", "amazon.titan-embed-text-v2:0")
EMBED_DIMENSIONS = int(os.getenv("RAG_EMBED_DIM", "512"))

TOP_K_FETCH = int(os.getenv("RAG_TOP_K_FETCH", "20"))
TOP_K_FINAL = int(os.getenv("RAG_TOP_K_FINAL", "3"))
MIN_SIMILARITY = float(os.getenv("RAG_MIN_SIMILARITY", "0.15"))

FALLBACK_RESPONSE = (
    "유사한 과거 환자 사례를 찾지 못했습니다. 추가 검사가 필요합니다."
)


class Retriever:
    """ChromaDB 검색 + 다양성 필터링."""

    def __init__(self):
        self.bedrock = boto3.client("bedrock-runtime")
        client = chromadb.PersistentClient(path=DB_DIR)
        self.collection = client.get_collection(name=COLLECTION_NAME)
        logger.info(
            "[rag] Retriever ready: db=%s collection=%s docs=%d",
            DB_DIR, COLLECTION_NAME, self.collection.count(),
        )

    def _embed(self, text: str) -> list[float]:
        body = json.dumps({
            "inputText": text[:8000],
            "dimensions": EMBED_DIMENSIONS,
        })
        for attempt in range(1, 4):
            try:
                resp = self.bedrock.invoke_model(
                    modelId=EMBED_MODEL_ID,
                    contentType="application/json",
                    accept="application/json",
                    body=body,
                )
                return json.loads(resp["body"].read())["embedding"]
            except ClientError:
                time.sleep(2 ** attempt)
        raise RuntimeError("임베딩 API 호출 실패")

    def search(self, query: str) -> dict:
        """
        검색 후 다양성 필터링을 적용하여 최종 Top-3를 반환.
        반환: {"results": [...], "fallback": bool}
        """
        query_vec = self._embed(query)

        raw = self.collection.query(
            query_embeddings=[query_vec],
            n_results=TOP_K_FETCH,
            include=["documents", "metadatas", "distances"],
        )

        # cosine distance → similarity 변환
        candidates = []
        for i in range(len(raw["ids"][0])):
            similarity = 1 - raw["distances"][0][i]
            candidates.append({
                "id": raw["ids"][0][i],
                "document": raw["documents"][0][i],
                "metadata": raw["metadatas"][0][i],
                "similarity": round(similarity, 4),
            })

        # fallback 체크: 최고 유사도가 기준 미달
        if not candidates or candidates[0]["similarity"] < MIN_SIMILARITY:
            logger.info("[rag] fallback (top similarity < %.2f)", MIN_SIMILARITY)
            return {"results": [], "fallback": True}

        # 다양성 필터링: discharge 최소 1 + radiology 최소 1
        selected = self._diversity_filter(candidates)

        logger.info(
            "[rag] search hit %d candidates → top %d (avg sim=%.3f)",
            len(candidates), len(selected),
            sum(s["similarity"] for s in selected) / max(len(selected), 1),
        )
        return {"results": selected, "fallback": False}

    @staticmethod
    def _diversity_filter(candidates: list[dict]) -> list[dict]:
        """discharge와 radiology를 각각 최소 1건 포함하여 Top-3 선정."""
        discharge = [c for c in candidates if c["metadata"].get("chunk_type") == "discharge_summary"]
        radiology = [c for c in candidates if c["metadata"].get("chunk_type") == "radiology"]

        selected: list[dict] = []
        if discharge:
            selected.append(discharge[0])
        if radiology:
            selected.append(radiology[0])

        selected_ids = {s["id"] for s in selected}
        for c in candidates:
            if len(selected) >= TOP_K_FINAL:
                break
            if c["id"] not in selected_ids:
                selected.append(c)

        selected.sort(key=lambda x: x["similarity"], reverse=True)
        return selected[:TOP_K_FINAL]
