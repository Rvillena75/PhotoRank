from __future__ import annotations

import json
from pathlib import Path

import onnxruntime
import torch

from export_model import (
    CHECKPOINT_SHA256,
    MANIFEST_FILE,
    MODEL_FILE,
    MobileNetV3SmallPooledL2,
    create_fixtures,
    load_verified_checkpoint,
    parse_arguments,
    sha256_file,
    validate_frozen_weights_recipe,
    validate_graph,
    validate_parity,
)


def main() -> None:
    arguments = parse_arguments()
    validate_frozen_weights_recipe()
    checkpoint_path = arguments.cache_directory / "mobilenet_v3_small-047dcff4.pth"
    if not checkpoint_path.exists() or sha256_file(checkpoint_path) != CHECKPOINT_SHA256:
        raise RuntimeError("Verified checkpoint cache is missing; run export_model.py first.")
    model_path = arguments.output_directory / MODEL_FILE
    manifest_path = arguments.output_directory / MANIFEST_FILE
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["sha256"] != sha256_file(model_path):
        raise RuntimeError("ONNX SHA-256 does not match MODEL_MANIFEST.json.")
    if manifest["source"]["checkpointSha256"] != CHECKPOINT_SHA256:
        raise RuntimeError("Checkpoint SHA-256 does not match MODEL_MANIFEST.json.")
    validate_graph(model_path)
    checkpoint = load_verified_checkpoint(checkpoint_path)
    model = MobileNetV3SmallPooledL2(checkpoint)
    model.eval()
    fixture_paths = create_fixtures(arguments.fixtures_directory)
    current = validate_parity(model, model_path, fixture_paths, arguments.fixtures_directory)
    expected = json.loads((arguments.fixtures_directory / "REFERENCE_EMBEDDINGS.json").read_text(encoding="utf-8"))
    if current["fixtures"] != expected["fixtures"]:
        raise RuntimeError("Regenerated fixture references differ from the versioned references.")
    print(f"Verified model with torch {torch.__version__} and ONNX Runtime {onnxruntime.__version__}.")


if __name__ == "__main__":
    main()
