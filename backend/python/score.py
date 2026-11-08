"""
Check detection and plans against the answer keys (practice folders only).

    python score.py ../../data            # every folder with an answer_key.json
    python score.py ../../data/full_week  # one folder

The app itself never reads answer_key.json. This script is only for testing.
"""
import json
import sys
from pathlib import Path

from analyze import analyze
from loader import load_dataset

ONSET_TOLERANCE_S = 3 * 3600


def fmt(unix):
    import datetime as dt
    return dt.datetime.fromtimestamp(unix, dt.timezone.utc).strftime("%m-%d %H:%M") if unix else "-"


def score_folder(folder: Path) -> tuple[int, int, int]:
    key = json.loads((folder / "answer_key.json").read_text())
    result = analyze(load_dataset(folder))
    found = [e for e in result["events"] if e["status"] != "predicted"]
    used, matched, rows = set(), 0, []

    for k in key:
        best = None
        for i, e in enumerate(found):
            if i in used or e["category"] != k["category"] or e["asset"] != k["asset"]:
                continue
            err = abs(e["onset_unix"] - k["onset_unix"])
            if err <= ONSET_TOLERANCE_S and (best is None or err < best[1]):
                best = (i, err)
        if best is None:
            rows.append(f"  MISSED  {k['id']:9s} {k['category']:17s} {k['asset']:16s} onset {fmt(k['onset_unix'])}")
            continue
        used.add(best[0])
        matched += 1
        e = found[best[0]]
        line = (f"  ok      {k['id']:9s} {k['category']:17s} {k['asset']:16s} "
                f"onset err {best[1] / 60:5.0f} min  status {e['status']:8s}")
        if k["category"] == "pump_failure":
            plan = e.get("recommended_action", {}).get("cheapest", {})
            line += f" | ours: {plan.get('description', '-')} (${plan.get('total_cost', 0):,})"
            line += f"\n{'':60s} key : {k['reference_action']}"
        rows.append(line)

    false_pos = [e for i, e in enumerate(found) if i not in used]
    for e in false_pos:
        rows.append(f"  EXTRA   {e['id']:9s} {e['category']:17s} {e['asset']:16s} onset {fmt(e['onset_unix'])}")

    print(f"\n== {folder.name}: {matched}/{len(key)} found, {len(false_pos)} false alarms")
    print("\n".join(rows))
    return matched, len(key), len(false_pos)


def main():
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "../../data")
    folders = [target] if (target / "answer_key.json").exists() else sorted(
        p for p in target.iterdir() if (p / "answer_key.json").exists())
    totals = [score_folder(f) for f in folders]
    m, n, fp = (sum(x) for x in zip(*totals))
    print(f"\nTOTAL: {m}/{n} events found, {fp} false alarms")


if __name__ == "__main__":
    main()
