"""
Data preprocessing utilities for orchestrator model training.
"""
import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder
from typing import Tuple, Dict, List
import glob


def load_parquet_data(data_path: str) -> pd.DataFrame:
    """
    Load all parquet files from a directory.
    
    Args:
        data_path: Path pattern (e.g., './data/train/*.parquet')
    
    Returns:
        Concatenated DataFrame
    """
    files = glob.glob(data_path)
    if not files:
        raise FileNotFoundError(f"No parquet files found at {data_path}")
    
    dfs = []
    for file in files:
        df = pd.read_parquet(file)
        dfs.append(df)
    
    return pd.concat(dfs, ignore_index=True)


def flatten_struct_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Flatten struct columns (latest_vitals, latest_labs) into individual columns.
    
    Args:
        df: Input DataFrame with struct columns
    
    Returns:
        DataFrame with flattened columns
    """
    df = df.copy()
    
    # Flatten latest_vitals
    if 'latest_vitals' in df.columns:
        vitals_df = pd.json_normalize(df['latest_vitals'])
        vitals_df.columns = [f'vital_{col}' for col in vitals_df.columns]
        df = pd.concat([df.drop('latest_vitals', axis=1), vitals_df], axis=1)
    
    # Flatten latest_labs
    if 'latest_labs' in df.columns:
        labs_df = pd.json_normalize(df['latest_labs'])
        labs_df.columns = [f'lab_{col}' for col in labs_df.columns]
        df = pd.concat([df.drop('latest_labs', axis=1), labs_df], axis=1)
    
    return df


def encode_categorical_features(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    test_df: pd.DataFrame,
    categorical_cols: List[str]
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, Dict[str, LabelEncoder]]:
    """
    Encode categorical features using LabelEncoder.
    Fit on train, transform on all sets.
    
    Args:
        train_df: Training DataFrame
        val_df: Validation DataFrame
        test_df: Test DataFrame
        categorical_cols: List of categorical column names
    
    Returns:
        Tuple of (encoded_train, encoded_val, encoded_test, encoders_dict)
    """
    train_df = train_df.copy()
    val_df = val_df.copy()
    test_df = test_df.copy()
    
    encoders = {}
    
    for col in categorical_cols:
        if col not in train_df.columns:
            continue
            
        le = LabelEncoder()
        
        # Fill missing values in all datasets
        train_df[col] = train_df[col].fillna('MISSING')
        val_df[col] = val_df[col].fillna('MISSING')
        test_df[col] = test_df[col].fillna('MISSING')
        
        # Collect all unique values from train + val + test to ensure 'MISSING' is included
        all_values = pd.concat([
            train_df[col],
            val_df[col],
            test_df[col]
        ]).unique()
        
        # Fit encoder on all unique values
        le.fit(all_values)
        
        # Transform all datasets
        train_df[col] = le.transform(train_df[col])
        val_df[col] = le.transform(val_df[col])
        test_df[col] = le.transform(test_df[col])
        
        encoders[col] = le
    
    return train_df, val_df, test_df, encoders


def prepare_features_and_labels(
    df: pd.DataFrame,
    label_cols: List[str],
    exclude_cols: List[str]
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Separate features and labels, excluding specified columns.
    
    Args:
        df: Input DataFrame
        label_cols: List of label column names
        exclude_cols: List of columns to exclude from features
    
    Returns:
        Tuple of (X, y)
    """
    # Identify feature columns
    all_exclude = set(label_cols + exclude_cols)
    feature_cols = [col for col in df.columns if col not in all_exclude]
    
    X = df[feature_cols].copy()
    y = df[label_cols].copy()
    
    # Fill NaN in features with 0 (or appropriate strategy)
    X = X.fillna(0)
    
    return X, y


def calculate_scale_pos_weight(y: pd.Series) -> float:
    """
    Calculate scale_pos_weight for imbalanced binary classification.
    
    Args:
        y: Binary label series
    
    Returns:
        scale_pos_weight value (neg_count / pos_count)
    """
    pos_count = y.sum()
    neg_count = len(y) - pos_count
    
    if pos_count == 0:
        return 1.0
    
    return neg_count / pos_count


def get_label_statistics(df: pd.DataFrame, label_cols: List[str]) -> pd.DataFrame:
    """
    Calculate statistics for each label.
    
    Args:
        df: DataFrame containing labels
        label_cols: List of label column names
    
    Returns:
        DataFrame with label statistics
    """
    stats = []
    
    for label in label_cols:
        total = len(df)
        positive = df[label].sum()
        negative = total - positive
        pos_ratio = positive / total if total > 0 else 0
        scale_weight = negative / positive if positive > 0 else 1.0
        
        stats.append({
            'label': label,
            'total': total,
            'positive': int(positive),
            'negative': int(negative),
            'pos_ratio': pos_ratio,
            'scale_pos_weight': scale_weight
        })
    
    return pd.DataFrame(stats)
