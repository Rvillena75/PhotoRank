from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageCms, ImageOps
from torch import Tensor
from torchvision.transforms import InterpolationMode
from torchvision.transforms import functional as transforms

MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
RESIZE_SHORT_SIDE = 256
CROP_SIZE = 224


def _convert_to_srgb(image: Image.Image) -> Image.Image:
    icc_profile = image.info.get("icc_profile")
    if isinstance(icc_profile, bytes) and icc_profile:
        source_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
        destination_profile = ImageCms.createProfile("sRGB")
        return ImageCms.profileToProfile(
            image,
            source_profile,
            destination_profile,
            outputMode="RGB",
        )
    return image.convert("RGB")


def preprocess_image(path: Path) -> Tensor:
    with Image.open(path) as source:
        oriented = ImageOps.exif_transpose(source)
        rgb = _convert_to_srgb(oriented)
        resized = transforms.resize(
            rgb,
            RESIZE_SHORT_SIDE,
            interpolation=InterpolationMode.BILINEAR,
            antialias=True,
        )
        cropped = transforms.center_crop(resized, [CROP_SIZE, CROP_SIZE])
        tensor = transforms.to_tensor(cropped)
    return transforms.normalize(tensor, mean=MEAN, std=STD).unsqueeze(0)


def tensor_bytes(tensor: Tensor) -> bytes:
    contiguous = tensor.detach().cpu().numpy().astype(np.dtype("<f4"), copy=False)
    return contiguous.tobytes(order="C")
