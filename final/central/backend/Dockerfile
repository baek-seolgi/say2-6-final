FROM python:3.12-slim

# LightGBM은 libgomp(OpenMP) 런타임 의존 → slim 이미지엔 없으므로 별도 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# CC map (.parquet) — ML 결정 엔진의 prior 데이터
COPY data/ /app/data/

# RAG ChromaDB 데이터 (49,743건 MIMIC 노트 임베딩)
# S3 zip(s3://say2-6team/jeongin/note_rag.zip)에서 받아 backend/rag_db/에 풀어둠.
# 빌드 시 이미지에 박혀 컨테이너 어디서 띄우든 /app/rag_db에서 자동 로드.
COPY rag_db/ /app/rag_db/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
