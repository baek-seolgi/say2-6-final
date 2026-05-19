"""
RAG API Server — FastAPI wrapper for step6_rag_orchestrator
"""

import os
import json
import time
import hashlib

import boto3
import chromadb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from botocore.exceptions import ClientError

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
CHROMA_DB_DIR = os.environ.get("CHROMA_DB_DIR", "./local_rag_db")
COLLECTION_NAME = "medical_rag_collection"
EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0"
EMBED_DIMENSIONS = 512

TOP_K_FETCH = 20
TOP_K_FINAL = 3
MIN_SIMILARITY = 0.15

# ──────────────────────────────────────────────
# FastAPI App
# ──────────────────────────────────────────────
app = FastAPI(title="RAG Service", version="1.0.0")

# 글로벌 클라이언트 (부팅 시 1회 초기화)
bedrock_client = None
collection = None


@app.on_event("startup")
def startup():
    global bedrock_client, collection
    bedrock_client = boto3.client("bedrock-runtime")
    client = chromadb.PersistentClient(path=CHROMA_DB_DIR)
    collection = client.get_collection(name=COLLECTION_NAME)
    print(f"[startup] ChromaDB loaded: {collection.count()} documents")


# ──────────────────────────────────────────────
# API Models
# ──────────────────────────────────────────────
class QueryRequest(BaseModel):
    query: str


class SearchResult(BaseModel):
    id: str
    document: str
    metadata: dict
    similarity: float


class QueryResponse(BaseModel):
    results: list[SearchResult]
    fallback: bool


# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "documents": collection.count() if collection else 0}


@app.post("/query", response_model=QueryResponse)
def query_rag(req: QueryRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query is empty")

    # 1. Embed
    query_vec = _embed(req.query)

    # 2. Search
    raw = collection.query(
        query_embeddings=[query_vec],
        n_results=TOP_K_FETCH,
        include=["documents", "metadatas", "distances"],
    )

    # 3. Process
    candidates = []
    for i in range(len(raw["ids"][0])):
        similarity = 1 - raw["distances"][0][i]
        candidates.append(SearchResult(
            id=raw["ids"][0][i],
            document=raw["documents"][0][i],
            metadata=raw["metadatas"][0][i],
            similarity=round(similarity, 4),
        ))

    # Fallback check
    if not candidates or candidates[0].similarity < MIN_SIMILARITY:
        return QueryResponse(results=[], fallback=True)

    # Diversity filter
    selected = _diversity_filter(candidates)
    return QueryResponse(results=selected, fallback=False)


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def _embed(text: str) -> list[float]:
    truncated = text[:8000]
    body = json.dumps({"inputText": truncated, "dimensions": EMBED_DIMENSIONS})

    for attempt in range(1, 4):
        try:
            resp = bedrock_client.invoke_model(
                modelId=EMBED_MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            return json.loads(resp["body"].read())["embedding"]
        except ClientError:
            time.sleep(2 ** attempt)

    raise HTTPException(status_code=502, detail="Bedrock embedding failed")


def _diversity_filter(candidates: list[SearchResult]) -> list[SearchResult]:
    discharge = [c for c in candidates if c.metadata.get("chunk_type") == "discharge_summary"]
    radiology = [c for c in candidates if c.metadata.get("chunk_type") == "radiology"]

    selected = []
    if discharge:
        selected.append(discharge[0])
    if radiology:
        selected.append(radiology[0])

    selected_ids = {s.id for s in selected}
    for c in candidates:
        if len(selected) >= TOP_K_FINAL:
            break
        if c.id not in selected_ids:
            selected.append(c)

    selected.sort(key=lambda x: x.similarity, reverse=True)
    return selected[:TOP_K_FINAL]
