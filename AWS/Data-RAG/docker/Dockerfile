FROM python:3.11-slim

WORKDIR /app

# 시스템 패키지 (AWS CLI for S3 sync)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && ./aws/install && \
    rm -rf awscliv2.zip aws && \
    apt-get purge -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Python 의존성
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 코드
COPY app/ ./app/

# 부팅 스크립트
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
