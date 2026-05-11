"""
운영 DB (drai_ops) 패키지.

[이 패키지가 하는 일]
HAPI FHIR와 별개로, 우리 시스템 전용 PostgreSQL(drai_ops) 접근 코드.

[구성]
- client.py: asyncpg 커넥션 풀 (startup/shutdown 관리)
- schema.sql: 테이블 DDL (최초 1회 실행)
- encounters.py: 응급실 방문 CRUD
- modal_results.py: 모달 원본 응답 CRUD
- diagnostic_reports.py: 종합 판단 CRUD

[사용 패턴]
from app.db import client as db
await db.execute("INSERT INTO ... VALUES ($1)", value)
row = await db.fetchone("SELECT ...")
"""
