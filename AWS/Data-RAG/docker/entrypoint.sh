#!/bin/bash
set -e

echo "=== RAG Service Starting ==="
echo "Downloading ChromaDB from S3..."
aws s3 sync "s3://${RAG_DB_BUCKET}/local_rag_db/" ./local_rag_db/ --quiet
echo "Download complete. DB size:"
du -sh ./local_rag_db/

echo "Starting RAG API server on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
