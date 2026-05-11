#!/usr/bin/env python3
"""
Import 경로 검증 스크립트
"""
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

def test_imports():
    """Test all critical imports"""
    errors = []
    
    print("="*60)
    print("Import 경로 검증 시작")
    print("="*60 + "\n")
    
    # Test 1: HybridDecisionEngine
    try:
        from app.agent.hybrid_decision_engine import HybridDecisionEngine
        print("✓ HybridDecisionEngine import OK")
    except Exception as e:
        errors.append(f"✗ HybridDecisionEngine import failed: {e}")
        print(f"✗ HybridDecisionEngine import failed: {e}")
    
    # Test 2: SessionManager
    try:
        from app.agent.session_manager import PatientSessionManager
        print("✓ PatientSessionManager import OK")
    except Exception as e:
        errors.append(f"✗ PatientSessionManager import failed: {e}")
        print(f"✗ PatientSessionManager import failed: {e}")
    
    # Test 3: CC Map
    try:
        from app.agent.orchestrator_utils.cc_map import ChiefComplaintModalityMap
        print("✓ ChiefComplaintModalityMap import OK")
    except Exception as e:
        errors.append(f"✗ ChiefComplaintModalityMap import failed: {e}")
        print(f"✗ ChiefComplaintModalityMap import failed: {e}")
    
    # Test 4: Feature Extractor
    try:
        from app.agent.orchestrator_utils.feature_extractor import InferenceFeatureExtractor
        print("✓ InferenceFeatureExtractor import OK")
    except Exception as e:
        errors.append(f"✗ InferenceFeatureExtractor import failed: {e}")
        print(f"✗ InferenceFeatureExtractor import failed: {e}")
    
    # Test 5: Bedrock Reporter
    try:
        from app.agent.orchestrator_utils.bedrock_reporter import BedrockReporter
        print("✓ BedrockReporter import OK")
    except Exception as e:
        errors.append(f"✗ BedrockReporter import failed: {e}")
        print(f"✗ BedrockReporter import failed: {e}")
    
    # Test 6: Load models function
    try:
        from app.agent.hybrid_decision_engine import load_stratified_models
        print("✓ load_stratified_models import OK")
    except Exception as e:
        errors.append(f"✗ load_stratified_models import failed: {e}")
        print(f"✗ load_stratified_models import failed: {e}")
    
    # Test 7: RAG modules
    try:
        from app.agent.rag import Retriever, Generator
        print("✓ RAG modules import OK")
    except Exception as e:
        errors.append(f"✗ RAG modules import failed: {e}")
        print(f"✗ RAG modules import failed: {e}")
    
    # Test 8: API modules
    try:
        from app.api import triage, orders, encounters
        print("✓ API modules import OK")
    except Exception as e:
        errors.append(f"✗ API modules import failed: {e}")
        print(f"✗ API modules import failed: {e}")
    
    # Test 9: FHIR modules
    try:
        from app.fhir import client, resources
        print("✓ FHIR modules import OK")
    except Exception as e:
        errors.append(f"✗ FHIR modules import failed: {e}")
        print(f"✗ FHIR modules import failed: {e}")
    
    # Test 10: DB modules
    try:
        from app.db import client, encounters
        print("✓ DB modules import OK")
    except Exception as e:
        errors.append(f"✗ DB modules import failed: {e}")
        print(f"✗ DB modules import failed: {e}")
    
    # Summary
    print("\n" + "="*60)
    if errors:
        print(f"❌ {len(errors)} import(s) failed:")
        for error in errors:
            print(f"  {error}")
        print("="*60)
        return False
    else:
        print("✅ All imports successful!")
        print("="*60)
        return True

if __name__ == "__main__":
    success = test_imports()
    sys.exit(0 if success else 1)
