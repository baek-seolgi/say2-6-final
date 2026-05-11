"""
Chief Complaint Modality Map Utility.

Loads and queries the data-driven chief complaint to modality mapping
extracted from MIMIC data.
"""
import pandas as pd
import logging

logger = logging.getLogger(__name__)


class ChiefComplaintModalityMap:
    """
    Data-driven chief complaint to modality mapping.
    
    Uses actual MIMIC data to determine which modality is most commonly
    ordered first for each chief complaint.
    """
    
    # Alias mapping for common chief complaint variations
    COMPLAINT_ALIASES = {
        'abd pain': 'abdominal pain',
        'abd pain, n/v': 'abdominal pain',
        'rlq abdominal pain': 'abdominal pain',
        'cp': 'chest pain',
        'chest pain, dyspnea': 'chest pain',
        'chest pain, sob': 'chest pain',
        'sob': 'shortness of breath',
        'dyspnea': 'shortness of breath',
        'n/v': 'nausea',
        'n/v/d': 'nausea',
        'ha': 'headache',
        'brbpr': 'rectal bleeding',
        'mvc': 'trauma',
        's/p fall': 'fall',
        'lower back pain': 'back pain',
        'altered mental status': 'altered mental status',
        'si': 'suicidal ideation',
    }
    
    def __init__(self, parquet_path='data/chief_complaint_modality_map.parquet'):
        """
        Load chief complaint modality map.
        
        Args:
            parquet_path: Path to cc_modality_map parquet file
        """
        self.df = pd.read_parquet(parquet_path)
        logger.info(f"Loaded CC modality map: {len(self.df)} records, {self.df['chief_complaint'].nunique()} unique chief complaints")
    
    def _normalize(self, chief_complaint: str) -> str:
        """
        Normalize chief complaint using aliases.
        
        Args:
            chief_complaint: Raw chief complaint string
        
        Returns:
            Normalized chief complaint string
        """
        cc = chief_complaint.lower().strip()
        return self.COMPLAINT_ALIASES.get(cc, cc)
    
    def get_initial_modalities(self, chief_complaint: str, threshold: float = 60.0, min_samples: int = 10, return_match_info: bool = False):
        """
        Get recommended initial modalities for a chief complaint.
        
        Strategy (3-stage matching):
        1. Exact match: Normalize with aliases, then exact match
        2. Partial match: Match first word (if >= min_samples)
        3. Fallback: Return ['LAB'] (most common in MIMIC)
        
        Decision logic:
        - If top modality has >= threshold% frequency, return only that modality
        - Otherwise, return top 2 modalities
        
        Args:
            chief_complaint: Patient's chief complaint (case-insensitive)
            threshold: Percentage threshold for single modality recommendation (default: 60.0)
            min_samples: Minimum sample count for partial match (default: 10)
            return_match_info: If True, return (modalities, match_info) tuple (default: False)
        
        Returns:
            If return_match_info=False: List of recommended modality strings (e.g., ['ECG', 'CXR'])
            If return_match_info=True: Tuple of (modalities, match_info_dict)
                match_info_dict contains:
                    - match_type: 'exact_match', 'alias_match', 'partial_match', or 'fallback'
                    - confidence: top modality percentage
                    - normalized_cc: normalized chief complaint used for matching
        """
        # Stage 1: Exact match with normalization
        cc_normalized = self._normalize(chief_complaint)
        cc_original = chief_complaint.lower().strip()
        matched = self.df[self.df['chief_complaint'].str.lower() == cc_normalized]
        
        if not matched.empty:
            # Determine if alias was used
            match_type = 'alias_match' if cc_normalized != cc_original else 'exact_match'
            
            # Sort by percentage (descending)
            matched_sorted = matched.sort_values('pct', ascending=False)
            
            # Get top modality
            top_modality = matched_sorted.iloc[0]['first_modality']
            top_pct = matched_sorted.iloc[0]['pct']
            
            # Decision logic
            if top_pct >= threshold:
                # Strong signal: single modality
                logger.info(f"CC '{chief_complaint}' → [{top_modality}] ({top_pct:.1f}%) [{match_type}]")
                modalities = [top_modality]
            else:
                # Weak signal: top 2 modalities
                modalities = matched_sorted.head(2)['first_modality'].tolist()
                logger.info(f"CC '{chief_complaint}' → {modalities} (top: {top_pct:.1f}%) [{match_type}]")
            
            if return_match_info:
                return modalities, {
                    'match_type': match_type,
                    'confidence': top_pct,
                    'normalized_cc': cc_normalized
                }
            return modalities
        
        # Stage 2: Partial match (first word)
        first_word = cc_normalized.split()[0] if cc_normalized else ''
        if first_word:
            partial_matched = self.df[self.df['chief_complaint'].str.lower().str.startswith(first_word)]
            
            if not partial_matched.empty:
                # Group by modality and sum counts
                modality_stats = partial_matched.groupby('first_modality').agg({
                    'count': 'sum'
                }).reset_index()
                
                total_count = modality_stats['count'].sum()
                
                # Only use partial match if we have enough samples
                if total_count >= min_samples:
                    modality_stats['pct'] = (modality_stats['count'] / total_count * 100).round(1)
                    modality_stats = modality_stats.sort_values('pct', ascending=False)
                    
                    top_modality = modality_stats.iloc[0]['first_modality']
                    top_pct = modality_stats.iloc[0]['pct']
                    
                    if top_pct >= threshold:
                        logger.info(f"CC '{chief_complaint}' → [{top_modality}] ({top_pct:.1f}%) [partial match: '{first_word}']")
                        modalities = [top_modality]
                    else:
                        modalities = modality_stats.head(2)['first_modality'].tolist()
                        logger.info(f"CC '{chief_complaint}' → {modalities} (top: {top_pct:.1f}%) [partial match: '{first_word}']")
                    
                    if return_match_info:
                        return modalities, {
                            'match_type': 'partial_match',
                            'confidence': top_pct,
                            'normalized_cc': cc_normalized,
                            'first_word': first_word
                        }
                    return modalities
        
        # Stage 3: Fallback
        logger.warning(f"No match for chief complaint: '{chief_complaint}', using fallback")
        modalities = ['LAB']  # Fallback: LAB is most common first modality in MIMIC
        
        if return_match_info:
            return modalities, {
                'match_type': 'fallback',
                'confidence': 0.0,
                'normalized_cc': cc_normalized
            }
        return modalities
    
    def get_statistics(self, chief_complaint: str):
        """
        Get detailed statistics for a chief complaint.
        
        Args:
            chief_complaint: Patient's chief complaint
        
        Returns:
            DataFrame with all modality frequencies for this CC
        """
        cc_normalized = chief_complaint.lower().strip()
        matched = self.df[self.df['chief_complaint'].str.lower() == cc_normalized]
        
        if matched.empty:
            return pd.DataFrame()
        
        return matched.sort_values('pct', ascending=False)
    
    def get_all_chief_complaints(self):
        """Get list of all chief complaints in the map."""
        return self.df['chief_complaint'].unique().tolist()
    
    def get_summary(self):
        """Get summary statistics of the map."""
        return {
            'total_chief_complaints': len(self.df['chief_complaint'].unique()),
            'total_records': len(self.df),
            'modality_distribution': self.df['first_modality'].value_counts().to_dict(),
            'avg_pct': self.df['pct'].mean(),
            'high_confidence_count': len(self.df[self.df['pct'] >= 50.0])
        }


def load_cc_map(parquet_path='data/chief_complaint_modality_map.parquet'):
    """
    Convenience function to load CC modality map.
    
    Args:
        parquet_path: Path to parquet file
    
    Returns:
        ChiefComplaintModalityMap instance
    """
    return ChiefComplaintModalityMap(parquet_path)


if __name__ == '__main__':
    # Test the utility
    logging.basicConfig(level=logging.INFO)
    
    cc_map = load_cc_map()
    
    print("=" * 80)
    print("CHIEF COMPLAINT MODALITY MAP - SUMMARY")
    print("=" * 80)
    summary = cc_map.get_summary()
    for key, value in summary.items():
        print(f"{key}: {value}")
    
    print("\n" + "=" * 80)
    print("EXAMPLE QUERIES")
    print("=" * 80)
    
    test_cases = [
        'chest pain',
        'abdominal pain',
        'fever',
        'shortness of breath',
        'unknown complaint'  # Should fallback
    ]
    
    for cc in test_cases:
        modalities = cc_map.get_initial_modalities(cc)
        print(f"\n'{cc}' → {modalities}")
        
        stats = cc_map.get_statistics(cc)
        if not stats.empty:
            print(stats[['first_modality', 'count', 'pct']].to_string(index=False))
