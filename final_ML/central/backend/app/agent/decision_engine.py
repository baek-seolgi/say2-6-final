"""
Data-Driven Hybrid Decision Engine - ML-First with CC Map Prior.

This module provides the decision engine for the multimodal orchestrator.
It uses ML models trained on MIMIC data to make data-driven decisions.

Strategy:
1. ML Models (Primary) - Data-driven predictions from MIMIC
2. CC Modality Map (Prior) - Initial routing based on historical data
3. NO hardcoded clinical rules - all decisions from data

Decision Flow:
- Initial: Use CC map for prior, ML for prediction
- Follow-up: ML models with context from completed modalities
"""

# Import from the hybrid_decision_engine module in the same directory
from app.agent.hybrid_decision_engine import (
    HybridDecisionEngine,
    load_stratified_models
)

# Backward compatibility alias
FusionDecisionEngine = HybridDecisionEngine

__all__ = ['HybridDecisionEngine', 'FusionDecisionEngine', 'load_stratified_models']
