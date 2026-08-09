from __future__ import annotations

import torch
from torch import Tensor, nn
from torch.nn import functional as functional
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small


FROZEN_WEIGHTS = MobileNet_V3_Small_Weights.IMAGENET1K_V1


class MobileNetV3SmallPooledL2(nn.Module):
    """Frozen PhotoRank extraction point; the classifier is intentionally unreachable."""

    def __init__(self, checkpoint: dict[str, Tensor]) -> None:
        super().__init__()
        # The verified state dictionary is loaded manually so its full SHA-256
        # is checked before torch deserializes it. FROZEN_WEIGHTS identifies the
        # exact TorchVision weight recipe without triggering an implicit load.
        model = mobilenet_v3_small(
            weights=None,
            width_mult=1.0,
            reduced_tail=False,
            dilated=False,
        )
        model.load_state_dict(checkpoint, strict=True)
        self.features = model.features
        self.avgpool = model.avgpool

    def forward(self, x: Tensor) -> Tensor:
        x = self.features(x)
        x = self.avgpool(x)
        x = torch.flatten(x, 1)
        x = functional.normalize(x, p=2, dim=1, eps=1e-12)
        return x
