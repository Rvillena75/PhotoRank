# Exportador del modelo visual

Este directorio reproduce la unidad versionada de modelo de PhotoRank: wrapper,
checkpoint verificado, ONNX, manifiesto, fixtures, tensores y embeddings de
referencia. Requiere Python 3.12 y acceso de red solo para la primera descarga
del checkpoint.

Desde este directorio:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r requirements.lock
.venv/bin/python export_model.py
.venv/bin/python verify_artifacts.py
```

`export_model.py` descarga el checkpoint a `.cache/`, calcula su SHA-256 completo
y se niega a cargarlo si no coincide con
`047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f`.
También exige que la URL de
`MobileNet_V3_Small_Weights.IMAGENET1K_V1` siga siendo la congelada. Después
carga manualmente ese state dictionary ya verificado, aplica `eval()`, exporta
con opset 17 y batch estático, valida el grafo y escribe los artefactos en
`../../assets/models`. La carga manual evita que TorchVision deserialice pesos
antes de completar la verificación criptográfica.

El exportador regenera seis imágenes deterministas, sus tensores `float32` NCHW
little-endian y `fixtures/REFERENCE_EMBEDDINGS.json`. PyTorch y ONNX Runtime CPU
deben coincidir con tolerancia absoluta `1e-5`; el verificador vuelve a ejecutar
la paridad y exige que las referencias versionadas sean idénticas.

No edites el ONNX, el manifiesto o los fixtures por separado. Cambiar pesos,
preprocesamiento, extracción, shape, opset o cuantización requiere una versión
mayor del modelo y recalibración posterior del threshold, con aprobación del
producto.

Las dependencias runtime y transitivas están fijadas exactamente en
`requirements.lock`. `requirements.in` documenta solo las dependencias directas.
Las atribuciones están en `ATTRIBUTIONS.md`.
