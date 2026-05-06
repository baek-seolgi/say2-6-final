FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# RAG ChromaDB 데이터 (49,743건 MIMIC 노트 임베딩)
# S3 zip(s3://say2-6team/jeongin/note_rag.zip)에서 받아 backend/rag_db/에 풀어둠.
# 빌드 시 이미지에 박혀 컨테이너 어디서 띄우든 /app/rag_db에서 자동 로드.
COPY rag_db/ /app/rag_db/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
