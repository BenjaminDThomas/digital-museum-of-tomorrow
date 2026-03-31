import base64
import io
import os
import threading
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from diffusers import StableDiffusionPipeline

app = FastAPI()

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
pipe = None
model_loading = False
model_error = None
model_lock = threading.Lock()


def load_pipeline():
    global pipe, model_loading, model_error
    if pipe is not None or model_loading:
        return pipe

    with model_lock:
        if pipe is not None or model_loading:
            return pipe

        model_loading = True
        model_error = None
        try:
            loaded_pipe = StableDiffusionPipeline.from_pretrained(
                MODEL_ID,
                torch_dtype=dtype,
                safety_checker=None,
                requires_safety_checker=False,
            )
            loaded_pipe = loaded_pipe.to(device)

            if device == "cuda":
                loaded_pipe.enable_attention_slicing()

            pipe = loaded_pipe
            return pipe
        except Exception as exc:
            model_error = str(exc)
            raise
        finally:
            model_loading = False


class Txt2ImgRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    width: int = 512
    height: int = 512
    cfg_scale: float = 7.0
    sampler_name: str = "Euler a"


@app.on_event("startup")
def warm_model_in_background():
    thread = threading.Thread(target=load_pipeline, daemon=True)
    thread.start()


@app.get("/sdapi/v1/sd-models")
def sd_models():
    return [{
        "title": MODEL_ID,
        "model_name": MODEL_ID,
        "loaded": pipe is not None,
        "loading": model_loading,
        "error": model_error,
    }]


@app.post("/sdapi/v1/txt2img")
def txt2img(req: Txt2ImgRequest):
    if pipe is None:
        if model_loading:
            raise HTTPException(status_code=503, detail="Stable Diffusion model is still loading. Please try again shortly.")
        if model_error:
            raise HTTPException(status_code=503, detail=f"Stable Diffusion model failed to load: {model_error}")
        load_pipeline()

    if pipe is None:
        raise HTTPException(status_code=503, detail="Stable Diffusion model is not available.")

    try:
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
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}")


# Serve the frontend static site from the project root after API routes
app.mount("/", StaticFiles(directory="/app", html=True), name="static")
