"""
Patient Session Manager for Real-time Orchestration.

Manages patient sessions, state updates, and orchestration loop.
Supports both in-memory (development) and Redis (production) backends.
"""
import logging
import json
import time
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime
import pickle

logger = logging.getLogger(__name__)


@dataclass
class PatientSession:
    """Patient session state."""
    patient_id: str
    patient_data: Dict[str, Any]
    modalities_completed: List[str]
    inference_results: List[Dict[str, Any]]
    iteration: int
    is_complete: bool
    created_at: float
    updated_at: float
    final_decision: Optional[str] = None
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for serialization."""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'PatientSession':
        """Create from dictionary."""
        return cls(**data)


class InMemorySessionStore:
    """In-memory session store for development."""
    
    def __init__(self):
        self.sessions: Dict[str, PatientSession] = {}
        logger.info("Initialized InMemorySessionStore")
    
    def create(self, patient_id: str, patient_data: Dict) -> PatientSession:
        """Create new session."""
        session = PatientSession(
            patient_id=patient_id,
            patient_data=patient_data,
            modalities_completed=[],
            inference_results=[],
            iteration=1,
            is_complete=False,
            created_at=time.time(),
            updated_at=time.time()
        )
        self.sessions[patient_id] = session
        logger.info(f"Created session for patient {patient_id}")
        return session
    
    def get(self, patient_id: str) -> Optional[PatientSession]:
        """Get session by patient ID."""
        return self.sessions.get(patient_id)
    
    def update(self, patient_id: str, session: PatientSession):
        """Update session."""
        session.updated_at = time.time()
        self.sessions[patient_id] = session
        logger.debug(f"Updated session for patient {patient_id}")
    
    def delete(self, patient_id: str):
        """Delete session."""
        if patient_id in self.sessions:
            del self.sessions[patient_id]
            logger.info(f"Deleted session for patient {patient_id}")
    
    def list_active(self) -> List[str]:
        """List active session IDs."""
        return [pid for pid, s in self.sessions.items() if not s.is_complete]


class RedisSessionStore:
    """Redis-based session store for production."""
    
    def __init__(self, redis_client):
        """
        Initialize Redis session store.
        
        Args:
            redis_client: Redis client instance (redis.Redis)
        """
        self.redis = redis_client
        self.prefix = "patient_session:"
        self.ttl = 86400  # 24 hours
        logger.info("Initialized RedisSessionStore")
    
    def _key(self, patient_id: str) -> str:
        """Generate Redis key."""
        return f"{self.prefix}{patient_id}"
    
    def create(self, patient_id: str, patient_data: Dict) -> PatientSession:
        """Create new session."""
        session = PatientSession(
            patient_id=patient_id,
            patient_data=patient_data,
            modalities_completed=[],
            inference_results=[],
            iteration=1,
            is_complete=False,
            created_at=time.time(),
            updated_at=time.time()
        )
        
        # Serialize and store
        key = self._key(patient_id)
        self.redis.setex(key, self.ttl, json.dumps(session.to_dict()))
        logger.info(f"Created Redis session for patient {patient_id}")
        return session
    
    def get(self, patient_id: str) -> Optional[PatientSession]:
        """Get session by patient ID."""
        key = self._key(patient_id)
        data = self.redis.get(key)
        
        if data is None:
            return None
        
        session_dict = json.loads(data)
        return PatientSession.from_dict(session_dict)
    
    def update(self, patient_id: str, session: PatientSession):
        """Update session."""
        session.updated_at = time.time()
        key = self._key(patient_id)
        self.redis.setex(key, self.ttl, json.dumps(session.to_dict()))
        logger.debug(f"Updated Redis session for patient {patient_id}")
    
    def delete(self, patient_id: str):
        """Delete session."""
        key = self._key(patient_id)
        self.redis.delete(key)
        logger.info(f"Deleted Redis session for patient {patient_id}")
    
    def list_active(self) -> List[str]:
        """List active session IDs."""
        pattern = f"{self.prefix}*"
        keys = self.redis.keys(pattern)
        
        active = []
        for key in keys:
            data = self.redis.get(key)
            if data:
                session_dict = json.loads(data)
                if not session_dict.get('is_complete', False):
                    patient_id = session_dict['patient_id']
                    active.append(patient_id)
        
        return active


class PatientSessionManager:
    """
    Manages patient sessions and orchestration loop.
    
    Responsibilities:
    - Create and manage patient sessions
    - Update modality status (ordered, waiting, completed)
    - Add inference results
    - Execute orchestration decisions
    - Handle iteration loop
    """
    
    MAX_ITERATIONS = 3
    
    def __init__(self, session_store, decision_engine_factory, feature_extractor):
        """
        Initialize session manager.
        
        Args:
            session_store: Session store (InMemorySessionStore or RedisSessionStore)
            decision_engine_factory: Factory function to create HybridDecisionEngine
            feature_extractor: InferenceFeatureExtractor instance
        """
        self.store = session_store
        self.engine_factory = decision_engine_factory
        self.feature_extractor = feature_extractor
        
        # Bedrock reporter for terminal decisions
        try:
            from app.agent.orchestrator_utils.bedrock_reporter import BedrockReporter
            self.bedrock_reporter = BedrockReporter()
            logger.info("Bedrock reporter initialized")
        except Exception as e:
            logger.warning(f"Bedrock reporter initialization failed: {e}")
            self.bedrock_reporter = None
        
        logger.info("Initialized PatientSessionManager")
    
    def create_session(self, patient_id: str, patient_data: Dict) -> Dict:
        """
        Create new patient session and make initial decision.
        
        Args:
            patient_id: Unique patient identifier
            patient_data: Patient information dict
        
        Returns:
            Initial decision dict
        """
        # Create session
        session = self.store.create(patient_id, patient_data)
        
        # Make initial decision
        decision = self._execute_decision(session)
        
        # Update session
        self.store.update(patient_id, session)
        
        logger.info(f"Created session {patient_id}, initial decision: {decision['decision']}")
        
        return {
            'patient_id': patient_id,
            'iteration': session.iteration,
            'decision': decision,
            'session_state': {
                'modalities_completed': session.modalities_completed,
                'is_complete': session.is_complete
            }
        }
    
    def get_session_status(self, patient_id: str) -> Optional[Dict]:
        """Get current session status."""
        session = self.store.get(patient_id)
        
        if session is None:
            return None
        
        return {
            'patient_id': patient_id,
            'iteration': session.iteration,
            'modalities_completed': session.modalities_completed,
            'is_complete': session.is_complete,
            'final_decision': session.final_decision,
            'created_at': datetime.fromtimestamp(session.created_at).isoformat(),
            'updated_at': datetime.fromtimestamp(session.updated_at).isoformat()
        }
    
    def add_modality_result(self, patient_id: str, modality: str, result: Dict, rag_context: str = "") -> Dict:
        """
        Add modality inference result and trigger next decision.
        
        Args:
            patient_id: Patient identifier
            modality: Modality name ('ECG', 'CXR', 'LAB')
            result: Inference result dict
            rag_context: RAG context text (for terminal decisions)
        
        Returns:
            Next decision dict
        """
        session = self.store.get(patient_id)
        
        if session is None:
            raise ValueError(f"Session not found: {patient_id}")
        
        if session.is_complete:
            raise ValueError(f"Session already complete: {patient_id}")
        
        # Add modality to completed list
        if modality not in session.modalities_completed:
            session.modalities_completed.append(modality)
        
        # Add inference result
        result_with_modality = {**result, 'modality': modality}
        session.inference_results.append(result_with_modality)
        
        # Increment iteration
        session.iteration += 1
        
        logger.info(f"Patient {patient_id}: Added {modality} result, iteration {session.iteration}")
        
        # Check max iterations
        if session.iteration > self.MAX_ITERATIONS:
            logger.warning(f"Patient {patient_id}: Max iterations reached, forcing completion")
            return self._handle_terminal_decision(
                session=session,
                decision_type='GENERATE_REPORT',
                ml_confidence=0.0,
                rag_context=rag_context,
                rationale=f'Max iterations ({self.MAX_ITERATIONS}) reached'
            )
        
        # Execute next decision
        decision = self._execute_decision(session, rag_context)
        
        # Update session
        self.store.update(patient_id, session)
        
        return {
            'patient_id': patient_id,
            'iteration': session.iteration,
            'decision': decision,
            'session_state': {
                'modalities_completed': session.modalities_completed,
                'is_complete': session.is_complete
            }
        }
    
    def _execute_decision(self, session: PatientSession, rag_context: str = "") -> Dict:
        """
        Execute decision using HybridDecisionEngine.
        
        Args:
            session: Patient session
            rag_context: RAG context for terminal decisions
        
        Returns:
            Decision dict
        """
        # Create decision engine
        engine = self.engine_factory(
            patient=session.patient_data,
            modalities_completed=session.modalities_completed,
            inference_results=session.inference_results,
            iteration=session.iteration
        )
        
        # Get decision
        decision = engine.decide()
        
        # Check if session should be completed (terminal decision)
        if decision['decision'] in ['GENERATE_REPORT', 'NEED_REASONING']:
            return self._handle_terminal_decision(
                session=session,
                decision_type=decision['decision'],
                ml_confidence=decision.get('ml_scores', {}).get('stop', 0.0) if decision['decision'] == 'GENERATE_REPORT' else decision.get('ml_scores', {}).get('need_reasoning', 0.0),
                rag_context=rag_context,
                rationale=decision['rationale']
            )
        
        return decision
    
    def _handle_terminal_decision(
        self,
        session: PatientSession,
        decision_type: str,
        ml_confidence: float,
        rag_context: str = "",
        rationale: str = ""
    ) -> Dict:
        """
        Handle terminal decisions (GENERATE_REPORT / NEED_REASONING).
        Calls Bedrock to generate clinical report and closes session.
        
        Args:
            session: Patient session
            decision_type: "GENERATE_REPORT" or "NEED_REASONING"
            ml_confidence: ML confidence score
            rag_context: RAG context text
            rationale: Decision rationale
        
        Returns:
            Decision dict with report
        """
        from app.agent.orchestrator_utils.bedrock_reporter import (
            TerminalReason,
            build_patient_context_from_session
        )
        
        # Map decision type to terminal reason
        terminal_reason = (
            TerminalReason.NEED_REASONING
            if decision_type == "NEED_REASONING"
            else TerminalReason.STOP
        )
        
        # Generate report if Bedrock is available
        report_data = None
        if self.bedrock_reporter:
            try:
                # Build context
                ctx = build_patient_context_from_session(
                    session=session,
                    rag_context=rag_context,
                    terminal_reason=terminal_reason
                )
                ctx.ml_confidence = ml_confidence
                
                # Generate report
                report = self.bedrock_reporter.generate_report(ctx)
                
                report_data = {
                    'text': report.report_text,
                    'structured': report.structured,
                    'model_used': report.model_used,
                    'terminal_reason': terminal_reason.value,
                    'error': report.error,
                    'usage': report.usage
                }
                
                logger.info(f"Patient {session.patient_id}: Report generated via Bedrock")
                
            except Exception as e:
                logger.error(f"Patient {session.patient_id}: Bedrock report generation failed: {e}")
                report_data = {
                    'text': '',
                    'structured': {},
                    'model_used': 'none',
                    'terminal_reason': terminal_reason.value,
                    'error': str(e),
                    'usage': {}
                }
        else:
            logger.warning(f"Patient {session.patient_id}: Bedrock reporter not available")
            report_data = {
                'text': f'Session completed: {rationale}',
                'structured': {},
                'model_used': 'none',
                'terminal_reason': terminal_reason.value,
                'error': 'Bedrock reporter not initialized',
                'usage': {}
            }
        
        # Mark session as complete
        session.is_complete = True
        session.final_decision = decision_type
        self.store.update(session.patient_id, session)
        
        logger.info(f"Patient {session.patient_id}: Session complete with {decision_type}")
        
        return {
            'decision': decision_type,
            'rationale': rationale,
            'terminal_reason': terminal_reason.value,
            'report': report_data,
            'decision_source': 'terminal'
        }
    
    def complete_session(self, patient_id: str, reason: str = 'manual'):
        """Manually complete a session."""
        session = self.store.get(patient_id)
        
        if session is None:
            raise ValueError(f"Session not found: {patient_id}")
        
        session.is_complete = True
        session.final_decision = f'COMPLETED_{reason.upper()}'
        self.store.update(patient_id, session)
        
        logger.info(f"Manually completed session {patient_id}: {reason}")
    
    def delete_session(self, patient_id: str):
        """Delete a session."""
        self.store.delete(patient_id)
    
    def list_active_sessions(self) -> List[str]:
        """List all active session IDs."""
        return self.store.list_active()


def create_session_manager(
    use_redis: bool = False,
    redis_url: Optional[str] = None,
    ml_models_initial: Optional[Dict] = None,
    ml_models_followup: Optional[Dict] = None,
    ml_metadata_initial: Optional[Dict] = None,
    ml_metadata_followup: Optional[Dict] = None,
    cc_map = None,
    feature_extractor = None
) -> PatientSessionManager:
    """
    Factory function to create PatientSessionManager.
    
    Args:
        use_redis: Use Redis backend (True) or in-memory (False)
        redis_url: Redis connection URL (required if use_redis=True)
        ml_models_initial: Initial ML models dict
        ml_models_followup: Follow-up ML models dict
        ml_metadata_initial: Initial metadata dict
        ml_metadata_followup: Follow-up metadata dict
        cc_map: ChiefComplaintModalityMap instance
        feature_extractor: InferenceFeatureExtractor instance
    
    Returns:
        Configured PatientSessionManager
    """
    # Create session store
    if use_redis:
        if redis_url is None:
            raise ValueError("redis_url required when use_redis=True")
        
        import redis
        redis_client = redis.from_url(redis_url)
        session_store = RedisSessionStore(redis_client)
        logger.info(f"Using Redis session store: {redis_url}")
    else:
        session_store = InMemorySessionStore()
        logger.info("Using in-memory session store")
    
    # Create decision engine factory
    def engine_factory(patient, modalities_completed, inference_results, iteration):
        from app.agent.hybrid_decision_engine import HybridDecisionEngine
        
        return HybridDecisionEngine(
            patient=patient,
            modalities_completed=modalities_completed,
            inference_results=inference_results,
            iteration=iteration,
            ml_models_initial=ml_models_initial,
            ml_models_followup=ml_models_followup,
            ml_metadata_initial=ml_metadata_initial,
            ml_metadata_followup=ml_metadata_followup,
            cc_map=cc_map,
            feature_extractor=feature_extractor
        )
    
    return PatientSessionManager(
        session_store=session_store,
        decision_engine_factory=engine_factory,
        feature_extractor=feature_extractor
    )
