"""Generate the SAMPLE project photos for the lab through a local ComfyUI (SDXL, RealVisXL). These are synthetic demo images, never real jobs.

   python tools/generate_sample_photos.py            (ComfyUI must answer on 127.0.0.1:8188)

Writes assets/source/<id>.png and assets/source/manifest.json (id, prompt, seed). Re-running is deterministic per seed.
"""
import json
import os
import time
import urllib.request

HOST = "http://127.0.0.1:8188"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "source")
os.makedirs(OUT, exist_ok=True)

STYLE = "professional real estate photograph, natural light, sharp focus, 35mm, no people, no text"
NEG = "people, person, text, watermark, logo, signature, cartoon, painting, blurry, distorted, extra roof, warped lines"

PHOTOS = [
    ("hero-metal-dusk", "modern west coast house with a dark standing seam metal roof at dusk, evergreen forest and mountains behind, warm interior lights"),
    ("metal-standing-seam-west-van", "charcoal standing seam metal roof on a contemporary house, vertical seams, clean ridge cap, pacific northwest garden"),
    ("asphalt-shingle-replacement", "freshly installed architectural asphalt shingle roof in weathered grey on a two storey family home, tidy ridge, gutters"),
    ("cedar-shake-craftsman", "new cedar shake roof on a craftsman style house, warm brown cedar, stone chimney, pacific northwest trees"),
    ("cedar-before-moss", "old weathered cedar shake roof thickly covered in moss and dark staining, worn edges, overcast day"),
    ("flat-roof-tpo", "white TPO membrane flat roof on a modern house, seams welded, drain and parapet detail, clear day"),
    ("flat-torch-on", "dark torch-on modified bitumen flat roof over a small deck, neat overlaps, sealed edges"),
    ("skylight-flashing", "skylight on a pitched roof with clean flashing and curb, asphalt shingles around it, blue sky"),
    ("solar-array-gable", "rooftop solar panel array on a south facing gable roof, black panels, aluminium frames, mountains and ocean in the far distance"),
    ("complex-roof-valleys", "complicated residential roof with several valleys, dormers and hips, composite slate shingles, three quarter aerial view"),
    ("composite-slate-detail", "close up of composite synthetic slate roofing tiles in dark grey, clean edge and overlap"),
    ("valley-flashing-detail", "close up of a roof valley with metal flashing and shingle overlap, clean and tight"),
    ("chimney-step-flashing", "brick chimney with step flashing and counter flashing on an asphalt shingle roof, sealed neatly"),
    ("ridge-vent-detail", "ridge cap and ridge vent on a new asphalt shingle roof, straight lines, clear sky"),
]


def post(path, payload):
    req = urllib.request.Request(HOST + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def get(path):
    return urllib.request.urlopen(HOST + path, timeout=120).read()


def graph(prompt, seed):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "realvisxlV50_bakedvae.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt + ", " + STYLE, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 1344, "height": 896, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 32, "cfg": 5.5, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0, "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0]}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"filename_prefix": "roofing_lab", "images": ["6", 0]}},
    }


def main():
    manifest = []
    for i, (pid, prompt) in enumerate(PHOTOS):
        target = os.path.join(OUT, pid + ".png")
        seed = 7000 + i
        manifest.append({"id": pid, "prompt": prompt, "seed": seed})
        if os.path.exists(target):
            continue
        qid = post("/prompt", {"prompt": graph(prompt, seed)})["prompt_id"]
        for _ in range(240):
            time.sleep(2)
            hist = json.loads(get("/history/" + qid))
            if qid in hist and hist[qid].get("outputs"):
                img = hist[qid]["outputs"]["7"]["images"][0]
                data = get("/view?filename=%s&subfolder=%s&type=%s" % (img["filename"], img["subfolder"], img["type"]))
                open(target, "wb").write(data)
                print("ok", pid, len(data))
                break
        else:
            print("TIMEOUT", pid)
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
