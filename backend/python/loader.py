"""Load a dataset folder (network.json, ops.json, telemetry.csv) into fast lookup structures."""
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

REQUIRED_FILES = ("network.json", "ops.json", "telemetry.csv")


@dataclass
class Dataset:
    name: str
    network: dict
    ops: dict
    ts: np.ndarray            # sorted unix timestamps (5-minute grid)
    series: dict              # (asset_id, metric) -> np.ndarray aligned with ts
    start_unix: int
    now_unix: int

    def get(self, asset_id: str, metric: str) -> np.ndarray:
        return self.series[(asset_id, metric)]

    def index_at(self, unix: int) -> int:
        """Index of the last reading at or before `unix`."""
        return int(np.searchsorted(self.ts, unix, side="right") - 1)

    def value_at(self, asset_id: str, metric: str, unix: int) -> float:
        return float(self.get(asset_id, metric)[self.index_at(unix)])

    # Convenience lookups over the network
    def systems(self):
        return self.network["systems"]

    def facilities(self):
        for system in self.network["systems"]:
            for facility in system["facilities"]:
                yield system, facility


def is_dataset_folder(folder: Path) -> bool:
    return folder.is_dir() and all((folder / f).exists() for f in REQUIRED_FILES)


def load_dataset(folder: Path, now_unix: int | None = None) -> Dataset:
    folder = Path(folder)
    with open(folder / "network.json") as f:
        network = json.load(f)
    with open(folder / "ops.json") as f:
        ops = json.load(f)

    df = pd.read_csv(
        folder / "telemetry.csv",
        usecols=["ts_unix", "asset_id", "metric", "value"],
        dtype={"ts_unix": "int64", "asset_id": "category", "metric": "category", "value": "float64"},
    )
    # "Now" is the last timestamp in the telemetry, never the system clock.
    last = int(df["ts_unix"].max())
    if now_unix is not None:
        last = min(last, int(now_unix))
        df = df[df["ts_unix"] <= last]

    wide = df.pivot_table(index="ts_unix", columns=["asset_id", "metric"], values="value", observed=True)
    wide = wide.sort_index().ffill()
    ts = wide.index.to_numpy(dtype=np.int64)
    series = {(str(a), str(m)): wide[(a, m)].to_numpy(dtype=float) for a, m in wide.columns}

    return Dataset(
        name=folder.name,
        network=network,
        ops=ops,
        ts=ts,
        series=series,
        start_unix=int(ts[0]),
        now_unix=int(ts[-1]),
    )
