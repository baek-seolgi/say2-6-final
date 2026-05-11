"""
Data-Driven Hybrid Decision Engine - ML-First with CC Map Prior.

Strategy:
1. ML Models (Primary) - Data-driven predictions from MIMIC
2. CC Modality Map (Prior) - Initial routing based on historical data
3. NO hardcoded clinical rules - all decisions from data

Decision Flow:
- Initial: Use CC map for prior, ML for prediction
- Follow-up: ML models with context from completed modalities
"""
import logging
import pickle
import os
import numpy as np
import pandas as pd
from app.agent.orchestrator_utils.cc_map import ChiefComplaintModalityMap

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class HybridDecisionEngine:
    """
    Data-driven hybrid decision engine.
    
    Components:
    1. Initial Decision Model - First modality selection (ML)
    2. Follow-up Decision Model - Additional tests, stop, reasoning (ML)
    3. CC Modality Map - Prior for initial routing (data-driven)
    
    NO hardcoded clinical rules - all decisions from MIMIC data.
    """
    
    # ML Model thresholds
    ML_VERY_HIGH_CONFIDENCE = 0.95  # Almost certain
    ML_HIGH_CONFIDENCE = 0.90        # Very confident
    ML_MEDIUM_CONFIDENCE = 0.70      # Somewhat confident
    ML_LOW_CONFIDENCE = 0.50         # Uncertain
    
    MAX_ITERATIONS = 3
    
    def __init__(self, patient, modalities_completed, inference_results, 
                 iteration=1, ml_models_initial=None, ml_models_followup=None,
                 ml_metadata_initial=None, ml_metadata_followup=None,
                 cc_map=None, feature_extractor=None):
        """
        Initialize hybrid engine.
        
        Args:
            patient: Patient data dict
            modalities_completed: List of completed modalities
            inference_results: Results from modality inference
            iteration: Current iteration number
            ml_models_initial: Dict of Initial Decision ML models
            ml_models_followup: Dict of Follow-up Decision ML models
            ml_metadata_initial: Initial model metadata
            ml_metadata_followup: Follow-up model metadata
            cc_map: ChiefComplaintModalityMap instance
            feature_extractor: InferenceFeatureExtractor instance
        """
        self.patient = patient
        self.modalities_completed = modalities_completed
        self.inference_results = inference_results
        self.iteration = iteration
        self.chief_complaint = patient.get('chief_complaint', '').lower()
        
        # ML models (stratified)
        self.ml_models_initial = ml_models_initial or {}
        self.ml_models_followup = ml_models_followup or {}
        self.ml_metadata_initial = ml_metadata_initial or {}
        self.ml_metadata_followup = ml_metadata_followup or {}
        
        # CC Modality Map (data-driven prior)
        self.cc_map = cc_map
        
        # Feature extractor
        self.feature_extractor = feature_extractor
        
        # DEBUG: Log feature_extractor status
        if feature_extractor:
            logger.info(f"✓ HybridDecisionEngine initialized WITH feature_extractor")
        else:
            logger.warning(f"✗ HybridDecisionEngine initialized WITHOUT feature_extractor")
        
        # Index results by modality
        self.results_by_modality = {}
        for result in inference_results:
            modality = result.get('modality', '')
            self.results_by_modality[modality] = result
    
    def decide(self):
        """
        Main data-driven decision logic.
        
        Decision Flow:
        1. Initial: CC Map prior + Initial ML Model
        2. Follow-up: Follow-up ML Model (with context)
        3. NO hardcoded rules - all from MIMIC data
        """
        # Step 1: Initial modality selection
        if not self.inference_results:
            return self._initial_modality_selection()
        
        # Step 2: Get ML decision (stratified models)
        ml_decision = self._get_ml_decision()
        
        if not ml_decision:
            # Fallback if ML fails
            logger.warning("ML prediction failed, using conservative default")
            return {
                'decision': 'GENERATE_REPORT',
                'rationale': 'ML prediction unavailable, defaulting to report generation',
                'risk_level': 'unknown',
                'confidence_summary': self._get_confidence_summary(),
                'decision_source': 'fallback'
            }
        
        # Step 3: Execute ML decision (argmax-based, no additional thresholds)
        action = ml_decision['action']
        confidence = ml_decision['confidence']
        
        # Check max iterations
        if action == 'CALL_NEXT_MODALITY' and self.iteration >= self.MAX_ITERATIONS:
            return {
                'decision': 'GENERATE_REPORT',
                'rationale': f'Max iterations reached ({self.MAX_ITERATIONS}), generating report',
                'risk_level': self._assess_risk_level(),
                'confidence_summary': self._get_confidence_summary(),
                'ml_scores': ml_decision['scores'],
                'decision_source': 'max_iterations'
            }
        
        # Execute ML decision directly (argmax already applied in _interpret_ml_predictions)
        return {
            'decision': action,
            'rationale': ml_decision['rationale'],
            'risk_level': self._assess_risk_level(),
            'confidence_summary': self._get_confidence_summary(),
            'ml_scores': ml_decision['scores'],
            'decision_source': 'ml_argmax'
        }
    
    def _get_ml_decision(self):
        """
        Get ML model predictions using stratified models.
        
        Uses Initial Model if no modalities completed yet,
        otherwise uses Follow-up Model.
        
        Returns:
            Dict with action, confidence, rationale, and scores
        """
        # Determine which model set to use
        is_initial = len(self.modalities_completed) == 0
        
        if is_initial:
            models = self.ml_models_initial
            model_type = 'initial'
        else:
            models = self.ml_models_followup
            model_type = 'followup'
        
        if not models:
            logger.warning(f"No {model_type} ML models available")
            return None
        
        try:
            # Use InferenceFeatureExtractor if available
            if self.feature_extractor:
                features_df = self.feature_extractor.extract_all_features(
                    patient_data=self.patient,
                    modalities_completed=self.modalities_completed,
                    inference_results=self.inference_results
                )
                features = features_df
            else:
                # Fallback to old method
                logger.warning("No feature_extractor available, using fallback method")
                features = self._prepare_ml_features(is_initial)
            
            # Get predictions from models
            predictions = {}
            for label, model in models.items():
                if isinstance(model, list):
                    # Ensemble model
                    preds = [m.predict(features)[0] for m in model]
                    score = np.mean(preds)
                else:
                    # Single model
                    score = model.predict(features)[0]
                
                predictions[label] = score
            
            # Determine action based on predictions
            action, confidence, rationale = self._interpret_ml_predictions(predictions, is_initial)
            
            return {
                'action': action,
                'confidence': confidence,
                'rationale': rationale,
                'scores': predictions,
                'model_type': model_type
            }
        
        except Exception as e:
            logger.warning(f"ML prediction failed: {e}")
            return None
    
    def _prepare_ml_features(self, is_initial=False):
        """
        Prepare features for ML model from patient data.
        
        Args:
            is_initial: If True, exclude has_* features (Initial model)
                       If False, include has_* features (Follow-up model)
        """
        # Get metadata for the appropriate model
        metadata = self.ml_metadata_initial if is_initial else self.ml_metadata_followup
        
        if not metadata or 'feature_names' not in metadata:
            logger.warning("No metadata available, using basic features")
            return self._prepare_basic_features(is_initial)
        
        # Get expected feature names from metadata
        expected_features = metadata['feature_names']
        
        # Initialize all features with 0
        features = {feat: 0 for feat in expected_features}
        
        # Fill in available patient data
        feature_mapping = {
            'anchor_age': self.patient.get('age', 0),
            'gender': self.patient.get('gender', 'MISSING'),
            'acuity': self.patient.get('acuity', 3),
            'pain': self.patient.get('pain', 0),
            'chiefcomplaint': self.chief_complaint,
            # Vital signs
            'vital_heartrate': self.patient.get('heartrate', 0),
            'vital_sbp': self.patient.get('sbp', 0),
            'vital_dbp': self.patient.get('dbp', 0),
            'vital_temperature': self.patient.get('temperature', 0),
            'vital_resprate': self.patient.get('resprate', 0),
            'vital_o2sat': self.patient.get('o2sat', 0),
            # Lab values
            'lab_Troponin_T': self.patient.get('troponin', 0),
            'lab_Lactate': self.patient.get('lactate', 0),
            'lab_White_Blood_Cells': self.patient.get('wbc', 0),
            'lab_Hemoglobin': self.patient.get('hemoglobin', 0),
            'lab_Platelet_Count': self.patient.get('platelets', 0),
            'lab_Potassium': self.patient.get('potassium', 0),
            'lab_Glucose': self.patient.get('glucose', 0),
            # Time
            'elapsed_hours': self.patient.get('elapsed_hours', 0),
        }
        
        # Add has_* features for Follow-up model
        if not is_initial:
            feature_mapping.update({
                'has_ecg': 1 if 'ECG' in self.modalities_completed else 0,
                'has_cxr': 1 if 'CXR' in self.modalities_completed else 0,
                'has_lab': 1 if 'LAB' in self.modalities_completed else 0,
                'has_ecg_visited': len([m for m in self.modalities_completed if m == 'ECG']),
                'has_cxr_visited': len([m for m in self.modalities_completed if m == 'CXR']),
                'has_lab_visited': len([m for m in self.modalities_completed if m == 'LAB']),
            })
        
        # Update features dict with available values
        for key, value in feature_mapping.items():
            if key in features:
                features[key] = value
        
        # Create DataFrame with correct column order
        df = pd.DataFrame([features], columns=expected_features)
        
        # Encode categorical features using metadata encoders
        if 'encoders' in metadata:
            encoders = metadata['encoders']
            
            for col in ['gender', 'chiefcomplaint', 'acuity', 'pain']:
                if col in df.columns and col in encoders:
                    try:
                        le = encoders[col]
                        value = df[col].iloc[0]
                        
                        # Convert to string for encoding
                        value_str = str(value)
                        
                        if value_str in le.classes_:
                            df[col] = le.transform([value_str])[0]
                        else:
                            # Use 'MISSING' encoding if available, else 0
                            if 'MISSING' in le.classes_:
                                df[col] = le.transform(['MISSING'])[0]
                            else:
                                df[col] = 0
                    except Exception as e:
                        logger.warning(f"Failed to encode {col}: {e}")
                        df[col] = 0
        
        return df
    
    def _prepare_basic_features(self, is_initial=False):
        """Fallback method to prepare basic features when metadata is unavailable."""
        features = {
            'anchor_age': self.patient.get('age', 0),
            'gender': 0,  # Encoded
            'acuity': self.patient.get('acuity', 3),
            'pain': self.patient.get('pain', 0),
            'chiefcomplaint': 0,  # Encoded
            'vital_heartrate': self.patient.get('heartrate', 0),
            'vital_sbp': self.patient.get('sbp', 0),
            'vital_dbp': self.patient.get('dbp', 0),
            'vital_temperature': self.patient.get('temperature', 0),
            'vital_resprate': self.patient.get('resprate', 0),
            'vital_o2sat': self.patient.get('o2sat', 0),
            'elapsed_hours': self.patient.get('elapsed_hours', 0),
        }
        
        if not is_initial:
            features.update({
                'has_ecg': 1 if 'ECG' in self.modalities_completed else 0,
                'has_cxr': 1 if 'CXR' in self.modalities_completed else 0,
                'has_lab': 1 if 'LAB' in self.modalities_completed else 0,
                'has_ecg_visited': len([m for m in self.modalities_completed if m == 'ECG']),
                'has_cxr_visited': len([m for m in self.modalities_completed if m == 'CXR']),
                'has_lab_visited': len([m for m in self.modalities_completed if m == 'LAB']),
            })
        
        return pd.DataFrame([features])
    
    def _interpret_ml_predictions(self, predictions, is_initial=False):
        """
        Interpret ML predictions into actionable decisions using argmax strategy.
        
        Args:
            predictions: Dict of label -> score
            is_initial: Whether this is initial decision (no modalities yet)
        
        Strategy:
        - Use argmax (highest score wins) instead of fixed thresholds
        - Training data shows: need_reasoning (46%), stop (39%), order_lab (1.9%)
        - Fixed thresholds (0.50, 0.90) don't work for imbalanced multi-label data
        
        Returns:
            (action, confidence, rationale) tuple
        """
        if not predictions:
            return ('GENERATE_REPORT', 0.5, 'No predictions available')
        
        # Find highest scoring action
        max_label = max(predictions, key=predictions.get)
        max_score = predictions[max_label]
        
        # Minimum confidence threshold (prevent random guessing)
        MIN_CONFIDENCE = 0.02  # 2% - lower than rarest class (order_ecg 0.3%)
        
        if max_score < MIN_CONFIDENCE:
            return (
                'GENERATE_REPORT',
                max_score,
                f"All scores too low (max: {max_score:.2%}), defaulting to report"
            )
        
        # Map label to action
        if max_label == 'stop':
            return (
                'GENERATE_REPORT',
                max_score,
                f"ML: stop ({max_score:.2%}) - sufficient information gathered"
            )
        
        elif max_label == 'need_reasoning':
            return (
                'NEED_REASONING',
                max_score,
                f"ML: need_reasoning ({max_score:.2%}) - complex case requires LLM"
            )
        
        elif max_label in ['order_ecg', 'order_cxr', 'order_lab']:
            modality = max_label.replace('order_', '').upper()
            
            # Check if already completed
            if modality in self.modalities_completed:
                # Find next best uncompleted modality
                test_scores = {}
                for test in ['order_ecg', 'order_cxr', 'order_lab']:
                    if test in predictions:
                        mod = test.replace('order_', '').upper()
                        if mod not in self.modalities_completed:
                            test_scores[mod] = predictions[test]
                
                if test_scores:
                    best_modality = max(test_scores, key=test_scores.get)
                    best_score = test_scores[best_modality]
                    return (
                        'CALL_NEXT_MODALITY',
                        best_score,
                        f"ML: {best_modality} ({best_score:.2%}) - {modality} already done"
                    )
                else:
                    # All modalities completed, check stop vs need_reasoning
                    if 'need_reasoning' in predictions and predictions['need_reasoning'] > predictions.get('stop', 0):
                        return (
                            'NEED_REASONING',
                            predictions['need_reasoning'],
                            f"ML: need_reasoning ({predictions['need_reasoning']:.2%}) - all tests done"
                        )
                    else:
                        return (
                            'GENERATE_REPORT',
                            predictions.get('stop', max_score),
                            "ML: All modalities completed, generating report"
                        )
            
            return (
                'CALL_NEXT_MODALITY',
                max_score,
                f"ML: {modality} ({max_score:.2%})"
            )
        
        # Unknown label
        return (
            'GENERATE_REPORT',
            max_score,
            f"ML: unknown label '{max_label}' ({max_score:.2%}), defaulting to report"
        )
    
    # ========== Data-driven methods ==========
    
    def _initial_modality_selection(self):
        """
        Select initial modalities using CC Map (data-driven prior).
        
        Uses actual MIMIC data to determine which modality is most commonly
        ordered first for this chief complaint.
        """
        if self.cc_map:
            # Use data-driven CC map
            modalities = self.cc_map.get_initial_modalities(self.chief_complaint)
            source = 'cc_map_data'
        else:
            # Fallback: LAB is most common first modality in MIMIC
            logger.warning("CC map not available, using fallback")
            modalities = ['LAB']
            source = 'fallback'
        
        return {
            'decision': 'CALL_NEXT_MODALITY',
            'next_modalities': modalities,
            'rationale': f'Initial selection for: {self.chief_complaint} (data-driven)',
            'risk_level': 'unknown',
            'confidence_summary': {},
            'decision_source': source
        }
    
    def _assess_risk_level(self):
        """
        Assess overall risk level based on ML predictions and findings.
        
        This is a simple heuristic for UI display purposes.
        """
        if not self.inference_results:
            return 'unknown'
        
        # Check for abnormal findings (simple keyword matching)
        high_risk_keywords = ['stemi', 'st elevation', 'pneumothorax', 'massive', 
                             'severe', 'critical', 'acute', 'emergency']
        medium_risk_keywords = ['pneumonia', 'infiltrate', 'cardiomegaly', 
                               'arrhythmia', 'elevated', 'abnormal']
        
        all_findings = ' '.join([r.get('finding', '').lower() 
                                for r in self.inference_results])
        
        if any(kw in all_findings for kw in high_risk_keywords):
            return 'high'
        elif any(kw in all_findings for kw in medium_risk_keywords):
            return 'medium'
        else:
            return 'low'
    
    def _get_confidence_summary(self):
        """Get confidence summary for all modalities."""
        summary = {}
        for result in self.inference_results:
            modality = result.get('modality', 'unknown')
            confidence = result.get('confidence', 0.0)
            summary[modality] = confidence
        return summary


def load_stratified_models(
    initial_dir='./orchestrator/models_stratified/initial',
    followup_dir='./orchestrator/models_stratified/followup'
):
    """
    Load stratified ML models for hybrid engine.
    
    Args:
        initial_dir: Directory containing Initial Decision models
        followup_dir: Directory containing Follow-up Decision models
    
    Returns:
        Tuple of (initial_models, followup_models, initial_metadata, followup_metadata)
    """
    def load_models_from_dir(model_dir, labels):
        """Helper to load models from a directory."""
        if not os.path.exists(model_dir):
            logger.warning(f"Model directory not found: {model_dir}")
            return {}, {}
        
        try:
            # Load metadata
            with open(os.path.join(model_dir, 'metadata.pkl'), 'rb') as f:
                metadata = pickle.load(f)
            
            # Load models
            models = {}
            for label in labels:
                model_path = os.path.join(model_dir, f'lgbm_{label}.pkl')
                if os.path.exists(model_path):
                    with open(model_path, 'rb') as f:
                        models[label] = pickle.load(f)
                    logger.info(f"Loaded model: {label} from {model_dir}")
            
            return models, metadata
        
        except Exception as e:
            logger.error(f"Failed to load models from {model_dir}: {e}")
            return {}, {}
    
    # Load Initial models
    initial_labels = ['order_ecg', 'order_cxr', 'order_lab']
    initial_models, initial_metadata = load_models_from_dir(initial_dir, initial_labels)
    
    # Load Follow-up models
    followup_labels = ['order_ecg', 'order_cxr', 'order_lab', 'stop', 'need_reasoning']
    followup_models, followup_metadata = load_models_from_dir(followup_dir, followup_labels)
    
    return initial_models, followup_models, initial_metadata, followup_metadata
