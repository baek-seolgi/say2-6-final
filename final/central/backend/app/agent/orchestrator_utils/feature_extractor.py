"""
Real-time Feature Extraction for Inference.

This module extracts the exact 74 features required by the Follow-up ML model,
matching the ground truth specification from metadata.pkl.

Feature Specification (74 total):
  1-7:   State features (has_*)
  8-14:  CXR features (7 CheXpert labels)
  15-38: ECG features (24 ICD diagnosis codes)
  39-49: Lab abnormal flags (11 flags)
  50-54: Demographics & Initial Assessment (5)
  55-57: CC Prior (3)
  58:    Shock Index (1)
  59-64: Vitals (6)
  65-74: Lab values (10)
"""
import logging
import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


class InferenceFeatureExtractor:
    """
    Extract all 74 features for real-time inference.
    
    This class ensures feature consistency between training and inference
    by using the exact feature names and encoders from metadata.pkl.
    """
    
    # Feature specification (ground truth from metadata.pkl)
    FEATURE_SPEC = {
        'state': ['elapsed_hours', 'has_lab', 'has_ecg', 'has_cxr', 
                  'has_lab_visited', 'has_ecg_visited', 'has_cxr_visited'],
        'cxr': ['cxr_Atelectasis', 'cxr_Cardiomegaly', 'cxr_Consolidation',
                'cxr_Edema', 'cxr_Fracture', 'cxr_Pneumonia', 'cxr_Pneumothorax'],
        'ecg': ['ecg_acute_kidney_failure', 'ecg_acute_myocardial_infarction',
                'ecg_angina_pectoris', 'ecg_atrial_fibrillation_flutter',
                'ecg_av_block_left_bundle_block', 'ecg_calcium_metabolism_disorder',
                'ecg_cardiac_arrest', 'ecg_chronic_ischemic_heart_disease',
                'ecg_chronic_kidney_disease', 'ecg_copd', 'ecg_heart_failure',
                'ecg_hyperkalemia', 'ecg_hypertension', 'ecg_hypokalemia',
                'ecg_hypothyroidism', 'ecg_other_cardiac_arrhythmias',
                'ecg_other_conduction_disorders', 'ecg_paroxysmal_tachycardia',
                'ecg_pericardial_disease', 'ecg_pulmonary_embolism',
                'ecg_pulmonary_heart_disease', 'ecg_respiratory_failure',
                'ecg_sepsis', 'ecg_type2_diabetes'],
        'lab_abnormal': ['is_abnormal', 'lab_bun_abnormal', 'lab_creatinine_abnormal',
                        'lab_glucose_abnormal', 'lab_hemoglobin_abnormal',
                        'lab_lactate_abnormal', 'lab_platelet_count_abnormal',
                        'lab_potassium_abnormal', 'lab_sodium_abnormal',
                        'lab_troponin_t_abnormal', 'lab_white_blood_cells_abnormal'],
        'demographics': ['anchor_age', 'gender'],
        'initial_assessment': ['acuity', 'pain', 'chiefcomplaint'],
        'cc_prior': ['cc_prior_ecg', 'cc_prior_cxr', 'cc_prior_lab'],
        'shock_index': ['shock_index'],
        'vitals': ['vital_temperature', 'vital_heartrate', 'vital_resprate',
                   'vital_o2sat', 'vital_sbp', 'vital_dbp'],
        'labs': ['lab_Troponin_T', 'lab_Lactate', 'lab_Creatinine', 'lab_Glucose',
                 'lab_Potassium', 'lab_Sodium', 'lab_Hemoglobin',
                 'lab_White_Blood_Cells', 'lab_Platelet_Count', 'lab_BUN']
    }
    
    # Lab normal ranges (for abnormal flag calculation)
    LAB_NORMAL_RANGES = {
        'Troponin_T': (0.0, 0.01),      # ng/mL
        'Lactate': (0.5, 2.2),           # mmol/L
        'Creatinine': (0.7, 1.3),        # mg/dL
        'Glucose': (70, 100),            # mg/dL (fasting)
        'Potassium': (3.5, 5.0),         # mEq/L
        'Sodium': (136, 145),            # mEq/L
        'Hemoglobin': (12.0, 17.5),      # g/dL
        'White_Blood_Cells': (4.5, 11.0), # K/uL
        'Platelet_Count': (150, 400),    # K/uL
        'BUN': (7, 20)                   # mg/dL
    }
    
    def __init__(self, cc_map, metadata: Dict[str, Any]):
        """
        Initialize feature extractor.
        
        Args:
            cc_map: ChiefComplaintModalityMap instance for CC Prior calculation
            metadata: Model metadata containing encoders and feature names
        """
        self.cc_map = cc_map
        self.metadata = metadata
        self.encoders = metadata.get('encoders', {})
        self.expected_features = metadata.get('feature_names', [])
        
        # Validate feature spec matches metadata
        all_spec_features = []
        for features in self.FEATURE_SPEC.values():
            all_spec_features.extend(features)
        
        if len(all_spec_features) != len(self.expected_features):
            logger.warning(
                f"Feature spec mismatch: spec has {len(all_spec_features)}, "
                f"metadata has {len(self.expected_features)}"
            )
        
        logger.info(f"Initialized InferenceFeatureExtractor with {len(self.expected_features)} features")
    
    def extract_all_features(
        self,
        patient_data: Dict[str, Any],
        modalities_completed: List[str],
        inference_results: List[Dict[str, Any]]
    ) -> pd.DataFrame:
        """
        Extract all 74 features for inference.
        
        Args:
            patient_data: Patient information dict
            modalities_completed: List of completed modalities ['ECG', 'CXR', 'LAB']
            inference_results: List of inference results from completed modalities
        
        Returns:
            DataFrame with single row containing all 74 features in correct order
        """
        features = {}
        
        # 1. State features (7)
        features.update(self._extract_state_features(patient_data, modalities_completed))
        
        # 2. CXR features (7)
        features.update(self._extract_cxr_features(modalities_completed, inference_results))
        
        # 3. ECG features (24)
        features.update(self._extract_ecg_features(modalities_completed, inference_results))
        
        # 4. Lab abnormal flags (11)
        features.update(self._extract_lab_abnormal_flags(patient_data))
        
        # 5. Demographics (2)
        features.update(self._extract_demographics(patient_data))
        
        # 6. Initial Assessment (3)
        features.update(self._extract_initial_assessment(patient_data))
        
        # 7. CC Prior (3)
        features.update(self._extract_cc_prior(patient_data))
        
        # 8. Shock Index (1)
        features.update(self._extract_shock_index(patient_data))
        
        # 9. Vitals (6)
        features.update(self._extract_vitals(patient_data))
        
        # 10. Lab values (10)
        features.update(self._extract_labs(patient_data))
        
        # Create DataFrame with correct column order
        df = pd.DataFrame([features], columns=self.expected_features)
        
        # Fill any missing features with 0
        for col in self.expected_features:
            if col not in df.columns:
                logger.warning(f"Missing feature: {col}, filling with 0")
                df[col] = 0
        
        # DEBUG: Print feature values
        print("\n" + "=" * 80)
        print("FEATURE EXTRACTION DEBUG")
        print("=" * 80)
        print(f"Total features: {len(df.columns)}")
        
        # ECG features
        ecg_cols = [c for c in df.columns if 'ecg' in c.lower()]
        if ecg_cols:
            print(f"\nECG features ({len(ecg_cols)}):")
            ecg_values = df[ecg_cols].iloc[0].to_dict()
            non_zero_ecg = {k: v for k, v in ecg_values.items() if v != 0}
            if non_zero_ecg:
                print(f"  Non-zero: {non_zero_ecg}")
            else:
                print(f"  All zeros (ECG completed: {'ECG' in modalities_completed})")
        
        # CXR features
        cxr_cols = [c for c in df.columns if 'cxr' in c.lower()]
        if cxr_cols:
            print(f"\nCXR features ({len(cxr_cols)}):")
            cxr_values = df[cxr_cols].iloc[0].to_dict()
            non_zero_cxr = {k: v for k, v in cxr_values.items() if v != 0}
            if non_zero_cxr:
                print(f"  Non-zero: {non_zero_cxr}")
            else:
                print(f"  All zeros (CXR completed: {'CXR' in modalities_completed})")
        
        # CC Prior
        cc_prior_cols = [c for c in df.columns if 'cc_prior' in c]
        if cc_prior_cols:
            print(f"\nCC Prior features:")
            cc_prior_values = df[cc_prior_cols].iloc[0].to_dict()
            print(f"  {cc_prior_values}")
        
        # State features
        state_cols = [c for c in df.columns if c.startswith('has_')]
        if state_cols:
            print(f"\nState features:")
            state_values = df[state_cols].iloc[0].to_dict()
            print(f"  {state_values}")
        
        # Lab abnormal flags
        lab_abnormal_cols = [c for c in df.columns if 'abnormal' in c]
        if lab_abnormal_cols:
            print(f"\nLab abnormal flags:")
            lab_abnormal_values = df[lab_abnormal_cols].iloc[0].to_dict()
            non_zero_abnormal = {k: v for k, v in lab_abnormal_values.items() if v != 0}
            if non_zero_abnormal:
                print(f"  Non-zero: {non_zero_abnormal}")
            else:
                print(f"  All zeros")
        
        print("=" * 80 + "\n")
        
        return df
    
    def _extract_state_features(self, patient_data: Dict, modalities_completed: List[str]) -> Dict:
        """Extract state features (has_*, elapsed_hours)."""
        return {
            'elapsed_hours': patient_data.get('elapsed_hours', 0.0),
            'has_lab': 1 if 'LAB' in modalities_completed else 0,
            'has_ecg': 1 if 'ECG' in modalities_completed else 0,
            'has_cxr': 1 if 'CXR' in modalities_completed else 0,
            'has_lab_visited': modalities_completed.count('LAB'),
            'has_ecg_visited': modalities_completed.count('ECG'),
            'has_cxr_visited': modalities_completed.count('CXR'),
        }
    
    def _extract_cxr_features(self, modalities_completed: List[str], 
                             inference_results: List[Dict]) -> Dict:
        """Extract CXR CheXpert features (7 labels)."""
        features = {f: 0 for f in self.FEATURE_SPEC['cxr']}
        
        if 'CXR' not in modalities_completed:
            return features
        
        # Find CXR result
        cxr_result = next((r for r in inference_results if r.get('modality') == 'CXR'), None)
        
        if cxr_result and 'chexpert_labels' in cxr_result:
            # CheXpert labels from inference result
            chexpert = cxr_result['chexpert_labels']
            for label in self.FEATURE_SPEC['cxr']:
                label_name = label.replace('cxr_', '')
                features[label] = chexpert.get(label_name, 0)
        
        return features
    
    def _extract_ecg_features(self, modalities_completed: List[str],
                             inference_results: List[Dict]) -> Dict:
        """Extract ECG ICD diagnosis features (24 codes)."""
        features = {f: 0 for f in self.FEATURE_SPEC['ecg']}
        
        if 'ECG' not in modalities_completed:
            return features
        
        # Find ECG result
        ecg_result = next((r for r in inference_results if r.get('modality') == 'ECG'), None)
        
        if ecg_result and 'icd_diagnoses' in ecg_result:
            # ICD diagnoses from inference result
            icd_codes = ecg_result['icd_diagnoses']
            for label in self.FEATURE_SPEC['ecg']:
                diagnosis_name = label.replace('ecg_', '')
                features[label] = 1 if diagnosis_name in icd_codes else 0
        
        return features
    
    def _extract_lab_abnormal_flags(self, patient_data: Dict) -> Dict:
        """Extract lab abnormal flags (11 flags)."""
        features = {}
        
        # Individual lab abnormal flags
        any_abnormal = False
        for lab_name, (low, high) in self.LAB_NORMAL_RANGES.items():
            value = patient_data.get(lab_name.lower(), None)
            
            flag_name = f'lab_{lab_name.lower()}_abnormal'
            if value is None or value == 0:
                features[flag_name] = 0
            else:
                is_abnormal = (value < low or value > high)
                features[flag_name] = 1 if is_abnormal else 0
                if is_abnormal:
                    any_abnormal = True
        
        # Overall abnormal flag
        features['is_abnormal'] = 1 if any_abnormal else 0
        
        return features
    
    def _extract_demographics(self, patient_data: Dict) -> Dict:
        """Extract demographics (age, gender)."""
        gender = patient_data.get('gender', 'MISSING')
        
        # Encode gender using metadata encoder
        if 'gender' in self.encoders:
            try:
                le = self.encoders['gender']
                if gender in le.classes_:
                    gender_encoded = le.transform([gender])[0]
                else:
                    gender_encoded = le.transform(['MISSING'])[0] if 'MISSING' in le.classes_ else 0
            except Exception as e:
                logger.warning(f"Failed to encode gender: {e}")
                gender_encoded = 0
        else:
            gender_encoded = 0
        
        return {
            'anchor_age': patient_data.get('age', 0),
            'gender': gender_encoded
        }
    
    def _extract_initial_assessment(self, patient_data: Dict) -> Dict:
        """Extract initial assessment (acuity, pain, chiefcomplaint)."""
        features = {}
        
        # Acuity
        acuity = patient_data.get('acuity', 3)
        if 'acuity' in self.encoders:
            try:
                le = self.encoders['acuity']
                features['acuity'] = le.transform([str(acuity)])[0]
            except:
                features['acuity'] = acuity
        else:
            features['acuity'] = acuity
        
        # Pain
        pain = patient_data.get('pain', 0)
        if 'pain' in self.encoders:
            try:
                le = self.encoders['pain']
                features['pain'] = le.transform([str(pain)])[0]
            except:
                features['pain'] = pain
        else:
            features['pain'] = pain
        
        # Chief complaint
        cc = patient_data.get('chief_complaint', 'MISSING').lower()
        if 'chiefcomplaint' in self.encoders:
            try:
                le = self.encoders['chiefcomplaint']
                if cc in le.classes_:
                    features['chiefcomplaint'] = le.transform([cc])[0]
                else:
                    features['chiefcomplaint'] = le.transform(['MISSING'])[0] if 'MISSING' in le.classes_ else 0
            except Exception as e:
                logger.warning(f"Failed to encode chiefcomplaint: {e}")
                features['chiefcomplaint'] = 0
        else:
            features['chiefcomplaint'] = 0
        
        return features
    
    def _extract_cc_prior(self, patient_data: Dict) -> Dict:
        """Extract CC Prior features using CC Map."""
        cc = patient_data.get('chief_complaint', '').lower()
        
        # Default: no prior
        features = {
            'cc_prior_ecg': 0.0,
            'cc_prior_cxr': 0.0,
            'cc_prior_lab': 0.0
        }
        
        if not self.cc_map or not cc:
            return features
        
        try:
            # Get statistics from CC Map
            stats = self.cc_map.get_statistics(cc)
            
            if not stats.empty:
                # Convert percentages to probabilities
                for _, row in stats.iterrows():
                    modality = row['first_modality'].lower()
                    pct = row['pct'] / 100.0
                    
                    if modality in ['ecg', 'cxr', 'lab']:
                        features[f'cc_prior_{modality}'] = pct
        except Exception as e:
            logger.warning(f"Failed to calculate CC Prior: {e}")
        
        return features
    
    def _extract_shock_index(self, patient_data: Dict) -> Dict:
        """Calculate shock index (HR / SBP)."""
        hr = patient_data.get('heartrate', 0)
        sbp = patient_data.get('sbp', 0)
        
        if sbp > 0:
            shock_index = hr / sbp
        else:
            shock_index = 0.0
        
        return {'shock_index': shock_index}
    
    def _extract_vitals(self, patient_data: Dict) -> Dict:
        """Extract vital signs (6 values)."""
        return {
            'vital_temperature': patient_data.get('temperature', 0.0),
            'vital_heartrate': patient_data.get('heartrate', 0.0),
            'vital_resprate': patient_data.get('resprate', 0.0),
            'vital_o2sat': patient_data.get('o2sat', 0.0),
            'vital_sbp': patient_data.get('sbp', 0.0),
            'vital_dbp': patient_data.get('dbp', 0.0),
        }
    
    def _extract_labs(self, patient_data: Dict) -> Dict:
        """Extract lab values (10 values)."""
        return {
            'lab_Troponin_T': patient_data.get('troponin_t', 0.0),
            'lab_Lactate': patient_data.get('lactate', 0.0),
            'lab_Creatinine': patient_data.get('creatinine', 0.0),
            'lab_Glucose': patient_data.get('glucose', 0.0),
            'lab_Potassium': patient_data.get('potassium', 0.0),
            'lab_Sodium': patient_data.get('sodium', 0.0),
            'lab_Hemoglobin': patient_data.get('hemoglobin', 0.0),
            'lab_White_Blood_Cells': patient_data.get('wbc', 0.0),
            'lab_Platelet_Count': patient_data.get('platelets', 0.0),
            'lab_BUN': patient_data.get('bun', 0.0),
        }
    
    def validate_features(self, features_df: pd.DataFrame) -> bool:
        """
        Validate that extracted features match expected specification.
        
        Args:
            features_df: DataFrame with extracted features
        
        Returns:
            True if valid, False otherwise
        """
        # Check column count
        if len(features_df.columns) != len(self.expected_features):
            logger.error(
                f"Feature count mismatch: got {len(features_df.columns)}, "
                f"expected {len(self.expected_features)}"
            )
            return False
        
        # Check column names
        missing = set(self.expected_features) - set(features_df.columns)
        extra = set(features_df.columns) - set(self.expected_features)
        
        if missing:
            logger.error(f"Missing features: {missing}")
            return False
        
        if extra:
            logger.error(f"Extra features: {extra}")
            return False
        
        # Check column order
        if list(features_df.columns) != self.expected_features:
            logger.warning("Feature order mismatch, reordering...")
            features_df = features_df[self.expected_features]
        
        logger.info("✓ Feature validation passed")
        return True


def load_feature_extractor(
    cc_map_path: str = 'data/chief_complaint_modality_map.parquet',
    metadata_path: str = 'orchestrator/models_stratified/followup/metadata.pkl'
) -> InferenceFeatureExtractor:
    """
    Convenience function to load feature extractor.
    
    Args:
        cc_map_path: Path to CC map parquet file
        metadata_path: Path to model metadata.pkl
    
    Returns:
        Initialized InferenceFeatureExtractor
    """
    import pickle
    from app.agent.orchestrator_utils.cc_map import load_cc_map
    
    # Load CC map
    cc_map = load_cc_map(cc_map_path)
    
    # Load metadata
    with open(metadata_path, 'rb') as f:
        metadata = pickle.load(f)
    
    return InferenceFeatureExtractor(cc_map, metadata)
