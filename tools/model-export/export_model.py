from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime
import PIL
import torch
import torchvision
from PIL import Image

from model_definition import FROZEN_WEIGHTS, MobileNetV3SmallPooledL2
from preprocessing import preprocess_image, tensor_bytes

CHECKPOINT_URL = "https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth"
CHECKPOINT_FILE = "mobilenet_v3_small-047dcff4.pth"
CHECKPOINT_SHA256 = "047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f"
MODEL_FILE = "mobilenet_v3_small_imagenet1k_v1_pooled_l2.onnx"
MANIFEST_FILE = "MODEL_MANIFEST.json"
MODEL_ID = "torchvision-mobilenet-v3-small-imagenet1k-v1-pooled-576"
MODEL_VERSION = "1.0.0"
INPUT_NAME = "image"
OUTPUT_NAME = "embedding"
OPSET = 17
PARITY_ATOL = 1e-5


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_frozen_weights_recipe() -> None:
    if FROZEN_WEIGHTS.url != CHECKPOINT_URL:
        raise RuntimeError(
            f"TorchVision IMAGENET1K_V1 URL changed: expected {CHECKPOINT_URL}, got {FROZEN_WEIGHTS.url}."
        )


def download_checkpoint(cache_directory: Path) -> Path:
    validate_frozen_weights_recipe()
    cache_directory.mkdir(parents=True, exist_ok=True)
    checkpoint_path = cache_directory / CHECKPOINT_FILE
    if checkpoint_path.exists() and sha256_file(checkpoint_path) == CHECKPOINT_SHA256:
        return checkpoint_path
    if checkpoint_path.exists():
        checkpoint_path.unlink()
    temporary_path = checkpoint_path.with_suffix(".download")
    if temporary_path.exists():
        temporary_path.unlink()
    urllib.request.urlretrieve(CHECKPOINT_URL, temporary_path)
    actual_hash = sha256_file(temporary_path)
    if actual_hash != CHECKPOINT_SHA256:
        temporary_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Checkpoint SHA-256 mismatch: expected {CHECKPOINT_SHA256}, got {actual_hash}."
        )
    temporary_path.replace(checkpoint_path)
    return checkpoint_path


def load_verified_checkpoint(path: Path) -> dict[str, torch.Tensor]:
    actual_hash = sha256_file(path)
    if actual_hash != CHECKPOINT_SHA256:
        raise RuntimeError(
            f"Refusing to load checkpoint with SHA-256 {actual_hash}; expected {CHECKPOINT_SHA256}."
        )
    state = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(state, dict) or not all(isinstance(key, str) for key in state):
        raise TypeError("Checkpoint did not contain a state dictionary.")
    return state


def create_fixtures(fixtures_directory: Path) -> tuple[Path, ...]:
    images_directory = fixtures_directory / "images"
    images_directory.mkdir(parents=True, exist_ok=True)

    gradient_path = images_directory / "gradient_landscape.png"
    gradient = np.zeros((240, 320, 3), dtype=np.uint8)
    x = np.arange(320, dtype=np.uint16)[None, :]
    y = np.arange(240, dtype=np.uint16)[:, None]
    gradient[:, :, 0] = ((x * 255) // 319).astype(np.uint8)
    gradient[:, :, 1] = ((y * 255) // 239).astype(np.uint8)
    gradient[:, :, 2] = (((x + y) * 255) // 558).astype(np.uint8)
    Image.fromarray(gradient, mode="RGB").save(gradient_path, format="PNG", optimize=False)

    checker_path = images_directory / "checker_portrait.png"
    checker = np.zeros((320, 240, 3), dtype=np.uint8)
    yy, xx = np.indices((320, 240))
    mask = ((xx // 24) + (yy // 24)) % 2 == 0
    checker[mask] = (235, 88, 52)
    checker[~mask] = (31, 93, 166)
    Image.fromarray(checker, mode="RGB").save(checker_path, format="PNG", optimize=False)

    oriented_path = images_directory / "exif_orientation_6.jpg"
    oriented = Image.new("RGB", (320, 240), color=(20, 35, 55))
    pixels = np.asarray(oriented).copy()
    pixels[:120, :160] = (235, 194, 52)
    pixels[120:, 160:] = (91, 184, 112)
    exif = Image.Exif()
    exif[274] = 6
    Image.fromarray(pixels, mode="RGB").save(
        oriented_path,
        format="JPEG",
        quality=95,
        subsampling=0,
        exif=exif,
    )

    radial_path = images_directory / "radial_square.png"
    radial = np.zeros((300, 300, 3), dtype=np.uint8)
    radial_y, radial_x = np.indices((300, 300))
    distance = np.sqrt((radial_x - 149.5) ** 2 + (radial_y - 149.5) ** 2)
    radial[:, :, 0] = np.clip(255 - distance, 0, 255).astype(np.uint8)
    radial[:, :, 1] = np.clip(distance, 0, 255).astype(np.uint8)
    radial[:, :, 2] = ((radial_x * 7 + radial_y * 3) % 256).astype(np.uint8)
    Image.fromarray(radial, mode="RGB").save(radial_path, format="PNG", optimize=False)

    stripes_path = images_directory / "stripes_wide.png"
    stripes = np.zeros((220, 360, 3), dtype=np.uint8)
    stripe_index = np.indices((220, 360))[1] // 18
    stripe_mask = stripe_index % 3
    stripes[stripe_mask == 0] = (245, 166, 35)
    stripes[stripe_mask == 1] = (74, 43, 126)
    stripes[stripe_mask == 2] = (32, 145, 168)
    Image.fromarray(stripes, mode="RGB").save(stripes_path, format="PNG", optimize=False)

    solid_path = images_directory / "solid_teal.png"
    solid = Image.new("RGB", (280, 260), color=(28, 132, 127))
    solid.save(solid_path, format="PNG", optimize=False)
    return gradient_path, checker_path, oriented_path, radial_path, stripes_path, solid_path


def export_onnx(model: MobileNetV3SmallPooledL2, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(0)
    dummy_input = torch.zeros((1, 3, 224, 224), dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=OPSET,
        do_constant_folding=True,
        input_names=[INPUT_NAME],
        output_names=[OUTPUT_NAME],
        dynamic_axes=None,
        dynamo=False,
    )


def _tensor_metadata(value: onnx.ValueInfoProto) -> tuple[int, list[int]]:
    tensor_type = value.type.tensor_type
    dimensions: list[int] = []
    for dimension in tensor_type.shape.dim:
        if not dimension.HasField("dim_value"):
            raise RuntimeError("The ONNX graph contains a dynamic dimension.")
        dimensions.append(dimension.dim_value)
    return tensor_type.elem_type, dimensions


def validate_graph(model_path: Path) -> None:
    graph_model = onnx.load(model_path)
    onnx.checker.check_model(graph_model, full_check=True)
    if len(graph_model.graph.input) != 1 or len(graph_model.graph.output) != 1:
        raise RuntimeError("Expected exactly one graph input and one graph output.")
    graph_input = graph_model.graph.input[0]
    graph_output = graph_model.graph.output[0]
    if graph_input.name != INPUT_NAME or _tensor_metadata(graph_input) != (onnx.TensorProto.FLOAT, [1, 3, 224, 224]):
        raise RuntimeError("Unexpected ONNX input contract.")
    if graph_output.name != OUTPUT_NAME or _tensor_metadata(graph_output) != (onnx.TensorProto.FLOAT, [1, 576]):
        raise RuntimeError("Unexpected ONNX output contract.")
    opsets = {entry.domain: entry.version for entry in graph_model.opset_import}
    if opsets.get("") != OPSET:
        raise RuntimeError(f"Expected default ONNX opset {OPSET}, got {opsets.get('')}.")
    quantized_operations = {
        "QuantizeLinear",
        "DequantizeLinear",
        "DynamicQuantizeLinear",
        "QLinearConv",
        "QLinearMatMul",
        "MatMulInteger",
        "ConvInteger",
    }
    present_quantized = sorted({node.op_type for node in graph_model.graph.node} & quantized_operations)
    if present_quantized:
        raise RuntimeError(f"Quantization operations are forbidden: {present_quantized}.")
    forbidden_classifier_shapes = {(1024, 576), (1000, 1024)}
    for initializer in graph_model.graph.initializer:
        if tuple(initializer.dims) in forbidden_classifier_shapes:
            raise RuntimeError("Classifier weights were exported into the ONNX graph.")


def validate_parity(
    model: MobileNetV3SmallPooledL2,
    model_path: Path,
    fixture_paths: tuple[Path, ...],
    fixtures_directory: Path,
) -> dict[str, Any]:
    session = onnxruntime.InferenceSession(
        str(model_path),
        providers=["CPUExecutionProvider"],
    )
    if [value.name for value in session.get_inputs()] != [INPUT_NAME]:
        raise RuntimeError("ONNX Runtime exposed an unexpected input name.")
    if [value.name for value in session.get_outputs()] != [OUTPUT_NAME]:
        raise RuntimeError("ONNX Runtime exposed an unexpected output name.")
    tensor_directory = fixtures_directory / "tensors"
    tensor_directory.mkdir(parents=True, exist_ok=True)
    references: list[dict[str, Any]] = []

    with torch.inference_mode():
        for fixture_path in fixture_paths:
            input_tensor = preprocess_image(fixture_path)
            reference = model(input_tensor).cpu().numpy().astype(np.float32, copy=False)
            runtime_output = session.run(
                [OUTPUT_NAME],
                {INPUT_NAME: input_tensor.cpu().numpy().astype(np.float32, copy=False)},
            )[0]
            second_output = session.run(
                [OUTPUT_NAME],
                {INPUT_NAME: input_tensor.cpu().numpy().astype(np.float32, copy=False)},
            )[0]
            if reference.shape != (1, 576) or runtime_output.shape != (1, 576):
                raise RuntimeError(f"Unexpected embedding shape for {fixture_path.name}.")
            if reference.dtype != np.float32 or runtime_output.dtype != np.float32:
                raise RuntimeError(f"Unexpected embedding dtype for {fixture_path.name}.")
            if not np.isfinite(runtime_output).all():
                raise RuntimeError(f"Non-finite embedding for {fixture_path.name}.")
            max_absolute_error = float(np.max(np.abs(reference - runtime_output)))
            if max_absolute_error > PARITY_ATOL:
                raise RuntimeError(
                    f"PyTorch/ONNX parity failed for {fixture_path.name}: {max_absolute_error}."
                )
            if not np.array_equal(runtime_output, second_output):
                raise RuntimeError(f"ONNX output is not deterministic for {fixture_path.name}.")
            norm = float(np.linalg.vector_norm(runtime_output[0]))
            if abs(norm - 1.0) > PARITY_ATOL:
                raise RuntimeError(f"Embedding norm is {norm} for {fixture_path.name}.")
            raw_tensor = tensor_bytes(input_tensor)
            tensor_path = tensor_directory / f"{fixture_path.stem}.f32le"
            tensor_path.write_bytes(raw_tensor)
            references.append(
                {
                    "file": fixture_path.name,
                    "imageSha256": sha256_file(fixture_path),
                    "tensorFile": tensor_path.name,
                    "tensorSha256": sha256_file(tensor_path),
                    "embedding": [float(value) for value in runtime_output[0]],
                    "l2Norm": norm,
                    "pytorchOnnxMaxAbsoluteError": max_absolute_error,
                }
            )
    return {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "tolerance": {"absolute": PARITY_ATOL},
        "fixtures": references,
    }


def manifest(model_sha256: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "file": MODEL_FILE,
        "sha256": model_sha256,
        "source": {
            "framework": "torchvision",
            "architecture": "mobilenet_v3_small",
            "weights": "MobileNet_V3_Small_Weights.IMAGENET1K_V1",
            "checkpointUrl": CHECKPOINT_URL,
            "checkpointSha256": CHECKPOINT_SHA256,
            "widthMult": 1.0,
            "reducedTail": False,
            "dilated": False,
        },
        "graph": {
            "opset": OPSET,
            "inputName": INPUT_NAME,
            "inputDtype": "float32",
            "inputShape": [1, 3, 224, 224],
            "outputName": OUTPUT_NAME,
            "outputDtype": "float32",
            "outputShape": [1, 576],
            "extractionPoint": "features.avgpool.flatten",
            "l2Normalization": {"p": 2, "axis": 1, "epsilon": 1e-12},
            "quantization": "none",
        },
        "preprocessing": {
            "exifOrientation": "normalize",
            "colorSpace": "sRGB",
            "channels": "RGB",
            "resizeShortSide": 256,
            "interpolation": "bilinear",
            "antialias": True,
            "centerCrop": [224, 224],
            "valueRange": [0, 1],
            "mean": [0.485, 0.456, 0.406],
            "std": [0.229, 0.224, 0.225],
        },
        "toolchain": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
            "exporter": "torch.onnx.export",
        },
        "license": {
            "code": "torchvision: BSD-3-Clause",
            "weights": "distributed by torchvision 0.20.1 under its BSD-3-Clause package license",
            "datasetTerms": "ImageNet terms of access apply to the source training dataset",
        },
    }


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def parse_arguments() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Export the frozen PhotoRank embedding model.")
    parser.add_argument("--output-directory", type=Path, default=repository_root / "assets" / "models")
    parser.add_argument("--cache-directory", type=Path, default=Path(__file__).resolve().parent / ".cache")
    parser.add_argument("--fixtures-directory", type=Path, default=Path(__file__).resolve().parent / "fixtures")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    validate_frozen_weights_recipe()
    checkpoint_path = download_checkpoint(arguments.cache_directory)
    checkpoint = load_verified_checkpoint(checkpoint_path)
    model = MobileNetV3SmallPooledL2(checkpoint)
    model.eval()
    model_path = arguments.output_directory / MODEL_FILE
    export_onnx(model, model_path)
    validate_graph(model_path)
    fixture_paths = create_fixtures(arguments.fixtures_directory)
    references = validate_parity(model, model_path, fixture_paths, arguments.fixtures_directory)
    model_hash = sha256_file(model_path)
    references["modelSha256"] = model_hash
    write_json(arguments.fixtures_directory / "REFERENCE_EMBEDDINGS.json", references)
    write_json(arguments.output_directory / MANIFEST_FILE, manifest(model_hash))
    print(f"Exported {model_path}")
    print(f"ONNX SHA-256: {model_hash}")
    print(f"Checkpoint SHA-256: {sha256_file(checkpoint_path)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Export failed: {error}", file=sys.stderr)
        raise
