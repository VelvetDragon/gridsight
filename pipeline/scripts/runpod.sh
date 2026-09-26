#!/usr/bin/env bash
# MrGridy: run the Response-mode GPU simulation on a RunPod PyTorch pod and build the JSON.
#
# Pod: any RunPod "PyTorch 2.x" template with an NVIDIA GPU (CUDA 12). ~10 GB disk.
# Usage on the pod (GitHub auth already set up, e.g. `gh auth login` or a token):
#
#   bash runpod.sh                      # clone, install, 10,000 sims per storm, build all storms
#   SIMS=20000 bash runpod.sh           # more simulations
#   STORM=helene bash runpod.sh         # one storm (the other storms' training runs still execute)
#   BRANCH=feat/response-pipeline bash runpod.sh
#
# Outputs: public/data/response/<storm>/*.json and public/data/response/storms.json in
# the cloned repo; raw downloads and simulation caches in $WORKDIR/gridsight-data.
set -euo pipefail

REPO="${REPO:-https://github.com/VelvetDragon/gridsight.git}"
BRANCH="${BRANCH:-main}"
WORKDIR="${WORKDIR:-/workspace}"
SIMS="${SIMS:-10000}"
STORM="${STORM:-all}"

mkdir -p "$WORKDIR"
cd "$WORKDIR"
if [ ! -d gridsight/.git ]; then
  git clone "$REPO" gridsight
fi
cd gridsight
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# The PyTorch image already has CUDA torch; a venv that sees system packages keeps it.
if [ ! -d .venv-gpu ]; then
  python3 -m venv --system-site-packages .venv-gpu
fi
# shellcheck disable=SC1091
source .venv-gpu/bin/activate
pip install --upgrade pip >/dev/null
pip install -r pipeline/requirements-gpu.txt

python - <<'PY'
import torch
assert torch.cuda.is_available(), "CUDA is not available on this pod"
print("torch", torch.__version__, "on", torch.cuda.get_device_name(0))
PY

export GRIDSIGHT_RAW="$WORKDIR/gridsight-data/raw"
export GRIDSIGHT_CACHE="$WORKDIR/gridsight-data/cache"
mkdir -p "$GRIDSIGHT_RAW" "$GRIDSIGHT_CACHE"

cd pipeline
python scripts/fetch_data.py
# Monte Carlo on the GPU: every storm, best-track and forecast runs, $SIMS each.
python -m gridsight.response.simulate --storm all --device cuda --sims "$SIMS"
# Outage model, zones, yards, mutual-aid scenarios and JSON (reuses the simulations above).
python -m gridsight.response.build --storm "$STORM" --skip-sim
cd ..

echo
echo "MrGridy response build done. Outputs:"
ls -la public/data/response public/data/response/*/ | sed 's/^/  /'
cat <<EOF

Copy the results back (pick one):
  1) Commit on a branch and push from the pod:
       git checkout -b data/response-gpu-${SIMS}
       git add public/data/response
       git commit -m "chore(data): regenerate response datasets (cuda, ${SIMS} sims)"
       git push -u origin data/response-gpu-${SIMS}
     then open a PR or merge that branch locally.
  2) runpodctl (no git needed):
       tar czf response-data.tgz public/data/response
       runpodctl send response-data.tgz
     and on your laptop, in the repo root:
       runpodctl receive <code printed above>
       tar xzf response-data.tgz
EOF
