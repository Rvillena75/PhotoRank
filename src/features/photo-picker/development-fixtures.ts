import { Asset } from 'expo-asset';

import type { PhotoAsset } from '../../domain/contracts';

import checkerImage from '../../../tools/model-export/fixtures/images/checker_portrait.png';
import orientedImage from '../../../tools/model-export/fixtures/images/exif_orientation_6.jpg';
import gradientImage from '../../../tools/model-export/fixtures/images/gradient_landscape.png';
import radialImage from '../../../tools/model-export/fixtures/images/radial_square.png';
import solidImage from '../../../tools/model-export/fixtures/images/solid_teal.png';
import stripesImage from '../../../tools/model-export/fixtures/images/stripes_wide.png';

function fixture(id: string, filename: string, moduleId: number): PhotoAsset {
  const resolvedUri = Asset.fromModule(moduleId).uri;
  return Object.freeze({ id, assetId: id, uri: resolvedUri ?? `fixture://${id}`, filename });
}

export const DEVELOPMENT_PHOTO_FIXTURES: readonly PhotoAsset[] = Object.freeze([
  fixture('fixture-gradient', 'gradient_landscape.png', gradientImage),
  fixture('fixture-checker', 'checker_portrait.png', checkerImage),
  fixture('fixture-oriented', 'exif_orientation_6.jpg', orientedImage),
  fixture('fixture-radial', 'radial_square.png', radialImage),
  fixture('fixture-stripes', 'stripes_wide.png', stripesImage),
  fixture('fixture-solid', 'solid_teal.png', solidImage),
] as const);
