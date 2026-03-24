FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y git python3 python3-venv python3-pip libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui.git
WORKDIR /opt/stable-diffusion-webui
EXPOSE 7860
CMD bash -lc "python3 launch.py --listen --port 7860 --api --medvram --skip-torch-cuda-test"