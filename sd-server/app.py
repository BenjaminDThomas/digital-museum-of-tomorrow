import base64
import io
import os
import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from diffusers import StableDiffusionPipeline

app = FastAPI()

# Serve the frontend static site from the project root
app.mount("/", StaticFiles(directory="/app", html=True), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_ID = os.getenv("MODEL_ID", "runwayml/stable-diffusion-v1-5")

print(f"Loading model {MODEL_ID}...")

device = "cuda" if torch.cuda.is_available() else "cpu"
dtype = torch.float16 if device == "cuda" else torch.float32

pipe = StableDiffusionPipeline.from_pretrained(
    MODEL_ID,
    torch_dtype=dtype,
    safety_checker=None,
    requires_safety_checker=False,
)
pipe = pipe.to(device)

if device == "cuda":
    pipe.enable_attention_slicing()


class Txt2ImgRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    width: int = 512
    height: int = 512
    cfg_scale: float = 7.0
    sampler_name: str = "Euler a"


@app.get("/sdapi/v1/sd-models")
def sd_models():
    return [{"title": MODEL_ID, "model_name": MODEL_ID}]


@app.post("/sdapi/v1/txt2img")
def txt2img(req: Txt2ImgRequest):
    result = pipe(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt or None,
        num_inference_steps=req.steps,
        width=req.width,
        height=req.height,
        guidance_scale=req.cfg_scale,
    )
    img = result.images[0]
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return {"images": [b64]}
