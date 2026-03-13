from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class FoldDefinition:
    test_user: str
    train_frame: pd.DataFrame
    validation_frame: pd.DataFrame
    test_frame: pd.DataFrame
    missing_test_labels: list[str]
    strict_ready: bool


def leave_one_user_out_splits(
    dataset: pd.DataFrame,
    labels: list[str],
    validation_fraction: float,
    seed: int,
) -> list[FoldDefinition]:
    folds: list[FoldDefinition] = []
    for test_user in sorted(dataset["user_id"].unique()):
        test_frame = dataset[dataset["user_id"] == test_user].reset_index(drop=True)
        train_pool = dataset[dataset["user_id"] != test_user].reset_index(drop=True)
        train_frame, validation_frame = stratified_split(train_pool, validation_fraction, seed)
        missing_test_labels = [
            label for label in labels if label not in set(test_frame["label"].astype(str))
        ]
        folds.append(
            FoldDefinition(
                test_user=test_user,
                train_frame=train_frame,
                validation_frame=validation_frame,
                test_frame=test_frame,
                missing_test_labels=missing_test_labels,
                strict_ready=not missing_test_labels,
            )
        )
    return folds


def stratified_split(
    frame: pd.DataFrame, validation_fraction: float, seed: int
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if validation_fraction <= 0.0:
        return frame.copy(), frame.iloc[0:0].copy()

    rng = np.random.default_rng(seed)
    train_indices: list[int] = []
    validation_indices: list[int] = []
    for _, label_frame in frame.groupby("label"):
        indices = label_frame.index.to_numpy()
        shuffled = rng.permutation(indices)
        validation_count = int(round(len(shuffled) * validation_fraction))
        if validation_count >= len(shuffled) and len(shuffled) > 1:
            validation_count = len(shuffled) - 1
        if validation_count == 0 and len(shuffled) > 2:
            validation_count = 1
        validation_indices.extend(shuffled[:validation_count].tolist())
        train_indices.extend(shuffled[validation_count:].tolist())

    train_frame = frame.loc[sorted(train_indices)].reset_index(drop=True)
    validation_frame = frame.loc[sorted(validation_indices)].reset_index(drop=True)
    return train_frame, validation_frame
